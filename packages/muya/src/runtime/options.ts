import type { IMuyaOptions } from '../types';

// Options that change markdown block classification and therefore require the
// current markdown to be parsed again before the editor is rendered.
const PARSE_AFFECTING_OPTIONS = new Set<keyof IMuyaOptions>([
    'isGitlabCompatibilityEnabled',
    'math',
    'footnote',
    'frontMatter',
    'trimUnnecessaryCodeBlockEmptyLines',
]);

export function hasParseAffectingOption(options: Partial<IMuyaOptions>): boolean {
    return Object.keys(options).some(key => PARSE_AFFECTING_OPTIONS.has(key as keyof IMuyaOptions));
}
