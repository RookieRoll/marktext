import fs from 'fs'
import path from 'path'
import Store, { type Schema } from 'electron-store'
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import log from 'electron-log'
import { isWindows } from '../config'
import { createRendererSenderGuard } from '../ipc/rendererSender'
import { hasSameKeys } from '../utils'
import { onInternalChannel } from '../utils/internalIpc'
import { getSupportedLanguages, isLanguageSupported } from 'common/i18n'
import { TypedEmitter } from '@shared/types/typedEmitter'
import type { IUserPreferences } from '@shared/types/preferences'
import schema from './schema.json'

const PREFERENCES_FILE_NAME = 'preferences'

const rendererSenderGuard = createRendererSenderGuard((sender) =>
  BrowserWindow.fromWebContents(sender)
)

// The Preference class extends EventEmitter but does not currently emit any
// events itself — keep the event map empty until concrete events are added.
type PreferenceEvents = Record<string, unknown[]>

// Structural subset of EnvPaths/AppPaths — only `preferencesPath` is read here.
interface AppPaths {
  readonly preferencesPath: string
}

interface StartupPreferences {
  language: string
  theme: string
  followSystemTheme: boolean
  lightModeTheme: string
  darkModeTheme: string
  codeFontFamily: string
  codeFontSize: number
  hideScrollbar: boolean
  titleBarStyle: string
  shortcutStyle: string
  sideBarVisibility: boolean
  restoreLayoutState: boolean
  tabBarVisibility: boolean
  sourceCodeModeEnabled: boolean
  spellcheckerEnabled: boolean
  spellcheckerLanguage: string
}

class Preference extends TypedEmitter<PreferenceEvents> {
  public readonly preferencesPath: string
  public readonly hasPreferencesFile: boolean
  public readonly store: Store<IUserPreferences>
  public readonly staticPath: string
  private _startupPreferences: StartupPreferences | null = null

  /**
   * @param paths The path instance.
   *
   * NOTE: This throws an exception when validation fails.
   */
  constructor(paths: AppPaths) {
    // TODO: Preferences should not loaded if global.MARKTEXT_SAFE_MODE is set.
    super()

    const { preferencesPath } = paths
    this.preferencesPath = preferencesPath
    this.hasPreferencesFile = fs.existsSync(
      path.join(this.preferencesPath, `./${PREFERENCES_FILE_NAME}.json`)
    )
    this.store = new Store<IUserPreferences>({
      schema: schema as unknown as Schema<IUserPreferences>,
      name: PREFERENCES_FILE_NAME,
      migrations: {
        '0.18.6': (store) => {
          if (store.get('startUpAction') === 'lastState') {
            store.set('startUpAction', 'openLastFolder')
          }
        }
      },
      beforeEachMigration: (_store, context) => {
        log.info(`Preferences migration: ${context.fromVersion} -> ${context.toVersion}`)
      }
    })

    this.staticPath = path.join(global.__static, 'preference.json')
    this.init()
  }

  init = (): void => {
    let defaultSettings: Record<string, unknown> | null = null
    try {
      defaultSettings = JSON.parse(fs.readFileSync(this.staticPath, { encoding: 'utf8' }) || '{}')

      // Set best theme on first application start.
      if (nativeTheme.shouldUseDarkColors) {
        defaultSettings!.theme = 'dark'
      }

      // Set system language on first application start
      if (!this.hasPreferencesFile) {
        const systemLanguage = this._getSystemLanguage()
        if (systemLanguage) {
          defaultSettings!.language = systemLanguage
        }
      }
    } catch (err) {
      log.error(err)
    }

    if (!defaultSettings) {
      throw new Error('Can not load static preference.json file')
    }

    // I don't know why `this.store.size` is 3 when first load, so I just check file existed.
    if (!this.hasPreferencesFile) {
      this.store.set(defaultSettings)
    } else {
      // Because `this.getAll()` will return a plainObject, so we can not use `hasOwnProperty` method
      // const plainObject = () => Object.create(null)
      const userSetting = this.getAll() as Record<string, unknown>
      // Update outdated settings
      const requiresUpdate = !hasSameKeys(defaultSettings, userSetting)
      const userSettingKeys = Object.keys(userSetting)
      const defaultSettingKeys = Object.keys(defaultSettings)

      if (requiresUpdate) {
        // TODO(fxha): For performance reasons, we should try to replace 'electron-store' because
        //   it does multiple blocking I/O calls when changing entries. There is no transaction or
        //   async I/O available. The core reason we changed to it was JSON scheme validation.

        // Remove outdated settings
        for (const key of userSettingKeys) {
          if (!defaultSettingKeys.includes(key)) {
            delete userSetting[key]
            this.store.delete(key)
          }
        }

        // Add new setting options
        let addedNewEntries = false
        for (const key in defaultSettings) {
          if (!userSettingKeys.includes(key)) {
            addedNewEntries = true
            userSetting[key] = defaultSettings[key]
          }
        }
        if (addedNewEntries) {
          this.store.set(userSetting)
        }
      }
    }

    this._listenForIpcMain()
  }

