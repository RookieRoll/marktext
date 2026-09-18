// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// Task 5.3 companion measurement: how much of a TAB SWITCH is spent deep-cloning
// the whole document state.
//
// `Editor.setContent` (the tab-switch path) parses/reuses a state array, stores
// it as authoritative, and then `JSONState.getState()` deep-clones the ENTIRE
// tree so `ScrollPage.updateState` can rebuild the DOM from it. This isolates
// that clone so the cost is attributed rather than assumed.

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

function time(iterations: number, run: () => void): number {
    run();
    const started = performance.now();
    for (let i = 0; i < iterations; i++) run();
    return (performance.now() - started) / iterations;
}

describe('document state deep-clone cost', () => {
    // Explicit timeout: `setContent` rebuilds the whole DOM in happy-dom, which
    // is slow enough that the default 5s budget is not safe on a loaded machine.
    it('separates the state clone from the DOM rebuild on setContent', { timeout: 60_000 }, () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            markdown: makeDocument(60),
        } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);

        const markdown = muya.getMarkdown();
        const state = muya.getState();
        // Kept small on purpose: `setContent` on this document costs ~100ms, so a
        // larger loop turns a decision record into a multi-second CPU hog that
        // times out when the full suite runs it alongside other files. The RATIO
        // is the measurement; it is stable at this size.
        const iterations = 5;

        // The two halves of `setContent`: clone the authoritative state, then
        // rebuild the block tree/DOM from it.
        const cloneMs = time(iterations, () => {
            muya.getState();
        });
        const setContentMs = time(iterations, () => {
            muya.setContent(markdown);
        });

        const cloneShare = (cloneMs / Math.max(setContentMs, 0.0001)) * 100;
        process.stdout.write(
            `state-clone-cost (${state.length} top-level blocks): `
            + `getState-clone=${cloneMs.toFixed(2)}ms, full-setContent=${setContentMs.toFixed(2)}ms, `
            + `clone-share=${cloneShare.toFixed(1)}%${String.fromCharCode(10)}`,
        );

        expect(cloneMs).toBeGreaterThan(0);
        expect(setContentMs).toBeGreaterThan(0);
        // `clone-share` above is the decision input and is REPORTED, not
        // asserted: these are wall-clock numbers from a shared test process. The
        // durable conclusion (the clone is ~0.1% of setContent, so removing it
        // would not be worth aliasing mutable state into the block tree) is in
        // PERFORMANCE.md and is reproduced by re-running this benchmark alone.
    });
});
