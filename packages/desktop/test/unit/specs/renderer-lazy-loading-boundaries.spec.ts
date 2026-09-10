import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(__dirname, '../../..')
const readRenderer = (relativePath: string): string =>
  readFileSync(resolve(desktopRoot, 'src/renderer/src', relativePath), 'utf8')

describe('renderer lazy-loading boundaries', () => {
  it('does not statically import low-frequency dialogs in the editor page', () => {
    const app = readRenderer('pages/app.vue')

    expect(app).toContain("createLazyDialog(() => import('@/components/about/index.vue'))")
    expect(app).toContain("createLazyDialog(() => import('@/components/commandPalette/index.vue'))")
    expect(app).toContain("createLazyDialog(() => import('@/components/exportSettings/index.vue'))")
    expect(app).not.toMatch(/import\s+AboutDialog\s+from\s+['"]@\/components\/about/)
    expect(app).not.toMatch(/import\s+CommandPalette\s+from\s+['"]@\/components\/commandPalette/)
    expect(app).not.toMatch(
      /import\s+ExportSettingDialog\s+from\s+['"]@\/components\/exportSettings/
    )
  })

  it('keeps CodeMirror and export runtime behind first-use dynamic imports', () => {
    const editor = readRenderer('components/editorWithTabs/editor.vue')
    const editorWithTabs = readRenderer('components/editorWithTabs/index.vue')
    const sourceCode = readRenderer('components/editorWithTabs/sourceCode.vue')

    expect(editorWithTabs).toContain("defineAsyncComponent(() => import('./sourceCode.vue'))")
    expect(editor).toContain("import('@/util/exportHtml')")
    expect(editor).toContain("import('@/util/pdf')")
    expect(editor).toContain("import('@/services/printService')")
    expect(editor).not.toMatch(/import\s+Printer\s+from\s+['"]@\/services\/printService/)
    expect(editor).not.toMatch(
      /import\s+\{[^}]*exportStyledHTML[^}]*\}\s+from\s+['"]@\/util\/exportHtml/
    )
    expect(sourceCode).toContain("from '../../codeMirror'")

    expect(sourceCode).toContain("import 'codemirror/addon/dialog/dialog'")
    expect(sourceCode).toContain("import 'codemirror/addon/dialog/dialog.css'")
    expect(sourceCode).toContain("import 'codemirror/addon/search/searchcursor'")
    expect(sourceCode).toContain("import 'codemirror/addon/search/search'")
    expect(sourceCode).toContain("execCommand('findPersistent')")
    expect(sourceCode).toContain("execCommand('findPersistentNext')")
    expect(sourceCode).toContain("execCommand('findPersistentPrev')")
    expect(sourceCode).toContain("execCommand('replace')")
    expect(sourceCode).toContain("bus.on('find', handleFind)")
    expect(sourceCode).toContain("bus.on('findNext', handleFindNext)")
    expect(sourceCode).toContain("bus.on('findPrev', handleFindPrevious)")
    expect(sourceCode).toContain("bus.on('replace', handleReplace)")
    expect(sourceCode).toContain("bus.off('find', handleFind)")
    expect(sourceCode).toContain("bus.off('findNext', handleFindNext)")
    expect(sourceCode).toContain("bus.off('findPrev', handleFindPrevious)")
    expect(sourceCode).toContain("bus.off('replace', handleReplace)")
    expect(sourceCode).toContain('background: var(--floatBgColor)')
  })
})
