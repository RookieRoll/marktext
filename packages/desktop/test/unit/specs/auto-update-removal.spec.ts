import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sourceRoot = resolve(desktopRoot, 'src')

const readSource = (...parts: string[]): string => readFileSync(resolve(sourceRoot, ...parts), 'utf8')

describe('automatic update removal boundary', () => {
  it('removes the updater dependency and runtime implementation', () => {
    const packageJson = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(packageJson.dependencies?.['electron-updater']).toBeUndefined()
    const lockfile = readFileSync(resolve(desktopRoot, '../../pnpm-lock.yaml'), 'utf8')
    const desktopImporter = lockfile.match(/  packages\/desktop:\n(?:(?:    [^\n]+|      [^\n]+)\n)*/)?.[0] ?? ''
    expect(desktopImporter).not.toContain('electron-updater')
    expect(existsSync(resolve(sourceRoot, 'renderer/src/store/autoUpdates.ts'))).toBe(false)
    expect(existsSync(resolve(sourceRoot, 'renderer/src/commands/utils.ts'))).toBe(false)

    for (const pathname of readdirRecursive(sourceRoot)) {
      expect(readFileSync(pathname, 'utf8')).not.toMatch(
        /electron-updater|autoUpdater|mt::NEED_UPDATE|mt::check-for-update|mt::UPDATE_/
      )
    }
  })

  it('removes update-only menu, command and IPC contracts', () => {
    expect(readSource('main/menu/templates/help.ts')).not.toContain('checkUpdates')
    expect(readSource('main/menu/templates/marktext.ts')).not.toContain('checkUpdates')
    expect(readSource('main/menu/actions/file.ts')).not.toContain('FILE_CHECK_UPDATE')
    expect(readSource('common/commands/constants.ts')).not.toContain('file.check-update')
    expect(readSource('renderer/src/commands/index.ts')).not.toContain('file.check-update')
    expect(readSource('renderer/src/commands/descriptions.ts')).not.toContain('file.check-update')
    expect(readSource('shared/types/ipc.ts')).not.toMatch(
      /NEED_UPDATE|check-for-update|UPDATE_AVAILABLE|UPDATE_DOWNLOADED|UPDATE_ERROR|UPDATE_NOT_AVAILABLE|isUpdatable/
    )

    const ipc = readSource('shared/types/ipc.ts')
    expect(ipc).toContain("'mt::update-file'")
    expect(ipc).toContain("'mt::update-object-tree'")
    expect(ipc).toContain("'mt::update-format-menu'")
  })

  it('keeps locale JSON valid and removes only update-check labels', () => {
    const localeRoot = resolve(desktopRoot, 'static/locales')
    for (const filename of readdirSync(localeRoot).filter((name) => name.endsWith('.json'))) {
      const locale = JSON.parse(readFileSync(resolve(localeRoot, filename), 'utf8')) as {
        menu?: {
          help?: Record<string, unknown>
          marktext?: Record<string, unknown>
        }
        commands?: { file?: Record<string, unknown> }
      }
      expect(locale.menu?.help?.checkUpdates).toBeUndefined()
      expect(locale.menu?.marktext?.checkUpdates).toBeUndefined()
      expect(locale.commands?.file?.checkUpdate).toBeUndefined()
    }
  })
})

function readdirRecursive(root: string): string[] {
  const paths: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const pathname = resolve(root, entry.name)
    if (entry.isDirectory()) paths.push(...readdirRecursive(pathname))
    else if (/\.(?:ts|vue|d\.ts)$/.test(entry.name)) paths.push(pathname)
  }
  return paths
}
