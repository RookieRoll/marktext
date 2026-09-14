/**
 * IPC channel contract — single source of truth for renderer↔main messaging.
 *
 * Four channel categories:
 *   - IpcInvokeChannels      : renderer → main, returns Promise<T>
 *   - IpcSendChannels        : renderer → main, fire-and-forget
 *   - IpcSyncChannels        : renderer → main, synchronous
 *   - IpcMainEventChannels   : main → renderer, push events (renderer .on)
 *
 * Channel names and the migrated domain payloads are typed here. A small number
 * of legacy channels still use unknown until their producers and consumers are
 * migrated together.
 *
 * To register a new channel:
 *   1. Add an entry to the appropriate interface here.
 *   2. Wire the handler in src/main (ipcMain.handle / ipcMain.on / webContents.send).
 *   3. Wire the caller via the typed preload bridge in src/preload/index.ts.
 */

import type { IKeyboardLayoutInfo, IKeyboardMapping } from 'native-keymap'
import type {
  MarkdownDocument,
  TabOptions,
  BootstrapEditorConfig,
  PageOptions,
  ExportType,
  SaveOptions,
  SerializedStat,
  LineEnding,
  FileChangeDetail,
  UnsavedFile
} from './files'
import type { BufferedState as BufferedStateType } from './bufferedState'
import type { MenuTemplate, MenuPopupPosition } from './menu'
import type { IUserPreferences, ShortcutStyle } from './preferences'
import type { KeybindingPreferences, UserKeybindings } from './keybindings'

export type { KeybindingPreferences, UserKeybindings } from './keybindings'
export type { UnsavedFile } from './files'
import type {
  RipgrepRequest,
  RipgrepStartResponse,
  RipgrepMatchEvent,
  RipgrepProgressEvent,
  RipgrepDoneEvent,
  RipgrepErrorEvent,
  RipgrepCancelledEvent
} from './ripgrep'
import type { UploadRequest, UploadResult } from './uploader'
import type { PerformanceSamplePayload } from '../performance'

// =================================================================
// Invoke channels (renderer → main, returns Promise<T>)
// =================================================================

export interface IpcInvokeChannels {
  'mt::ask-for-image-path': { args: []; ret: string[] }
  'mt::boot-info-async': { args: []; ret: BootInfo }
  'mt::clipboard::guess-file-path': { args: []; ret: string | null }
  'mt::clipboard::read-text': { args: []; ret: string }
  'mt::cmd::exists': { args: [name: string]; ret: boolean }
  'mt::fonts::list': { args: []; ret: string[] }
  'mt::fs-trash-item': { args: [pathname: string]; ret: void }
  'mt::fs::copy': { args: [src: string, dest: string]; ret: void }
  'mt::fs::empty-dir': { args: [path: string]; ret: void }
  'mt::fs::ensure-dir': { args: [path: string]; ret: void }
  'mt::fs::is-directory': { args: [path: string]; ret: boolean }
  'mt::fs::is-executable': { args: [path: string]; ret: boolean }
  'mt::fs::is-file': { args: [path: string]; ret: boolean }
  'mt::fs::move': { args: [src: string, dest: string]; ret: void }
  'mt::fs::output-file': { args: [path: string, data: string | Uint8Array]; ret: void }
  'mt::fs::path-exists': { args: [path: string]; ret: boolean }
  'mt::fs::read-file': { args: [path: string, encoding?: string]; ret: string | Uint8Array }
  'mt::fs::readdir': { args: [path: string]; ret: string[] }
  'mt::fs::stat': { args: [path: string]; ret: SerializedStat }
  'mt::fs::unlink': { args: [path: string]; ret: void }
  'mt::fs::write-file': { args: [path: string, data: string | Uint8Array]; ret: void }
  'mt::i18n::is-supported': { args: [lang: string]; ret: boolean }
  'mt::i18n::load': { args: [language: string]; ret: Record<string, unknown> }
  'mt::i18n::supported': { args: []; ret: string[] }
  'mt::keybinding-get-keyboard-info': { args: []; ret: KeyboardInfo }
  'mt::keybinding-get-pref-keybindings': {
    args: []
    ret: KeybindingPreferences
  }
  'mt::keybinding-set-style': { args: [style: ShortcutStyle]; ret: KeybindingPreferences }
  'mt::keybinding-save-user-keybindings': { args: [bindings: UserKeybindings]; ret: boolean }
  'mt::paths::is-image': { args: [path: string]; ret: boolean }
  'mt::rg::start': { args: [req: RipgrepRequest]; ret: RipgrepStartResponse }
  'mt::shell::open-external': { args: [url: string]; ret: void }
  'mt::shell::open-path': { args: [fullPath: string]; ret: string }
  'mt::spellchecker-get-available-dictionaries': { args: []; ret: string[] }
  'mt::spellchecker-get-custom-dictionary-words': { args: []; ret: string[] }
  'mt::spellchecker-remove-word': { args: [word: string]; ret: boolean }
  'mt::spellchecker-set-enabled': { args: [enabled: boolean]; ret: void }
  'mt::spellchecker-switch-language': { args: [language: string]; ret: void }
  'mt::uploader::upload': { args: [req: UploadRequest]; ret: UploadResult }
  'mt::win::is-fullscreen': { args: []; ret: boolean }
  'mt::win::is-maximized': { args: []; ret: boolean }
  // Main derives the BrowserWindow via BrowserWindow.fromWebContents(e.sender);
  // no need to pass windowId. Payload is the editor+project+layout snapshot.
  'update-buffer-state': { args: [payload: BufferedStateType]; ret: boolean }
}

