import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type TokenKind = 'identifier' | 'string' | 'punctuation'

type Token = {
  kind: TokenKind
  value: string
  start: number
  end: number
}

type SourceUnit = {
  text: string
  offset: number
}

type ModuleReference = {
  specifier: string
  start: number
}

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sourceRoot = resolve(desktopRoot, 'src')
const rendererRoot = resolve(sourceRoot, 'renderer/src')
const sharedTypesRoot = resolve(sourceRoot, 'shared/types')
const platformRoot = resolve(rendererRoot, 'platform')

const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.js', '.jsx', '.mjs', '.cjs'])
const rendererCapabilityGlobals = new Set([
  'electron',
  'fileUtils',
  'path',
  'ripgrep',
  'uploader',
  'fonts',
  'commandExists',
  'i18nUtils',
  'process',
  'rgPath',
  'DIRNAME'
])
const sharedDomGlobals = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'HTMLElement',
  'SVGElement',
  'Element',
  'Document',
  'Window',
  'Node',
  'File',
  'Blob',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'DOMParser',
  'MutationObserver',
  'ResizeObserver',
  'XMLHttpRequest',
  'WebSocket',
  'FormData',
  'FileReader',
  'Image',
  'ImageData',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D'
])
const regexPrefixKeywords = new Set([
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
  'await'
])
const nodeBuiltinNames = new Set(
  builtinModules.flatMap((moduleName) => [moduleName, moduleName.replace(/^node:/, '')])
)
const legacyAliasConfigFiles = [
  resolve(desktopRoot, 'electron.vite.config.ts'),
  resolve(desktopRoot, 'vitest.config.ts'),
  resolve(desktopRoot, 'tsconfig.base.json')
]

const toPosixPath = (pathname: string): string => pathname.replaceAll('\\', '/')

const relativePath = (root: string, pathname: string): string =>
  toPosixPath(relative(root, pathname))

const formatViolation = (
  root: string,
  pathname: string,
  source: string,
  index: number,
  reason: string
): string => `${relativePath(root, pathname)}:${lineNumber(source, index)} ${reason}`

const lineNumber = (source: string, index: number): number => source.slice(0, index).split('\n').length

const collectSourceFiles = (root: string): string[] => {
  if (!existsSync(root)) return []

  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const pathname = resolve(directory, entry)
      const stats = statSync(pathname)
      if (stats.isDirectory()) {
        visit(pathname)
      } else if (stats.isFile() && sourceExtensions.has(extname(pathname).toLowerCase())) {
        files.push(pathname)
      }
    }
  }

  visit(root)
  return files
}

const isIdentifierStart = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z_$]/.test(character)

const isIdentifierPart = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z0-9_$]/.test(character)

const skipRegexLiteral = (source: string, start: number): number => {
  let index = start + 1
  let inCharacterClass = false

  while (index < source.length) {
    const character = source[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === '[') inCharacterClass = true
    if (character === ']') inCharacterClass = false
    if (character === '/' && !inCharacterClass) {
      index += 1
      while (isIdentifierPart(source[index])) index += 1
      return index
    }
    if (character === '\n' || character === '\r') return start + 1
    index += 1
  }

  return index
}

/** Tokenize code while discarding comments, template text, and regex literals. */
const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let index = 0
  let canStartRegex = true

  while (index < source.length) {
    const character = source[index]
    const nextCharacter = source[index + 1]

    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      index += 2
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index = Math.min(source.length, index + 2)
      continue
    }

    if (character === "'" || character === '"') {
      const quote = character
      const start = index
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
        } else if (source[index] === quote) {
          const value = source.slice(start + 1, index)
          index += 1
          tokens.push({ kind: 'string', value, start, end: index })
          break
        } else {
          index += 1
        }
      }
      if (tokens[tokens.length - 1]?.start !== start) {
        tokens.push({ kind: 'string', value: source.slice(start + 1), start, end: index })
      }
      canStartRegex = false
      continue
    }

    if (character === '`') {
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
        } else if (source[index] === '`') {
          index += 1
          break
        } else {
          index += 1
        }
      }
      canStartRegex = false
      continue
    }

    if (character === '/' && canStartRegex) {
      const regexEnd = skipRegexLiteral(source, index)
      if (regexEnd > index + 1) {
        index = regexEnd
        canStartRegex = false
        continue
      }
    }

    if (isIdentifierStart(character)) {
      const start = index
      index += 1
      while (isIdentifierPart(source[index])) index += 1
      const value = source.slice(start, index)
      tokens.push({ kind: 'identifier', value, start, end: index })
      canStartRegex = regexPrefixKeywords.has(value)
      continue
    }

    const value = character === '?' && nextCharacter === '.' ? '?.' : character
    const end = value === '?.' ? index + 2 : index + 1
    tokens.push({ kind: 'punctuation', value, start: index, end })
    index = end
    canStartRegex = ![')', ']', '}'].includes(value)
  }

  return tokens
}

