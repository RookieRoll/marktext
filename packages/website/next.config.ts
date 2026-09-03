import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: resolve(__dirname, '../..'),
  images: {
    unoptimized: true
  }
  // www -> apex redirect lives in middleware.ts.
}

export default config
