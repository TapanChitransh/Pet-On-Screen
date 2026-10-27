import { useId, type CSSProperties, type ReactNode } from 'react'
import type { SpeciesLook } from '@models/Species'
import type { AnimationName } from '@models/Behavior'

export interface SpriteVisual {
  animation: AnimationName
  facing: 1 | -1
  gait: 'trot' | 'hop' | 'waddle' | 'prowl'
  faceViewer: boolean
  hidden: boolean
  moving: boolean
  /**
   * Eye direction. In the pet window this is omitted: PetRuntime writes --look-x/--look-y straight
   * to the head layer so cursor movement never re-renders React.
   */
  lookAt?: { dx: number; dy: number } | null
  /** Dashboard previews have no runtime driving the breathing transform, so they opt into a cheap CSS breathe. */
  preview?: boolean
  /** out of breath: tongue out */
  panting?: boolean
}

interface Props {
  look: SpeciesLook
  visual: SpriteVisual
  /** Extra class names, e.g. for the dashboard preview. */
  className?: string
}

const VIEWBOX = '0 0 120 110'
const pct = (x: number, y: number): string => `${((x / 120) * 100).toFixed(1)}% ${((y / 110) * 100).toFixed(1)}%`

/** Mixes a #rgb/#rrggbb color toward black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  let h = m[1]
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const target = amount < 0 ? 0 : 255
  const a = Math.abs(amount)
  const ch = (i: number): string => {
    const v = parseInt(h.slice(i, i + 2), 16)
    return Math.round(v + (target - v) * a)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${ch(0)}${ch(2)}${ch(4)}`
}

/**
 * Procedural placeholder sprite. Three archetypes (quadruped, upright bird, human) are built from
 * the same named parts (.tail .leg .torso .body .head .wing) so the clips in sprite.css work for all.
 *
 * Performance notes (measured, see README):
 * - each animated part is its own absolutely positioned <div> holding a small SVG, so transforms
 *   are composited on the GPU instead of re-painting the SVG every frame;
 * - always-on idle motion (breathing, tail, blink, ear twitch, eye tracking, head follow) is driven by
 *   PetRuntime at ~8Hz, not by 60fps CSS keyframes; the head's `motion` wrapper carries the head
 *   turn/tilt so it composes with the pose transform on .part.head;
 * - state loops in sprite.css use steps() so they update ~10-25 times a second.
 */
export function PetSprite({ look, visual, className = '' }: Props): JSX.Element {
  const style: CSSProperties = {
    ['--body' as string]: look.body,
    ['--belly' as string]: look.belly,
    ['--accent' as string]: look.accent,
    // Static per species, so setting them on the root never triggers per-frame repaints.
    ['--body-dark' as string]: shade(look.body, -0.16),
    ['--outline' as string]: shade(look.body, -0.45),
    transform: `scaleX(${visual.facing})`
  }
  if (visual.lookAt) {
    style['--look-x' as never] = visual.lookAt.dx as never
    style['--look-y' as never] = visual.lookAt.dy as never
  }
  const classes = [
    'sprite-wrap',
    `anim-${visual.animation}`,
    `gait-${visual.gait}`,
    look.archetype,
    `face-${look.snout}`,
    visual.faceViewer ? 'face-viewer' : '',
    visual.hidden ? 'is-hidden' : '',
    visual.preview ? 'preview' : '',
    // Standing still inside a walk/run clip (mid-walk pause, braking): the legs rest instead of pedalling the air.
    !visual.moving && (visual.animation === 'walk' || visual.animation === 'run') ? 'is-still' : '',
    visual.panting ? 'is-panting' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} style={style}>
      <Layer className="shadow-layer">
        <ellipse className="shadow" cx="62" cy="104" rx="30" ry="4" />
      </Layer>
      {look.archetype === 'quadruped' && <Quadruped look={look} />}
      {look.archetype === 'upright' && <Upright look={look} />}
      {look.archetype === 'human' && <Human look={look} />}
      <Layer className="props">
        <g className="bowl">
          <ellipse cx="108" cy="102" rx="11" ry="4" fill="#5b6fd6" />
          <ellipse cx="108" cy="99" rx="8" ry="2.5" fill="#c68a4a" />
        </g>
        <g className="puddle">
          <ellipse cx="108" cy="103" rx="12" ry="3.5" fill="#7cc4ff" opacity="0.8" />
        </g>
        <g className="splash">
          <circle cx="30" cy="86" r="3" fill="#7cc4ff" />
          <circle cx="92" cy="80" r="2.5" fill="#7cc4ff" />
          <circle cx="60" cy="40" r="2" fill="#7cc4ff" />
        </g>
        <text className="snack" x="86" y="86" fontSize="14">
          🥪
        </text>
        <text className="cup" x="86" y="84" fontSize="13">
          ☕
        </text>
        <text className="book" x="84" y="84" fontSize="14">
          📖
        </text>
      </Layer>
      <div className="part ball">
        <svg viewBox={VIEWBOX}>
          <circle cx="108" cy="97" r="6" fill="#ffcc33" />
          <path d="M103 95 q5 4 10 0" stroke="#e08a00" strokeWidth="1.2" fill="none" />
        </svg>
      </div>
      <div className="zzz" aria-hidden>
        <span className="z z1">z</span>
        <span className="z z2">z</span>
        <span className="z z3">Z</span>
      </div>
    </div>
  )
}

/**
 * A full-size SVG layer; children are drawn in the shared 120x110 coordinate space.
 * `motion` adds an inner wrapper that carries the runtime-driven idle motion transform, kept
 * separate from the pose transform on .part so the two compose and only the pose has a transition.
 */
