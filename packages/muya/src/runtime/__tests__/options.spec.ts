import { describe, expect, it } from 'vitest';
import { hasParseAffectingOption } from '../options';

describe('runtime options', () => {
    it('identifies options that change markdown block classification', () => {
        expect(hasParseAffectingOption({ math: false })).toBe(true);
        expect(hasParseAffectingOption({ frontMatter: false })).toBe(true);
        expect(hasParseAffectingOption({ trimUnnecessaryCodeBlockEmptyLines: true })).toBe(true);
    });

    it('ignores render-only and editor interaction options', () => {
        expect(hasParseAffectingOption({ fontSize: 18, wrapCodeBlocks: true })).toBe(false);
        expect(hasParseAffectingOption({ spellcheckEnabled: true, hideQuickInsertHint: true })).toBe(false);
    });

    it('returns false for no options', () => {
        expect(hasParseAffectingOption({})).toBe(false);
    });
});
