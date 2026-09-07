import type { ShortcutStyle } from './preferences'

/**
 * User keybindings as they cross the Electron structured-clone boundary.
 *
 * The renderer normally sends a Map, while array entries keep the contract
 * usable for tests and other serializable callers without accepting arbitrary
 * objects from IPC.
 */
export type UserKeybindings =
  | Map<string, string>
  | ReadonlyArray<readonly [key: string, accelerator: string]>

export interface KeybindingPreferences {
  defaultKeybindings: Map<string, string>
  userKeybindings: Map<string, string>
  shortcutStyle: ShortcutStyle
}

const isKeybindingEntry = (value: unknown): value is readonly [string, string] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'string'

const hasValidMapEntries = (value: Map<unknown, unknown>): boolean => {
  for (const [key, accelerator] of value) {
    if (typeof key !== 'string' || typeof accelerator !== 'string') return false
  }
  return true
}

/** Validate untrusted user keybinding data received through IPC. */
export const isUserKeybindings = (value: unknown): value is UserKeybindings => {
  if (value instanceof Map) return hasValidMapEntries(value)
  return Array.isArray(value) && value.every(isKeybindingEntry)
}
