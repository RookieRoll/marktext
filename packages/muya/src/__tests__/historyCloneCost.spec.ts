// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';

// Task 5.3 evidence: the desktop deep-clones a tab's whole undo/redo stack
// TWICE on every tab switch — `getHistory()` clones each op on the way out and
// `setHistory()`/`adoptHistory()` clones each op again on the way back in (both
// go through `deepClone` = `structuredClone`).
//
// This measures that cost against stack depth so the decision to remove it is
// evidence-based. The stack depth after N edits is the driving variable.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function placeCursorOnFirstBlock(muya: Muya): Content {
    const first = muya.editor.scrollPage!.firstContentInDescendant()!;
    muya.editor.activeContentBlock = first;
    first.setCursor(0, 0, true);
    return first;
}

async function recordEdits(muya: Muya, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        muya.editor.history.cutoff();
        placeCursorOnFirstBlock(muya);
        muya.insertParagraph('after', `edit-${i}`);
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain(`edit-${i}`);
        });
    }
}

function time(iterations: number, run: () => void): number {
    // Warm once (the first call pays JIT/allocation costs).
    run();
    const started = performance.now();
    for (let i = 0; i < iterations; i++) run();
    return (performance.now() - started) / iterations;
}

describe('undo/redo stack deep-clone cost', () => {
    // Explicit timeouts: these record 40 and 80 edits through the real editor, and
    // `setHistory` deep-clones the whole stack on every call. Under the default 5s
    // budget they time out whenever the suite runs them alongside other files, so
    // a plain `vitest run` would report a red suite for a benchmark that is fine
    // in isolation. The RATIO is the measurement; it is stable with more headroom.
    it('measures the per-switch getHistory + setHistory round trip', { timeout: 60_000 }, async () => {
        const muya = bootMuya('# Title\n');
        await recordEdits(muya, 40);

        const depth = muya.getHistory().stack.undo.length;
        expect(depth).toBe(40);

        const snapshot = muya.getHistory();
        const iterations = 30;
        const getMs = time(iterations, () => {
            muya.getHistory();
        });
        const setMs = time(iterations, () => {
            muya.setHistory(snapshot);
        });
        const roundTrip = getMs + setMs;

        process.stdout.write(
            `history-clone-cost (depth=${depth}): `
            + `getHistory=${getMs.toFixed(3)}ms, setHistory=${setMs.toFixed(3)}ms, `
            + `per-switch-round-trip=${roundTrip.toFixed(3)}ms${String.fromCharCode(10)}`,
        );

        expect(getMs).toBeGreaterThan(0);
        expect(setMs).toBeGreaterThan(0);
    });

    it('reports how the round trip scales with stack depth', { timeout: 120_000 }, async () => {
        const shallow = bootMuya('# Title\n');
        await recordEdits(shallow, 10);
        const deep = bootMuya('# Title\n');
        await recordEdits(deep, 80);

        const shallowDepth = shallow.getHistory().stack.undo.length;
        const deepDepth = deep.getHistory().stack.undo.length;
        const iterations = 10;

        const measure = (muya: Muya): number => {
            const snapshot = muya.getHistory();
            return time(iterations, () => {
                muya.setHistory(muya.getHistory());
            }) + time(iterations, () => {
                muya.setHistory(snapshot);
            });
        };

        const shallowMs = measure(shallow);
        const deepMs = measure(deep);

        process.stdout.write(
            `history-clone-scaling: depth ${shallowDepth}=${shallowMs.toFixed(2)}ms, `
            + `depth ${deepDepth}=${deepMs.toFixed(2)}ms, `
            + `ratio=${(deepMs / Math.max(shallowMs, 0.0001)).toFixed(2)}x `
            + `(${(deepDepth / shallowDepth).toFixed(0)}x deeper)${String.fromCharCode(10)}`,
        );

        // Cost tracks stack depth, i.e. it grows with how long the user has been
        // editing — never with what is on screen.
        expect(deepMs).toBeGreaterThan(shallowMs);
    });
});
