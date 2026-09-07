import { getMarktextRuntime } from './runtime'
export const getRipgrepBridge = (): Window['ripgrep'] => window.ripgrep

export const getRipgrepRuntimePaths = (): { binaryPath: string } => ({
  binaryPath: getMarktextRuntime()?.paths?.ripgrepBinaryPath || window.rgPath || ''
})
