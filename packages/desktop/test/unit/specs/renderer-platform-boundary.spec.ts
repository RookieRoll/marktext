import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/renderer/src')
const capabilityPattern = /window\.(electron|path|fileUtils|ripgrep|uploader|fonts|commandExists|i18nUtils|process|DIRNAME)|window\.rgPath/

const collectSourceFiles = (directory: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const pathname = join(directory, entry)
    if (statSync(pathname).isDirectory()) {
      if (entry !== 'platform') files.push(...collectSourceFiles(pathname))
      continue
    }
    if (/\.(ts|vue)$/.test(entry)) files.push(pathname)
  }
  return files
}

describe('renderer platform boundary', () => {
  it('keeps preload globals inside renderer platform adapters', () => {
    const violations = collectSourceFiles(rendererRoot)
      .flatMap((pathname) => {
        const source = readFileSync(pathname, 'utf8')
        return source.match(capabilityPattern) ? [pathname] : []
      })
      .map((pathname) => relative(rendererRoot, pathname))

    expect(violations).toEqual([])
  })
})
