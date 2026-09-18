// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// Quantifies the O(blocks^2) -> O(blocks) inline-render fix by toggling the
// reference-definition cache at runtime on identical documents. The "legacy"
// path re-clones and re-walks the full state for every content block, exactly
// as `InlineRenderer.patch` did before the revision cache was added.

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
        `paragraph ${i} text with a [link][ref-${i}]\n\n[ref-${i}]: https://example.com/${i}\n`).join('\n');
}

function render(blocks: number, legacy: boolean): number {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown: makeDocument(blocks),
    } as ConstructorParameters<typeof Muya>[1]);

    if (legacy) {
        // Simulate the pre-fix renderer: ignore the revision cache so every
        // block re-clones + re-walks the full state.
        const inlineRenderer = muya.editor.inlineRenderer as unknown as {
            _labelsRevision: number;
        };
        Object.defineProperty(inlineRenderer, '_labelsRevision', {
            get: () => -1,
            set: () => {},
            configurable: true,
        });
    }

    const started = performance.now();
    muya.init();
    const elapsed = performance.now() - started;
    hosts.push(muya.domNode);
    return elapsed;
}

describe('inline render cache impact', () => {
    it('measures cached vs legacy full-state-scan rendering', () => {
        render(20, false); // warm up

        const blocks = 300;
        const cached = render(blocks, false);
        const legacy = render(blocks, true);

        process.stdout.write(
            `inline-render-${blocks}-blocks: cached=${cached.toFixed(1)}ms legacy=${legacy.toFixed(1)}ms speedup=${(legacy / Math.max(cached, 1)).toFixed(2)}x${
                String.fromCharCode(10)}`,
        );
        expect(legacy).toBeGreaterThan(0);
    });
});