// =================================================================
// Send channels (renderer → main, fire-and-forget)
// =================================================================

export interface IpcSendChannels {
  'app-create-editor-window': []
  'app-create-settings-window': []
  'app-open-directory-by-id': [windowId: number, dirPath: string]
  'app-open-file-by-id': [windowId: number, filePath: string, options?: TabOptions]
  'app-open-files-by-id': [windowId: number, filePaths: string[], options?: TabOptions]
  'app-open-markdown-by-id': [windowId: number, markdown: string, options?: TabOptions]
  'broadcast-preferences-changed': [partial: Partial<IUserPreferences>]
  'broadcast-user-data-changed': [partial: Record<string, unknown>]
  'menu-add-recently-used': [filePath: string]
  'menu-clear-recently-used': []
  'mt::add-recently-used-document': [filePath: string]
  'mt::app-try-quit': []
  'mt::ask-for-image-auto-path': [payload: ImageAutoPathRequest]
  'mt::ask-for-modify-image-folder-path': [imagePath?: string]
  'mt::ask-for-open-project-in-sidebar': []
  'mt::ask-for-user-data': []
  'mt::ask-for-user-preference': []
  'mt::clipboard::write-text': [text: string]
  'mt::close-window': []
  'mt::close-window-confirm': [unsavedFiles: UnsavedFile[]]
  'mt::cmd-close-window': []
  'mt::cmd-import-file': []
  'mt::cmd-new-editor-window': []
  'mt::cmd-open-file': []
  'mt::cmd-open-folder': []
  'mt::cmd-toggle-autosave': []
  'mt::editor-selection-changed': [windowId: number, state: EditorSelectionState]
  'mt::format-link-click': [payload: FormatLinkPayload]
  'mt::get-current-language': []
  'mt::handle-renderer-error': [error: RendererErrorPayload]
  'mt::keybinding-debug-dump-keyboard-info': []
  'mt::make-screenshot': []
  'mt::menu::popup': [template: MenuTemplate, position?: MenuPopupPosition]
  'mt::menu::popup-application': [position?: MenuPopupPosition]
  'mt::performance-mark': [milestone: import('../performance').PerformanceMilestone, payload?: PerformanceSamplePayload]
  'mt::open-file': [filePath: string, options?: TabOptions]
  'mt::open-file-by-window-id': [windowId: number, filePath: string, options?: TabOptions]
  'mt::open-keybindings-config': []
  'mt::open-setting-window': []
  'mt::rename': [
    payload: RenamePayload
  ]
  'mt::renderer-ready': []
  'mt::request-keybindings': []
  'mt::set-editor-format-menus-enabled': [windowId: number, enabled: boolean]
  'mt::response-export': [
    payload: {
      type: ExportType
      title: string
      content: string
      filename: string
      pathname: string
      pageOptions: PageOptions
    }
  ]
  'mt::response-file-move-to': [payload: { id: string; pathname: string }]
  'mt::response-file-save': [
    id: string,
    filename: string,
    pathname: string,
    markdown: string,
    options: SaveOptions,
    defaultPath: string
  ]
  'mt::response-file-save-as': [
    id: string,
    filename: string,
    pathname: string,
    markdown: string,
    options: SaveOptions,
    defaultPath: string
  ]
  'mt::response-print': []
  'mt::rg::cancel': [searchId: string]
  'mt::save-and-close-tabs': [tabs: UnsavedFile[]]
  'mt::save-tabs': [tabs: UnsavedFile[]]
  'mt::select-default-directory-to-open': []
  'mt::set-user-data': [partial: Record<string, unknown>]
  'mt::set-user-preference': [partial: Partial<IUserPreferences>]
  'mt::shell::open-external': [url: string]
  'mt::shell::show-item': [fullPath: string]
  'mt::update-format-menu': [windowId: number, state: Record<string, boolean>]
  'mt::update-line-ending-menu': [windowId: number, lineEnding: LineEnding]
  'mt::update-sidebar-menu': [windowId: number, visible: boolean]
  'mt::view-layout-changed': [windowId: number, layout: ViewLayoutChange]
  'mt::win::close': []
  'mt::win::maximize': []
  'mt::win::minimize': []
  'mt::win::set-fullscreen': [flag: boolean]
  'mt::win::toggle-fullscreen': []
  'mt::win::toggle-maximize': []
  'mt::win::unmaximize': []
  'mt::window-add-file-path': [windowId: number, filePath: string]
  'mt::window-initialized': []
  'mt::window-tab-closed': [pathname: string]
  'mt::window-toggle-always-on-top': []
  'mt::window::drop': [payload: string[]]
  'screen-capture': []
  'set-image-folder-path': [path: string]
  'set-user-preference': [partial: Partial<IUserPreferences>]
  'watcher-unwatch-all-by-id': [windowId: number]
  'watcher-unwatch-directory': [windowId: number, path: string]
  'watcher-unwatch-file': [windowId: number, path: string]
  'watcher-watch-directory': [windowId: number, path: string]
  'watcher-watch-file': [windowId: number, path: string]
  'window-add-file-path': [windowId: number, filePath: string]
  'window-change-file-path': [windowId: number, oldPath: string, newPath: string]
  'window-close-by-id': [windowId: number]
  'window-file-saved': [windowId: number, tabId: string]
  'window-reload-by-id': [windowId: number]
  'window-toggle-always-on-top': [windowId: number]
}

