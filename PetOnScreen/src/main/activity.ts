import { powerMonitor } from 'electron'
import type { ActivityInfo } from '@shared/types'

const RETURN_THRESHOLD = 300 // seconds idle before "coming back" counts as a return

/**
 * Privacy-preserving activity signal. We only ask the OS how long since the last input event -
 * never what was typed or clicked. Runs once per second.
 */
export class ActivityMonitor {
  private timer: NodeJS.Timeout | null = null
  private lastIdle = 0
  private activeSince = Date.now()

  start(onTick: (info: ActivityInfo) => void): void {
    this.stop()
    this.timer = setInterval(() => {
      const idle = powerMonitor.getSystemIdleTime()
      const now = Date.now()
      let returned = false
      if (idle >= RETURN_THRESHOLD) {
        // The user stepped away: continuous-activity clock restarts when they return.
        this.activeSince = now
      } else if (this.lastIdle >= RETURN_THRESHOLD) {
        returned = true
        this.activeSince = now
      }
      this.lastIdle = idle
      onTick({ idleSeconds: idle, activeSeconds: Math.floor((now - this.activeSince) / 1000), returned })
    }, 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
