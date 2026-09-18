import { describe, expect, it, vi } from 'vitest'
import { restoreTabContent } from '../../../src/main/windows/restoreTab'

const makeTab = (overrides: Record<string, unknown> = {}) => ({
  id: 'tab-1',
  pathname: '/notes/one.md',
  filename: 'one.md',
  markdown: '# One',
  isSaved: true,
  ...overrides
})

describe('restoreTabContent', () => {
  it('updates only a saved tab when the disk content changed', async() => {
    const loadDocument = vi.fn(async() => ({ markdown: '# Changed' }))

    await expect(restoreTabContent(makeTab(), loadDocument)).resolves.toEqual({
      status: 'updated',
      tabId: 'tab-1',
      markdown: '# Changed'
    })
    expect(loadDocument).toHaveBeenCalledWith('/notes/one.md')
  })

  it('keeps an unsaved draft even when disk content is readable and different', async() => {
    const tab = makeTab({ isSaved: false, markdown: '# Draft' })

    await expect(
      restoreTabContent(tab, async() => ({ markdown: '# Disk version' }))
    ).resolves.toEqual({ status: 'unchanged', tabId: 'tab-1' })
    expect(tab.markdown).toBe('# Draft')
  })

  it('isolates a read failure and preserves the original buffer and metadata', async() => {
    const tab = makeTab({ markdown: '# Keep me' })
    const error = new Error('EACCES: permission denied')

    const result = await restoreTabContent(tab, async() => {
      throw error
    })

    expect(result).toMatchObject({
      status: 'failed',
      tabId: 'tab-1',
      pathname: '/notes/one.md',
      filename: 'one.md',
      message: 'EACCES: permission denied',
      stack: expect.any(String)
    })
    expect(tab.markdown).toBe('# Keep me')
    expect(tab.isSaved).toBe(false)
  })

  it('continues other tabs after one failure and reports each outcome', async() => {
    const tabs = [
      makeTab({ id: 'active', pathname: '/notes/active.md' }),
      makeTab({ id: 'broken', pathname: '/notes/broken.md' }),
      makeTab({ id: 'saved', pathname: '/notes/saved.md' })
    ]
    const loadDocument = vi.fn(async(pathname: string) => {
      if (pathname.endsWith('broken.md')) throw new Error('missing')
      return { markdown: `disk:${pathname}` }
    })

    const results = await Promise.all(tabs.map((tab) => restoreTabContent(tab, loadDocument)))

    expect(results.map((result) => result.status)).toEqual(['updated', 'failed', 'updated'])
    expect(results.map((result) => result.tabId)).toEqual(['active', 'broken', 'saved'])
    expect(tabs[1]?.markdown).toBe('# One')
  })

  it('skips pathless tabs without invoking the loader', async() => {
    const loadDocument = vi.fn()
    const tab = makeTab({ pathname: '' })

    await expect(restoreTabContent(tab, loadDocument)).resolves.toEqual({
      status: 'skipped',
      tabId: 'tab-1'
    })
    expect(loadDocument).not.toHaveBeenCalled()
  })
})
