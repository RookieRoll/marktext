import { describe, expect, it } from 'vitest'
import routes from '../../../src/renderer/src/router'

describe('renderer route loading boundaries', () => {
  it('keeps editor and preference pages behind async route components', () => {
    const editor = routes('editor').find((route) => route.path === '/editor')
    const preference = routes('editor').find((route) => route.path === '/preference')

    expect(typeof editor?.component).toBe('function')
    expect(typeof preference?.component).toBe('function')
    expect(preference?.children?.every((route) => typeof route.component === 'function')).toBe(true)
  })
})
