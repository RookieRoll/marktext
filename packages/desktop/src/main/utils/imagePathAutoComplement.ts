import fs from 'fs'
import path from 'path'
import { filter } from 'fuzzaldrin'
import log from 'electron-log'
import { isDirectory, isFile } from 'common/filesystem'
import { IMAGE_EXTENSIONS } from 'common/filesystem/paths'
import { BLACK_LIST } from '../config'

interface DirOrImageEntry {
  file: string
  type: string
}

const IMAGE_PATH: Map<string, DirOrImageEntry[]> = new Map()
export const watchers: Map<string, fs.FSWatcher> = new Map()
const cacheGenerations: Map<string, number> = new Map()

const canonicalizeDirectory = (directory: string): string => {
  const normalized = path.normalize(path.resolve(directory))
  return normalized
}

/** Release cached image completions and their OS watchers. */
export const clearImagePathCache = (directory?: string): void => {
  if (directory === undefined) {
    for (const key of IMAGE_PATH.keys())
      cacheGenerations.set(key, (cacheGenerations.get(key) ?? 0) + 1)
    for (const key of watchers.keys())
      cacheGenerations.set(key, (cacheGenerations.get(key) ?? 0) + 1)
    for (const watcher of watchers.values()) watcher.close()
    watchers.clear()
    IMAGE_PATH.clear()
    return
  }

  const key = canonicalizeDirectory(directory)
  cacheGenerations.set(key, (cacheGenerations.get(key) ?? 0) + 1)
  IMAGE_PATH.delete(key)
  const watcher = watchers.get(key)
  if (watcher) {
    watcher.close()
    watchers.delete(key)
  }
}

const IMAGE_REG = new RegExp('(' + IMAGE_EXTENSIONS.join('|') + ')$', 'i')

const filesHandler = (
  files: string[],
  directory: string,
  key?: string
): DirOrImageEntry[] | undefined => {
  const onlyDirAndImage: DirOrImageEntry[] = files
    .map((file): DirOrImageEntry => {
      const fullPath = path.join(directory, file)
      let type = ''
      if (isDirectory(fullPath)) {
        type = 'directory'
      } else if (isFile(fullPath) && IMAGE_REG.test(file)) {
        type = 'image'
      }
      return { file, type }
    })
    .filter(({ file, type }) => {
      if ((BLACK_LIST as readonly string[]).includes(file)) return false
      return type === 'directory' || type === 'image'
    })

  IMAGE_PATH.set(canonicalizeDirectory(directory), onlyDirAndImage)
  if (key !== undefined) {
    return filter(onlyDirAndImage, key, { key: 'file' })
  }
  return undefined
}

const rebuild = (directory: string): void => {
  const key = canonicalizeDirectory(directory)
  const generation = cacheGenerations.get(key) ?? 0
  fs.readdir(directory, (err, files) => {
    if (err) {
      if ((cacheGenerations.get(key) ?? 0) === generation) clearImagePathCache(directory)
      log.error('imagePathAutoComplement::rebuild:', err)
    } else if ((cacheGenerations.get(key) ?? 0) === generation) {
      filesHandler(files, directory)
    }
  })
}

const watchDirectory = (directory: string): void => {
  const key = canonicalizeDirectory(directory)
  if (watchers.has(key)) return
  try {
    const watcher = fs.watch(directory, (eventType) => {
      if (eventType === 'rename') rebuild(directory)
    })
    watcher.on('error', (err) => {
      log.error('imagePathAutoComplement::watchDirectory:', err)
      if (watchers.get(key) === watcher) clearImagePathCache(directory)
    })
    watchers.set(key, watcher)
  } catch (err) {
    log.error('imagePathAutoComplement::watchDirectory:', err)
  }
}

export const searchFilesAndDir = (directory: string, key: string): Promise<DirOrImageEntry[]> => {
  const canonicalDirectory = canonicalizeDirectory(directory)
  if (IMAGE_PATH.has(canonicalDirectory)) {
    return Promise.resolve(filter(IMAGE_PATH.get(canonicalDirectory)!, key, { key: 'file' }))
  }

  return new Promise((resolve, reject) => {
    const generation = cacheGenerations.get(canonicalDirectory) ?? 0
    fs.readdir(directory, (err, files) => {
      if (err) {
        if ((cacheGenerations.get(canonicalDirectory) ?? 0) === generation)
          clearImagePathCache(directory)
        reject(err)
      } else if ((cacheGenerations.get(canonicalDirectory) ?? 0) === generation) {
        const result = filesHandler(files, directory, key) ?? []
        watchDirectory(directory)
        resolve(result)
      } else {
        resolve([])
      }
    })
  })
}
