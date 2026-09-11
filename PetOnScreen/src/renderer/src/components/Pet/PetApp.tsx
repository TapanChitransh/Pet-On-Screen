import { useEffect, useState } from 'react'
import { PetRuntime } from '@renderer/runtime/PetRuntime'
import { PetStage } from './PetStage'

export function PetApp(): JSX.Element | null {
  const [runtime, setRuntime] = useState<PetRuntime | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let created: PetRuntime | null = null
    PetRuntime.create()
      .then((rt) => {
        if (cancelled) {
          rt.dispose()
          return
        }
        created = rt
        setRuntime(rt)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
      created?.dispose()
    }
  }, [])

  if (error) return <div className="fatal">PetOnScreen failed to start: {error}</div>
  if (!runtime) return null
  return <PetStage runtime={runtime} />
}
