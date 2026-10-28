import { useEffect, useState } from 'react'
import type { AppSettings, DisplayInfo, LiveSnapshot, SaveData } from '@shared/types'
import { PetCard } from './PetCard'
import { AdoptPanel } from '../Marketplace/AdoptPanel'
import { InventoryPanel } from './InventoryPanel'
import { MemoryPanel } from './MemoryPanel'
import { SettingsPanel } from '../Settings/SettingsPanel'
import { RoadmapPanel } from './RoadmapPanel'
import { UpdateCard } from './UpdateCard'

export type Tab = 'pets' | 'adopt' | 'inventory' | 'memory' | 'settings' | 'about'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'pets', label: 'My Pets', icon: '🐾' },
  { id: 'adopt', label: 'Adopt', icon: '🏪' },
  { id: 'inventory', label: 'Inventory', icon: '🎒' },
  { id: 'memory', label: 'Memory', icon: '🧠' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'about', label: 'Roadmap', icon: '🗺️' }
]

export interface DashboardState {
  settings: AppSettings
  save: SaveData
  displays: DisplayInfo[]
  version: string
  isPackaged: boolean
  dataPath: string
}

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
  return t && TABS.some((x) => x.id === t) ? t : 'pets'
}

export function DashboardApp(): JSX.Element {
  const [state, setState] = useState<DashboardState | null>(null)
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  const [tab, setTab] = useState<Tab>(initialTab)

  useEffect(() => {
    void window.petApi.getState().then(setState)
    const unsubs = [
      window.petApi.on<{ settings: AppSettings; save: SaveData }>('store:changed', (p) => setState((s) => (s ? { ...s, settings: p.settings, save: p.save } : s))),
      window.petApi.on<AppSettings>('settings:changed', (settings) => setState((s) => (s ? { ...s, settings } : s))),
      window.petApi.on<DisplayInfo[]>('displays', (displays) => setState((s) => (s ? { ...s, displays } : s))),
      window.petApi.on<LiveSnapshot>('pet:snapshot', setLive),
      window.petApi.on<string>('dashboard:tab', (t) => {
        if (TABS.some((x) => x.id === t)) setTab(t as Tab)
      })
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  if (!state) return <div className="loading">Loading…</div>

  const active = state.save.pets.find((p) => p.id === state.save.activePetId) ?? null

  return (
    <div className="dash">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">🐾</span>
          <div>
            <div className="brand-name">PetOnScreen</div>
            <div className="muted small">v{state.version}</div>
          </div>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={`nav-item${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="btn ghost" onClick={() => window.petApi.updateSettings({ petVisible: !state.settings.petVisible })}>
            {state.settings.petVisible ? '🙈 Hide pet' : '👀 Show pet'}
          </button>
          <button className="btn ghost" onClick={() => window.petApi.updateSettings({ paused: !state.settings.paused })}>
            {state.settings.paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </aside>
      <main className="content">
        <UpdateCard settings={state.settings} variant="banner" />
        {tab === 'pets' && (
          <section>
            <h1>My Pets</h1>
            <p className="muted">
              Your pets live in one shared world, but only one can be on your screen at a time. Switch anytime, the others keep their stats and memories.
            </p>
            <div className="cards">
              {state.save.pets.map((p) => (
                <PetCard key={p.id} pet={p} active={p.id === state.save.activePetId} live={p.id === live?.petId ? live : null} canRelease={state.save.pets.length > 1} />
              ))}
            </div>
            <button className="btn primary" onClick={() => setTab('adopt')}>
              + Adopt another pet
            </button>
          </section>
        )}
        {tab === 'adopt' && <AdoptPanel owned={state.save.pets} onAdopted={() => setTab('pets')} />}
        {tab === 'inventory' && <InventoryPanel pet={active} />}
        {tab === 'memory' && <MemoryPanel pet={active} ownerName={state.settings.ownerName} />}
        {tab === 'settings' && <SettingsPanel state={state} />}
        {tab === 'about' && <RoadmapPanel dataPath={state.dataPath} />}
      </main>
    </div>
  )
}
