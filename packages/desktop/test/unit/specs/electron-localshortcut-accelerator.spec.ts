import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  electronLocalshortcut,
  getAcceleratorFromKeyboardEvent,
  isValidElectronAccelerator
} from '@hfelix/electron-localshortcut'

type BeforeInputEvent = {
  preventDefault: () => void
}

type FakeWindow = {
  webContents: EventEmitter
  isDestroyed: () => boolean
  getTitle: () => string
}

const isMac = process.platform === 'darwin'
const primaryAccelerator = isMac ? 'shift+cmd' : 'ctrl+shift'

const makeWindow = (): FakeWindow => ({
  webContents: new EventEmitter(),
  isDestroyed: () => false,
  getTitle: () => 'accelerator probe'
})

const makeRecordedKeyboardEvent = (key: string, code: string, shiftKey: boolean): KeyboardEvent =>
  ({
    type: 'keydown',
    key,
    code,
    ctrlKey: !isMac,
    altKey: false,
    shiftKey,
    metaKey: isMac,
    getModifierState: () => false
  }) as unknown as KeyboardEvent

const makeRuntimeInputEvent = (key: string, code: string, shift: boolean) => ({
  type: 'keyDown',
  key,
  code,
  control: !isMac,
  alt: false,
  shift,
  meta: isMac,
  isComposing: false
})

const probeCases = [
  { name: 'Digit7', key: '&', code: 'Digit7', shiftKey: true, keyAccelerator: '&' },
  { name: 'punctuation', key: '{', code: 'BracketLeft', shiftKey: true, keyAccelerator: '{' },
  { name: 'letter', key: 'A', code: 'KeyA', shiftKey: true, keyAccelerator: 'A' },
  { name: 'unshifted Digit7', key: '7', code: 'Digit7', shiftKey: false, keyAccelerator: '7' }
] as const

afterEach(() => {
  vi.restoreAllMocks()
})

describe('@hfelix/electron-localshortcut accelerator probe', () => {
  it.each(probeCases)('keeps the expected Shift state for $name while recording', (probe) => {
    const result = getAcceleratorFromKeyboardEvent(
      makeRecordedKeyboardEvent(probe.key, probe.code, probe.shiftKey)
    )
    const expectedAccelerator = probe.shiftKey
      ? `${primaryAccelerator}+${probe.keyAccelerator}`
      : `${isMac ? 'cmd' : 'ctrl'}+${probe.keyAccelerator}`

    expect(result).toEqual({ accelerator: expectedAccelerator, isValid: true })
    expect(isValidElectronAccelerator(result.accelerator)).toBe(true)
  })

  it.each(probeCases)('matches the recorded accelerator at runtime for $name', (probe) => {
    const win = makeWindow()
    const callback = vi.fn(() => true)
    const recorded = getAcceleratorFromKeyboardEvent(
      makeRecordedKeyboardEvent(probe.key, probe.code, probe.shiftKey)
    )
    const event: BeforeInputEvent = { preventDefault: vi.fn() }

    electronLocalshortcut.register(win as never, recorded.accelerator, callback)
    win.webContents.emit(
      'before-input-event',
      event,
      makeRuntimeInputEvent(probe.key, probe.code, probe.shiftKey)
    )

    expect(callback).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledOnce()

    electronLocalshortcut.unregister(win as never, recorded.accelerator)
  })
})
