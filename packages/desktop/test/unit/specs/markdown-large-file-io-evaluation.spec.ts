import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import iconv from 'iconv-lite'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Keep the encoding comparison deterministic. The purpose of this test is to
// demonstrate why a prefix-only replacement cannot be merged without changing
// the current full-buffer detection semantics.
vi.mock('ced', () => ({ default: vi.fn(() => 'GB') }))

const { guessEncoding } = await import('main_renderer/filesystem/encoding')
const { loadMarkdownFile, writeMarkdownFile } = await import('main_renderer/filesystem/markdown')

const temporaryDirectories: string[] = []

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marktext-markdown-io-'))
  temporaryDirectories.push(directory)
  return directory
}

const writeFixture = async (directory: string, name: string, contents: Buffer): Promise<string> => {
  const pathname = path.join(directory, name)
  await fs.writeFile(pathname, contents)
  return pathname
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('large-file I/O evaluation for loadMarkdownFile (OpenSpec 6.8)', () => {
  it('preserves BOM, encoding, mixed line endings, trailing newlines, and save bytes', async () => {
    const directory = await makeTemporaryDirectory()
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('one\r\ntwo\n\n', 'utf8')
    ])
    const pathname = await writeFixture(directory, 'mixed-utf8.md', original)

    const document = await loadMarkdownFile(pathname, 'crlf', false, 2, false)

    expect(document.markdown).toBe('one\ntwo\n\n')
    expect(document.encoding).toEqual({ encoding: 'utf8', isBom: true })
    expect(document.lineEnding).toBe('crlf')
    expect(document.adjustLineEndingOnSave).toBe(true)
    expect(document.trimTrailingNewline).toBe(2)
    expect(document.isMixedLineEndings).toBe(true)

    const savedPathname = path.join(directory, 'saved.md')
    await writeMarkdownFile(savedPathname, document.markdown, {
      adjustLineEndingOnSave: document.adjustLineEndingOnSave,
      lineEnding: document.lineEnding,
      encoding: document.encoding
    })

    expect(await fs.readFile(savedPathname)).toEqual(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n\r\n', 'utf8')])
    )
  })

  it('preserves UTF-16 BOM and error semantics without auto-guessing', async () => {
    const directory = await makeTemporaryDirectory()
    const original = iconv.encode('one\r\ntwo\r\n', 'utf16le', { addBOM: true })
    const pathname = await writeFixture(directory, 'utf16le.md', original)

    const document = await loadMarkdownFile(pathname, 'lf', false, 2, false)

    expect(document.markdown).toBe('one\ntwo\n')
    expect(document.encoding).toEqual({ encoding: 'utf16le', isBom: true })
    expect(document.lineEnding).toBe('crlf')
    expect(document.adjustLineEndingOnSave).toBe(true)
    expect(document.trimTrailingNewline).toBe(1)
    expect(document.isMixedLineEndings).toBe(false)

    await expect(
      loadMarkdownFile(path.join(directory, 'missing.md'), 'lf', false)
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['', 3],
    ['one', 0],
    ['one\n', 1],
    ['one\n\n', 2]
  ])('keeps trailing-newline metadata for %j', async (contents, expected) => {
    const directory = await makeTemporaryDirectory()
    const pathname = await writeFixture(directory, 'trailing.md', Buffer.from(contents, 'utf8'))
    const document = await loadMarkdownFile(pathname, 'lf', false, 2, false)

    expect(document.trimTrailingNewline).toBe(expected)
  })

  it('shows why prefix-only encoding detection is not a safe drop-in replacement', () => {
    const prefix = Buffer.from('# valid UTF-8 prefix\n', 'utf8')
    const invalidUtf8Tail = Buffer.from([0xc2, 0x20, 0x6f, 0x6b])
    const complete = Buffer.concat([prefix, invalidUtf8Tail])

    expect(guessEncoding(prefix, true).encoding).toBe('utf8')
    expect(guessEncoding(complete, true).encoding).toBe('gb2312')
  })

  it('records a reproducible large-document detection and load sample without asserting noisy timings', async () => {
    const directory = await makeTemporaryDirectory()
    const contents = Buffer.from('# repeated line\n'.repeat(262144), 'utf8')
    const pathname = await writeFixture(directory, 'large.md', contents)
    const prefix = contents.subarray(0, 64 * 1024)

    const detectionSamples: number[] = []
    const loadSamples: number[] = []
    const saveSamples: number[] = []
    for (let index = 0; index < 3; index += 1) {
      const detectionStart = performance.now()
      expect(guessEncoding(contents, true).encoding).toBe('utf8')
      detectionSamples.push(performance.now() - detectionStart)

      const loadStart = performance.now()
      const document = await loadMarkdownFile(pathname, 'lf', true, 2, false)
      expect(document.markdown.length).toBeGreaterThan(contents.length - 32)
      loadSamples.push(performance.now() - loadStart)

      const saveStart = performance.now()
      await writeMarkdownFile(path.join(directory, `saved-${index}.md`), document.markdown, {
        adjustLineEndingOnSave: false,
        lineEnding: 'lf',
        encoding: document.encoding
      })
      saveSamples.push(performance.now() - saveStart)
    }

    const prefixStart = performance.now()
    expect(guessEncoding(prefix, true).encoding).toBe('utf8')
    const prefixDetectionMs = performance.now() - prefixStart

    const memory = process.memoryUsage()
    console.info(
      '[OpenSpec 6.8] large-file sample',
      JSON.stringify({
        fixtureKiB: Math.round(contents.length / 1024),
        detectionMs: detectionSamples.map((value) => Number(value.toFixed(2))),
        prefixDetectionMs: Number(prefixDetectionMs.toFixed(2)),
        loadMs: loadSamples.map((value) => Number(value.toFixed(2))),
        saveMs: saveSamples.map((value) => Number(value.toFixed(2))),
        rssMiB: Number((memory.rss / 1024 / 1024).toFixed(1)),
        heapUsedMiB: Number((memory.heapUsed / 1024 / 1024).toFixed(1))
      })
    )

    // The prefix has a bounded amount of detection work, but the complete
    // buffer is still required for decoding, newline analysis, and the
    // renderer payload. This test deliberately records rather than gates
    // wall-clock timings, which vary across CI and developer machines.
    expect(prefix.length).toBe(64 * 1024)
    expect(contents.length).toBeGreaterThan(prefix.length * 32)
  })
})
