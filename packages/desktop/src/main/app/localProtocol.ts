import fs from 'fs'
import path from 'path'
import { extname } from 'path'
import { net, protocol } from 'electron'
import type { Protocol } from 'electron'
import { pathToFileURL } from 'url'

export const MARKTEXT_PROTOCOL_SCHEME = 'marktext'
export const MARKTEXT_RENDERER_HOST = 'renderer'
export const MARKTEXT_LOCAL_HOST = 'local'

export interface ProtocolRegistration {
  registerSchemesAsPrivileged: (
    schemes: Array<{
      scheme: string
      privileges: {
        standard: boolean
        secure: boolean
        supportFetchAPI: boolean
        stream: boolean
      }
    }>
  ) => void
  isProtocolHandled: (scheme: string) => boolean
  handle: (scheme: string, handler: (request: Request) => Response | Promise<Response>) => void
}

export const markTextSchemeDefinition = {
  scheme: MARKTEXT_PROTOCOL_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true
  }
} as const

export const registerMarkTextScheme = (
  protocolModule: Pick<Protocol, 'registerSchemesAsPrivileged'> = protocol
): void => {
  protocolModule.registerSchemesAsPrivileged([markTextSchemeDefinition])
}

const allowedLocalResourceRoots = new Map<string, number>()

const normalizeFilesystemPath = (pathname: string): string => {
  const resolved = path.resolve(pathname)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

const pathKey = (pathname: string): string => {
  const normalized = normalizeFilesystemPath(pathname)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export const registerAllowedLocalResourceRoot = (root: string): void => {
  if (!root) return
  const key = pathKey(root)
  allowedLocalResourceRoots.set(key, (allowedLocalResourceRoots.get(key) ?? 0) + 1)
}

export const unregisterAllowedLocalResourceRoot = (root: string): void => {
  if (!root) return
  const key = pathKey(root)
  const count = allowedLocalResourceRoots.get(key) ?? 0
  if (count <= 1) allowedLocalResourceRoots.delete(key)
  else allowedLocalResourceRoots.set(key, count - 1)
}

const isWithinRoot = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const isAllowedLocalImage = (filePath: string): boolean => {
  if (!/\.(?:jpeg|jpg|png|gif|svg|webp)$/i.test(extname(filePath))) return false
  const candidate = pathKey(filePath)
  return Array.from(allowedLocalResourceRoots.keys()).some((root) => isWithinRoot(root, candidate))
}

const forbiddenResponse = (status: number, message: string): Response =>
  new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  })

const createLocalImageResponse = (
  requestUrl: URL,
  fetchFile: (url: string) => Response | Promise<Response>
): Response | Promise<Response> => {
  const filePath = requestUrl.searchParams.get('path')
  if (!filePath || !isAllowedLocalImage(filePath)) {
    return forbiddenResponse(403, 'Local image is outside an opened document root')
  }

  return fetchFile(pathToFileURL(path.resolve(filePath)).toString())
}

export const createRendererProtocolHandler = (
  rendererRoot: string,
  fetchFile: (url: string) => Response | Promise<Response> = (url) => net.fetch(url)
): ((request: Request) => Response | Promise<Response>) => {
  const root = path.resolve(rendererRoot)

  return (request) => {
    const requestUrl = new URL(request.url)
    if (request.method !== 'GET') {
      return forbiddenResponse(405, 'Only GET is supported')
    }

    if (requestUrl.hostname === MARKTEXT_LOCAL_HOST) {
      return createLocalImageResponse(requestUrl, fetchFile)
    }

    if (requestUrl.hostname !== MARKTEXT_RENDERER_HOST) {
      return forbiddenResponse(404, 'Unknown MarkText resource host')
    }

    let requestedPath: string
    try {
      requestedPath = decodeURIComponent(requestUrl.pathname)
    } catch {
      return forbiddenResponse(400, 'Invalid resource path')
    }

    const target = path.resolve(root, '.' + requestedPath)
    const relative = path.relative(root, target)
    const isInsideRoot = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    if (!isInsideRoot) {
      return forbiddenResponse(403, 'Resource path is outside the renderer bundle')
    }

    return fetchFile(pathToFileURL(target).toString())
  }
}

export const registerMarkTextRendererProtocol = (
  rendererRoot: string,
  protocolModule: Pick<Protocol, 'isProtocolHandled' | 'handle'> = protocol,
  fetchFile: (url: string) => Response | Promise<Response> = (url) => net.fetch(url)
): void => {
  if (protocolModule.isProtocolHandled(MARKTEXT_PROTOCOL_SCHEME)) return
  protocolModule.handle(
    MARKTEXT_PROTOCOL_SCHEME,
    createRendererProtocolHandler(rendererRoot, fetchFile)
  )
}