const getSourceUnits = (pathname: string, source: string): SourceUnit[] => {
  if (extname(pathname).toLowerCase() !== '.vue') return [{ text: source, offset: 0 }]

  const units: SourceUnit[] = []
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
  for (const match of source.matchAll(scriptPattern)) {
    const text = match[1] ?? ''
    const matchStart = match.index ?? 0
    const contentOffset = match[0].indexOf(text)
    if (contentOffset >= 0) units.push({ text, offset: matchStart + contentOffset })
  }
  return units
}

const getVueTemplateExpressionUnits = (source: string): SourceUnit[] => {
  const units: SourceUnit[] = []
  const templatePattern = /<template\b[^>]*>([\s\S]*?)<\/template\s*>/gi
  const directivePattern = /(?:\bv-[\w-]+|[:@#][\w.-]+)\s*=\s*(['"])([\s\S]*?)\1/g

  for (const templateMatch of source.matchAll(templatePattern)) {
    const template = templateMatch[1] ?? ''
    const templateStart = (templateMatch.index ?? 0) + templateMatch[0].indexOf(template)
    for (const directiveMatch of template.matchAll(directivePattern)) {
      const expression = directiveMatch[2] ?? ''
      const expressionOffset = templateStart + (directiveMatch.index ?? 0) + directiveMatch[0].indexOf(expression)
      units.push({ text: expression, offset: expressionOffset })
    }
  }

  return units
}

const findFromSpecifier = (tokens: Token[], start: number): ModuleReference | null => {
  let braceDepth = 0
  let bracketDepth = 0
  let parenthesisDepth = 0

  for (let index = start; index < Math.min(tokens.length, start + 160); index += 1) {
    const token = tokens[index]
    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      (token.value === ';' || token.value === 'import' || token.value === 'export')
    ) {
      break
    }

    if (
      token.kind === 'identifier' &&
      token.value === 'from' &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0
    ) {
      const specifier = tokens[index + 1]
      if (specifier?.kind === 'string') {
        return { specifier: specifier.value, start: token.start }
      }
    }

    if (token.value === '{') braceDepth += 1
    if (token.value === '}') braceDepth = Math.max(0, braceDepth - 1)
    if (token.value === '[') bracketDepth += 1
    if (token.value === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (token.value === '(') parenthesisDepth += 1
    if (token.value === ')') parenthesisDepth = Math.max(0, parenthesisDepth - 1)
  }

  return null
}

const findModuleReferences = (source: string): ModuleReference[] => {
  const tokens = tokenize(source)
  const references: ModuleReference[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind !== 'identifier') continue
    const previous = tokens[index - 1]
    if (previous?.value === '.' || previous?.value === '?.') continue

    if (token.value === 'require') {
      const open = tokens[index + 1]
      const specifier = tokens[index + 2]
      if (open?.value === '(' && specifier?.kind === 'string') {
        references.push({ specifier: specifier.value, start: token.start })
      }
      continue
    }

    if (token.value !== 'import' && token.value !== 'export') continue

    const next = tokens[index + 1]
    if (token.value === 'import' && next?.value === '(' && tokens[index + 2]?.kind === 'string') {
      references.push({ specifier: tokens[index + 2].value, start: token.start })
      continue
    }
    if (next?.kind === 'string') {
      references.push({ specifier: next.value, start: token.start })
      continue
    }

    const reference = findFromSpecifier(tokens, index + 1)
    if (reference) references.push({ ...reference, start: token.start })
  }

  return references
}

const findCapabilityReferences = (source: string): Array<{ name: string; start: number }> => {
  const tokens = tokenize(source)
  const references: Array<{ name: string; start: number }> = []

  for (let index = 0; index < tokens.length; index += 1) {
    const base = tokens[index]
    if (base.kind !== 'identifier' || !['window', 'globalThis'].includes(base.value)) continue

    let propertyIndex = index + 1
    if (tokens[propertyIndex]?.value === '?.') propertyIndex += 1
    if (tokens[propertyIndex]?.value === '.') propertyIndex += 1

    if (tokens[propertyIndex]?.kind === 'identifier') {
      const name = tokens[propertyIndex].value
      if (rendererCapabilityGlobals.has(name)) references.push({ name, start: base.start })
      continue
    }

    if (tokens[propertyIndex]?.value !== '[') continue
    const property = tokens[propertyIndex + 1]
    if (property?.kind === 'string' && rendererCapabilityGlobals.has(property.value)) {
      references.push({ name: property.value, start: base.start })
    }
  }

  return references
}

const isNodeBuiltinSpecifier = (specifier: string): boolean => {
  const normalized = specifier.replace(/^node:/, '')
  return specifier.startsWith('node:') || nodeBuiltinNames.has(normalized)
}

const isElectronRuntimeSpecifier = (specifier: string): boolean =>
  /^electron(?:\/|$)/i.test(specifier)

const isLegacyMuyaSpecifier = (specifier: string): boolean => {
  const normalized = toPosixPath(specifier)
  return (
    /^@marktext\/muyajs(?:\/|$)/i.test(normalized) ||
    /^muya(?:\/|$)/i.test(normalized) ||
    /^(?:\.\.?(?:\/|$))+muyajs(?:\/|$)/i.test(normalized) ||
    /(?:^|\/)packages\/muyajs(?:\/|$)/i.test(normalized)
  )
}

const isSharedForbiddenSpecifier = (specifier: string): boolean =>
  /^(?:vue(?:\/|$)|vue-[^/]+(?:\/|$)|@vue(?:\/|$)|electron(?:\/|$)|@electron(?:\/|$)|(?:dompurify|jsdom|happy-dom|linkedom)(?:\/|$))/i.test(
    specifier
  )

const isPropertyName = (tokens: Token[], index: number): boolean => {
  const previous = tokens[index - 1]?.value
  const next = tokens[index + 1]?.value
  const nextNext = tokens[index + 2]?.value
  return (
    previous === '.' ||
    previous === '?.' ||
    next === ':' ||
    (next === '?' && nextNext === ':')
  )
}

const isLegacyMuyaPathValue = (value: string): boolean => {
  const normalized = toPosixPath(value)
  return (
    /(?:^|\/)packages\/muyajs(?:\/|$)/i.test(normalized) ||
    /^(?:\.\.\/)+muyajs(?:\/|$)/i.test(normalized) ||
    /^(?:\.\/)?muyajs(?:\/|$)/i.test(normalized) ||
    normalized === 'muyajs'
  )
}

const findLegacyAliasReferences = (source: string): number[] => {
  const tokens = tokenize(source)
  const references: number[] = []

  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const key = tokens[index]
    if (!['identifier', 'string'].includes(key.kind) || tokens[index + 1]?.value !== ':') continue

    let depth = 0
    let pointsToLegacyMuya = false
    for (let valueIndex = index + 2; valueIndex < tokens.length; valueIndex += 1) {
      const token = tokens[valueIndex]
      if (depth === 0 && [';', ',', '}'].includes(token.value)) break
      if (token.kind === 'string' && isLegacyMuyaPathValue(token.value)) {
        pointsToLegacyMuya = true
      }
      if (token.kind === 'identifier' && isLegacyMuyaPathValue(token.value)) {
        pointsToLegacyMuya = true
      }
      if (['(', '[', '{'].includes(token.value)) depth += 1
      if ([')', ']', '}'].includes(token.value)) depth = Math.max(0, depth - 1)
    }
    if (pointsToLegacyMuya) references.push(key.start)
  }

  return references
}

