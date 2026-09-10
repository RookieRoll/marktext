import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../src', relativePath), 'utf8')

const mainSource = source('renderer/src/main.ts')
const bootstrapSource = source('renderer/src/bootstrap.ts')
const appPageSource = source('renderer/src/pages/app.vue')
const preferencePageSource = source('renderer/src/pages/preference.vue')
const baseWindowSource = source('main/windows/base.ts')
const preferenceSource = source('main/preferences/index.ts')
const accessorSource = source('main/app/accessor.ts')

const indexOfOrFail = (text: string, needle: string): number => {
  const index = text.indexOf(needle)
  expect(index, `missing source marker: ${needle}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('startup language, theme, and preference snapshot', () => {
  it('seeds theme and minimal preferences before the first Vue mount', () => {
    const styleIndex = indexOfOrFail(appPageSource, 'addStyles(startupStyle)')
    const hydrationIndex = indexOfOrFail(mainSource, 'SET_USER_PREFERENCE(initialState)')
    const mountIndex = indexOfOrFail(mainSource, "app.mount('#app')")

    expect(styleIndex).toBeLessThan(indexOfOrFail(appPageSource, 'onMounted(async () =>'))
    expect(hydrationIndex).toBeLessThan(mountIndex)
    expect(mainSource).toContain('await setLanguage(initialLanguage)')
    expect(mainSource).toContain('requestCurrentLanguage()')
  })

  it('passes the resolved language through the existing window startup URL', () => {
    expect(baseWindowSource).toContain("url.searchParams.set('lang', language ?? '')")
    expect(bootstrapSource).toContain("const language = params.get('lang')")
    expect(bootstrapSource).toContain('language\n    }')
  })

  it('does not apply the startup theme again from page mounted hooks', () => {
    expect(appPageSource).toContain('addStyles(startupStyle)')
    expect(preferencePageSource).toContain('addThemeStyle(initialState?.theme')
    expect(preferencePageSource).not.toContain('nextTick')
  })

  it('reuses a cached startup preference snapshot for main construction', () => {
    expect(preferenceSource).toContain('getStartupPreferences(): StartupPreferences')
    expect(preferenceSource).toContain('if (!this._startupPreferences)')
    expect(accessorSource).toContain('this.preferences.getStartupPreferences()')
    expect(baseWindowSource).toContain(
      'userPreference.getStartupPreferences?.() ?? userPreference.getAll()'
    )
  })

  it('keeps the legacy current-language IPC as an explicit fallback', () => {
    const i18nSource = source('renderer/src/i18n/index.ts')
    expect(i18nSource).toContain("getIpcRenderer().send('mt::get-current-language')")
    expect(i18nSource).not.toContain(
      "getIpcRenderer().send('mt::get-current-language')\n  getIpcRenderer().on"
    )
  })
})