function Layer({ className, motion = false, origin, children }: { className: string; motion?: boolean; origin?: string; children: ReactNode }): JSX.Element {
  const svg = (
    <svg viewBox={VIEWBOX} xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  )
  const style = origin ? { transformOrigin: origin } : undefined
  return (
    <div className={`part ${className}`} style={style}>
      {motion ? (
        <div className="idle-motion" style={style}>
          {svg}
        </div>
      ) : (
        svg
      )}
    </div>
  )
}

interface EyeProps {
  cx: number
  cy: number
  r?: number
  angry?: boolean
  iris?: string
  /** draw a white eyeball around the pupil (owl); otherwise a glossy toon eye */
  sclera?: boolean
  /** color of the skin the eye sits on, used for the eyelid */
  lid?: string
}

function Eye({ cx, cy, r = 3.6, angry = false, iris, sclera = false, lid = 'var(--body)' }: EyeProps): JSX.Element {
  const ink = '#1d1d24'
  return (
    <g className="eye">
      {sclera && <circle cx={cx} cy={cy} r={r} fill="#fff" />}
      {iris ? (
        <>
          <ellipse className="pupil" cx={cx} cy={cy} rx={r * 0.82} ry={r * 0.95} fill={ink} />
          <ellipse className="pupil" cx={cx} cy={cy + 0.1} rx={r * 0.66} ry={r * 0.78} fill={iris} />
          <ellipse className="pupil" cx={cx + 0.2} cy={cy + 0.2} rx={r * 0.34} ry={r * 0.44} fill={ink} />
        </>
      ) : (
        <ellipse className="pupil" cx={cx} cy={cy} rx={r * (sclera ? 0.58 : 0.78)} ry={r * (sclera ? 0.58 : 0.95)} fill={ink} />
      )}
      <circle className="pupil-shine" cx={cx + r * 0.28} cy={cy - r * 0.38} r={r * 0.3} fill="#fff" />
      <circle className="pupil-shine" cx={cx - r * 0.3} cy={cy + r * 0.42} r={r * 0.13} fill="#fff" opacity="0.8" />
      <g className="lid">
        <ellipse cx={cx} cy={cy - 0.2} rx={r + 0.9} ry={r + 1} fill={lid} />
        <path d={`M${cx - r * 0.85} ${cy + 0.2} q${r * 0.85} ${r * 0.75} ${r * 1.7} 0`} stroke={ink} strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </g>
      {angry && <line className="brow" x1={cx - r} y1={cy - r - 1.5} x2={cx + r} y2={cy - r - 3} stroke={ink} strokeWidth="1.6" strokeLinecap="round" />}
    </g>
  )
}

/* ------------------------------------------------------------------ quadruped */

/** Ears drawn over the head (floppy ears hang in front of the face side). */
function FrontEars({ look }: { look: SpeciesLook }): JSX.Element | null {
  if (look.ear !== 'floppy') return null
  const c = look.earColor ?? 'var(--accent)'
  return (
    <g className="ears">
      <path
        className="ear left ol"
        style={{ transformOrigin: '70% 4%' }}
        d="M77 31 Q65 29 62 41 Q59 54 64 61 Q69 64 72 58 Q73.5 48 80 36 Z"
        fill={c}
      />
    </g>
  )
}

function Ears({ look }: { look: SpeciesLook }): JSX.Element | null {
  switch (look.ear) {
    case 'pointy':
      return (
        <g className="ears">
          <g className="ear left">
            <path className="ol" d="M71 43 Q69 27 75 18 Q84 24 88 34 Z" fill="var(--body)" />
            <path d="M74.5 37 Q74 29 76.5 24 Q81.5 28 84 33 Z" fill="#f2b8c0" opacity="0.75" />
          </g>
          <g className="ear right">
            <path className="ol" d="M88 33 Q95 22 103 17 Q106 29 103 43 Z" fill="var(--body)" />
            <path d="M92 32 Q97 26 101 23 Q102.5 30 101 37 Z" fill="#f2b8c0" opacity="0.75" />
          </g>
        </g>
      )
    case 'floppy': {
      const c = look.earColor ?? 'var(--accent)'
      // Only the far ear sits behind the head; the near one is drawn by FrontEars.
      return (
        <g className="ears">
          <path className="ear right ol" style={{ transformOrigin: '30% 4%' }} d="M93 32 Q105 30 107 42 Q109 53 103 56 Q99 54 98 47 Q96 40 91 36 Z" fill={c} />
        </g>
      )
    }
    case 'long':
      return (
        <g className="ears">
          <ellipse className="ear left" cx="80" cy="22" rx="5" ry="15" fill="var(--body)" transform="rotate(-8 80 22)" />
          <ellipse cx="80" cy="23" rx="2.5" ry="11" fill="#f2b8c0" transform="rotate(-8 80 22)" />
          <ellipse className="ear right" cx="92" cy="20" rx="5" ry="15" fill="var(--body)" transform="rotate(6 92 20)" />
          <ellipse cx="92" cy="21" rx="2.5" ry="11" fill="#f2b8c0" transform="rotate(6 92 20)" />
        </g>
      )
    case 'round':
      return (
        <g className="ears">
          <circle className="ear left" cx="73" cy="37" r="7" fill={look.mask ?? 'var(--accent)'} />
          <circle className="ear right" cx="99" cy="37" r="7" fill={look.mask ?? 'var(--accent)'} />
          {look.snout === 'redpanda' && (
            <>
              <circle cx="73" cy="37" r="3.5" fill="var(--accent)" />
              <circle cx="99" cy="37" r="3.5" fill="var(--accent)" />
            </>
          )}
        </g>
      )
    case 'small':
      return (
        <g className="ears">
          <circle className="ear left" cx="75" cy="36" r="4.5" fill="var(--body)" />
          <circle cx="75" cy="36" r="2.4" fill="#f2b8c0" />
          <circle className="ear right" cx="97" cy="35" r="4.5" fill="var(--body)" />
          <circle cx="97" cy="35" r="2.4" fill="#f2b8c0" />
        </g>
      )
    case 'tuft':
      return (
        <g className="ears">
          <path className="ear left" d="M74 38 L72 26 L82 34 Z" fill="var(--accent)" />
          <path className="ear right" d="M92 34 L98 24 L102 38 Z" fill="var(--accent)" />
        </g>
      )
    default:
      return null
  }
}

