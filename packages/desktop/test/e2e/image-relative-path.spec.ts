import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, waitForEditor, waitForMenuReady } from './helpers'

// Checklist 122 — integration coverage for the Phase G "G1" blocker: a
// relative-path image (`![](assets/cat.png)`) in a saved document must resolve
// to a DIRNAME-anchored `marktext://local/?path=` URL so Chromium can load it off disk. The
// engine-unit half is pinned by packages/muya/src/utils/__tests__/image.spec.ts
// (getImageSrc). This spec drives the REAL built Electron app: it saves a doc
// next to a sibling `assets/cat.png`, opens it (so the renderer populates
// `window.DIRNAME` from the document directory), and asserts the rendered
// `<img>` src is `marktext://local/?path=<docDir>/assets/cat.png` — not the broken,
// non-anchored `marktext://local/?path=assets/cat.png` form the migration regressed to.

// A 1x1 transparent PNG so `loadImage` resolves (the engine swaps the wrapper
// to `.mu-image-success` only when the file actually loads off disk).
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const createdDirs: string[] = []

const writeDocWithRelativeImage = (): { docPath: string; docDir: string } => {
  const docDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2e-relimg-'))
  createdDirs.push(docDir)
  const assetsDir = path.join(docDir, 'assets')
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.writeFileSync(path.join(assetsDir, 'cat.png'), Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
  const docPath = path.join(docDir, 'note.md')
  fs.writeFileSync(docPath, '![a cat](assets/cat.png)\n', 'utf-8')
  return { docPath, docDir }
}

test.describe('Relative-path image resolves to a DIRNAME-anchored marktext://local URL', () => {
  let app: ElectronApplication | null = null
  let page: Page
  let docDir: string

  test.beforeAll(async () => {
    const written = writeDocWithRelativeImage()
    docDir = written.docDir
    const launched = await launchElectron([written.docPath])
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await waitForMenuReady(app)
  })

  test.afterAll(async () => {
    if (app) await app.close()
    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  test('window.DIRNAME tracks the opened document directory', async () => {
    // The renderer populates window.DIRNAME from the open file's dirname; the
    // engine reads it to anchor relative image paths (image.ts getImageSrc).
    await expect
      .poll(async () => page.evaluate(() => window.DIRNAME), { timeout: 10000 })
      .toBeTruthy()
    const dirname = await page.evaluate(() => window.DIRNAME)
    // marktext://local URLs always use forward slashes, and so does the engine's
    // resolveRelativePath; compare against the normalised doc dir.
    expect(dirname.replace(/\\/g, '/')).toBe(docDir.replace(/\\/g, '/'))
  })

  test('renders an <img> whose src is marktext://local/?path=<docDir>/assets/cat.png', async () => {
    const imgLocator = page.locator('.editor-component .mu-image-container img')
    await imgLocator.first().waitFor({ state: 'attached', timeout: 10000 })

    // Wait for loadImageAsync to settle: a successful off-disk load swaps the
    // wrapper to `.mu-image-success` and sets the <img> src to the resolved
    // (optionally cache-busted) marktext://local URL.
    await expect
      .poll(
        async () => page.locator('.editor-component .mu-inline-image.mu-image-success').count(),
        {
          timeout: 10000
        }
      )
      .toBeGreaterThanOrEqual(1)

    const src = await imgLocator.first().getAttribute('src')
    expect(src).not.toBeNull()
    const value = src as string

    // DIRNAME-anchored: the marktext://local query must contain the resolved image path.
    expect(value.startsWith('marktext://local/?path=')).toBe(true)
    expect(value).not.toContain('marktext://local/?path=marktext://local/?path=')

    const parsed = new URL(value)
    const resolvedPath = decodeURIComponent(parsed.searchParams.get('path') ?? '')
    expect(resolvedPath.replace(/\\/g, '/').endsWith('assets/cat.png')).toBe(true)
    expect(resolvedPath.replace(/\\/g, '/')).toBe(`${docDir.replace(/\\/g, '/')}/assets/cat.png`)
  })

  test('the anchored marktext://local URL points at a file that exists on disk', async () => {
    const src = await page
      .locator('.editor-component .mu-image-container img')
      .first()
      .getAttribute('src')
    expect(src).not.toBeNull()
    const parsed = new URL(src as string)
    const onDiskPath = decodeURIComponent(parsed.searchParams.get('path') ?? '')
    expect(fs.existsSync(onDiskPath)).toBe(true)
    expect(onDiskPath.replace(/\\/g, '/')).toBe(
      path.join(docDir, 'assets', 'cat.png').replace(/\\/g, '/')
    )
  })
})
