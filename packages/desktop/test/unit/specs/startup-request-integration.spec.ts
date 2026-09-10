import { describe, expect, it, vi } from 'vitest'
import {
  createStartupOpenRequestQueue,
  runApplicationStartup
} from '../../../src/main/app/applicationStartup'

type StartupState = 'not-started' | 'initializing' | 'ready'
type OpenedRequest = { source: string; path: string; openFilesInSameWindow: boolean }

/**
 * Injectable integration boundary for OS-originated startup requests.
 *
 * It deliberately models only the App contract that matters here: startup
 * stages, the first-window boundary, recovery selection, and the event sources
 * that can arrive before or after that boundary. No Electron or native binding
 * is needed, so this remains executable on every development platform.
 */
class StartupRequestHarness {
  readonly opened: OpenedRequest[] = []
  readonly windowCreationCount: number[] = []
  readonly queue = createStartupOpenRequestQueue<{ source: string; path: string }>()

  private state: StartupState = 'not-started'
  private windowCount = 0
  private startupPromise: Promise<void> | null = null
  private windowCreationPromise: Promise<void> | null = null
  private restorePaths: string[]
  private explicitCommandLinePaths: string[]
  private restoreSelected = false
  private readonly hooks: { beforeCreateWindow?: () => void }

  constructor(
    options: {
      commandLinePaths?: string[]
      restorePaths?: string[]
      hooks?: { beforeCreateWindow?: () => void }
    } = {}
  ) {
    this.explicitCommandLinePaths = [...(options.commandLinePaths ?? [])]
    this.restorePaths = [...(options.restorePaths ?? [])]
    this.hooks = options.hooks ?? {}
  }

  commandLineOpen(paths: string[]): void {
    this.explicitCommandLinePaths.push(...paths)
  }

  openFile(path: string): void {
    if (this.state === 'ready' && this.windowCount > 0) {
      this.record('macOS open-file', [{ source: 'macOS open-file', path }], false)
      return
    }
    this.queue.enqueue([{ source: 'macOS open-file', path }])
    if (this.state === 'ready') void this.ensureFirstWindowAndFlush()
  }

  secondInstance(paths: string[], openFilesInSameWindow = false): void {
    if (this.state === 'ready' && this.windowCount > 0) {
      this.record(
        'second-instance',
        paths.map((path) => ({ source: 'second-instance', path })),
        openFilesInSameWindow
      )
      return
    }

    this.queue.enqueue(
      paths.map((path) => ({ source: 'second-instance', path })),
      openFilesInSameWindow
    )
    if (this.state === 'not-started') this.start()
    else if (this.state === 'ready') void this.ensureFirstWindowAndFlush()
  }

  activate(): void {
    if (this.windowCount !== 0) return
    if (this.state === 'not-started') this.start()
    else if (this.state === 'ready') void this.ensureFirstWindowAndFlush()
  }

  start(): void {
    if (this.state !== 'not-started') return
    this.state = 'initializing'
    this.startupPromise = runApplicationStartup({
      registerProtocol: vi.fn(),
      registerIpc: vi.fn(),
      applySecurityPolicy: vi.fn(),
      initializePreferences: vi.fn(),
      registerMenus: async () => {
        // Let callers inject open-file/second-instance/activate while no window exists.
        await Promise.resolve()
      },
      restoreStateAndWindows: () => {
        if (this.explicitCommandLinePaths.length > 0 || this.queue.size > 0) {
          this.restoreSelected = false
          return
        }
        this.restoreSelected = true
      },
      createFirstWindow: () => this.createFirstWindow(),
      registerLifecycleEvents: vi.fn()
    }).then(() => {
      this.state = 'ready'
      this.flushPendingRequests()
    })
  }

  async waitForStartup(): Promise<void> {
    await this.startupPromise
    await Promise.resolve()
  }

  async waitForWindowCreation(): Promise<void> {
    await this.windowCreationPromise
    await Promise.resolve()
  }

  closeLastWindow(): void {
    this.windowCount = 0
  }

