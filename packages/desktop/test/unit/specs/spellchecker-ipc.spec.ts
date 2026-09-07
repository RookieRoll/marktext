import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const handles = new Map<string, RegisteredHandler>()
  const session = {
    addWordToSpellCheckerDictionary: vi.fn(() => true),
    removeWordFromSpellCheckerDictionary: vi.fn(() => true),
    listWordsInSpellCheckerDictionary: vi.fn(() => Promise.resolve(['custom-word'])),
    setSpellCheckerEnabled: vi.fn(),
    isSpellCheckerEnabled: vi.fn(() => true),
    setSpellCheckerLanguages: vi.fn(),
    availableSpellCheckerLanguages: ['en-US', 'de-DE']
  }
  return {
    handles,
    session,
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: RegisteredHandler) => {
        handles.set(channel, handler)
      })
    },
    log: {
      warn: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain
}))
vi.mock('electron-log', () => ({ default: mocks.log }))

import registerSpellcheckerHandlers from '../../../src/main/spellchecker'

const invokeChannels = [
  'mt::spellchecker-remove-word',
  'mt::spellchecker-switch-language',
  'mt::spellchecker-get-available-dictionaries',
  'mt::spellchecker-set-enabled',
  'mt::spellchecker-get-custom-dictionary-words'
] as const

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const window = {
    id: 1,
    webContents: { session: mocks.session }
  } as unknown as BrowserWindow

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame },
    childFrameEvent: { sender, senderFrame: childFrame },
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame },
    sender,
    window
  }
}

const events = createEvents()
registerSpellcheckerHandlers()

describe('spellchecker IPC renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? events.window : null
    )
  })

  it('registers every spellchecker invoke handler', () => {
    for (const channel of invokeChannels) {
      expect(mocks.handles.has(channel)).toBe(true)
    }
  })

  it('rejects unknown senders and child frames before dictionary APIs run', async () => {
    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const channel of invokeChannels) {
        const handler = mocks.handles.get(channel)
        expect(handler).toBeDefined()
        await expect(Promise.resolve().then(() => handler!(event, 'de-DE'))).rejects.toThrow(
          'Rejected IPC sender'
        )
      }
    }

    expect(mocks.session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled()
    expect(mocks.session.removeWordFromSpellCheckerDictionary).not.toHaveBeenCalled()
    expect(mocks.session.listWordsInSpellCheckerDictionary).not.toHaveBeenCalled()
    expect(mocks.session.setSpellCheckerEnabled).not.toHaveBeenCalled()
    expect(mocks.session.isSpellCheckerEnabled).not.toHaveBeenCalled()
    expect(mocks.session.setSpellCheckerLanguages).not.toHaveBeenCalled()
  })

  it('preserves dictionary behavior for a trusted main-frame renderer', async () => {
    const removeHandler = mocks.handles.get('mt::spellchecker-remove-word')
    const switchHandler = mocks.handles.get('mt::spellchecker-switch-language')
    const dictionariesHandler = mocks.handles.get('mt::spellchecker-get-available-dictionaries')
    const enabledHandler = mocks.handles.get('mt::spellchecker-set-enabled')
    const customWordsHandler = mocks.handles.get('mt::spellchecker-get-custom-dictionary-words')

    await expect(removeHandler!(events.mainFrameEvent, 'teh')).resolves.toBe(true)
    await expect(switchHandler!(events.mainFrameEvent, 'de-DE')).resolves.toBeNull()
    await expect(dictionariesHandler!(events.mainFrameEvent)).resolves.toEqual(['en-US', 'de-DE'])
    await expect(enabledHandler!(events.mainFrameEvent, true)).resolves.toBe(true)
    await expect(customWordsHandler!(events.mainFrameEvent)).resolves.toEqual(['custom-word'])

    expect(mocks.session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledWith('teh')
    expect(mocks.session.setSpellCheckerLanguages).toHaveBeenCalledWith(['de-DE'])
    expect(mocks.session.setSpellCheckerEnabled).toHaveBeenCalledWith(true)
    expect(mocks.session.isSpellCheckerEnabled).toHaveBeenCalledTimes(1)
    expect(mocks.session.listWordsInSpellCheckerDictionary).toHaveBeenCalledTimes(1)
  })
})
