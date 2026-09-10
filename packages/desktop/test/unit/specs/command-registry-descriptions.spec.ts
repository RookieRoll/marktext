import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(__dirname, '../../..')
const readSource = (relativePath: string): string =>
  readFileSync(resolve(desktopRoot, relativePath), 'utf8')

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const hasCommandId = (source: string, id: string): boolean =>
  stripComments(source).replace(/\s+/g, ' ').includes(`id: '${id}'`)

const hasDescriptionId = (source: string, id: string): boolean =>
  stripComments(source).replace(/\s+/g, ' ').includes(`'${id}':`)

describe('Command Palette command registry', () => {
  it('does not expose stale Find Next/Previous descriptions for missing commands', () => {
    const registry = readSource('src/renderer/src/commands/index.ts')
    const descriptions = readSource('src/renderer/src/commands/descriptions.ts')

    for (const id of ['edit.find-next', 'edit.find-previous']) {
      expect(hasCommandId(registry, id), `unexpected registry entry for ${id}`).toBe(false)
      expect(hasDescriptionId(descriptions, id), `stale description for ${id}`).toBe(false)
    }
  })

  it('keeps the neighboring Find and Replace commands described and executable', () => {
    const registry = readSource('src/renderer/src/commands/index.ts')
    const descriptions = readSource('src/renderer/src/commands/descriptions.ts')

    for (const id of ['edit.find', 'edit.replace', 'edit.find-in-folder']) {
      expect(hasCommandId(registry, id), `missing registry entry for ${id}`).toBe(true)
      expect(hasDescriptionId(descriptions, id), `missing description for ${id}`).toBe(true)
    }
  })
})
