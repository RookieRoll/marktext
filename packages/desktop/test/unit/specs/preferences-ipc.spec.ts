import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredListener = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, RegisteredListener>()
  return {
    listeners,
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    ipcMain: {
      on: vi.fn((channel: string, listener: RegisteredListener) => {
        listeners.set(channel, listener)
      }),
      emit: vi.fn()
    },
    onInternalChannel: vi.fn()
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain,
  app: { getLocale: vi.fn(() => 'en-US') },
  nativeTheme: { shouldUseDarkColors: false }
}))
vi.mock('electron-store', () => ({ default: vi.fn() }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), error: vi.fn() } }))
vi.mock('../../../src/main/config', () => ({ isWindows: false }))
vi.mock('../../../src/main/utils', () => ({ hasSameKeys: vi.fn() }))
vi.mock('../../../src/main/utils/internalIpc', () => ({
  onInternalChannel: mocks.onInternalChannel
}))
vi.mock('common/i18n', () => ({
  getSupportedLanguages: vi.fn(() => ['en-US']),
  isLanguageSupported: vi.fn(() => true)
}))

import type { IUserPreferences } from '../../../src/shared/types/preferences'
import Preference from '../../../src/main/preferences'

const channels = [
  'mt::ask-for-user-preference',
  'mt::set-user-preference',
  'mt::cmd-toggle-autosave'
] as const

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const window = { webContents: { send: vi.fn() } } as unknown as BrowserWindow

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame },
    childFrameEvent: { sender, senderFrame: childFrame },
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame },
    sender,
    window
  }
}

const events = createEvents()

describe('preferences IPC renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? events.window : null
    )
  })

  const createPreference = () => {
    const preference = Object.create(Preference.prototype) as Preference
    const settings = { theme: 'dark' } as unknown as IUserPreferences

    preference.getAll = vi.fn(() => settings)
    preference.setItems = vi.fn()
    preference.getItem = vi.fn(() => false) as unknown as Preference['getItem']
    preference.setItem = vi.fn()
    preference._listenForIpcMain()

    return { preference, settings }
  }

  it('registers the preference and autosave listeners', () => {
    createPreference()

    expect([...mocks.listeners.keys()]).toEqual(expect.arrayContaining([...channels]))
    expect(mocks.listeners).toHaveProperty('size', channels.length)
  })

  it('no-ops invalid senders before reading or mutating preferences', () => {
    const { preference } = createPreference()
    const ask = mocks.listeners.get('mt::ask-for-user-preference')
    const set = mocks.listeners.get('mt::set-user-preference')
    const toggleAutosave = mocks.listeners.get('mt::cmd-toggle-autosave')

    expect(ask).toBeDefined()
    expect(set).toBeDefined()
    expect(toggleAutosave).toBeDefined()

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      expect(ask!(event)).toBeUndefined()
      expect(set!(event, { theme: 'light' })).toBeUndefined()
      expect(toggleAutosave!(event)).toBeUndefined()
    }

    expect(events.window.webContents.send).not.toHaveBeenCalled()
    expect(preference.getAll).not.toHaveBeenCalled()
    expect(preference.setItems).not.toHaveBeenCalled()
    expect(preference.getItem).not.toHaveBeenCalled()
    expect(preference.setItem).not.toHaveBeenCalled()
  })

  it('preserves valid renderer preference and autosave behavior', () => {
    const { preference, settings } = createPreference()
    const ask = mocks.listeners.get('mt::ask-for-user-preference')!
    const set = mocks.listeners.get('mt::set-user-preference')!
    const toggleAutosave = mocks.listeners.get('mt::cmd-toggle-autosave')!

    ask(events.mainFrameEvent)
    set(events.mainFrameEvent, { theme: 'light' })
    toggleAutosave(events.mainFrameEvent)

    expect(events.window.webContents.send).toHaveBeenCalledWith('mt::user-preference', settings)
    expect(preference.setItems).toHaveBeenCalledWith({ theme: 'light' })
    expect(preference.getItem).toHaveBeenCalledWith('autoSave')
    expect(preference.setItem).toHaveBeenCalledWith('autoSave', true)
  })
})
