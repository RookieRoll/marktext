import { deepClone } from '../util'
import { getRipgrepBridge, getRipgrepRuntimePaths } from '@/platform/ripgrep'
import type {
  RipgrepMatchEvent,
  RipgrepProgressEvent,
  RipgrepRequest,
  RipgrepSearchOptions as RipgrepQueryOptions,
  RipgrepTextResult,
  RipgrepDoneEvent,
  RipgrepErrorEvent,
  RipgrepCancelledEvent,
  RipgrepMode
} from '@shared/types/ripgrep'

export type { RipgrepMode }

type SearchCallbacks<TPayload> = {
  didMatch?: (payload: TPayload) => void
  didSearchPaths?: (num: number) => void
}

export type RipgrepSearchOptions = RipgrepQueryOptions & SearchCallbacks<RipgrepTextResult | string>
export type TextSearchOptions = RipgrepQueryOptions & SearchCallbacks<RipgrepTextResult>
export type FileSearchOptions = RipgrepQueryOptions & SearchCallbacks<string>

export interface CancellableSearch extends Promise<void> {
  cancel: () => void
}

interface StartArgs<TPayload> {
  mode: RipgrepMode
  directories: string[]
  pattern: string
  options: RipgrepQueryOptions & SearchCallbacks<TPayload>
}

let nextId = 1
const genId = (): string => 'rg-' + Date.now() + '-' + nextId++

const startSearch = <TPayload>({
  mode,
  directories,
  pattern,
  options
}: StartArgs<TPayload>): CancellableSearch => {
  const searchId = genId()
  const didMatch = options.didMatch || (() => {})
  const didSearchPaths = options.didSearchPaths || (() => {})

  let offMatch: (() => void) | null = null
  let offProgress: (() => void) | null = null
  let offDone: (() => void) | null = null
  let offError: (() => void) | null = null
  let offCancelled: (() => void) | null = null
  let cancelled = false

  const cleanup = (): void => {
    offMatch?.()
    offProgress?.()
    offDone?.()
    offError?.()
    offCancelled?.()
    offMatch = offProgress = offDone = offError = offCancelled = null
  }

  const promise = new Promise<void>((resolve, reject) => {
    offMatch = getRipgrepBridge().onMatch((event: RipgrepMatchEvent) => {
      if (event.searchId !== searchId) return
      try {
        didMatch(event.payload as TPayload)
      } catch (err) {
        console.error(err)
      }
    })
    offProgress = getRipgrepBridge().onProgress((event: RipgrepProgressEvent) => {
      if (event.searchId !== searchId) return
      try {
        didSearchPaths(event.num)
      } catch (err) {
        console.error(err)
      }
    })
    offDone = getRipgrepBridge().onDone((event: RipgrepDoneEvent) => {
      if (event.searchId !== searchId) return
      cleanup()
      resolve()
    })
    offError = getRipgrepBridge().onError((event: RipgrepErrorEvent) => {
      if (event.searchId !== searchId) return
      cleanup()
      reject(new Error(event.error || 'Ripgrep search failed'))
    })
    offCancelled = getRipgrepBridge().onCancelled((event: RipgrepCancelledEvent) => {
      if (event.searchId !== searchId) return
      cleanup()
      resolve()
    })

    const { didMatch: _didMatch, didSearchPaths: _didSearchPaths, ...rest } = options
    let serializable: RipgrepQueryOptions
    try {
      serializable = deepClone(rest)
    } catch {
      serializable = rest
    }

    const request: RipgrepRequest = {
      searchId,
      mode,
      directories,
      pattern,
      options: serializable
    }
    getRipgrepBridge()
      .start(request)
      .catch((err) => {
        cleanup()
        reject(err)
      })
  }) as CancellableSearch

  promise.cancel = (): void => {
    if (cancelled) return
    cancelled = true
    getRipgrepBridge().cancel(searchId)
  }
  return promise
}

class RipgrepDirectorySearcher {
  rgPath: string

  constructor() {
    this.rgPath = getRipgrepRuntimePaths().binaryPath
  }

  search(directories: string[], pattern: string, options: TextSearchOptions): CancellableSearch {
    return startSearch({ mode: 'text', directories, pattern, options })
  }
}

export default RipgrepDirectorySearcher

export class FileSearcher {
  search(directories: string[], _pattern: string, options: FileSearchOptions): CancellableSearch {
    return startSearch({ mode: 'files', directories, pattern: '', options })
  }
}
