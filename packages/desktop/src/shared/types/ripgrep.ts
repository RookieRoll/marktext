export type RipgrepMode = 'files' | 'text'

export interface RipgrepSearchOptions {
  isRegexp?: boolean
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  followSymlinks?: boolean
  maxFileSize?: number | string
  includeHidden?: boolean
  noIgnore?: boolean
  leadingContextLineCount?: number
  trailingContextLineCount?: number
  inclusions?: string[]
  exclusions?: string[]
}

export interface RipgrepStartResponse {
  searchId: string
}

export interface RipgrepRequest {
  searchId: string
  mode: RipgrepMode
  directories: string[]
  pattern: string
  options: RipgrepSearchOptions
}

export type RipgrepSearchRange = [[number, number], [number, number]]

export interface RipgrepMatch {
  matchText: string
  lineText: string
  range: RipgrepSearchRange
  leadingContextLines: string[]
  trailingContextLines: string[]
}

export interface RipgrepTextResult {
  filePath: string
  matches: RipgrepMatch[]
}

export type RipgrepMatchPayload = RipgrepTextResult | string

export interface RipgrepMatchEvent {
  searchId: string
  payload: RipgrepMatchPayload
}

export interface RipgrepProgressEvent {
  searchId: string
  num: number
}

export interface RipgrepDoneEvent {
  searchId: string
}

export interface RipgrepErrorEvent {
  searchId: string
  error: string
}

export interface RipgrepCancelledEvent {
  searchId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  isStringArray(value) && value.length > 0 && value.every((item) => item.length > 0)

const isOptionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === 'boolean'

const isOptionalNonNegativeInteger = (value: unknown): boolean =>
  value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0)

export const isRipgrepSearchOptions = (value: unknown): value is RipgrepSearchOptions => {
  if (!isRecord(value)) return false
  return (
    isOptionalBoolean(value.isRegexp) &&
    isOptionalBoolean(value.isCaseSensitive) &&
    isOptionalBoolean(value.isWholeWord) &&
    isOptionalBoolean(value.followSymlinks) &&
    (value.maxFileSize === undefined ||
      typeof value.maxFileSize === 'string' ||
      (typeof value.maxFileSize === 'number' && Number.isFinite(value.maxFileSize))) &&
    isOptionalBoolean(value.includeHidden) &&
    isOptionalBoolean(value.noIgnore) &&
    isOptionalNonNegativeInteger(value.leadingContextLineCount) &&
    isOptionalNonNegativeInteger(value.trailingContextLineCount) &&
    (value.inclusions === undefined || isStringArray(value.inclusions)) &&
    (value.exclusions === undefined || isStringArray(value.exclusions))
  )
}

export const isRipgrepRequest = (value: unknown): value is RipgrepRequest => {
  if (!isRecord(value)) return false
  return (
    typeof value.searchId === 'string' &&
    value.searchId.length > 0 &&
    (value.mode === 'files' || value.mode === 'text') &&
    isNonEmptyStringArray(value.directories) &&
    typeof value.pattern === 'string' &&
    isRipgrepSearchOptions(value.options)
  )
}