/** A stroked tail with a darker outline drawn underneath. */
function StrokeTail({ d, width, color = 'var(--body)' }: { d: string; width: number; color?: string }): JSX.Element {
  return (
    <>
      <path d={d} stroke="var(--outline)" strokeWidth={width + 2.6} strokeLinecap="round" fill="none" />
      <path d={d} stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" />
    </>
  )
}

function Tail({ look }: { look: SpeciesLook }): JSX.Element | null {
  switch (look.tail) {
    case 'curly':
      return <StrokeTail d="M32 62 q-13 -10 -6 -21 q7 -9 12 -1" width={7} />
    case 'long':
      return <StrokeTail d="M32 68 q-16 2 -18 -18 q0 -8 6 -8" width={6} />
    case 'bushy':
      return (
        <g>
          <path className="ol" d="M34 62 Q18 66 12 52 Q8 40 16 34 Q22 46 34 54 Z" fill="var(--body)" />
          <path d="M16 34 Q10 40 12 48 Q16 44 18 38 Z" fill="var(--belly)" />
        </g>
      )
    case 'ringed':
      return (
        <g transform="rotate(28 24 62)">
          <ellipse className="ol" cx="24" cy="62" rx="9" ry="20" fill="var(--body)" />
          <rect x="15.5" y="50" width="17" height="4" fill={look.mask ?? 'var(--accent)'} opacity="0.85" />
          <rect x="15.5" y="60" width="17" height="4" fill={look.mask ?? 'var(--accent)'} opacity="0.85" />
          <rect x="15.5" y="70" width="17" height="4" fill={look.mask ?? 'var(--accent)'} opacity="0.85" />
          <ellipse cx="24" cy="79" rx="7" ry="3.6" fill={look.mask ?? 'var(--accent)'} />
        </g>
      )
    case 'puff':
      return <circle className="ol" cx="30" cy="62" r="7" fill="var(--belly)" />
    case 'stub':
      return <circle className="ol" cx="30" cy="62" r="5" fill="var(--body)" />
    case 'short':
      return <ellipse className="ol" cx="31" cy="58" rx="6" ry="4" fill="var(--belly)" transform="rotate(-30 31 58)" />
    case 'spade':
      return (
        <g>
          <StrokeTail d="M32 66 q-14 -2 -18 -18" width={5} />
          <path className="ol" d="M14 50 L7 40 L19 42 Z" fill="var(--accent)" />
        </g>
      )
    case 'flowing':
      return (
        <g>
          <path d="M30 62 q-14 4 -14 22 q0 8 6 14" stroke={look.mane ?? 'var(--accent)'} strokeWidth="9" strokeLinecap="round" fill="none" />
          <path d="M28 66 q-9 6 -8 20" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6" />
        </g>
      )
    case 'tassel':
      return (
        <g>
          <StrokeTail d="M32 64 q-14 6 -16 24" width={4} />
          <ellipse className="ol" cx="15" cy="90" rx="4.5" ry="6" fill={look.lionMane ?? 'var(--accent)'} />
        </g>
      )
    case 'thin':
      return <StrokeTail d="M32 64 q-12 -4 -16 -20" width={4} />
    default:
      return null
  }
}

