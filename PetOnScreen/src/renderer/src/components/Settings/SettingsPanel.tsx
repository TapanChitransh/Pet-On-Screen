import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import type { DashboardState } from '../Dashboard/DashboardApp'
import { UpdateCard } from '../Dashboard/UpdateCard'

const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (default)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)' }
]

export function SettingsPanel({ state }: { state: DashboardState }): JSX.Element {
  const s = state.settings
  const update = (patch: Partial<AppSettings>): void => void window.petApi.updateSettings(patch)
  const [owner, setOwner] = useState(s.ownerName)
  const [apiKey, setApiKey] = useState(s.aiApiKey)
  useEffect(() => setOwner(s.ownerName), [s.ownerName])
  useEffect(() => setApiKey(s.aiApiKey), [s.aiApiKey])

  return (
    <section>
      <h1>Settings</h1>

      <div className="card">
        <h3>Desktop pet</h3>
        <Row label="Pet size" hint={`${Math.round(s.petScale * 100)}%`}>
          <input type="range" min={0.5} max={2.5} step={0.05} value={s.petScale} onChange={(e) => update({ petScale: Number(e.target.value) })} />
        </Row>
        <Row label="Monitor">
          <select value={s.displayId ?? ''} onChange={(e) => update({ displayId: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Primary display</option>
            {state.displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.bounds.width}×{d.bounds.height})
              </option>
            ))}
          </select>
        </Row>
        <Toggle label="Always on top" hint="Keep the pet above other windows" checked={s.alwaysOnTop} onChange={(v) => update({ alwaysOnTop: v })} />
        <Toggle label="Click-through mode" hint="The pet never captures the mouse. Use the tray or dashboard to interact." checked={s.clickThrough} onChange={(v) => update({ clickThrough: v })} />
        <Toggle label="Free roam" hint="Let the pet leave the floor and wander anywhere on screen" checked={s.freeRoam} onChange={(v) => update({ freeRoam: v })} />
        <Toggle label="Pause pet" hint="Freeze the pet in place" checked={s.paused} onChange={(v) => update({ paused: v })} />
        <Toggle label="Show pet" checked={s.petVisible} onChange={(v) => update({ petVisible: v })} />
      </div>

      <UpdateCard settings={s} variant="card" />

      <div className="card">
        <h3>System</h3>
        <Toggle
          label="Start with system"
          hint={state.isPackaged ? 'Launch PetOnScreen when you log in' : 'Available in the installed build (npm run dist), not in dev mode'}
          checked={s.startWithOS}
          disabled={!state.isPackaged}
          onChange={(v) => update({ startWithOS: v })}
        />
        <Row label="Break reminder" hint={s.breakReminderMinutes === 0 ? 'off' : `after ${s.breakReminderMinutes} min of continuous activity`}>
          <input type="range" min={0} max={180} step={15} value={s.breakReminderMinutes} onChange={(e) => update({ breakReminderMinutes: Number(e.target.value) })} />
        </Row>
        <p className="muted small">Activity detection only asks the OS how long since the last input. Nothing you type or click is ever read.</p>
      </div>

      <div className="card">
        <h3>Sound</h3>
        <Toggle label="Sounds" hint="Tiny synthesized voice, eating, jump and sleep sounds" checked={s.soundEnabled} onChange={(v) => update({ soundEnabled: v })} />
        <Row label="Volume" hint={`${Math.round(s.volume * 100)}%`}>
          <input type="range" min={0} max={1} step={0.05} value={s.volume} disabled={!s.soundEnabled} onChange={(e) => update({ volume: Number(e.target.value) })} />
        </Row>
      </div>

      <div className="card">
        <h3>Voice commands</h3>
        <Toggle label="Listen for commands" hint="Right-click the pet → Train to teach commands by voice" checked={s.voiceEnabled} onChange={(v) => update({ voiceEnabled: v })} />
        <p className="muted small">
          Speech is recognized on this computer by a small Whisper model (downloaded once, about 40 MB, then cached). Audio never leaves your machine and is discarded right after each phrase. Treats you give after a spoken command teach the pet your voice, so a trained pet
          obeys you and not whoever else is in the room.
        </p>
      </div>

      <div className="card">
        <h3>You</h3>
        <Row label="Your name" hint="Your pet will use it">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              update({ ownerName: owner.trim() })
            }}
          >
            <input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={24} placeholder="e.g. Sam" />
            <button className="btn small" type="submit" disabled={owner.trim() === s.ownerName}>
              Save
            </button>
          </form>
        </Row>
      </div>

      <div className="card">
        <h3>AI conversation (optional)</h3>
        <p className="muted small">
          Without a key, Talk uses built-in local replies based on your pet's stats and memories. With a Claude API key, replies come from Claude speaking as your pet. The key is stored only in your local settings file and used only from this
          app.
        </p>
        <Row label="Claude API key">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              update({ aiApiKey: apiKey.trim() })
            }}
          >
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" />
            <button className="btn small" type="submit" disabled={apiKey.trim() === s.aiApiKey}>
              Save
            </button>
            {s.aiApiKey && (
              <button className="btn ghost small" type="button" onClick={() => update({ aiApiKey: '' })}>
                Remove
              </button>
            )}
          </form>
        </Row>
        <Row label="Model">
          <select value={s.aiModel} onChange={(e) => update({ aiModel: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Row>
      </div>

      <p className="muted small">Data file: {state.dataPath}</p>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="row">
      <div className="row-label">
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className={`row toggle${disabled ? ' disabled' : ''}`}>
      <div className="row-label">
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <div className="row-control">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch" />
      </div>
    </label>
  )
}
