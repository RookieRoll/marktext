import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  createRendererProtocolHandler,
  registerAllowedLocalResourceRoot,
  unregisterAllowedLocalResourceRoot,
  registerMarkTextScheme,
  MARKTEXT_PROTOCOL_SCHEME
} from '../../../src/main/app/localProtocol'

describe('app protocol', () => {
  it('registers the privileged app scheme before ready', () => {
    const registerSchemesAsPrivileged = (schemes: unknown[]) => {
      expect(schemes).toEqual([
        expect.objectContaining({
          scheme: MARKTEXT_PROTOCOL_SCHEME,
          privileges: expect.objectContaining({ standard: true, secure: true })
        })
      ])
    }

    registerMarkTextScheme({ registerSchemesAsPrivileged })
  })

  it('serves only renderer files beneath the renderer root', async () => {
    const fetchFile = async (url: string) => new Response(url)
    const handler = createRendererProtocolHandler('D:/app/out/renderer', fetchFile)

    const ok = await handler(new Request('marktext://renderer/assets/index.js'))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('D:/app/out/renderer/assets/index.js')

    const traversal = await handler(new Request('marktext://renderer/%5C..%5Cmain.js'))
    expect(traversal.status).toBe(403)
  })

  it('serves local images only from an opened directory root', async () => {
    const root = path.resolve('D:/notes')
    registerAllowedLocalResourceRoot(root)
    registerAllowedLocalResourceRoot(root)
    const fetchFile = async (url: string) => new Response(url)
    const handler = createRendererProtocolHandler('D:/app/out/renderer', fetchFile)
    const allowedPath = path.join(root, 'assets', 'image.png')
    const deniedPath = path.resolve('D:/private', 'secret.png')

    const allowed = await handler(
      new Request(`marktext://local/?path=${encodeURIComponent(allowedPath)}`)
    )
    expect(allowed.status).toBe(200)

    const denied = await handler(
      new Request(`marktext://local/?path=${encodeURIComponent(deniedPath)}`)
    )
    expect(denied.status).toBe(403)

    const nonImage = await handler(
      new Request(`marktext://local/?path=${encodeURIComponent(path.join(root, 'notes.md'))}`)
    )
    expect(nonImage.status).toBe(403)

    unregisterAllowedLocalResourceRoot(root)
    const stillAllowed = await handler(
      new Request(`marktext://local/?path=${encodeURIComponent(allowedPath)}`)
    )
    expect(stillAllowed.status).toBe(200)

    unregisterAllowedLocalResourceRoot(root)
    const revoked = await handler(
      new Request(`marktext://local/?path=${encodeURIComponent(allowedPath)}`)
    )
    expect(revoked.status).toBe(403)
  })
})
