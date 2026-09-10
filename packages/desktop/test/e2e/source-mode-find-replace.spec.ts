import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  enterSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

test.describe('Source Code mode Find/Replace', () => {
  let app: ElectronApplication
  let page: Page

  const SOURCE_DIALOG = '.source-code .CodeMirror-dialog'
  const SEARCH_FIELD = `${SOURCE_DIALOG} input.CodeMirror-search-field`
  const SEARCHING = '.source-code .CodeMirror .cm-searching'

  const sourceValue = async (): Promise<string> => {
    return await page.evaluate(() => {
      const element = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getValue(): string } })
        | null
      return element?.CodeMirror?.getValue() ?? ''
    })
  }

  const sourceSelection = async (): Promise<{
    anchor: { line: number; ch: number }
    head: { line: number; ch: number }
  }> => {
    return await page.evaluate(() => {
      const element = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
            CodeMirror?: {
              getCursor(which: 'anchor' | 'head'): { line: number; ch: number }
            }
          })
        | null
      if (!element?.CodeMirror) throw new Error('Source Code CodeMirror instance is unavailable')
      return {
        anchor: element.CodeMirror.getCursor('anchor'),
        head: element.CodeMirror.getCursor('head')
      }
    })
  }

  const closeSourceDialog = async (): Promise<void> => {
    await page.keyboard.press('Escape')
    await expect(page.locator(SOURCE_DIALOG)).toHaveCount(0, { timeout: 5000 })
  }

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(
      '# Source search\n\nneedle first\nneedle second\nneedle third\n'
    )
    app = launched.app
    page = launched.page
    await enterSourceMode(page, app)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test.beforeEach(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if ((await page.locator(SOURCE_DIALOG).count()) === 0) break
      await page.keyboard.press('Escape')
      await page.waitForTimeout(50)
    }
    await expect(page.locator(SOURCE_DIALOG)).toHaveCount(0, { timeout: 5000 })
    await page.evaluate((value) => {
      const element = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
            CodeMirror?: {
              setValue(value: string): void
              setCursor(position: { line: number; ch: number }): void
              execCommand(command: string): void
              focus(): void
            }
          })
        | null
      if (!element?.CodeMirror) throw new Error('Source Code CodeMirror instance is unavailable')
      element.CodeMirror.execCommand('clearSearch')
      element.CodeMirror.setValue(value)
      element.CodeMirror.setCursor({ line: 0, ch: 0 })
      element.CodeMirror.focus()
    }, '# Source search\\n\\nneedle first\\nneedle second\\nneedle third\\n')
  })

  test('Find opens an opaque dialog, highlights matches, and supports next/previous', async () => {
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')

    const dialog = page.locator(SOURCE_DIALOG)
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(page.locator(SEARCH_FIELD)).toBeVisible()

    const background = await dialog.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        opacity: style.opacity
      }
    })
    expect(background.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(background.backgroundColor).not.toBe('transparent')
    expect(background.opacity).toBe('1')

    await page.locator(SEARCH_FIELD).fill('needle')
    await page.locator(SEARCH_FIELD).press('Enter')
    await expect.poll(() => page.locator(SEARCHING).count(), { timeout: 5000 }).toBeGreaterThan(0)

    const first = await sourceSelection()
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findNext')
    await expect.poll(async () => sourceSelection(), { timeout: 5000 }).not.toEqual(first)
    const second = await sourceSelection()
    expect(second.head).not.toEqual(first.head)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findPrev')
    await expect.poll(async () => sourceSelection(), { timeout: 5000 }).toEqual(first)
    await expectNoRendererErrors(app)
  })

  test('Replace opens both fields and replaces all matching source text', async () => {
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'replace')

    const dialog = page.locator(SOURCE_DIALOG)
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(page.locator(SEARCH_FIELD)).toHaveCount(1)
    await page.locator(SEARCH_FIELD).fill('needle')
    await page.locator(SEARCH_FIELD).press('Enter')

    await expect(page.locator(SEARCH_FIELD)).toHaveCount(1)
    await page.locator(SEARCH_FIELD).fill('replaced')
    await page.locator(SEARCH_FIELD).press('Enter')

    const confirmationButtons = page.locator(`${SOURCE_DIALOG} button`)
    await expect(confirmationButtons).toHaveCount(4, { timeout: 5000 })
    await confirmationButtons.nth(2).click()

    await expect
      .poll(() => sourceValue(), { timeout: 5000 })
      .toBe('# Source search\n\nreplaced first\nreplaced second\nreplaced third\n')
    await expect(page.locator(SOURCE_DIALOG)).toHaveCount(0, { timeout: 5000 })
    await expectNoRendererErrors(app)
  })

  test('Escape closes Find and removes CodeMirror search highlights', async () => {
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    await page.locator(SEARCH_FIELD).fill('needle')
    await page.locator(SEARCH_FIELD).press('Enter')
    await expect.poll(() => page.locator(SEARCHING).count(), { timeout: 5000 }).toBeGreaterThan(0)

    await closeSourceDialog()
    await expect(page.locator(SEARCHING)).toHaveCount(0)
    await expectNoRendererErrors(app)
  })
})
