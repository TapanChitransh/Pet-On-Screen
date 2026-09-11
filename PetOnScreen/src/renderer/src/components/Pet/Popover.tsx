import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  x: number
  y: number
  width?: number
  className?: string
  children: ReactNode
}

/** Positions a floating panel near an anchor point and keeps it fully inside the window. */
export function Popover({ x, y, width = 240, className = '', children }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x - width / 2, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let left = x - rect.width / 2
    let top = y - rect.height
    if (top < margin) top = Math.min(window.innerHeight - rect.height - margin, y + 20)
    left = Math.max(margin, Math.min(window.innerWidth - rect.width - margin, left))
    top = Math.max(margin, Math.min(window.innerHeight - rect.height - margin, top))
    setPos({ left, top })
  }, [x, y, width, children])

  return (
    <div ref={ref} className={`popover ${className}`} style={{ left: pos.left, top: pos.top, width }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  )
}
