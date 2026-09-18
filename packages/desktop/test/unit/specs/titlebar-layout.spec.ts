import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The editor title bar used to render the last three folders plus the file name,
// centred between two fixed paddings, with the character/word counter parked
// inside the 138px window-controls column. Both had the same failure mode: the
// rendered width depended on the document, so the title drifted and a long name
// slid under the counter or the buttons.
//
// The bar now lays out inside an explicit band (sidebar edge -> window-controls
// edge): the name is a fixed-width, left-aligned, ellipsised column, and the
// counter is pushed to the far end of the band. These assertions pin the
// structure that keeps those two facts true.

const desktopRoot = resolve(__dirname, '../../..')
const TITLE_BAR = 'src/renderer/src/components/titleBar/index.vue'

const readTitleBar = (): string => readFileSync(resolve(desktopRoot, TITLE_BAR), 'utf8')

const compact = (source: string): string => source.replace(/\s+/g, ' ')

// Match `<selector> {` exactly: the selectors are also named in prose comments
// above the rules, and a bare `indexOf` would anchor on the comment.
const ruleBody = (css: string, selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{`).exec(css)
  if (!match) return null
  const open = css.indexOf('{', match.index)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return null
}

describe('editor title bar layout', () => {
  it('shows only the document name and drops the folder trail', () => {
    const source = compact(readTitleBar())

    expect(source).toContain('{{ displayName }}')
    expect(source).not.toContain('of paths')
    expect(source).not.toContain('path-arrow')
    expect(source).not.toContain('ArrowRight')
    expect(source).not.toContain('PATH_SEPARATOR')
  })

  it('strips the extension and keeps dotfiles untouched', () => {
    const source = compact(readTitleBar())

    expect(source).toContain("const separator = name.lastIndexOf('.')")
    expect(source).toContain('return separator > 0 ? name.slice(0, separator) : name')
  })

  it('keeps the full path reachable from the name', () => {
    const source = compact(readTitleBar())
    expect(source).toContain(':title="pathname || filename"')
  })

  it('gives the name a fixed, ellipsising, left-aligned column', () => {
    const css = readTitleBar()
    const name = ruleBody(css, '.title .filename')

    expect(name).not.toBeNull()
    const body = compact(name as string)
    expect(body).toContain('flex: 0 0 auto')
    expect(body).toContain('width: var(--titleBarNameWidth, 360px)')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('text-overflow: ellipsis')
    expect(body).toContain('text-align: left')

    const rule = compact(css)
    expect(rule).toContain('const TITLE_BAR_NAME_WIDTH = 360')
    expect(rule).toContain('--titleBarNameWidth')
  })

  it('pushes the counter to the end of the band it shares with the menu', () => {
    const css = readTitleBar()
    const tools = ruleBody(css, '.title-bar-tools')

    expect(tools).not.toBeNull()
    const body = compact(tools as string)
    expect(body).toContain('left: var(--titleBarBandLeft, 0px)')
    expect(body).toContain('right: var(--titleBarBandRight, 0px)')
    expect(body).toContain('display: flex')

    const rule = compact(css)
    expect(rule).toContain('.title-bar-tools .word-count { margin-left: auto; }')
    // The counter must not be parked in the controls column any more.
    expect(rule).not.toContain("'left-toolbar title-no-drag' : 'right-toolbar'")
  })

  it('bounds the band by the sidebar and the window controls', () => {
    const rule = compact(readTitleBar())

    expect(rule).toContain('const titleBarBandLeft = computed(() =>')
    expect(rule).toContain('const WINDOW_CONTROLS_WIDTH = 138')
    // Controls and the right bound share one condition, so the counter can never
    // sit under a button or leave a gap when the buttons are hidden.
    expect(rule).toContain('const showWindowControls = computed(')
    expect(rule).toContain('v-if="showWindowControls"')
    expect(rule).toContain('effectiveSideBarWidth')
  })
})
