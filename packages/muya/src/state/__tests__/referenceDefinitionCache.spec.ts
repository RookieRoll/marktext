// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// The inline renderer used to deep-clone and walk the whole JSON state for
// every block it patched. Large documents therefore paid O(blocks^2) work
// during initial render. The renderer now caches the reference-definition scan
// by JSON-state revision; these tests pin both the cache and its invalidation.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function contentBlocks(muya: Muya): Content[] {
    const blocks: Content[] = [];
    muya.editor.scrollPage!.breadthFirstTraverse((node) => {
        if (node.isContent())
            blocks.push(node);
    });
    return blocks;
}

describe('inline renderer reference-definition cache', () => {
    it('caches labels until the authoritative state revision changes', () => {
        const muya = boot('one [x][a]\n\n[a]: https://a.example\n');
        const [paragraph] = contentBlocks(muya);

        paragraph.update();
        expect(muya.editor.inlineRenderer.labels.get('a')?.href).toBe('https://a.example');

        const revision = muya.editor.jsonState.revision;
        paragraph.update();
        expect(muya.editor.jsonState.revision).toBe(revision);
    });

    it('refreshes labels after a reference definition is edited', () => {
        const muya = boot('one [x][a]\n\n[a]: https://a.example\n');
        const blocks = contentBlocks(muya);
        const paragraph = blocks[0];
        const definition = blocks[1];

        paragraph.update();
        expect(muya.editor.inlineRenderer.labels.get('a')?.href).toBe('https://a.example');

        definition.text = '[a]: https://b.example';
        muya.flush();
        paragraph.update();

        expect(muya.editor.inlineRenderer.labels.get('a')?.href).toBe('https://b.example');
    });

    it('advances the state revision on setContent', () => {
        const muya = boot('first\n');
        const before = muya.editor.jsonState.revision;

        muya.setContent('second\n');

        expect(muya.editor.jsonState.revision).toBeGreaterThan(before);
    });
});
