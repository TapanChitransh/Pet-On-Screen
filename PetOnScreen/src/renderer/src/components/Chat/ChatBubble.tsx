import { useEffect, useRef, useState } from 'react'
import type { PetRuntime } from '@renderer/runtime/PetRuntime'
import type { ChatMessage } from '@shared/types'
import { Popover } from '../Pet/Popover'

interface Props {
  x: number
  y: number
  runtime: PetRuntime
  onClose: () => void
}

export function ChatBubble({ x, y, runtime, onClose }: Props): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const useAi = runtime.settings.aiApiKey.length > 0
  const name = runtime.engine.pet.name

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  const send = async (): Promise<void> => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', text: t, at: Date.now() }])
    try {
      const reply = await runtime.talk(t)
      setMessages((m) => [...m, { role: 'pet', text: reply.text, at: Date.now() }])
      if (reply.error) setNote(reply.error === 'refusal' ? 'AI reply unavailable for that, answered locally.' : `AI unavailable (${reply.error}), answered locally.`)
      else setNote(null)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <Popover x={x} y={y} width={300} className="chat">
      <div className="menu-title">
        <span>💬 Talk to {name}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="chat-mode muted small">{useAi ? `Claude · ${runtime.settings.aiModel}` : 'Local replies · add a Claude API key in Settings for AI conversation'}</div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <div className="muted small chat-empty">Say hi, ask if {name} is hungry, or introduce yourself.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="chat-msg pet typing">…</div>}
      </div>
      {note && <div className="chat-note small">{note}</div>}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Say something to ${name}…`} maxLength={200} />
        <button type="submit" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </Popover>
  )
}
