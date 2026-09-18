// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// Evidence test for the O(blocks^2) inline-render regression.
//
// `InlineRenderer.patch` used to clone + walk the whole JSON state for every
// content block during initial render. The renderer now caches that scan by
// state revision. This benchmark is not a hard latency gate (CI machines vary);
// it asserts scaling stays roughly linear by comparing a small document against
// one 4x larger. Before the fix the ratio grew superlinearly with block count.

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
        `paragraph ${i} with [link][ref-${i}]\n\n[ref-${i}]: https://example.com/${i}\n`).join('\n');
}

function render(blocks: number): number {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const markdown = makeDocument(blocks);
    const started = performance.now();
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    const elapsed = performance.now() - started;
    hosts.push(muya.domNode);
    return elapsed;
}

describe('large document initial render scaling', () => {
    it('renders a 4x larger document without quadratic blowup', () => {
        // Warm up module/lexer paths before timing.
        render(20);

        const small = render(100);
        const large = render(400);

        process.stdout.write(`large-document-render: 100 blocks=${small.toFixed(1)}ms, 400 blocks=${large.toFixed(1)}ms, ratio=${(large / Math.max(small, 1)).toFixed(2)}x${String.fromCharCode(10)}`);
        // Linear scaling would be ~4x. Allow generous headroom for happy-dom
        // variance while still failing the old quadratic behavior (~16x).
        expect(large / Math.max(small, 1)).toBeLessThan(10);
    });
});
