import { describe, expect, it } from 'vitest'
import {
  APPLICATION_STARTUP_ORDER,
  runApplicationStartup,
  type ApplicationStartupEffects
} from '../../../src/main/app/applicationStartup'

const expectedStartupOrder = [
  'registerProtocol',
  'registerIpc',
  'applySecurityPolicy',
  'initializePreferences',
  'registerMenus',
  'restoreStateAndWindows',
  'createFirstWindow',
  'registerLifecycleEvents'
] as const

const createEffects = (calls: string[]): ApplicationStartupEffects => ({
  registerProtocol: () => {
    calls.push('registerProtocol')
  },
  registerIpc: () => {
    calls.push('registerIpc')
  },
  applySecurityPolicy: () => {
    calls.push('applySecurityPolicy')
  },
  initializePreferences: () => {
    calls.push('initializePreferences')
  },
  registerMenus: () => {
    calls.push('registerMenus')
  },
  restoreStateAndWindows: () => {
    calls.push('restoreStateAndWindows')
  },
  createFirstWindow: () => {
    calls.push('createFirstWindow')
  },
  registerLifecycleEvents: () => {
    calls.push('registerLifecycleEvents')
  }
})

describe('runApplicationStartup', () => {
  it('runs the injected startup effects in the documented order', async () => {
    const calls: string[] = []

    await runApplicationStartup(createEffects(calls))

    expect(APPLICATION_STARTUP_ORDER).toEqual(expectedStartupOrder)
    expect(calls).toEqual(expectedStartupOrder)
  })

  it('stops before the next stage when startup is cancelled', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const effects = createEffects(calls)
    effects.registerProtocol = () => {
      calls.push('registerProtocol')
      controller.abort()
    }

    await expect(runApplicationStartup(effects, controller.signal)).resolves.toBeUndefined()
    expect(calls).toEqual(['registerProtocol'])
  })

  it('does not start any stage when already cancelled', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    controller.abort()

    await expect(
      runApplicationStartup(createEffects(calls), controller.signal)
    ).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })

  it('waits for each async effect and stops after a failure', async () => {
    const calls: string[] = []
    const effects = createEffects(calls)
    effects.registerProtocol = async () => {
      calls.push('registerProtocol:start')
      await Promise.resolve()
      calls.push('registerProtocol:end')
    }
    const failure = new Error('security policy failed')
    effects.applySecurityPolicy = async () => {
      calls.push('applySecurityPolicy:start')
      await Promise.resolve()
      throw failure
    }

    await expect(runApplicationStartup(effects)).rejects.toThrow(failure)
    expect(calls).toEqual([
      'registerProtocol:start',
      'registerProtocol:end',
      'registerIpc',
      'applySecurityPolicy:start'
    ])
  })
})
