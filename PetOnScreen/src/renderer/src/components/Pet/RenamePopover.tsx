import { useEffect, useRef, useState } from 'react'
import type { PetRuntime } from '@renderer/runtime/PetRuntime'
import { Popover } from './Popover'

interface Props {
  x: number
  y: number
  runtime: PetRuntime
  onClose: () => void
}

export function RenamePopover({ x, y, runtime, onClose }: Props): JSX.Element {
  const [name, setName] = useState(runtime.engine.pet.name)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const submit = (): void => {
    const clean = name.trim()
    if (clean && clean !== runtime.engine.pet.name) runtime.command({ type: 'rename', name: clean })
    onClose()
  }

  return (
    <Popover x={x} y={y} width={240} className="rename">
      <div className="menu-title">
        <span>✏️ Rename</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        <button type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </Popover>
  )
}