  getAll(): IUserPreferences {
    return this.store.store as IUserPreferences
  }

  /**
   * Return the small, frequently reused preference snapshot needed before the
   * first renderer paint. Keep it cached until a preference mutation so window
   * constructors do not repeatedly traverse electron-store for the same data.
   */
  getStartupPreferences(): StartupPreferences {
    if (!this._startupPreferences) {
      const preferences = this.getAll()
      this._startupPreferences = {
        language: preferences.language || 'en',
        theme: preferences.theme || 'light',
        followSystemTheme: preferences.followSystemTheme !== false,
        lightModeTheme: preferences.lightModeTheme || 'light',
        darkModeTheme: preferences.darkModeTheme || 'dark',
        codeFontFamily: preferences.codeFontFamily || '',
        codeFontSize: typeof preferences.codeFontSize === 'number' ? preferences.codeFontSize : 14,
        hideScrollbar: preferences.hideScrollbar === true,
        titleBarStyle: preferences.titleBarStyle || 'custom',
        shortcutStyle: preferences.shortcutStyle || 'marktext',
        sideBarVisibility: preferences.sideBarVisibility === true,
        restoreLayoutState: preferences.restoreLayoutState !== false,
        tabBarVisibility: preferences.tabBarVisibility === true,
        sourceCodeModeEnabled: preferences.sourceCodeModeEnabled === true,
        spellcheckerEnabled: preferences.spellcheckerEnabled === true,
        spellcheckerLanguage: preferences.spellcheckerLanguage || 'en-US'
      }
    }
    return this._startupPreferences
  }

  setItem(key: string, value: unknown): void {
    this._startupPreferences = null
    this.store.set(key, value)
    ipcMain.emit('broadcast-preferences-changed', { [key]: value })
  }

  getItem<T = unknown>(key: string): T {
    return this.store.get(key) as T
  }

  /**
   * Change multiple setting entries.
   *
   * @param settings A settings object or subset object with key/value entries.
   */
  setItems(settings: Record<string, unknown> | null | undefined): void {
    if (!settings) {
      log.error('Cannot change settings without entires: object is undefined or null.')
      return
    }

    Object.keys(settings).forEach((key) => {
      this.setItem(key, settings[key])
    })
  }

  getPreferredEol(): 'lf' | 'crlf' {
    const endOfLine = this.getItem<string>('endOfLine')
    if (endOfLine === 'lf') {
      return 'lf'
    }
    return endOfLine === 'crlf' || isWindows ? 'crlf' : 'lf'
  }

  exportJSON(): void {
    // todo
  }

  importJSON(): void {
    // todo
  }

  _listenForIpcMain(): void {
    ipcMain.on('mt::ask-for-user-preference', (e) => {
      const win = rendererSenderGuard.getWindow(e)
      if (win) {
        win.webContents.send('mt::user-preference', this.getAll())
      }
    })
    ipcMain.on('mt::set-user-preference', (e, settings: Record<string, unknown>) => {
      if (!rendererSenderGuard.getWindow(e)) return
      this.setItems(settings)
    })
    ipcMain.on('mt::cmd-toggle-autosave', (e) => {
      if (!rendererSenderGuard.getWindow(e)) return
      this.setItem('autoSave', !this.getItem('autoSave'))
    })

    onInternalChannel('set-user-preference', (settings: Record<string, unknown>) => {
      this.setItems(settings)
    })
  }

  /**
   * Gets the system language, or null if it's not in the supported list
   * @returns Supported system language code or null
   */
  _getSystemLanguage(): string | null {
    try {
      // Get the system language
      const systemLocale = app.getLocale()
      log.info(`System locale detected: ${systemLocale}`)

      // Get the list of supported languages
      const supportedLanguages = getSupportedLanguages()

      // Directly match the full language code (e.g. zh-CN)
      if (isLanguageSupported(systemLocale)) {
        log.info(`Using system language: ${systemLocale}`)
        return systemLocale
      }

      // Attempt to match the primary part of the language (e.g. zh)
      const primaryLanguage = systemLocale.split('-')[0]!
      const matchedLanguage = supportedLanguages.find((lang) => lang.startsWith(primaryLanguage))

      if (matchedLanguage) {
        log.info(`Using matched language: ${matchedLanguage} for system locale: ${systemLocale}`)
        return matchedLanguage
      }

      log.info(`System language ${systemLocale} not supported, will use default language`)
      return null
    } catch (error) {
      log.error('Error detecting system language:', error)
      return null
    }
  }
}

export default Preference
