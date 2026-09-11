import type { EventFx } from '@engine/EventEngine'

const GLYPHS: Record<NonNullable<EventFx>, string[]> = {
  hearts: ['💗', '💕', '💗'],
  sparkle: ['✨', '⭐', '✨'],
  zzz: ['z', 'z', 'Z'],
  question: ['?'],
  exclaim: ['!'],
  music: ['♪', '♫', '♪'],
  gift: ['🎁']
}

/** Short-lived floating particles above the pet. Re-mounted (via key) whenever a new effect fires. */
export function Fx({ kind }: { kind: NonNullable<EventFx> }): JSX.Element {
  const glyphs = GLYPHS[kind]
  return (
    <div className={`fx fx-${kind}`} aria-hidden>
      {glyphs.map((g, i) => (
        <span key={i} className="fx-glyph" style={{ animationDelay: `${i * 0.18}s`, left: `${35 + i * 15}%` }}>
          {g}
        </span>
      ))}
    </div>
  )
}
