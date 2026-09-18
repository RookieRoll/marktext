import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The editor's bottom scroll buffer (#3405) used to be re-applied to the new
// `.mu-container` as `padding-bottom: 100vh` (fcd8f391, visual parity after the
// @muyajs/core migration). A full viewport height overshot the intent: once the
// last block was already visible at the bottom edge, the container still had a
// screen of empty scroll range left, so the scrollbar thumb stopped short of
// the end of its track. These assertions pin the buffer to the document-level
// 100px the engine already declares.

const desktopRoot = resolve(__dirname, '../../..')
const readSource = (relativePath: string): string =>
  readFileSync(resolve(desktopRoot, relativePath), 'utf8')

const compact = (source: string): string => source.replace(/\s+/g, ' ')

const EDITOR = 'src/renderer/src/components/editorWithTabs/editor.vue'

const ruleBody = (css: string, selector: string): string | null => {
  const start = css.indexOf(selector)
  if (start === -1) return null
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  if (open === -1 || close === -1) return null
  return css.slice(open + 1, close)
}

describe('editor bottom scroll buffer', () => {
  it('adds at most the document 100px bottom padding, not a full viewport', () => {
    const css = readSource(EDITOR)
    const container = ruleBody(css, '.editor-component .mu-container')

    expect(container).not.toBeNull()
    const body = compact(container as string)
    expect(body).toContain('padding-top: 20px')
    expect(body).toContain('padding-bottom: 100px')
    expect(body).not.toContain('100vh')
  })

  it('keeps the engine document padding that the override builds on', () => {
    const engine = compact(readSource('../muya/src/assets/styles/blockSyntax.css'))
    expect(engine).toContain('.mu-container { box-sizing: border-box; max-width: var(--editor-area-width, 800px); min-height: 100%; margin: 0 auto; padding: 0 50px 100px;')
  })

  it('clears the temporary padding on the element scrollToCords padded', () => {
    const source = compact(readSource(EDITOR))

    // `scrollToCords` writes to the scroll container's first child.
    expect(source).toContain('editorId.style.paddingBottom =')
    // `handleResetPaddingBottom` must undo it on that same element; the old
    // `container.style.paddingBottom = ''` targeted the scroll container, which
    // never carries a padding, so the temporary buffer survived every switch.
    expect(source).toContain("firstChild.style.paddingBottom = ''")
    expect(source).not.toContain("container.style.paddingBottom = ''")
  })
})