// =================================================================
// Sync channels (synchronous renderer → main)
// =================================================================

export interface IpcSyncChannels {
  'mt::boot-info': { args: []; ret: BootInfo }
  'mt::paths::is-same-sync': { args: [a: string, b: string]; ret: boolean }
}

// =================================================================
// Push events (main → renderer, listened on ipcRenderer.on)
// =================================================================

export interface IpcMainEventChannels {
  'language-changed': [language: string]
  'mt::about-dialog': []
  'mt::ask-for-close': []
  'mt::bootstrap-editor': [config: BootstrapEditorConfig]
  'mt::cm-copy-as-html': []
  'mt::cm-copy-as-rich': []
  'mt::cm-insert-paragraph': [direction: 'before' | 'after']
  'mt::cm-paste-as-plain-text': []
  'mt::current-language': [language: string]
  'mt::editor-ask-file-save': []
  'mt::editor-ask-file-save-as': []
  'mt::editor-close-tab': [tabId?: string]
  'mt::editor-edit-action': [action: string]
  'mt::editor-format-action': [payload: { type: string }]
  'mt::editor-move-file': []
  'mt::editor-paragraph-action': [payload: { type: string }]
  'mt::editor-rename-file': []
  'mt::execute-command-by-id': [commandId: string]
  'mt::export-success': [payload: { type: string; filePath: string }]
  'mt::file-saved': [tabId: string]
  'mt::force-close-tabs-by-id': [tabIds: string[]]
  'mt::invalidate-image-cache': []
  'mt::keybindings-response': [bindings: KeybindingMap]
  'mt::load-state': [state: BufferedStateType]
  'mt::menu::click': [menuId: string]
  'mt::menu::closed': []
  'mt::new-untitled-tab': [selected?: boolean, markdown?: string]
  'mt::open-directory': [directoryPath: string]
  'mt::open-new-tab': [
    markdownDocument: MarkdownDocument | null,
    options?: TabOptions,
    selected?: boolean
  ]
  'mt::pandoc-not-exists': [opts: NotificationPayload]
  'mt::print-service-clearup': []
  'mt::rg::cancelled': [payload: RipgrepCancelledEvent]
  'mt::rg::done': [payload: RipgrepDoneEvent]
  'mt::rg::error': [payload: RipgrepErrorEvent]
  'mt::rg::match': [payload: RipgrepMatchEvent]
  'mt::rg::progress': [payload: RipgrepProgressEvent]
  'mt::screenshot-captured': [filePath: string]
  'mt::set-line-ending': [lineEnding: LineEnding]
  'mt::set-pathname': [payload: { id: string; pathname: string; filename: string }]
  'mt::set-view-layout': [layout: ViewLayoutChange]
  'mt::show-command-palette': []
  'mt::show-export-dialog': [type: ExportType]
  'mt::show-notification': [payload: NotificationPayload]
  'mt::spelling-replace-misspelling': [payload: SpellingReplacementPayload]
  'mt::spelling-show-switch-language': []
  'mt::switch-tab-by-file_path': [filePath: string]
  'mt::switch-tab-by-index': [index: number]
  'mt::tab-save-failure': [tabId: string, message: string]
  'mt::tab-saved': [tabId: string]
  'mt::tabs-cycle-left': []
  'mt::tabs-cycle-right': []
  'mt::toggle-view-layout-entry': [entry: string]
  'mt::toggle-view-mode-entry': [entry: string]
  'mt::update-file': [payload: { type: 'add' | 'change' | 'unlink'; change: FileChangeDetail }]
  'mt::update-object-tree': [payload: ObjectTreeChangePayload]
  'mt::user-preference': [partial: Partial<IUserPreferences>]
  'mt::window-active-status': [status: WindowActiveStatus]
  'mt::window-enter-full-screen': []
  'mt::window-leave-full-screen': []
  'mt::window-maximize': []
  'mt::window-unmaximize': []
  'mt::window-zoom': [zoomLevel: number]
  'settings::change-tab': [tab: string]
}

