import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { APPLICATION_STARTUP_ORDER, runApplicationStartup } from '../../../src/main/app/applicationStartup'

type StepCall = { step: string; method: string }

describe('app startup integration', () => {
  let calls: StepCall[]

  beforeEach(() => {
    calls = []
  })

  it('executes all 8 stages in the documented order', async () => {
    const effects = Object.fromEntries(
      APPLICATION_STARTUP_ORDER.map((step) => [
        step,
        vi.fn(() => calls.push({ step, method: 'sync' }))
      ])
    ) as unknown as Record<string, () => void>

    await runApplicationStartup(effects as never)

    expect(calls.map((c) => c.step)).toEqual([...APPLICATION_STARTUP_ORDER])
    expect(calls.every((c) => c.method === 'sync')).toBe(true)
  })

  it('awaits async effects before proceeding to the next stage', async () => {
    const resolved: string[] = []
    const effects = Object.fromEntries(
      APPLICATION_STARTUP_ORDER.map((step) => [
        step,
        vi.fn(async () => {
          calls.push({ step, method: 'start' })
          await Promise.resolve()
          calls.push({ step, method: 'end' })
          resolved.push(step)
        })
      ])
    ) as unknown as Record<string, () => void>

    await runApplicationStartup(effects as never)

    // Each step must complete (end) before the next step starts
    for (let i = 0; i < APPLICATION_STARTUP_ORDER.length; i++) {
      const startIdx = calls.findIndex((c) => c.step === APPLICATION_STARTUP_ORDER[i] && c.method === 'start')
      const endIdx = calls.findIndex((c) => c.step === APPLICATION_STARTUP_ORDER[i] && c.method === 'end')
      expect(endIdx).toBeGreaterThan(startIdx)
      if (i > 0) {
        const prevEndIdx = calls.findIndex((c) => c.step === APPLICATION_STARTUP_ORDER[i - 1] && c.method === 'end')
        expect(startIdx).toBeGreaterThan(prevEndIdx)
      }
    }
    expect(resolved).toEqual([...APPLICATION_STARTUP_ORDER])
  })

  it('propagates errors from a failing stage without calling subsequent stages', async () => {
    const failure = new Error('preferences init failed')
    let reached = 0
    const effects = Object.fromEntries(
      APPLICATION_STARTUP_ORDER.map((step, i) => [
        step,
        vi.fn(() => {
          if (step === 'initializePreferences') throw failure
          reached++
        })
      ])
    ) as unknown as Record<string, () => void>

    await expect(runApplicationStartup(effects as never)).rejects.toThrow(failure)
    // Only registerProtocol, registerIpc, applySecurityPolicy ran
    expect(reached).toBe(3)
  })
})
