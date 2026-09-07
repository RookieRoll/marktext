import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addCommonStyle, addStyles } from '@/util/theme'

// `theme.ts` transitively imports `@/config`, whose first line reads
// `window.path.sep` at module-load time. Stub the preload `window.path` surface
// before the static import runs.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
})

const EMOJI_SELECTOR = '.mu-emoji-picker section .emoji-wrapper .item span'
const EMOJI_FONT = 'Noto Color Emoji'

const setPlatform = (platform: NodeJS.Platform): void => {
  const w = window as unknown as {
    electron: { process: { platform: NodeJS.Platform } }
  }
  w.electron = { process: { platform } }
}

const commonStyleHtml = () =>
  (document.querySelector('#ag-common-style') as HTMLStyleElement | null)?.innerHTML ?? ''

const commonOptions = { codeFontFamily: 'Fira Code', codeFontSize: 14 }

describe('theme.ts emoji-picker Linux font patch', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.className = ''
    setPlatform('win32')
  })

  it('injects the .mu-emoji-picker font fallback into the common sheet on Linux', () => {
    setPlatform('linux')
    addCommonStyle(commonOptions)

    const css = commonStyleHtml()
    expect(css).toContain(EMOJI_SELECTOR)
    expect(css).toContain(EMOJI_FONT)
    expect(css).toContain(`${EMOJI_SELECTOR} { font-family: sans-serif, "${EMOJI_FONT}"; }`)
  })

  it('omits the emoji patch entirely off Linux', () => {
    addCommonStyle(commonOptions)

    const css = commonStyleHtml()
    expect(css).not.toContain('.mu-emoji-picker')
    expect(css).not.toContain(EMOJI_FONT)
  })

  it('keeps targeting the engine .mu-emoji-picker selector (not a legacy ag-* class) on Linux', () => {
    setPlatform('linux')
    addCommonStyle(commonOptions)

    const css = commonStyleHtml()
    expect(css).toContain('.mu-emoji-picker')
    expect(css).not.toContain('.ag-emoji-picker')
  })

  it('routes the patch through addStyles (theme + common) on Linux', () => {
    setPlatform('linux')
    addStyles({ theme: 'light', ...commonOptions })

    expect(commonStyleHtml()).toContain(EMOJI_SELECTOR)
    // The theme sheet itself carries the theme CSS, not the emoji patch.
    const themeHtml = (document.querySelector('#ag-theme') as HTMLStyleElement | null)?.innerHTML
    expect(themeHtml).not.toContain('.mu-emoji-picker')
  })

  it('routes nothing emoji-related through addStyles off Linux', () => {
    addStyles({ theme: 'light', ...commonOptions })

    expect(commonStyleHtml()).not.toContain('.mu-emoji-picker')
  })
})