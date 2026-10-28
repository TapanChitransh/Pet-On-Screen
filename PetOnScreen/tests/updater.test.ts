import { describe, expect, it } from 'vitest'
import { compareVersions } from '@shared/version'

describe('compareVersions', () => {
  it('orders numeric semver parts', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
  })

  it('ignores a leading v, pre-release tags and missing parts', () => {
    expect(compareVersions('v0.2.0', '0.2.0-beta.1')).toBe(0)
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('1', '0.9')).toBeGreaterThan(0)
  })
})