  private createFirstWindow(): Promise<void> {
    if (this.windowCount > 0) return Promise.resolve()
    if (this.windowCreationPromise) return this.windowCreationPromise

    this.windowCreationPromise = Promise.resolve()
      .then(() => {
        this.hooks.beforeCreateWindow?.()
        this.windowCount = 1
        this.windowCreationCount.push(this.windowCreationCount.length + 1)
        if (this.restoreSelected) {
          for (const path of this.restorePaths) {
            this.record('startup recovery', [{ source: 'startup recovery', path }], false)
          }
        }
      })
      .finally(() => {
        this.windowCreationPromise = null
      })
    return this.windowCreationPromise
  }

  private ensureFirstWindowAndFlush(): Promise<void> {
    if (this.windowCount > 0) {
      this.flushPendingRequests()
      return Promise.resolve()
    }
    return this.createFirstWindow().then(() => this.flushPendingRequests())
  }

  private flushPendingRequests(): void {
    if (this.windowCount === 0) return

    if (this.explicitCommandLinePaths.length > 0) {
      const paths = this.explicitCommandLinePaths.splice(0)
      this.record(
        'command line',
        paths.map((path) => ({ source: 'command line', path })),
        false
      )
    }

    for (const request of this.queue.drain()) {
      this.record(
        request.paths.map((item) => item.source).join(', '),
        request.paths,
        request.openFilesInSameWindow
      )
    }
  }

  private record(
    source: string,
    paths: Array<{ source: string; path: string }>,
    openFilesInSameWindow: boolean
  ): void {
    for (const item of paths) {
      this.opened.push({ source, path: item.path, openFilesInSameWindow })
    }
  }
}

describe('startup request integration harness', () => {
  it('keeps command-line, open-file, and second-instance requests ordered before the first window', async () => {
    const harness = new StartupRequestHarness({
      commandLinePaths: ['command-line.md'],
      restorePaths: ['recovered.md']
    })

    harness.openFile('mac-open-file.md')
    harness.secondInstance(['second-instance.md'], true)
    harness.activate()
    await harness.waitForStartup()

    expect(harness.opened).toEqual([
      { source: 'command line', path: 'command-line.md', openFilesInSameWindow: false },
      { source: 'macOS open-file', path: 'mac-open-file.md', openFilesInSameWindow: false },
      { source: 'second-instance', path: 'second-instance.md', openFilesInSameWindow: true }
    ])
    expect(harness.opened.some(({ path }) => path === 'recovered.md')).toBe(false)
  })

  it('does not duplicate or reorder requests arriving while recovery selects its pathway', async () => {
    let harness!: StartupRequestHarness
    harness = new StartupRequestHarness({
      restorePaths: ['recovered.md'],
      hooks: {
        beforeCreateWindow: () => {
          harness.activate()
          harness.openFile('late-open-file.md')
          harness.secondInstance(['late-second-instance.md'])
        }
      }
    })

    harness.start()
    await harness.waitForStartup()

    expect(harness.opened).toEqual([
      { source: 'startup recovery', path: 'recovered.md', openFilesInSameWindow: false },
      { source: 'macOS open-file', path: 'late-open-file.md', openFilesInSameWindow: false },
      { source: 'second-instance', path: 'late-second-instance.md', openFilesInSameWindow: false }
    ])
    expect(new Set(harness.opened.map(({ path }) => path)).size).toBe(harness.opened.length)
  })

  it('serializes activate and second-instance during first-window recreation', async () => {
    const harness = new StartupRequestHarness()
    harness.start()
    await harness.waitForStartup()
    harness.closeLastWindow()

    harness.activate()
    harness.secondInstance(['reopen-second.md'], true)
    harness.openFile('reopen-open-file.md')
    await harness.waitForWindowCreation()

    expect(harness.windowCreationCount).toHaveLength(2)
    expect(harness.opened.slice(-2)).toEqual([
      { source: 'second-instance', path: 'reopen-second.md', openFilesInSameWindow: true },
      { source: 'macOS open-file', path: 'reopen-open-file.md', openFilesInSameWindow: false }
    ])
    expect(harness.queue.size).toBe(0)
  })
})
