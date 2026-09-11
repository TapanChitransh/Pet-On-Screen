const DONE: { title: string; items: string[] }[] = [
  {
    title: 'Phase 1 — Desktop pet',
    items: ['Transparent, frameless, always-on-top overlay', 'Click-through everywhere except the pet', 'Drag & drop with gravity', 'Autonomous walking, idle motion, blinking, tail & ears', 'Click reactions that vary', 'Multi-monitor placement, remembered position']
  },
  {
    title: 'Phase 2 — Behavior engine',
    items: ['Weighted, cooldown-aware state machine (28 states)', 'Personality traits that bias every decision and drift over time', 'Stats with gentle drift, self-feeding, offline catch-up', 'Rare spontaneous events (gifts, zoomies, hiding, dancing…)', 'Idle / return / long-session awareness']
  },
  {
    title: 'Phase 3 — Pet system',
    items: ['Twenty-three animals (six species, nine dog breeds, lion, wolf and more) and a tiny person companion, each with its own silhouette, gait, voice and favorites', 'Mini-games: Fetch (throw the ball anywhere, the pet brings it back) and Tug of war (hold and pull, grip meters, rounds)', 'Local JSON persistence (atomic writes)', 'Multiple pets, switching, renaming, releasing', 'Inventory: food, toys, treasures found by the pet', 'Levels & experience']
  },
  {
    title: 'Phase 4 — Conversation & memory',
    items: ['Talk bubble with local, stat-aware replies (no key needed)', 'Optional Claude-powered replies in character via the Anthropic SDK', 'Memory: favorites, counts, event log, owner name, relationship level']
  },
  {
    title: 'Phase 6 — Polish (partial)',
    items: ['Synthesized sounds with master toggle & volume', 'System tray with size / monitor / pause / click-through controls', 'Start-with-system (installed builds)']
  }
]

const PLANNED: { title: string; items: string[] }[] = [
  {
    title: 'Phase 5 — Marketplace',
    items: ['Pet purchasing & currency (all six starters are free today)', 'Rare and limited-time pets', 'Accessories, skins and environments', 'Purchasable food and toy packs']
  },
  {
    title: 'Phase 6 — Polish (remaining)',
    items: ['Hand-drawn / sprite-sheet artwork replacing the procedural placeholders', 'Recorded animal sounds', 'OS notifications option', 'Onboarding tour', 'Pet walking between monitors']
  }
]

export function RoadmapPanel({ dataPath }: { dataPath: string }): JSX.Element {
  return (
    <section>
      <h1>Roadmap</h1>
      <p className="muted">What is real today versus what is still planned. Nothing in the app is a placeholder button: if it is not listed under “Done”, it is not in the UI.</p>
      <div className="two-col">
        <div>
          <h2>✅ Done</h2>
          {DONE.map((g) => (
            <div key={g.title} className="card">
              <h3>{g.title}</h3>
              <ul className="plain">
                {g.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <h2>🗓️ Planned</h2>
          {PLANNED.map((g) => (
            <div key={g.title} className="card planned">
              <h3>{g.title}</h3>
              <ul className="plain">
                {g.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="card">
            <h3>Privacy</h3>
            <p className="muted small">PetOnScreen never captures screenshots, keystrokes or window contents. The only activity signal is the OS-provided “seconds since last input”. Everything is stored locally at {dataPath}. The optional Claude API key is only sent to Anthropic when you chat.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
