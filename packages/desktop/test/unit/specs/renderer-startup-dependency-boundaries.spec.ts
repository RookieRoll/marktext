import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(__dirname, '../../..')
const rendererRoot = resolve(desktopRoot, 'src/renderer/src')
const readRenderer = (relativePath: string): string =>
  readFileSync(resolve(rendererRoot, relativePath), 'utf8')

const readProductionEntry = (): string | null => {
  const outputRoot = resolve(desktopRoot, 'out/renderer')
  const htmlPath = resolve(outputRoot, 'index.html')
  if (!existsSync(htmlPath)) return null

  const html = readFileSync(htmlPath, 'utf8')
  const entry = html.match(/assets\/([^"']+\.js)/)?.[1]
  return entry ? readFileSync(resolve(outputRoot, 'assets', entry), 'utf8') : null
}

describe('renderer startup dependency boundaries', () => {
  it('registers only the Element Plus components used by renderer templates', () => {
    const main = readRenderer('main.ts')

    expect(main).not.toContain("import ElementPlus from 'element-plus'")
    expect(main).not.toContain("element-plus/dist/index.css")
    expect(main).toContain("provideGlobalConfig({ locale: en }, app, true)")

    for (const component of [
      'autocomplete',
      'button',
      'col',
      'dialog',
      'form',
      'icon',
      'input',
      'input-number',
      'radio',
      'row',
      'select',
      'slider',
      'switch',
      'table',
      'tabs',
      'tooltip',
      'tree'
    ]) {
      expect(main).toContain(`element-plus/es/components/${component}/index`)
      expect(main).toContain(`element-plus/es/components/${component}/style/css`)
    }
  })

  it('does not duplicate the Muya engine side-effect import', () => {
    const editor = readRenderer('components/editorWithTabs/editor.vue')
    expect(editor.match(/from '@muyajs\/core'/g)?.length).toBe(1)
    expect(editor).not.toContain("import '@muyajs/core'")
  })

  it('keeps every diagram renderer behind the Muya dynamic loader', () => {
    const diagram = readFileSync(
      resolve(desktopRoot, '../muya/src/utils/diagram/index.ts'),
      'utf8'
    )

    for (const renderer of ['./plantuml', 'mermaid', 'vega-embed', 'flowchart.js', './sequence']) {
      expect(diagram).toContain(`import('${renderer}')`)
    }
    expect(diagram).not.toMatch(/^(?!\s*\/\/).*from ['"](?:mermaid|vega-embed|flowchart\.js)/m)
  })

  it('keeps chart implementations out of the production HTML entry', () => {
    const entry = readProductionEntry()
    if (entry === null) return

    for (const dependency of ['mermaid', 'vega-embed', 'flowchart.js', 'sequence-diagram']) {
      expect(entry).not.toContain(dependency)
    }

    const assetsRoot = resolve(desktopRoot, 'out/renderer/assets')
    const assets = readdirSync(assetsRoot)
    expect(assets.some((asset) => /mermaid|flow|sequence/i.test(asset))).toBe(true)
  })
})