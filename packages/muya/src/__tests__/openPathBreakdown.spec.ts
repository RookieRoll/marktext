// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// Task 3.1/3.2 decision input: where does the open path actually spend its time?
//
// The plan under consideration is viewport-gated rendering — build every block
// (so layout/selection/scroll-height stay intact) but defer heavy DECORATIONS
// for blocks outside the viewport. That only pays off if decorations are a
// meaningful share of the tree build, so measure before building it.
//
// Construction = markdown -> state (parse). init() = state -> block tree + DOM.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function paragraphs(n: number): string {
    return Array.from({ length: n }, (_v, i) => `paragraph ${i} with **bold** text`).join('\n\n');
}

function mathBlocks(n: number): string {
    return Array.from({ length: n }, (_v, i) => `$$\nx_{${i}} = \\frac{a}{b} + ${i}\n$$`).join('\n\n');
}

function codeBlocks(n: number): string {
    return Array.from(
        { length: n },
        (_v, i) => `\`\`\`javascript\nconst value${i} = ${i}\n\`\`\``,
    ).join('\n\n');
}

interface IPhase {
    construct: number;
    init: number;
}

function build(markdown: string): IPhase {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const startConstruct = performance.now();
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    const startInit = performance.now();
    muya.init();
    const end = performance.now();

    hosts.push(muya.domNode);
    return { construct: startInit - startConstruct, init: end - startInit };
}

function timeBuild(markdown: string, runs: number): IPhase {
    // Warm the parser / block registry.
    build(markdown);
    let construct = 0;
    let init = 0;
    for (let i = 0; i < runs; i++) {
        const phase = build(markdown);
        construct += phase.construct;
        init += phase.init;
    }
    return { construct: construct / runs, init: init / runs };
}

describe('open path breakdown', () => {
    // Explicit timeout: this builds four 150-block documents per kind (a warmup
    // plus 3 timed runs) with real KaTeX decorations, which lands around 6s under
    // the default 5s budget. Same reasoning as `stateCloneCost` — the RATIO is the
    // measurement, and a benchmark must not report the suite red.
    it('separates parse from tree build across block kinds', { timeout: 120_000 }, () => {
        const blocks = 150;
        const runs = 3;

        const paragraphPhase = timeBuild(paragraphs(blocks), runs);
        const mathPhase = timeBuild(mathBlocks(blocks), runs);
        const codePhase = timeBuild(codeBlocks(blocks), runs);

        const report = (label: string, phase: IPhase): void => {
            process.stdout.write(
                `  ${label.padEnd(12)} construct=${phase.construct.toFixed(1)}ms init=${phase.init.toFixed(1)}ms total=${(phase.construct + phase.init).toFixed(1)}ms${
                    String.fromCharCode(10)}`,
            );
        };

        process.stdout.write(`open-path-breakdown (${blocks} blocks, ${runs} runs avg):${String.fromCharCode(10)}`);
        report('paragraphs', paragraphPhase);
        report('math', mathPhase);
        report('code', codePhase);

        const paragraphTotal = paragraphPhase.init;
        const mathTotal = mathPhase.init;

        // The decoration delta is what viewport gating could remove from the
        // first frame: same block count, same layout shape, different work.
        const decorationDelta = mathTotal - paragraphTotal;
        const decorationShare = (decorationDelta / Math.max(mathTotal, 0.0001)) * 100;
        process.stdout.write(
            `  math decoration delta=${decorationDelta.toFixed(1)}ms (${decorationShare.toFixed(1)}% of math init)${
                String.fromCharCode(10)}`,
        );

        expect(paragraphPhase.init).toBeGreaterThan(0);
        expect(mathPhase.init).toBeGreaterThan(0);
        expect(codePhase.init).toBeGreaterThan(0);
    });
});