// =================================================================
// Auxiliary types
// =================================================================

/**
 * Snapshot of the active OS keyboard layout, returned by
 * `mt::keybinding-get-keyboard-info`. Mirrors the runtime shape produced
 * by `native-keymap` (see `src/main/keyboard/index.ts#getKeyboardInfo`).
 */
export interface KeyboardInfo {
  layout: IKeyboardLayoutInfo
  keymap: IKeyboardMapping
}

export interface BootInfo {
  platform: NodeJS.Platform
  arch: string
  versions: Record<string, string>
  env: Record<string, string>
  paths: {
    resources: string
    userData: string
    cwd: string
    ripgrepBinary: string
  }
  MARKDOWN_INCLUSIONS: string[]
}

/** Link data emitted when the editor opens a Markdown link. */
export interface FormatLinkData {
  href?: string | null
  text?: string | null
}

export interface FormatLinkPayload {
  data: FormatLinkData
  dirname?: string
}

/** File rename request emitted by the editor store. */
export interface RenamePayload {
  id: string
  pathname: string
  newPathname: string
  currentFile?: Record<string, unknown>
}

/** Replacement selected from the native spelling context menu. */
export interface SpellingReplacementPayload {
  word: string
  replacement: string
}
/** Payload used by the image auto-path lookup request. */
export interface ImageAutoPathRequest {
  id: string
  pathname: string
  src: string
  /** The editor snapshot is only forwarded for legacy lookup context. */
  currentFile?: Record<string, unknown>
}

/** Selection information used to update the application menu state. */
export interface EditorSelectionState {
  affiliation: Record<string, boolean>
  isTable?: boolean
  isLooseListItem?: boolean
  isTaskList?: boolean
  isDisabled?: boolean
  isMultiline?: boolean
  isCodeFences?: boolean
  isCodeContent?: boolean
  hasFrontMatter?: boolean
}

/** Serializable renderer error copied from ErrorEvent before IPC transport. */
export interface RendererErrorPayload {
  message: string
  name: string
  stack?: string
}

/** Keybinding map broadcast to renderer windows. */
export type KeybindingMap = Record<string, string>

/** Window focus state sent by editor and settings windows. */
export interface WindowActiveStatus {
  status: boolean
}

/** Layout changes are intentionally open while the legacy menu state migrates. */
export type ViewLayoutChange = Record<string, unknown>

/** File-system watcher change delivered to the project tree. */
export interface ObjectTreeChangePayload {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  change: FileChangeDetail
}

/** Notification payloads sent from main to renderer. */
export interface NotificationPayload {
  time?: number
  title?: string
  message?: string
  type?: 'primary' | 'error' | 'warning' | 'info'
  showConfirm?: boolean
}
// =================================================================
// Helper types for the preload bridge generic wrappers
// =================================================================

export type InvokeArgs<K extends keyof IpcInvokeChannels> = IpcInvokeChannels[K]['args']
export type InvokeRet<K extends keyof IpcInvokeChannels> = IpcInvokeChannels[K]['ret']

export type SyncArgs<K extends keyof IpcSyncChannels> = IpcSyncChannels[K]['args']
export type SyncRet<K extends keyof IpcSyncChannels> = IpcSyncChannels[K]['ret']

export type SendArgs<K extends keyof IpcSendChannels> = IpcSendChannels[K]

export type EventArgs<K extends keyof IpcMainEventChannels> = IpcMainEventChannels[K]
