import { describe, expect, it } from 'vitest'
import type { SaveableFile } from '@/store/editor/types'
import { createSaveCloseWorkflow, type SaveCloseDecision } from '@/store/editor/saveCloseWorkflow'

const makeFile = (id: string, markdown = `# ${id}`): SaveableFile => ({
  id,
  filename: `${id}.md`,
  pathname: `/workspace/${id}.md`,
  markdown,
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 3
})

describe('save/close workflow composition', () => {
  it('flushes before reading and schedules buffered state after a save request', async function saveCurrentWorkflowTest() {
    const events: string[] = []
    let markdown = 'stale'
    const file = makeFile('note', markdown)
    const workflow = createSaveCloseWorkflow({
      flushActiveEditor: () => {
        events.push('flush')
        markdown = 'flushed'
      },
      readFile: () => {
        events.push('read')
        return { ...file, markdown }
      },
      requestSave: (snapshot) => {
        events.push(`save:${snapshot.markdown}`)
      },
      confirmClose: () => {
        throw new Error('confirmation should not be used by saveCurrent')
      },
      requestCloseTabs: () => {
        throw new Error('close should not be used by saveCurrent')
      },
      requestCloseWindow: () => {
        throw new Error('close should not be used by saveCurrent')
      },
      scheduleBufferedState: () => {
        events.push('schedule-buffered-state')
      }
    })

    const result = await workflow.saveCurrent({ fileId: 'note', defaultPath: '/workspace' })

    expect(result.outcome).toBe('saved')
    expect(result.snapshot?.markdown).toBe('flushed')
    expect(events).toEqual(['flush', 'read', 'save:flushed', 'schedule-buffered-state'])
  })

  it('confirms, saves, closes tabs, then schedules buffered state', async function closeTabsSaveWorkflowTest() {
    const events: string[] = []
    let markdown = 'stale'
    const files = new Map([
      ['dirty', makeFile('dirty', markdown)],
      ['clean', makeFile('clean')]
    ])
    const workflow = createSaveCloseWorkflow({
      flushActiveEditor: () => {
        events.push('flush')
        markdown = 'flushed'
      },
      readFile: (fileId) => {
        events.push(`read:${fileId}`)
        const file = files.get(fileId)
        return fileId === 'dirty' && file ? { ...file, markdown } : (file ?? null)
      },
      requestSave: (snapshot) => {
        events.push(`save:${snapshot.id}:${snapshot.markdown}`)
      },
      confirmClose: (payloads) => {
        events.push(`confirm:${payloads.map(({ id }) => id).join(',')}`)
        expect(payloads[0]?.markdown).toBe('flushed')
        return 'save'
      },
      requestCloseTabs: (tabIds) => {
        events.push(`close-tabs:${tabIds.join(',')}`)
      },
      requestCloseWindow: () => {
        throw new Error('window close should not be used by closeTabs')
      },
      scheduleBufferedState: () => {
        events.push('schedule-buffered-state')
      }
    })

    const result = await workflow.closeTabs({
      tabIds: ['dirty', 'clean'],
      unsavedFileIds: ['dirty'],
      defaultPath: '/workspace'
    })

    expect(result.outcome).toBe('closed')
    expect(events).toEqual([
      'flush',
      'read:dirty',
      'confirm:dirty',
      'save:dirty:flushed',
      'close-tabs:dirty,clean',
      'schedule-buffered-state'
    ])
  })

  it('does not close or reschedule tabs when confirmation is cancelled', async function closeTabsCancelWorkflowTest() {
    const events: string[] = []
    const decision: SaveCloseDecision = 'cancel'
    const workflow = createSaveCloseWorkflow({
      flushActiveEditor: () => {
        events.push('flush')
      },
      readFile: (fileId) => {
        events.push(`read:${fileId}`)
        return makeFile(fileId)
      },
      requestSave: () => {
        events.push('save')
      },
      confirmClose: () => {
        events.push(`confirm:${decision}`)
        return decision
      },
      requestCloseTabs: () => {
        events.push('close-tabs')
      },
      requestCloseWindow: () => {
        events.push('close-window')
      },
      scheduleBufferedState: () => {
        events.push('schedule-buffered-state')
      }
    })

    const result = await workflow.closeTabs({
      tabIds: ['dirty'],
      unsavedFileIds: ['dirty'],
      defaultPath: '/workspace'
    })

    expect(result).toEqual({ outcome: 'cancelled' })
    expect(events).toEqual(['flush', 'read:dirty', 'confirm:cancel'])
  })

  it('schedules buffered state before confirming a window close', async function closeWindowWorkflowTest() {
    const events: string[] = []
    const workflow = createSaveCloseWorkflow({
      flushActiveEditor: () => {
        events.push('flush')
      },
      readFile: (fileId) => {
        events.push(`read:${fileId}`)
        return makeFile(fileId)
      },
      requestSave: (snapshot) => {
        events.push(`save:${snapshot.id}`)
      },
      confirmClose: (payloads) => {
        events.push(`confirm:${payloads.map(({ id }) => id).join(',')}`)
        return 'discard'
      },
      requestCloseTabs: () => {
        throw new Error('tab close should not be used by closeWindow')
      },
      requestCloseWindow: () => {
        events.push('close-window')
      },
      scheduleBufferedState: () => {
        events.push('schedule-buffered-state')
      }
    })

    const result = await workflow.closeWindow({
      unsavedFileIds: ['dirty'],
      defaultPath: '/workspace'
    })

    expect(result.outcome).toBe('closed')
    expect(events).toEqual([
      'schedule-buffered-state',
      'flush',
      'read:dirty',
      'confirm:dirty',
      'close-window'
    ])
  })
})
