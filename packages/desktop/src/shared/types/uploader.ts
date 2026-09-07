export interface UploadPreferences {
  currentUploader: string
  cliScript: string
}

export interface UploadPathRequest {
  pathname: string
  image: string
  isPath: true
  preferences: UploadPreferences
}

export interface UploadBufferPayload {
  data: Uint8Array | number[]
  name: string
}

export interface UploadBufferRequest {
  pathname: string
  image: UploadBufferPayload
  isPath: false
  preferences: UploadPreferences
}

export type UploadRequest = UploadPathRequest | UploadBufferRequest
export type UploadResult = string

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isUploadPreferences = (value: unknown): value is UploadPreferences =>
  isRecord(value) &&
  typeof value.currentUploader === 'string' &&
  typeof value.cliScript === 'string'

const isBinaryData = (value: unknown): value is Uint8Array | number[] =>
  value instanceof Uint8Array ||
  (Array.isArray(value) &&
    value.every(
      (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255
    ))

export const isUploadRequest = (value: unknown): value is UploadRequest => {
  if (
    !isRecord(value) ||
    typeof value.pathname !== 'string' ||
    !isUploadPreferences(value.preferences)
  ) {
    return false
  }

  if (value.isPath === true) {
    return typeof value.image === 'string'
  }

  if (value.isPath !== false || !isRecord(value.image)) return false
  return typeof value.image.name === 'string' && isBinaryData(value.image.data)
}
