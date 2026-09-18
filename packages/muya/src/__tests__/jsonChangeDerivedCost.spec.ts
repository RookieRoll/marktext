// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya, wordCount } from '../index';

// Evidence for task 5.1/5.2: the desktop's `json-change` handler runs THREE
// full-document passes per batched edit — `getMarkdown()` (serialize the whole
// block tree), `wordCount(markdown)`, and the synthetic-history content hash.
// This measures each pass separately so the optimization targets the dominant
// one instead of guessing.
//
// Absolute numbers are happy-dom on one machine; the RATIOS are the point.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function makeDocument(blocks: number): string {
    return Array.from({ length: blocks }, (_v, i) =>
        `## heading ${i}\n\nparagraph ${i} with **bold** and [link][ref-${i}] text\n\n[ref-${i}]: https://example.com/${i}\n`).join('\n');
}

// Mirror of the desktop's `hashContent` (syntheticHistory.ts) so the measured
// cost matches the real hot path.
function stripTrailingNewlines(content: string): string {
    let end = content.length;
    while (end > 0 && (content.charCodeAt(end - 1) === 10 || content.charCodeAt(end - 1) === 13))
        end -= 1;
    return end === content.length ? content : content.slice(0, end);
}
const FNV32_OFFSET_A = 0x811C9DC5;
const FNV32_OFFSET_B = 0x9E3779B9;
const FNV32_PRIME = 0x01000193;
function hashContent(content: string): string {
    const normalized = stripTrailingNewlines(content);
    let hashA = FNV32_OFFSET_A;
    let hashB = FNV32_OFFSET_B;
    for (let i = 0; i < normalized.length; i++) {
        const code = normalized.charCodeAt(i);
        hashA = Math.imul(hashA ^ code, FNV32_PRIME);
        hashB = Math.imul(hashB ^ (code + i), FNV32_PRIME);
    }
    return `${(hashA >>> 0).toString(36)}:${(hashB >>> 0).toString(36)}`;
}

function time(iterations: number, run: () => void): number {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) run();
    return (performance.now() - started) / iterations;
}

describe('json-change derived-work cost', () => {
    it('splits the three full-document passes and reports their shares', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const markdown = makeDocument(400);
        const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);

        // Warm the serializer / regex paths before timing.
        muya.getMarkdown();
        wordCount(markdown);
        hashContent(markdown);

        const iterations = 20;
        const serialized = muya.getMarkdown();
        const serializeMs = time(iterations, () => void muya.getMarkdown());
        const wordCountMs = time(iterations, () => void wordCount(serialized));
        const hashMs = time(iterations, () => void hashContent(serialized));
        const total = serializeMs + wordCountMs + hashMs;

        const pct = (value: number) => `${((value / Math.max(total, 0.0001)) * 100).toFixed(1)}%`;
        process.stdout.write(
            `json-change-derived-cost (${serialized.length} chars): `
            + `serialize=${serializeMs.toFixed(2)}ms (${pct(serializeMs)}), `
            + `wordCount=${wordCountMs.toFixed(2)}ms (${pct(wordCountMs)}), `
            + `hash=${hashMs.toFixed(2)}ms (${pct(hashMs)}), `
            + `total=${total.toFixed(2)}ms${String.fromCharCode(10)}`,
        );

        // Every pass must be measurable; a zero here would mean the benchmark
        // silently stopped exercising one of them.
        expect(serializeMs).toBeGreaterThan(0);
        expect(wordCountMs).toBeGreaterThan(0);
        expect(hashMs).toBeGreaterThan(0);
    });
});
