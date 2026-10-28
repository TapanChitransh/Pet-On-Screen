import { useEffect, useRef, useState } from 'react'
import type { PetRuntime } from '@renderer/runtime/PetRuntime'
import type { VoiceState } from '@renderer/runtime/VoiceService'
import type { CommandOutcome } from '@engine/PetEngine'
import { COMMANDS, COMMAND_IDS, skillLabel, skillOf } from '@models/Commands'
import { FULL_OWNER_SAMPLES, MIN_OWNER_SAMPLES, ownerConfidence } from '@engine/Voiceprint'
import { Popover } from './Popover'

interface Props {
  x: number
  y: number
  runtime: PetRuntime
  onClose: () => void
}

function statusLine(v: VoiceState): string {
  switch (v.status) {
    case 'off':
      return 'Microphone off'
    case 'starting':
      return 'Asking for the microphone…'
    case 'downloading':
      return `Downloading the speech model (once, ~40 MB)… ${Math.round(v.progress * 100)}%`
    case 'loading':
      return 'Loading the speech model…'
    case 'listening':
      return 'Listening'
    case 'hearing':
      return 'Hearing you…'
    case 'thinking':
      return 'Working out what you said…'
    case 'error':
      return v.error ?? 'Something went wrong'
  }
}

function describe(o: CommandOutcome): string {
  const name = o.id ? COMMANDS[o.id].label.toLowerCase() : null
  switch (o.kind) {
    case 'command': {
      if (o.refusedStranger) return `${name}: ignored · not the owner's voice`
      const base = `${name}: ${o.obeyed ? 'obeyed' : 'ignored'}`
      if (o.milestone === 'learned') return `${base} · mastered!`
      if (o.milestone === 'learning') return `${base} · getting the hang of it`
      return o.level !== null ? `${base} · level ${Math.round(o.level)}` : base
    }
    case 'praise':
      return name ? `praise · "${name}" reinforced` : 'praise · happy, but nothing recent to reinforce'
    case 'scold':
      return name ? `scold · learned not to ignore "${name}"` : 'scold · that stung'
    case 'treat':
      if (!o.treatGiven) return 'treat · none left'
      return name ? `treat · "${name}" reinforced${o.milestone === 'learned' ? ' · mastered!' : ''}` : 'treat · eaten, nothing recent to reinforce'
    default:
      return 'not a command'
  }
}

export function TrainPopover({ x, y, runtime, onClose }: Props): JSX.Element {
  const [, force] = useState(0)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => runtime.subscribeVoice(() => force((n) => n + 1)), [runtime])
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const pet = runtime.engine.pet
  const voice = runtime.voice.state
  const on = runtime.settings.voiceEnabled
  const last = runtime.lastCommand
  const busy = voice.status === 'starting' || voice.status === 'downloading' || voice.status === 'loading'
  const treats = pet.inventory.treat ?? 0
  const owner = pet.training.owner
  const samples = owner?.n ?? 0
  const confidence = ownerConfidence(owner)
  const speaker = runtime.lastSpeaker
  const mastered = COMMAND_IDS.filter((id) => skillOf(pet.training, id).level >= 75).length

  const send = (): void => {
    const t = text.trim()
    if (!t) return
    setText('')
    runtime.heard(t)
    inputRef.current?.focus()
  }

  return (
    <Popover x={x} y={y} width={320} className="train">
      <div className="menu-title">
        <span>🎓 Train {pet.name}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="train-mic">
        <button className={`train-mic-btn${on ? ' on' : ''}`} onClick={() => runtime.setVoice(!on)} disabled={busy} aria-pressed={on}>
          {on ? '⏹ Stop listening' : '🎤 Listen'}
        </button>
        <div className="train-status">
          <div className={`train-status-text${voice.status === 'error' ? ' error' : ''}`}>{statusLine(voice)}</div>
          {voice.status === 'downloading' && (
            <div className="train-track">
              <div className="train-fill" style={{ width: `${Math.round(voice.progress * 100)}%` }} />
            </div>
          )}
          {(voice.status === 'listening' || voice.status === 'hearing' || voice.status === 'thinking') && (
            <div className="train-track level">
              <div className="train-fill" style={{ width: `${Math.round(voice.level * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      <div className="train-heard">
        {voice.lastText || last ? (
          <>
            {voice.lastText && (
              <div>
                <span className="muted">heard: </span>“{voice.lastText}”
                {voice.lastAt && last?.speaker !== undefined && speaker !== 'unknown' && <span className={`train-speaker ${speaker}`}>{speaker === 'owner' ? 'your voice' : 'someone else'}</span>}
              </div>
            )}
            {last && (
              <div>
                <span className="muted">→ </span>
                {describe(last)}
              </div>
            )}
          </>
        ) : (
          <span className="muted small">
            Say a command, then give a treat within 20 seconds when {pet.name} gets it right. Repeating alone barely works; treats are what teach. Praise (“good {pet.name}”) helps a little, “no” after a miss teaches
            the boundary.
          </span>
        )}
      </div>

      <div className="train-actions">
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="or type: sit, come, good boy…" maxLength={60} />
          <button type="submit" disabled={!text.trim()}>
            Say
          </button>
        </form>
        <button className={`train-treat${treats === 0 ? ' empty' : ''}`} onClick={() => runtime.heard('treat')} title={treats ? 'Give a treat: rewards what the pet just did right' : 'No treats left. Your pet finds more while exploring.'}>
          🍪 Treat <span className="muted">×{treats}</span>
        </button>
      </div>

      <div className="train-list">
        {COMMAND_IDS.map((id) => {
          const s = skillOf(pet.training, id)
          const def = COMMANDS[id]
          return (
            <div key={id} className="train-row" title={`Say: ${def.phrases.slice(0, 3).join(' · ')}${s.heard ? ` — obeyed ${s.obeyed} of ${s.heard}` : ''}`}>
              <span className="train-cmd">
                {def.emoji} {def.label}
              </span>
              <div className="train-track">
                <div className={`train-fill${s.level >= 75 ? ' mastered' : ''}`} style={{ width: `${Math.round(s.level)}%` }} />
              </div>
              <span className="train-skill muted">{skillLabel(s.level)}</span>
            </div>
          )
        })}
      </div>

      <div className="train-owner">
        <div className="train-owner-head">
          <span>🔊 Knows your voice</span>
          <span className="muted">{samples < MIN_OWNER_SAMPLES ? `${samples}/${MIN_OWNER_SAMPLES} samples` : confidence >= 1 ? 'yes' : `${Math.round(confidence * 100)}%`}</span>
        </div>
        <div className="train-track">
          <div className="train-fill voice" style={{ width: `${Math.round(Math.min(1, samples / FULL_OWNER_SAMPLES) * 100)}%` }} />
        </div>
        <div className="muted small">
          {samples < MIN_OWNER_SAMPLES
            ? `Every spoken command you reward with a treat teaches ${pet.name} your voice. Until then it listens to anyone.`
            : mastered > 0
              ? `${pet.name} only takes its mastered command${mastered === 1 ? '' : 's'} from you. Other voices get a puzzled look.`
              : `${pet.name} recognizes you. Once a command is mastered, it will only obey it from you.`}
        </div>
      </div>
    </Popover>
  )
}
