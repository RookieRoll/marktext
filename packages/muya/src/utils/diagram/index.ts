const rendererCache = new Map();
const rendererLoading = new Map();

export interface IMermaidRenderer {
    initialize: (options: {
        startOnLoad: false;
        securityLevel: 'strict';
        theme: string;
    }) => void;
    parse: (code: string) => Promise<unknown>;
    run: (options: { nodes: Element[] }) => Promise<unknown>;
}

type MermaidTask<T> = (renderer: IMermaidRenderer) => Promise<T> | T;

// Mermaid keeps configuration and renderer state at module scope. Serialize
// operations so a preview, export, or theme switch cannot reconfigure the
// singleton while another diagram is parsing or rendering.
let mermaidQueue: Promise<void> = Promise.resolve();

/**
 *
 * @param {string} name the renderer name: plantuml, mermaid, vega-lite, flowchart, sequence
 */
async function loadRenderer(name: string) {
    if (rendererCache.has(name))
        return rendererCache.get(name);

    // Avoid starting duplicate dynamic imports when several blocks request
    // Mermaid during the same render pass.
    const pending = rendererLoading.get(name);
    if (pending)
        return pending;

    const loading = (async () => {
        let m;
        switch (name) {
            case 'plantuml':
                m = await import('./plantuml');
                break;

            case 'mermaid':
                m = await import('mermaid');
                break;

            case 'vega-lite':
                m = await import('vega-embed');
                break;

            case 'flowchart':
                m = await import('flowchart.js');
                break;

            case 'sequence':
                m = await import('./sequence');
                break;

            default:
                throw new Error(`Unknown diagram name ${name}`);
        }

        rendererCache.set(name, m.default);
        return m.default;
    })();
    rendererLoading.set(name, loading);

    try {
        return await loading;
    }
    finally {
        if (rendererLoading.get(name) === loading)
            rendererLoading.delete(name);
    }
}

export function withMermaidRenderer<T>(theme: string, task: MermaidTask<T>): Promise<T> {
    const operation = mermaidQueue.then(async () => {
        const renderer = await loadRenderer('mermaid') as IMermaidRenderer;
        renderer.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme,
        });
        return task(renderer);
    });

    // Keep the queue usable after a failed diagram while preserving the
    // rejection for the caller that owns this operation.
    mermaidQueue = operation.then(() => undefined, () => undefined);
    return operation;
}

export default loadRenderer;
