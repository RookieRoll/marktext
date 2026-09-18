/**
 * Resolves the outcome of refreshing one restored tab.
 *
 * File loading stays injectable so failure isolation can be tested without
 * Electron. The function never throws for a document read/decode failure and
 * never writes the error string into the tab's Markdown buffer.
 */

export interface RestorableTab {
  id: string
  pathname: string
  filename: string
  markdown: string
  isSaved: boolean
}

export interface RestoredTabDocument {
  markdown: string
}

export type RestoreTabResult =
  | { status: 'skipped'; tabId: string }
  | { status: 'unchanged'; tabId: string }
  | { status: 'updated'; tabId: string; markdown: string }
  | {
    status: 'failed'
    tabId: string
    pathname: string
    filename: string
    message: string
    stack?: string
  }

export type RestoreTabFailure = Extract<RestoreTabResult, { status: 'failed' }>

const getErrorDetails = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    }
  }

  return { message: String(error) }
}

/**
 * Reads one restored tab and reports whether its persisted buffer should be
 * replaced. Unsaved tabs retain their buffered Markdown even when the file can
 * be read; read/decode failures are returned as metadata-only outcomes.
 */
export const restoreTabContent = async(
  tab: RestorableTab,
  loadDocument: (pathname: string) => Promise<RestoredTabDocument>
): Promise<RestoreTabResult> => {
  if (!tab.pathname) {
    return { status: 'skipped', tabId: tab.id }
  }

  try {
    const document = await loadDocument(tab.pathname)
    if (tab.isSaved && document.markdown !== tab.markdown) {
      return { status: 'updated', tabId: tab.id, markdown: document.markdown }
    }

    return { status: 'unchanged', tabId: tab.id }
  } catch (error) {
    // Keep the buffered Markdown but mark the tab unsaved so closing or saving
    // cannot silently discard the recovered content.
    tab.isSaved = false
    return {
      status: 'failed',
      tabId: tab.id,
      pathname: tab.pathname,
      filename: tab.filename,
      ...getErrorDetails(error)
    }
  }
}
