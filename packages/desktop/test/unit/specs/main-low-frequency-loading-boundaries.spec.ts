import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(__dirname, '../../..')
const readMain = (relativePath: string): string =>
  readFileSync(resolve(desktopRoot, 'src/main', relativePath), 'utf8')

describe('main low-frequency loading boundaries', () => {
  it('keeps the Pandoc backend out of the static file-menu action path', () => {
    const fileActions = readMain('menu/actions/file.ts')

    expect(fileActions).not.toContain("import pandoc from '../../utils/pandoc'")
    expect(fileActions).toContain("import('../../utils/pandoc')")
    expect(fileActions).toContain('const loadPandoc = async () =>')
  })

  it('keeps import, export, print, and window-control menu entry points', () => {
    const fileActions = readMain('menu/actions/file.ts')
    const fileMenu = readMain('menu/templates/file.ts')
    const windowMenu = readMain('menu/templates/window.ts')

    expect(fileActions).toContain("'mt::show-export-dialog'")
    expect(fileActions).toContain("'mt::cmd-import-file'")
    expect(fileMenu).toContain('actions.importFile')
    expect(fileMenu).toContain('actions.exportFile')
    expect(fileMenu).toContain('actions.printDocument')
    expect(windowMenu).toContain('toggleFullScreen')
    expect(windowMenu).toContain('toggleAlwaysOnTop')
  })
})
