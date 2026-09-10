import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tableStyles = resolve(__dirname, '../../../../muya/src/assets/styles/blockSyntax.css')

describe('Muya table selection overlay', () => {
  it('uses a translucent selection fill so selected cell text remains visible', () => {
    const css = readFileSync(tableStyles, 'utf8')
    const selector = '.mu-table-inner tr td.mu-table-cell-selected::before'
    const start = css.indexOf(selector)
    expect(start).toBeGreaterThanOrEqual(0)
    const block = css.slice(start, css.indexOf('}', start) + 1)

    expect(block).toContain('background: var(--selection-color)')
    expect(block).not.toContain('background: var(--editor-color-04)')
  })

  it('keeps the selection color translucent in light and dark built-in themes', () => {
    const themeDirectory = resolve(__dirname, '../../../src/renderer/src/assets/themes')
    const lightTheme = readFileSync(resolve(themeDirectory, 'ayu-light.theme.css'), 'utf8')
    const darkTheme = readFileSync(resolve(themeDirectory, 'ayu-dark.theme.css'), 'utf8')

    expect(lightTheme).toMatch(/--selectionColor:\s*rgba\([^;]+,\s*0(?:\.\d+)?\)/)
    expect(darkTheme).toMatch(/--selectionColor:\s*rgba\([^;]+,\s*0(?:\.\d+)?\)/)
  })

  it('retains the theme-colored border overlay rules', () => {
    const css = readFileSync(tableStyles, 'utf8')
    const start = css.indexOf('.mu-table-inner tr td.mu-table-cell-border-top::before')
    expect(start).toBeGreaterThanOrEqual(0)
    const block = css.slice(start, css.indexOf(".mu-table-inner td[data-align='left']", start))

    expect(block).toContain('border-top-color: var(--theme-color)')
    expect(block).toContain('border-right-color: var(--theme-color)')
    expect(block).toContain('border-bottom-color: var(--theme-color)')
    expect(block).toContain('border-left-color: var(--theme-color)')
  })
})