const findRendererBoundaryViolations = (): string[] => {
  const violations: string[] = []
  for (const pathname of collectSourceFiles(rendererRoot)) {
    if (pathname === platformRoot || pathname.startsWith(`${platformRoot}\\`)) continue
    const source = readFileSync(pathname, 'utf8')
    const units = getSourceUnits(pathname, source)

    for (const unit of units) {
      for (const reference of findCapabilityReferences(unit.text)) {
        violations.push(
          formatViolation(
            rendererRoot,
            pathname,
            source,
            unit.offset + reference.start,
            `reads preload global ${reference.name}`
          )
        )
      }
      for (const reference of findModuleReferences(unit.text)) {
        if (isElectronRuntimeSpecifier(reference.specifier) || isNodeBuiltinSpecifier(reference.specifier)) {
          violations.push(
            formatViolation(
              rendererRoot,
              pathname,
              source,
              unit.offset + reference.start,
              `imports forbidden runtime module ${reference.specifier}`
            )
          )
        }
      }
    }

    for (const unit of getVueTemplateExpressionUnits(source)) {
      for (const reference of findCapabilityReferences(unit.text)) {
        violations.push(
          formatViolation(
            rendererRoot,
            pathname,
            source,
            unit.offset + reference.start,
            `reads preload global ${reference.name}`
          )
        )
      }
    }
  }
  return violations.sort()
}

