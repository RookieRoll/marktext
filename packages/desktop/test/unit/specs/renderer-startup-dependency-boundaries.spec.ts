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
    expect(main).not.toContain('element-plus/dist/index.css')
    expect(main).toContain('provideGlobalConfig(elementPlusConfig, app, true)')
    expect(main).toContain("bus.on('language-changed'")

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

  it('registers editor startup listeners before awaiting command metadata', () => {
    const app = readRenderer('pages/app.vue')
    const bootstrapListener = app.indexOf('editorStore.LISTEN_FOR_BOOTSTRAP_WINDOW()')
    const fileOpenListener = app.indexOf('editorStore.LISTEN_FOR_NEW_TAB()')
    const commandCenterAwait = app.indexOf('await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()')

    expect(bootstrapListener).toBeGreaterThan(-1)
    expect(fileOpenListener).toBeGreaterThan(-1)
    expect(commandCenterAwait).toBeGreaterThan(-1)
    expect(bootstrapListener).toBeLessThan(commandCenterAwait)
    expect(fileOpenListener).toBeLessThan(commandCenterAwait)
  })

  it('waits for the renderer-ready handshake before sending startup payloads', () => {
    const main = readRenderer('../../main/windows/editor.ts')
    const manager = readRenderer('../../main/app/windowManager.ts')

    // Main must not send the bootstrap payload straight from did-finish-load:
    // the editor route is a lazy chunk, so its listeners register later.
    const didFinishLoad = main.indexOf("win.webContents.once('did-finish-load'")
    const firstSend = main.indexOf("send('mt::bootstrap-editor'")
    expect(didFinishLoad).toBeGreaterThan(-1)
    expect(firstSend).toBeGreaterThan(didFinishLoad)

    expect(main).toContain('notifyRendererReady()')
    expect(main).toContain('_maybeFlushStartupPayload()')
    expect(main).toContain("send('mt::bootstrap-editor', this._bootstrapConfig)")
    expect(manager).toContain("ipcMain.on('mt::renderer-ready'")
    expect(manager).toContain('editor.notifyRendererReady()')
  })

  it('signals renderer readiness from the editor page before awaiting command metadata', () => {
    const app = readRenderer('pages/app.vue')

    const readySignal = app.indexOf("send('mt::renderer-ready')")
    const bootstrapListener = app.indexOf('editorStore.LISTEN_FOR_BOOTSTRAP_WINDOW()')
    const fileOpenListener = app.indexOf('editorStore.LISTEN_FOR_NEW_TAB()')
    const commandCenterAwait = app.indexOf('await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()')

    expect(readySignal).toBeGreaterThan(-1)
    expect(bootstrapListener).toBeGreaterThan(-1)
    expect(fileOpenListener).toBeGreaterThan(-1)
    // Readiness must be announced only after the startup listeners exist, and
    // before the command-metadata await can suspend the handler.
    expect(readySignal).toBeGreaterThan(bootstrapListener)
    expect(readySignal).toBeGreaterThan(fileOpenListener)
    expect(readySignal).toBeLessThan(commandCenterAwait)
  })

  it('does not duplicate the Muya engine side-effect import', () => {
    const editor = readRenderer('components/editorWithTabs/editor.vue')
    expect(editor.match(/from '@muyajs\/core'/g)?.length).toBe(1)
    expect(editor).not.toContain("import '@muyajs/core'")
  })

  it('keeps every diagram renderer behind the Muya dynamic loader', () => {
    const diagram = readFileSync(resolve(desktopRoot, '../muya/src/utils/diagram/index.ts'), 'utf8')

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
