import { describe, expect, it, vi } from 'vitest'
import { createEnsureService } from '../../../src/main/utils/ensureService'

describe('createEnsureService', () => {
  it('shares one initialization promise across concurrent callers', async() => {
    let resolveLoader!: (value: string) => void
    const loader = vi.fn(() => new Promise<string>((resolve) => {
      resolveLoader = resolve
    }))
    const ensure = createEnsureService(loader)

    const first = ensure()
    const second = ensure()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(loader).toHaveBeenCalledOnce()

    resolveLoader('ready')
    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready'])
    await expect(ensure()).resolves.toBe('ready')
    expect(loader).toHaveBeenCalledOnce()
  })

  it('clears a failed initialization so a later request can retry', async() => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('ready')
    const ensure = createEnsureService(loader)

    await expect(ensure()).rejects.toThrow('temporary failure')
    await expect(ensure()).resolves.toBe('ready')
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