function Snout({ look }: { look: SpeciesLook }): JSX.Element {
  switch (look.snout) {
    case 'dog':
      return (
        <g className="snout">
          <ellipse className="ol" cx="99" cy="57" rx="11.5" ry="8" fill={look.faceMask ?? 'var(--belly)'} />
          <path d="M102.5 51.5 q4.5 -2.2 9 0 q-0.6 4.6 -4.5 5.4 q-3.9 -0.8 -4.5 -5.4 z" fill="#2a2a30" />
          <ellipse cx="105.6" cy="52.3" rx="1.6" ry="0.8" fill="#fff" opacity="0.55" />
          <path className="mouth" d="M107 57 v1.6 q-2.6 3.4 -6 1 M107 58.6 q2 2.6 4.2 0.6" stroke="#2a2a30" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          <path className="tongue" d="M102.5 61 q0 5 3.2 5 q3.2 0 3 -5 z" fill="#e66a7f" stroke="#b84a5e" strokeWidth="0.7" />
        </g>
      )
    case 'cat':
      return (
        <g className="snout">
          <path d="M94 55 L100 55 L97 58.5 Z" fill="#e88a9a" />
          <path className="mouth" d="M93 61 q4 3 4 -2 q0 5 4 2" stroke="#2a2a30" strokeWidth="1.1" fill="none" />
          <g stroke="#3a3a42" strokeWidth="0.8" opacity="0.7">
            <line x1="102" y1="56" x2="116" y2="53" />
            <line x1="102" y1="59" x2="116" y2="61" />
            <line x1="90" y1="56" x2="78" y2="54" />
          </g>
        </g>
      )
    case 'bunny':
      return (
        <g className="snout">
          <ellipse cx="97" cy="56" rx="3" ry="2.2" fill="#e88a9a" />
          <path className="mouth" d="M94 60 q3 3 3 -1 q0 4 3 1" stroke="#2a2a30" strokeWidth="1" fill="none" />
          <rect x="95.5" y="59.5" width="3" height="3.5" rx="0.8" fill="#fff" />
        </g>
      )
    case 'fox':
      return (
        <g className="snout">
          <path d="M92 50 L110 57 L92 63 Z" fill="var(--belly)" />
          <circle cx="109" cy="57" r="2.6" fill="#2a2a30" />
          <path className="mouth" d="M100 61 q3 3 6 -1" stroke="#2a2a30" strokeWidth="1" fill="none" />
        </g>
      )
    case 'panda':
      return (
        <g className="snout">
          <ellipse cx="87" cy="58" rx="3.6" ry="2.6" fill="#2a2a30" />
          <path className="mouth" d="M84 62 q3 3 6 0" stroke="#2a2a30" strokeWidth="1.2" fill="none" />
        </g>
      )
    case 'redpanda':
      return (
        <g className="snout">
          <ellipse cx="97" cy="57" rx="8" ry="6" fill="var(--accent)" />
          <ellipse cx="102" cy="55" rx="3" ry="2.3" fill="#2a2a30" />
          <path className="mouth" d="M95 61 q3 3 6 0" stroke="#2a2a30" strokeWidth="1.1" fill="none" />
          <path d="M80 50 q-1 5 -3 8" stroke={look.mask} strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M94 49 q1 5 3 8" stroke={look.mask} strokeWidth="2" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'deer':
      return (
        <g className="snout">
          <ellipse cx="100" cy="56" rx="11" ry="7" fill="var(--belly)" />
          <ellipse cx="108" cy="54" rx="3.4" ry="2.6" fill="#2a2a30" />
          <path className="mouth" d="M100 61 q4 3 8 -1" stroke="#2a2a30" strokeWidth="1.1" fill="none" />
        </g>
      )
    case 'unicorn':
      return (
        <g className="snout">
          <ellipse cx="99" cy="56" rx="10" ry="8" fill="var(--belly)" />
          <ellipse cx="104" cy="54" rx="1.6" ry="1.2" fill="#c98ad6" />
          <ellipse cx="104" cy="58" rx="1.6" ry="1.2" fill="#c98ad6" />
          <path className="mouth" d="M96 62 q4 3 8 0" stroke="#b07cc0" strokeWidth="1.1" fill="none" />
        </g>
      )
    case 'dragon':
      return (
        <g className="snout">
          <path d="M92 48 L112 56 L94 64 Z" fill="var(--body)" />
          <path d="M96 58 L110 56 L96 63 Z" fill="var(--belly)" />
          <circle cx="108" cy="54" r="1.4" fill="#1d1d24" />
          <path d="M100 60 L102 63 L104 60 Z" fill="#fff" />
          <path className="mouth" d="M97 60 q6 2 12 -3" stroke="#1d1d24" strokeWidth="1" fill="none" />
        </g>
      )
    case 'lion':
      return (
        <g className="snout">
          <ellipse cx="96" cy="57" rx="11" ry="8" fill="var(--belly)" />
          <ellipse cx="101" cy="53" rx="4" ry="3" fill="#3a2a22" />
          <path className="mouth" d="M93 61 q4 3 4 -2 q0 5 4 2" stroke="#3a2a22" strokeWidth="1.2" fill="none" />
          <g fill="#3a2a22" opacity="0.6">
            <circle cx="90" cy="58" r="0.8" />
            <circle cx="90" cy="61" r="0.8" />
            <circle cx="103" cy="59" r="0.8" />
            <circle cx="103" cy="62" r="0.8" />
          </g>
        </g>
      )
    case 'wolf':
      return (
        <g className="snout">
          <path className="ol" d="M90 50 Q104 48 112 53 Q115 57 111 60 Q102 64 92 62 Z" fill={look.faceMask ?? 'var(--belly)'} />
          <ellipse cx="111" cy="53.6" rx="3.4" ry="2.6" fill="#1d1d24" />
          <ellipse cx="110.2" cy="52.8" rx="1.2" ry="0.6" fill="#fff" opacity="0.5" />
          <path className="mouth" d="M110 58.5 q-4 3 -10 1" stroke="#1d1d24" strokeWidth="1.1" strokeLinecap="round" fill="none" />
          <path className="tongue" d="M103 60.5 q0 5 3 5 q3 0 2.8 -5 z" fill="#e66a7f" stroke="#b84a5e" strokeWidth="0.7" />
        </g>
      )
    case 'pug':
      return (
        <g className="snout">
          <ellipse className="ol" cx="96" cy="56" rx="11" ry="9" fill={look.mask ?? 'var(--accent)'} />
          <ellipse cx="99" cy="53" rx="3.8" ry="2.8" fill="#121216" />
          <ellipse cx="98.2" cy="52.2" rx="1.3" ry="0.6" fill="#fff" opacity="0.45" />
          <path className="mouth" d="M99 56.5 v1.6 q-2.6 3 -5.6 1 M99 58.1 q2.4 2.6 5 0.8" stroke="#f3e6d0" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.8" />
          <path d="M80 37 q6 -3.5 12 -1 M82 33 q5 -3 10 -1" stroke={look.mask ?? 'var(--accent)'} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.55" />
          <path className="tongue" d="M95 61 q0 4.6 3 4.6 q3 0 2.8 -4.6 z" fill="#e66a7f" stroke="#b84a5e" strokeWidth="0.7" />
        </g>
      )
    case 'hamster':
      return (
        <g className="snout">
          <ellipse cx="80" cy="58" rx="7" ry="5.5" fill="var(--belly)" />
          <ellipse cx="96" cy="59" rx="7" ry="5.5" fill="var(--belly)" />
          <ellipse cx="97" cy="54" rx="2.2" ry="1.7" fill="#e88a9a" />
          <path className="mouth" d="M95 58 q2 2 2 -1 q0 3 2 1" stroke="#2a2a30" strokeWidth="1" fill="none" />
          <rect x="96" y="57.5" width="2.4" height="2.8" rx="0.6" fill="#fff" />
          <g stroke="#3a3a42" strokeWidth="0.7" opacity="0.6">
            <line x1="101" y1="56" x2="113" y2="54" />
            <line x1="101" y1="59" x2="113" y2="61" />
          </g>
        </g>
      )
    default:
      return <g />
  }
}

function HeadExtras({ look }: { look: SpeciesLook }): JSX.Element | null {
  return (
    <>
      {look.lionMane && (
        <g className="lion-mane">
          <circle cx="83" cy="52" r="30" fill={look.lionMane} />
          <g fill={look.lionMane}>
            <path d="M53 44 L46 34 L58 38 Z" />
            <path d="M58 30 L56 18 L66 26 Z" />
            <path d="M72 24 L76 12 L82 22 Z" />
            <path d="M92 24 L100 14 L100 26 Z" />
            <path d="M104 34 L114 30 L108 40 Z" />
          </g>
          <circle cx="83" cy="52" r="24" fill="#b8702e" opacity="0.5" />
        </g>
      )}
      {look.antlers && (
        <g className="antlers" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M78 34 L74 18 M74 18 L68 12 M74 18 L72 8 M76 26 L70 22" />
          <path d="M94 34 L98 18 M98 18 L104 12 M98 18 L100 8 M96 26 L102 22" />
        </g>
      )}
      {look.horn && (
        <g className="horn">
          <path d="M82 34 L86 8 L92 34 Z" fill="#f4d160" />
          <path d="M83 30 L91 27 M84 24 L90 22 M85 18 L89 16" stroke="#e0b030" strokeWidth="1.1" />
        </g>
      )}
      {look.mane && (
        <g className="mane">
          <path d="M70 36 q-10 6 -8 22 q4 -6 8 -4 q-4 8 0 14 q6 -6 8 -2" fill={look.mane} />
          <path d="M74 32 q6 -8 14 -2 q-6 0 -10 6 z" fill={look.mane} />
        </g>
      )}
    </>
  )
}

function Quadruped({ look }: { look: SpeciesLook }): JSX.Element {
  const uid = useId().replace(/:/g, '')
  const rx = look.bodyWidth / 2
  const ry = look.bodyHeight / 2
  const legLen = look.legLength ?? 0
  const legTop = 80 - legLen
  const cy = legTop - ry + 8
  // Long bodies (dachshund) push the head forward so it stays at the front of the body.
  const headDx = Math.max(-3, Math.min(9, (rx - 32) * 0.9))
  const legW = 10.5
  const paw = look.faceMask ?? (look.spotColor ? 'var(--body)' : undefined)
  const legs: { cls: string; x: number; far: boolean }[] = [
    { cls: 'leg back b', x: 60 - rx + 16, far: true },
    { cls: 'leg front a', x: 60 + rx - 24 + headDx * 0.3, far: true },
    { cls: 'leg back a', x: 60 - rx + 6, far: false },
    { cls: 'leg front b', x: 60 + rx - 14 + headDx * 0.3, far: false }
  ]
  const leg = (l: (typeof legs)[number]): JSX.Element => {
    const fill = l.far ? 'var(--body-dark)' : 'var(--body)'
    const pawFill = paw && !l.far ? paw : fill
    const px = l.x + legW / 2 + 1.2
    return (
      <Layer key={l.cls} className={l.cls} origin={pct(l.x + legW / 2, legTop)}>
        <rect className="ol" x={l.x} y={legTop} width={legW} height={101 - legTop} rx={legW / 2} fill={fill} />
        <ellipse className="ol" cx={px} cy="101.4" rx={legW / 2 + 1.7} ry="3.3" fill={pawFill} />
        {!l.far && <path d={`M${px - 1.6} 99.6 v1.8 M${px + 1.6} 99.6 v1.8`} stroke="var(--outline)" strokeWidth="0.8" strokeLinecap="round" opacity="0.6" />}
      </Layer>
    )
  }
  const bodyPath = `M${60 - rx + ry} ${cy - ry} H${60 + rx - ry} A${ry} ${ry} 0 0 1 ${60 + rx - ry} ${cy + ry} H${60 - rx + ry} A${ry} ${ry} 0 0 1 ${60 - rx + ry} ${cy - ry} Z`
  const headShift = `translate(${headDx} ${-legLen})`
  const dogFace = look.snout === 'dog' || look.snout === 'wolf' || look.snout === 'pug'
  const eyeR = look.snout === 'pug' ? 4.3 : 3.9
  return (
    <>
      <Layer className="tail" motion origin={pct(32, cy)}>
        <Tail look={look} />
      </Layer>
      {look.wings && (
        <Layer className="wing" origin={pct(52, cy - 4)}>
          <path className="ol" d={`M50 ${cy - 4} q-6 -30 26 -34 q-10 14 -6 34 z`} fill={look.wings} />
          <path d={`M52 ${cy - 6} q-2 -20 18 -26`} stroke="var(--accent)" strokeWidth="1.2" fill="none" opacity="0.5" />
        </Layer>
      )}
      {legs.map(leg)}
      <div className="part torso" style={{ transformOrigin: pct(60, legTop + 10) }}>
        <Layer className="body" motion origin={pct(60, cy)}>
          <defs>
            <clipPath id={`body-${uid}`}>
              <path d={bodyPath} />
            </clipPath>
          </defs>
          <path className="ol" d={bodyPath} fill="var(--body)" />
          <g clipPath={`url(#body-${uid})`}>
            <ellipse cx="62" cy={cy + ry * 0.62} rx={rx * 0.62} ry={ry * 0.5} fill="var(--belly)" />
            {look.faceMask && <ellipse cx={60 + rx - 6} cy={cy + 3} rx="11" ry={ry * 0.8} fill={look.faceMask} />}
            <ellipse cx={60} cy={cy - ry * 0.55} rx={rx * 0.7} ry={ry * 0.22} fill="#fff" opacity="0.07" />
            {look.spots && (
              <g fill={look.spotColor ?? 'var(--belly)'} opacity="0.92">
                <circle cx="48" cy={cy - 6} r={look.spotColor ? 3.4 : 2.4} />
                <circle cx="60" cy={cy - 10} r={look.spotColor ? 2.8 : 2.2} />
                <circle cx="71" cy={cy - 4} r={look.spotColor ? 3.2 : 2.4} />
                <circle cx="56" cy={cy} r={look.spotColor ? 2.6 : 1.8} />
                {look.spotColor && <circle cx="40" cy={cy + 2} r="2.4" />}
                {look.spotColor && <circle cx="66" cy={cy + 7} r="2" />}
                {look.spotColor && <circle cx="80" cy={cy - 8} r="1.8" />}
              </g>
            )}
          </g>
        </Layer>
        <Layer className="head" motion origin={pct(84 + headDx, 62 - legLen)}>
          <g transform={headShift}>
            <defs>
              <clipPath id={`head-${uid}`}>
                <ellipse cx="86" cy="49" rx="19.5" ry="18" />
              </clipPath>
            </defs>
            <HeadExtras look={look} />
            <Ears look={look} />
            <ellipse className="ol" cx="86" cy="49" rx="19.5" ry="18" fill="var(--body)" />
            {look.faceMask && (
              <g clipPath={`url(#head-${uid})`} fill={look.faceMask}>
                <ellipse cx="88" cy="61" rx="17" ry="9.5" />
                <path d="M84.5 58 Q85.5 42 87.5 33 Q89.5 42 91 58 Z" />
              </g>
            )}
            {look.spotColor && (
              <g fill={look.spotColor} opacity="0.9">
                <circle cx="75" cy="40" r="2.6" />
                <circle cx="96" cy="35" r="2.2" />
                <circle cx="89" cy="62" r="1.4" />
              </g>
            )}
            {look.snout === 'panda' && (
              <>
                <ellipse cx="80" cy="47" rx="6.5" ry="8" fill={look.mask} transform="rotate(-20 80 47)" />
                <ellipse cx="94" cy="47" rx="6.5" ry="8" fill={look.mask} transform="rotate(20 94 47)" />
              </>
            )}
            {look.snout === 'redpanda' && (
              <>
                <ellipse cx="80" cy="47" rx="5.5" ry="6" fill={look.mask} opacity="0.85" />
                <ellipse cx="94" cy="46" rx="5.5" ry="6" fill={look.mask} opacity="0.85" />
                <ellipse cx="74" cy="56" rx="5" ry="4" fill="var(--accent)" />
              </>
            )}
            {look.snout === 'panda' || look.snout === 'redpanda' ? (
              <>
                <Eye cx={80} cy={47} r={2.8} lid={look.mask} />
                <Eye cx={94} cy={47} r={2.8} lid={look.mask} />
              </>
            ) : look.snout === 'hamster' ? (
              <>
                <Eye cx={81} cy={48} r={3} />
                <Eye cx={93} cy={47} r={3} />
              </>
            ) : (
              <>
                <Eye cx={dogFace ? 80 : 81} cy={46} r={eyeR} angry iris={look.iris} />
                <Eye cx={93} cy={45} r={eyeR} angry iris={look.iris} />
              </>
            )}
            <ellipse className="blush" cx="76" cy="55" rx="3.5" ry="2" fill="#f28ea0" opacity="0.5" />
            <Snout look={look} />
            <FrontEars look={look} />
          </g>
        </Layer>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------- upright */

function Upright({ look }: { look: SpeciesLook }): JSX.Element {
  switch (look.snout) {
    case 'owl':
      return <Owl look={look} />
    case 'duck':
      return <Duck look={look} />
    case 'swan':
      return <Swan look={look} />
    default:
      return <Penguin look={look} />
  }
}

function Feet({ x1, x2, color, rx = 8 }: { x1: number; x2: number; color: string; rx?: number }): JSX.Element {
  return (
    <>
      <Layer className="leg back a" origin={pct(x1, 102)}>
        <ellipse cx={x1} cy="102" rx={rx} ry="3.5" fill={color} />
      </Layer>
      <Layer className="leg back b" origin={pct(x2, 102)}>
        <ellipse cx={x2} cy="102" rx={rx} ry="3.5" fill={color} />
      </Layer>
    </>
  )
}

function Penguin({ look }: { look: SpeciesLook }): JSX.Element {
  return (
    <>
      <Feet x1={54} x2={70} color={look.accent} />
      <div className="part torso" style={{ transformOrigin: pct(60, 90) }}>
        <Layer className="body" motion origin={pct(62, 68)}>
          <ellipse cx="62" cy="68" rx="24" ry="32" fill="var(--body)" />
          <ellipse cx="64" cy="74" rx="16" ry="23" fill="var(--belly)" />
        </Layer>
        <Layer className="leg front a arm" origin={pct(40, 56)}>
          <ellipse cx="40" cy="70" rx="6" ry="15" fill="var(--body)" transform="rotate(12 40 70)" />
        </Layer>
        <Layer className="leg front b arm" origin={pct(84, 56)}>
          <ellipse cx="84" cy="70" rx="6" ry="15" fill="var(--body)" transform="rotate(-12 84 70)" />
        </Layer>
        <Layer className="head" motion origin={pct(64, 56)}>
          <circle cx="64" cy="40" r="18" fill="var(--body)" />
          <ellipse cx="66" cy="44" rx="11" ry="9" fill="var(--belly)" />
          <Eye cx={61} cy={39} r={3.2} angry lid="var(--belly)" />
          <Eye cx={72} cy={39} r={3.2} angry lid="var(--belly)" />
          <g className="snout">
            <path d="M74 44 L86 47 L74 50 Z" fill={look.accent} />
          </g>
          <ellipse className="blush" cx="58" cy="47" rx="3" ry="1.8" fill="#f28ea0" opacity="0.5" />
        </Layer>
      </div>
    </>
  )
}

function Owl({ look }: { look: SpeciesLook }): JSX.Element {
  const wing = look.wings ?? look.accent
  return (
    <>
      <Feet x1={54} x2={70} color={look.accent} rx={6} />
      <div className="part torso" style={{ transformOrigin: pct(62, 92) }}>
        <Layer className="body" motion origin={pct(62, 72)}>
          <ellipse cx="62" cy="72" rx="25" ry="30" fill="var(--body)" />
          <ellipse cx="63" cy="78" rx="16" ry="20" fill="var(--belly)" />
          <g fill="var(--body)" opacity="0.55">
            <ellipse cx="57" cy="72" rx="2.2" ry="3" />
            <ellipse cx="66" cy="70" rx="2.2" ry="3" />
            <ellipse cx="61" cy="82" rx="2.2" ry="3" />
            <ellipse cx="70" cy="80" rx="2.2" ry="3" />
            <ellipse cx="56" cy="90" rx="2.2" ry="3" />
            <ellipse cx="66" cy="92" rx="2.2" ry="3" />
          </g>
        </Layer>
        <Layer className="leg front a arm" origin={pct(38, 58)}>
          <ellipse cx="38" cy="74" rx="7" ry="18" fill={wing} transform="rotate(10 38 74)" />
        </Layer>
        <Layer className="leg front b arm" origin={pct(86, 58)}>
          <ellipse cx="86" cy="74" rx="7" ry="18" fill={wing} transform="rotate(-10 86 74)" />
        </Layer>
        <Layer className="head" motion origin={pct(62, 56)}>
          <path className="ear left" d="M46 30 L44 12 L58 24 Z" fill="var(--body)" />
          <path className="ear right" d="M78 30 L80 12 L66 24 Z" fill="var(--body)" />
          <circle cx="62" cy="38" r="21" fill="var(--body)" />
          <ellipse cx="53" cy="40" rx="9" ry="10" fill="var(--belly)" />
          <ellipse cx="71" cy="40" rx="9" ry="10" fill="var(--belly)" />
          <Eye cx={53} cy={40} r={6} iris={look.accent} sclera lid="var(--belly)" />
          <Eye cx={71} cy={40} r={6} iris={look.accent} sclera lid="var(--belly)" />
          <g className="snout">
            <path d="M62 44 L58 50 L66 50 Z" fill={look.accent} />
          </g>
        </Layer>
      </div>
    </>
  )
}

function Duck({ look }: { look: SpeciesLook }): JSX.Element {
  const wing = look.wings ?? look.body
  return (
    <>
      <Feet x1={52} x2={68} color={look.accent} rx={8} />
      <div className="part torso" style={{ transformOrigin: pct(60, 92) }}>
        <Layer className="body" motion origin={pct(58, 76)}>
          <path d="M36 66 L28 56 L40 62 Z" fill="var(--body)" />
          <ellipse cx="58" cy="76" rx="24" ry="24" fill="var(--body)" />
          <ellipse cx="62" cy="82" rx="15" ry="16" fill="var(--belly)" />
        </Layer>
        <Layer className="leg front a arm" origin={pct(42, 64)}>
          <ellipse cx="42" cy="76" rx="8" ry="14" fill={wing} transform="rotate(14 42 76)" />
        </Layer>
        <Layer className="leg front b arm" origin={pct(80, 64)}>
          <ellipse cx="80" cy="76" rx="7" ry="13" fill={wing} transform="rotate(-14 80 76)" />
        </Layer>
        <Layer className="head" motion origin={pct(66, 56)}>
          <circle cx="66" cy="42" r="16" fill="var(--body)" />
          <Eye cx={62} cy={40} r={3} angry />
          <Eye cx={73} cy={40} r={3} angry />
          <g className="snout">
            <ellipse cx="84" cy="47" rx="10" ry="4.5" fill={look.accent} />
            <path className="mouth" d="M76 47 L94 47" stroke="#c96a12" strokeWidth="1" />
          </g>
          <ellipse className="blush" cx="60" cy="47" rx="3" ry="1.8" fill="#f28ea0" opacity="0.5" />
        </Layer>
      </div>
    </>
  )
}

function Swan({ look }: { look: SpeciesLook }): JSX.Element {
  const wing = look.wings ?? look.body
  return (
    <>
      <Feet x1={50} x2={64} color={look.accent} rx={6} />
      <div className="part torso" style={{ transformOrigin: pct(56, 92) }}>
        <Layer className="body" motion origin={pct(56, 80)}>
          <path d="M32 80 L22 66 L36 72 Z" fill="var(--body)" />
          <ellipse cx="56" cy="82" rx="27" ry="19" fill="var(--body)" />
          <ellipse cx="58" cy="88" rx="16" ry="10" fill="var(--belly)" />
        </Layer>
        <Layer className="leg front a arm" origin={pct(46, 70)}>
          <ellipse cx="48" cy="76" rx="18" ry="9" fill={wing} transform="rotate(-18 48 76)" />
          <path d="M34 72 q14 -6 28 -2" stroke="var(--belly)" strokeWidth="1.2" fill="none" opacity="0.8" />
        </Layer>
        <Layer className="leg front b arm" origin={pct(60, 70)}>
          <ellipse cx="60" cy="74" rx="15" ry="8" fill={wing} transform="rotate(-22 60 74)" />
        </Layer>
        <Layer className="head" motion origin={pct(66, 72)}>
          <path d="M66 74 q18 -6 12 -30 q-4 -14 6 -20" stroke="var(--body)" strokeWidth="9" strokeLinecap="round" fill="none" />
          <circle cx="84" cy="24" r="9" fill="var(--body)" />
          <path d="M86 24 L100 26 L86 30 Z" fill={look.accent} />
          <path d="M84 22 q3 0 5 3" stroke={look.mask ?? '#222'} strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <Eye cx={84} cy={22} r={2.2} />
        </Layer>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------------- human */

function Hair({ look }: { look: SpeciesLook }): JSX.Element {
  const c = look.hairColor ?? '#3a2a24'
  switch (look.hair) {
    case 'long':
      return (
        <g className="hair">
          <path d="M45 30 q0 -22 15 -22 q15 0 15 22 l0 18 q-4 -8 -6 -14 q-9 -8 -18 0 q-2 6 -6 14 z" fill={c} />
        </g>
      )
    case 'bun':
      return (
        <g className="hair">
          <circle cx="60" cy="12" r="6" fill={c} />
          <path d="M45 30 q0 -20 15 -20 q15 0 15 20 q-6 -10 -15 -8 q-9 -2 -15 8 z" fill={c} />
        </g>
      )
    case 'curly':
      return (
        <g className="hair" fill={c}>
          <circle cx="48" cy="24" r="6" />
          <circle cx="54" cy="16" r="6.5" />
          <circle cx="62" cy="13" r="7" />
          <circle cx="70" cy="17" r="6.5" />
          <circle cx="74" cy="25" r="6" />
        </g>
      )
    default:
      return (
        <g className="hair">
          <path d="M45 30 q0 -20 15 -20 q15 0 15 20 q-5 -9 -15 -8 q-10 -1 -15 8 z" fill={c} />
        </g>
      )
  }
}

function Human({ look }: { look: SpeciesLook }): JSX.Element {
  const skin = look.skin ?? '#f2c7a5'
  const outfit = look.outfit ?? look.body
  const pants = look.pants ?? look.accent
  return (
    <>
      <Layer className="leg back a" origin={pct(53.5, 74)}>
        <rect x="49" y="74" width="9" height="27" rx="3" fill={pants} />
        <ellipse cx="54" cy="102" rx="6.5" ry="3" fill="#2a2a30" />
      </Layer>
      <Layer className="leg back b" origin={pct(66.5, 74)}>
        <rect x="62" y="74" width="9" height="27" rx="3" fill={pants} />
        <ellipse cx="67" cy="102" rx="6.5" ry="3" fill="#2a2a30" />
      </Layer>
      <div className="part torso" style={{ transformOrigin: pct(60, 80) }}>
        <Layer className="body" motion origin={pct(60, 64)}>
          <rect x="43" y="46" width="34" height="36" rx="9" fill={outfit} />
          <path d="M52 46 q8 8 16 0" stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" />
        </Layer>
        <Layer className="leg front a arm" origin={pct(39.5, 49)}>
          <rect x="35" y="47" width="9" height="30" rx="4.5" fill={outfit} />
          <rect x="35" y="62" width="9" height="15" rx="4.5" fill={skin} />
          <circle cx="39.5" cy="79" r="4.5" fill={skin} />
        </Layer>
        <Layer className="leg front b arm" origin={pct(80.5, 49)}>
          <rect x="76" y="47" width="9" height="30" rx="4.5" fill={outfit} />
          <rect x="76" y="62" width="9" height="15" rx="4.5" fill={skin} />
          <circle cx="80.5" cy="79" r="4.5" fill={skin} />
        </Layer>
        <Layer className="head" motion origin={pct(60, 44)}>
          <rect x="56" y="40" width="8" height="8" fill={skin} />
          <circle cx="60" cy="30" r="15" fill={skin} />
          <Hair look={look} />
          <Eye cx={54.5} cy={31} r={2.6} lid={skin} />
          <Eye cx={65.5} cy={31} r={2.6} lid={skin} />
          {look.glasses && (
            <g stroke="#2a2a30" strokeWidth="1.1" fill="none" opacity="0.85">
              <circle cx="54.5" cy="31" r="4.6" />
              <circle cx="65.5" cy="31" r="4.6" />
              <line x1="59.1" y1="31" x2="60.9" y2="31" />
            </g>
          )}
          <g className="snout">
            <path className="mouth" d="M56.5 38 q3.5 3.5 7 0" stroke="#8a4a3a" strokeWidth="1.2" fill="none" />
          </g>
          <ellipse className="blush" cx="50" cy="36" rx="2.6" ry="1.5" fill="#f28ea0" opacity="0.5" />
          <ellipse className="blush" cx="70" cy="36" rx="2.6" ry="1.5" fill="#f28ea0" opacity="0.5" />
        </Layer>
      </div>
    </>
  )
}
