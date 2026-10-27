import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PetRuntime, VisualState } from '@renderer/runtime/PetRuntime'
import { SPRITE_HEIGHT, SPRITE_WIDTH } from '@engine/PetEngine'
import { SPECIES } from '@models/Species'
import { PetSprite } from './PetSprite'
import { SpeechBubble } from './SpeechBubble'
import { Fx } from './Fx'
import { PetMenu } from '../PetMenu/PetMenu'
import { StatsPopover } from '../PetStats/StatsPopover'
import { ChatBubble } from '../Chat/ChatBubble'
import { InventoryPopover } from './InventoryPopover'
import { RenamePopover } from './RenamePopover'
import { PlayLayer } from '../Play/PlayLayer'
import { PlayHud } from '../Play/PlayHud'

export type OverlayKind = 'menu' | 'stats' | 'chat' | 'inventory' | 'rename'
export interface Overlay {
  kind: OverlayKind
  x: number
  y: number
}

interface Gesture {
  pointerId: number
  startX: number
  startY: number
  grabDx: number
  grabDy: number
  dragging: boolean
}

const DRAG_THRESHOLD = 6

export function useVisual(runtime: PetRuntime): VisualState {
  return useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.visual,
    () => runtime.visual
  )
}

export function PetStage({ runtime }: { runtime: PetRuntime }): JSX.Element {
  const visual = useVisual(runtime)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const species = SPECIES[visual.speciesId]
  const scale = visual.scale
  const w = SPRITE_WIDTH * scale
  const h = SPRITE_HEIGHT * scale

  const frameRef = useCallback(
    (el: HTMLDivElement | null) => {
      runtime.frameEl = el
      if (el) el.style.transform = `translate3d(${runtime.snapshot.x}px, ${runtime.snapshot.y}px, 0)`
    },
    [runtime]
  )

  useEffect(() => {
    runtime.setOverlayOpen(overlay !== null)
  }, [overlay, runtime])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (overlay) setOverlay(null)
      else if (runtime.visual.playMode !== 'none') runtime.stopPlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlay, runtime])

  const playing = visual.playMode !== 'none'
  const playPointer = useRef<number | null>(null)
  const onPlayDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    playPointer.current = e.pointerId
    runtime.playPointerDown(e.clientX, e.clientY)
  }
  const onPlayMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    runtime.playPointerMove(e.clientX, e.clientY)
  }
  const onPlayUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (playPointer.current !== e.pointerId) return
    playPointer.current = null
    runtime.playPointerUp(e.clientX, e.clientY)
  }

  const openOverlay = (kind: OverlayKind): void => {
    const s = runtime.snapshot
    setOverlay({ kind, x: s.x, y: s.y - h - 12 })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const s = runtime.snapshot
    gesture.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabDx: s.x - e.clientX, grabDy: s.y - e.clientY, dragging: false }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.dragging) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return
      g.dragging = true
      runtime.dragStart()
      setOverlay(null)
    }
    runtime.dragMove(e.clientX + g.grabDx, e.clientY + g.grabDy)
  }

  const endGesture = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    if (g.dragging) runtime.dragEnd()
    else if (!cancelled) {
      runtime.click()
      if (overlay) setOverlay(null)
    }
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (gesture.current?.dragging) return
    openOverlay(overlay?.kind === 'menu' ? 'menu' : 'menu')
  }

  const hidden = visual.hidden
  const paused = visual.paused

  return (
    <div className={`stage${paused ? ' paused' : ''}`}>
      {overlay && <div className="backdrop" onPointerDown={() => setOverlay(null)} onContextMenu={(e) => e.preventDefault()} />}
      <div className="pet-frame" ref={frameRef}>
        <div
          className={`pet-hitbox${hidden ? ' hidden' : ''}`}
          style={{ width: w, height: h, left: -w / 2, top: -h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endGesture(e, false)}
          onPointerCancel={(e) => endGesture(e, true)}
          onPointerEnter={() => runtime.setDomHover(true)}
          onPointerLeave={() => runtime.setDomHover(false)}
          onContextMenu={onContextMenu}
          title={`${visual.name} — ${visual.state.toLowerCase().replace(/_/g, ' ')}`}
        >
          <div className="pet-body">
            <PetSprite look={species.look} visual={visual} />
          </div>
          {visual.fx && <Fx key={visual.fxKey} kind={visual.fx} />}
          {visual.heldItem && <div className="held-item">{visual.heldItem}</div>}
        </div>
        {visual.speech && <SpeechBubble key={visual.speechKey} text={visual.speech} offsetY={-h - 6} />}
        {paused && <div className="paused-badge" style={{ top: -h - 30 }}>paused</div>}
      </div>

      <PlayLayer visual={visual} />
      {playing && !overlay && (
        <div
          className={`play-capture mode-${visual.playMode} phase-${visual.playPhase ?? 'none'}${visual.tugHolding || visual.ballHeld === 'cursor' ? ' holding' : ''}`}
          onPointerDown={onPlayDown}
          onPointerMove={onPlayMove}
          onPointerUp={onPlayUp}
          onPointerCancel={onPlayUp}
          onContextMenu={(e) => {
            e.preventDefault()
            openOverlay('menu')
          }}
        />
      )}
      <PlayHud visual={visual} onStop={() => runtime.stopPlay()} />

      {overlay?.kind === 'menu' && (
        <PetMenu
          x={overlay.x}
          y={overlay.y}
          petName={visual.name}
          playing={playing}
          perched={visual.perched}
          onClose={() => setOverlay(null)}
          onAction={(action) => {
            switch (action) {
              case 'roam':
                runtime.releasePerch()
                setOverlay(null)
                break
              case 'pet':
                runtime.command({ type: 'pet' })
                setOverlay(null)
                break
              case 'feed':
                runtime.command({ type: 'feed', foodId: 'kibble' })
                setOverlay(null)
                break
              case 'play':
                runtime.command({ type: 'play' })
                setOverlay(null)
                break
              case 'fetch':
                runtime.startFetch()
                setOverlay(null)
                break
              case 'tug':
                runtime.startTug()
                setOverlay(null)
                break
              case 'stopPlay':
                runtime.stopPlay()
                setOverlay(null)
                break
              case 'talk':
                openOverlay('chat')
                break
              case 'inventory':
                openOverlay('inventory')
                break
              case 'stats':
                openOverlay('stats')
                break
              case 'rename':
                openOverlay('rename')
                break
              case 'settings':
                window.petApi.openDashboard('settings')
                setOverlay(null)
                break
              case 'dashboard':
                window.petApi.openDashboard()
                setOverlay(null)
                break
              case 'hide':
                setOverlay(null)
                void window.petApi.updateSettings({ petVisible: false })
                break
              case 'quit':
                window.petApi.quit()
                break
            }
          }}
        />
      )}
      {overlay?.kind === 'stats' && <StatsPopover x={overlay.x} y={overlay.y} runtime={runtime} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'chat' && <ChatBubble x={overlay.x} y={overlay.y} runtime={runtime} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'inventory' && <InventoryPopover x={overlay.x} y={overlay.y} runtime={runtime} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'rename' && <RenamePopover x={overlay.x} y={overlay.y} runtime={runtime} onClose={() => setOverlay(null)} />}
    </div>
  )
}
