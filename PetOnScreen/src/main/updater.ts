import { app, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { compareVersions } from '@shared/version'

export const RELEASES_URL = 'https://github.com/TapanChitransh/Pet-On-Screen/releases'
const LATEST_API = 'https://api.github.com/repos/TapanChitransh/Pet-On-Screen/releases/latest'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 20_000

export interface UpdaterOptions {
  autoDownload: () => boolean
  onState: (state: UpdateState) => void
}

/**
 * Keeps the app current. Installed builds use electron-updater against the GitHub Releases of
 * TapanChitransh/Pet-On-Screen (update metadata `latest.yml` / `latest-mac.yml` is produced by
 * electron-builder because package.json has a `publish` entry): checks on launch and every six
 * hours, downloads in the background when the "Update automatically" setting is on, and installs
 * either when the user clicks "Restart to update" or silently on the next quit.
 *
 * When electron-updater cannot run (dev mode, an unsigned macOS build, or a platform without an
 * installer), the GitHub API is asked for the latest release instead, so the dashboard still shows
 * what is new and offers the download page.
 */
export class Updater {
  state: UpdateState
  private timer: NodeJS.Timeout | null = null
  private readonly native: boolean

  constructor(private readonly opts: UpdaterOptions) {
    const current = process.env['PETONSCREEN_UPDATE_FROM'] || app.getVersion()
    this.state = { status: 'idle', current, latest: null, progress: 0, error: null, checkedAt: null, native: false }
    // Squirrel.Mac refuses unsigned apps; Windows NSIS and Linux AppImage work unsigned.
    this.native = app.isPackaged && !process.env['PETONSCREEN_UPDATE_FROM'] && process.platform !== 'darwin'
    this.state.native = this.native
    if (this.native) this.wire()
  }

  start(): void {
    setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.state
    this.set({ status: 'checking', error: null })
    try {
      if (this.native) {
        autoUpdater.autoDownload = this.opts.autoDownload()
        const result = await autoUpdater.checkForUpdates()
        // Events update the state; a null result means the updater is disabled for this build.
        if (!result) this.set({ status: 'up-to-date', checkedAt: Date.now() })
      } else {
        await this.checkViaApi()
      }
    } catch (err) {
      this.set({ status: 'error', error: friendly(err), checkedAt: Date.now() })
    }
    return this.state
  }

  async download(): Promise<void> {
    if (!this.native || this.state.status !== 'available') return
    try {
      this.set({ status: 'downloading', progress: 0 })
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.set({ status: 'error', error: friendly(err) })
    }
  }

  /** Quit and install right away (the renderer flushes its save on before-quit first). */
  install(): void {
    if (this.state.status !== 'downloaded') return
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }

  openReleasePage(): void {
    void shell.openExternal(this.state.latest?.url ?? RELEASES_URL)
  }

  /* ------------------------------------------------------------------ native */

  private wire(): void {
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = null
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      const latest = describe(info)
      const downloading = autoUpdater.autoDownload
      this.set({ status: downloading ? 'downloading' : 'available', latest, progress: 0, checkedAt: Date.now() })
    })
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.set({ status: 'up-to-date', latest: describe(info), checkedAt: Date.now() })
    })
    autoUpdater.on('download-progress', (p: { percent: number }) => {
      this.set({ status: 'downloading', progress: Math.max(0, Math.min(1, p.percent / 100)) })
    })
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.set({ status: 'downloaded', latest: describe(info), progress: 1 })
    })
    autoUpdater.on('error', (err: Error) => {
      this.set({ status: 'error', error: friendly(err), checkedAt: Date.now() })
    })
  }

  /* --------------------------------------------------------------- fallback */

  private async checkViaApi(): Promise<void> {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `PetOnScreen/${this.state.current}` } })
    if (res.status === 404) {
      this.set({ status: 'up-to-date', latest: null, checkedAt: Date.now() })
      return
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const rel = (await res.json()) as { tag_name: string; name: string | null; body: string | null; html_url: string; published_at: string | null; assets: { name: string; browser_download_url: string }[] }
    const version = rel.tag_name.replace(/^v/, '')
    const asset = pickAsset(rel.assets)
    const latest = { version, notes: rel.body ?? '', url: asset?.browser_download_url ?? rel.html_url, pageUrl: rel.html_url, publishedAt: rel.published_at ? Date.parse(rel.published_at) : null }
    this.set({ status: compareVersions(version, this.state.current) > 0 ? 'available' : 'up-to-date', latest, checkedAt: Date.now() })
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.opts.onState(this.state)
  }
}

function describe(info: UpdateInfo): NonNullable<UpdateState['latest']> {
  const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : Array.isArray(info.releaseNotes) ? info.releaseNotes.map((n) => n.note ?? '').join('\n') : ''
  return {
    version: info.version,
    notes: stripHtml(notes),
    url: `${RELEASES_URL}/tag/v${info.version}`,
    pageUrl: `${RELEASES_URL}/tag/v${info.version}`,
    publishedAt: info.releaseDate ? Date.parse(info.releaseDate) : null
  }
}

function pickAsset(assets: { name: string; browser_download_url: string }[]): { name: string; browser_download_url: string } | null {
  const want = process.platform === 'win32' ? /\.exe$/i : process.platform === 'darwin' ? (process.arch === 'arm64' ? /arm64\.dmg$/i : /x64\.dmg$/i) : /\.AppImage$/i
  return assets.find((a) => want.test(a.name)) ?? null
}

/** Release notes from the GitHub provider arrive as HTML; the dashboard renders plain text. */
function stripHtml(s: string): string {
  return s
    .replace(/<li>/gi, '- ')
    .replace(/<\/(p|li|h\d|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|net::ERR/i.test(msg)) return 'Could not reach GitHub. Check your connection and try again.'
  if (/404/.test(msg)) return 'No update information was published for this platform yet.'
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg
}