const findLegacyMuyaViolations = (): string[] => {
  const violations: string[] = []
  for (const pathname of collectSourceFiles(sourceRoot)) {
    const source = readFileSync(pathname, 'utf8')
    for (const unit of getSourceUnits(pathname, source)) {
      for (const reference of findModuleReferences(unit.text)) {
        if (isLegacyMuyaSpecifier(reference.specifier)) {
          violations.push(
            formatViolation(
              desktopRoot,
              pathname,
              source,
              unit.offset + reference.start,
              `imports legacy Muya module ${reference.specifier}`
            )
          )
        }
      }
    }
  }

  for (const pathname of legacyAliasConfigFiles) {
    if (!existsSync(pathname)) continue
    const source = readFileSync(pathname, 'utf8')
    for (const start of findLegacyAliasReferences(source)) {
      violations.push(
        formatViolation(desktopRoot, pathname, source, start, 'defines an alias pointing to packages/muyajs')
      )
    }
  }

  return violations.sort()
}

const findSharedTypeRuntimeViolations = (): string[] => {
  const violations: string[] = []
  for (const pathname of collectSourceFiles(sharedTypesRoot)) {
    const source = readFileSync(pathname, 'utf8')
    for (const unit of getSourceUnits(pathname, source)) {
      const tokens = tokenize(unit.text)
      for (const reference of findModuleReferences(unit.text)) {
        if (isSharedForbiddenSpecifier(reference.specifier)) {
          violations.push(
            formatViolation(
              sharedTypesRoot,
              pathname,
              source,
              unit.offset + reference.start,
              `imports forbidden shared-type module ${reference.specifier}`
            )
          )
        }
      }
      for (const [index, token] of tokens.entries()) {
        if (
          token.kind === 'identifier' &&
          sharedDomGlobals.has(token.value) &&
          !isPropertyName(tokens, index)
        ) {
          violations.push(
            formatViolation(
              sharedTypesRoot,
              pathname,
              source,
              unit.offset + token.start,
              `references DOM runtime global ${token.value}`
            )
          )
        }
      }
    }
  }
  return violations.sort()
}

describe('architecture boundaries', () => {
  it('keeps Electron, Node, and preload globals behind renderer platform adapters', () => {
    expect(findRendererBoundaryViolations()).toEqual([])
  })

  it('keeps desktop production source and resolver aliases off legacy muyajs', () => {
    expect(findLegacyMuyaViolations()).toEqual([])
  })

  it('keeps shared types independent from Vue, DOM, and Electron runtime APIs', () => {
    expect(findSharedTypeRuntimeViolations()).toEqual([])
  })

  it('ignores comments and prose when identifying forbidden imports', () => {
    expect(findModuleReferences('// import \'electron\'\n/* require(\'fs\') */')).toEqual([])
    expect(findModuleReferences('const note = "import \'electron\'"')).toEqual([])
    expect(findLegacyAliasReferences('// muya: resolve(__dirname, \'../muyajs\')')).toEqual([])
  })
})
