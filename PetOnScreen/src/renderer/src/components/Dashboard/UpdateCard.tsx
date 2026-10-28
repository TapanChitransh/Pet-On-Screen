import { useEffect, useState } from 'react'
import type { AppSettings, UpdateState } from '@shared/types'

/** Subscribes to the updater in the main process. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.petApi.updateGetState().then(setState)
    return window.petApi.on<UpdateState>('update:state', setState)
  }, [])
  return state
}

function when(ts: number | null): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`
  return new Date(ts).toLocaleDateString()
}

/** Minimal rendering of GitHub release notes: headings, bullets, paragraphs, bare links. */
function Notes({ text }: { text: string }): JSX.Element | null {
  // The release workflow runs one job per platform, and each appends the same generated notes.
  const seen = new Set<string>()
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => {
      const key = l.trim()
      if (key && seen.has(key)) return false
      if (key) seen.add(key)
      return true
    })
  if (lines.every((l) => !l.trim())) return null
  const out: JSX.Element[] = []
  let bullets: string[] = []
  const flush = (): void => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="plain">
          {bullets.map((b, i) => (
            <li key={i}>{linkify(b)}</li>
          ))}
        </ul>
      )
      bullets = []
    }
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      bullets.push(bullet[1])
      continue
    }
    flush()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) out.push(<h4 key={`h-${out.length}`}>{heading[1].replace(/\*\*/g, '')}</h4>)
    else out.push(<p key={`p-${out.length}`}>{linkify(line.replace(/\*\*/g, ''))}</p>)
  }
  flush()
  return <div className="update-notes">{out}</div>
}

function linkify(s: string): React.ReactNode {
  const parts = s.split(/(https?:\/\/\S+)/g)
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} onClick={(e) => (e.preventDefault(), window.petApi.openExternal(p))}>
        {p.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
      </a>
    ) : (
      // Strip "by @user in #123" noise GitHub appends to generated notes.
      p.replace(/\s+by @\S+ in \S+$/, '')
    )
  )
}

interface Props {
  settings: AppSettings
  /** Full card (settings tab) or the compact banner shown above every tab. */
  variant: 'card' | 'banner'
}

export function UpdateCard({ settings, variant }: Props): JSX.Element | null {
  const u = useUpdateState()
  if (!u) return null
  const update = (patch: Partial<AppSettings>): void => void window.petApi.updateSettings(patch)
  const latest = u.latest
  const newer = u.status === 'available' || u.status === 'downloading' || u.status === 'downloaded'

  if (variant === 'banner') {
    if (!newer || !latest) return null
    return (
      <div className={`update-banner ${u.status}`}>
        <span className="update-banner-icon">🎁</span>
        <div className="update-banner-text">
          <strong>PetOnScreen {latest.version} is {u.status === 'downloaded' ? 'ready to install' : u.status === 'downloading' ? 'downloading…' : 'available'}</strong>
          <span className="muted small">
            {u.status === 'downloading' ? `${Math.round(u.progress * 100)}% · installs when you quit, or restart now` : u.status === 'downloaded' ? 'It installs on the next quit, or restart now.' : `You have ${u.current}.`}
          </span>
        </div>
        {u.status === 'downloading' && (
          <div className="update-track">
            <div className="update-fill" style={{ width: `${Math.round(u.progress * 100)}%` }} />
          </div>
        )}
        <div className="spacer" />
        {u.status === 'downloaded' && (
          <button className="btn primary small" onClick={() => window.petApi.updateInstall()}>
            Restart to update
          </button>
        )}
        {u.status === 'available' && u.native && (
          <button className="btn primary small" onClick={() => window.petApi.updateDownload()}>
            Download
          </button>
        )}
        {u.status === 'available' && !u.native && (
          <button className="btn primary small" onClick={() => window.petApi.updateOpenRelease()}>
            Get it
          </button>
        )}
        <button className="btn ghost small" onClick={() => window.petApi.openDashboard('settings')} title="Details and what's new">
          What's new
        </button>
      </div>
    )
  }

  const statusLine = (): string => {
    switch (u.status) {
      case 'idle':
        return 'Not checked yet'
      case 'checking':
        return 'Checking GitHub for a newer release…'
      case 'up-to-date':
        return `You're on the latest version${u.checkedAt ? ` · checked ${when(u.checkedAt)}` : ''}`
      case 'available':
        return u.native ? `Version ${latest?.version} is available` : `Version ${latest?.version} is available to download`
      case 'downloading':
        return `Downloading ${latest?.version}… ${Math.round(u.progress * 100)}%`
      case 'downloaded':
        return `Version ${latest?.version} is downloaded and will install when you quit`
      case 'error':
        return u.error ?? 'Update check failed'
    }
  }

  return (
    <div className={`card update-card${newer ? ' newer' : ''}`}>
      <div className="update-head">
        <div>
          <h3>Updates</h3>
          <div className="muted small">
            Installed: v{u.current}
            {latest && latest.version !== u.current ? ` · Latest: v${latest.version}` : ''}
          </div>
        </div>
        <div className="update-head-actions">
          {u.status === 'downloaded' && (
            <button className="btn primary small" onClick={() => window.petApi.updateInstall()}>
              Restart to update
            </button>
          )}
          {u.status === 'available' && u.native && (
            <button className="btn primary small" onClick={() => window.petApi.updateDownload()}>
              Download update
            </button>
          )}
          {u.status === 'available' && !u.native && (
            <button className="btn primary small" onClick={() => window.petApi.updateOpenRelease()}>
              Download from GitHub
            </button>
          )}
          <button className="btn small" disabled={u.status === 'checking' || u.status === 'downloading'} onClick={() => window.petApi.updateCheck()}>
            {u.status === 'checking' ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>
      <p className={`update-status${u.status === 'error' ? ' error' : ''}`}>{statusLine()}</p>
      {u.status === 'downloading' && (
        <div className="update-track">
          <div className="update-fill" style={{ width: `${Math.round(u.progress * 100)}%` }} />
        </div>
      )}
      <label className="row toggle">
        <div className="row-label">
          <div>Update automatically</div>
          <div className="muted small">{u.native ? 'Download new versions in the background and install them when you quit' : 'Check for new versions on launch and every few hours'}</div>
        </div>
        <div className="row-control">
          <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => update({ autoUpdate: e.target.checked })} />
          <span className="switch" />
        </div>
      </label>
      {!u.native && (
        <p className="muted small">
          {u.current && window.navigator.platform.toLowerCase().includes('mac')
            ? 'Mac builds are not code-signed yet, so new versions are offered as a download rather than installed in place.'
            : 'In-place installation works in the installed build; this build can only point you to the download.'}
        </p>
      )}
      {latest && (
        <div className="update-latest">
          <h4>
            {newer ? "What's new in" : 'Latest release:'} v{latest.version}
            {latest.publishedAt && <span className="muted small"> · {new Date(latest.publishedAt).toLocaleDateString()}</span>}
          </h4>
          {latest.notes.trim() ? <Notes text={latest.notes} /> : <p className="muted small">No release notes were written for this version.</p>}
          <button className="btn ghost small" onClick={() => window.petApi.openExternal(latest.pageUrl)}>
            Open release page
          </button>
        </div>
      )}
    </div>
  )
}
