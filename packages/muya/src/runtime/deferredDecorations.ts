/**
 * Viewport gating for expensive block decorations (tasks 3.1 / 3.2 / 3.3).
 *
 * ## Scope gate — off by default
 *
 * This exists so the work is fully built and tested and can be enabled by
 * flipping an option, but the product requirement is **immediate rendering**:
 * with the gate disabled (the default) every `shouldRenderEagerly` answers
 * `true` and every `defer` runs inline, so the caller's behaviour is byte-for-
 * byte what it was before this module existed.
 *
 * ## Why gating and not blindly deferring
 *
 * The block tree is built DIRECTLY on the live document: `Muya`'s container is
 * inserted with `originContainer.replaceWith(newContainer)` and every block
 * appends its DOM while being constructed. There is no offscreen staging area,
 * so anything rendered after first paint is a visible change on an already
 * painted document. Gating therefore keeps the decoration rendering — it only
 * moves *when* to the moment the block approaches the viewport, which is the
 * same remedy the engine already uses for diagrams
 * (`DiagramPreview` debounces 200ms).
 *
 * ## Semantics
 *
 *  - **Disabled (default)**: always render. No observation, no queueing.
 *  - **Enabled**: only blocks near the viewport render immediately; the rest are
 *    queued until they approach. The margin is the overscan paid for.
 *  - **Unknown geometry fails open**: no DOM, no measurement, no
 *    `IntersectionObserver` all answer "render". A missing signal must never
 *    leave a block blank.
 *  - Queued work is keyed by a caller id, so repeated updates replace instead
 *    of stacking and repeated notifications render once.
 *  - `flush()` renders everything; `discard()` drops queued work for torn-down
 *    DOM and invalidates pending observer callbacks.
 */

export interface IDeferredDecorationGateOptions {
    /**
     * Master switch. Defaults to `false` so the embedder keeps immediate
     * rendering unless it explicitly opts in.
     */
    enabled?: boolean;
    /** Overscan in CSS pixels. Defaults to one viewport height. */
    margin?: number;
    /** Injectable for tests; defaults to `IntersectionObserver` when available. */
    observe?: (element: Element, onNear: () => void) => (() => void) | null;
}

export interface IDeferredDecorationGate {
    /** Whether the gate may withhold a decoration from the current pass. */
    readonly enabled: boolean;
    /**
     * Whether a block's decoration should render in the current pass.
     *
     * `true` whenever the gate is disabled, the block is near the viewport, or the
     * viewport cannot be measured. `false` only when the block was queued to
     * render on approach.
     */
    shouldRenderEagerly: (element: Element | null, id: string) => boolean;
    /** Register work to run when the block comes near the viewport. */
    defer: (element: Element | null, id: string, work: () => void) => void;
    /** Run all queued work in insertion order. Returns how many ran. */
    flush: () => number;
    /** Drop queued work without running it. */
    discard: () => void;
    /** How much decoration work is currently queued. Observable for reporting. */
    readonly queuedCount: number;
}

const DEFAULT_MARGIN_FACTOR = 1;

/**
 * Read `innerHeight` without double-casting `globalThis`: the DOM lib already
 * declares it, so a narrow structural check is enough.
 */
function getViewportHeight(): number {
    const height: number | undefined = globalThis.innerHeight;
    return typeof height === 'number' && height > 0 ? height : 0;
}

function defaultObserve(
    margin: number,
): (element: Element, onNear: () => void) => (() => void) | null {
    return (element, onNear) => {
    // `IntersectionObserver` is absent in non-DOM environments; reading it off
    // the global avoids casting and the runtime check narrows it.
        const Observer = globalThis.IntersectionObserver;
        if (typeof Observer !== 'function')
            return null;

        const observer = new Observer(
            (entries) => {
                if (entries.some(entry => entry.isIntersecting))
                    onNear();
            },
            { rootMargin: `${margin}px 0px ${margin}px 0px` },
        );
        observer.observe(element);
        return () => observer.disconnect();
    };
}

/**
 * Distance from the viewport to an element's nearest edge, in CSS pixels.
 * Negative when any part of the element is inside the viewport.
 */
function distanceToViewport(element: Element): number | null {
    if (typeof element.getBoundingClientRect !== 'function')
        return null;
    const viewportHeight = getViewportHeight();
    if (viewportHeight <= 0)
        return null;

    let rect: DOMRect;
    try {
        rect = element.getBoundingClientRect();
    }
    catch {
        return null;
    }
    if (!rect || typeof rect.top !== 'number' || typeof rect.bottom !== 'number')
        return null;

    // Inside the viewport: negative (or zero) distance.
    if (rect.bottom >= 0 && rect.top <= viewportHeight) {
        return Math.max(rect.bottom - viewportHeight, -rect.top) * -1;
    }
    return rect.top > viewportHeight ? rect.top - viewportHeight : -rect.bottom;
}

export function createDeferredDecorationGate(
    options: IDeferredDecorationGateOptions = {},
): IDeferredDecorationGate {
    const enabled = options.enabled ?? false;
    const queued = new Map<string, () => void>();
    const unobserveByElement = new WeakMap<Element, () => void>();
    // Tracked separately from the WeakMap so `discard()` can invalidate every
    // observation at once; a still-pending observer callback must not resurrect
    // work for a document that has been replaced.
    const observedElements = new Set<Element>();
    const disposedElements = new WeakSet<Element>();

    function marginOf(): number {
        if (typeof options.margin === 'number' && options.margin >= 0)
            return options.margin;
        return getViewportHeight() * DEFAULT_MARGIN_FACTOR;
    }

    function runQueued(id: string): void {
        const work = queued.get(id);
        if (!work)
            return;
        queued.delete(id);
        work();
    }

    /**
     * Watch `element` and run `id`'s queued work when it comes near the viewport.
     *
     * Returns whether a watch was actually established. When it was not (no
     * `IntersectionObserver` in this environment), the caller must run the work
     * itself — nothing else will ever trigger it, and stranding a decoration would
     * leave the block blank.
     */
    function observe(element: Element, id: string): boolean {
        if (unobserveByElement.has(element))
            return true;
        const observeImpl = options.observe ?? defaultObserve(marginOf());
        const unobserve = observeImpl(element, () => {
            unobserveByElement.get(element)?.();
            unobserveByElement.delete(element);
            observedElements.delete(element);
            runQueued(id);
        });
        if (!unobserve)
            return false;
        unobserveByElement.set(element, unobserve);
        observedElements.add(element);
        return true;
    }

    return {
        get enabled(): boolean {
            return enabled;
        },

        shouldRenderEagerly(element: Element | null, id: string): boolean {
            // Disabled is the default: render immediately, exactly as before.
            if (!enabled)
                return true;

            // Already queued ⇒ this block is waiting to come into view.
            if (queued.has(id))
                return false;
            if (!element)
                return true;

            const distance = distanceToViewport(element);
            // No measurement available: render. A blank document is worse than an
            // eager render, so every unknown answers "yes".
            if (distance === null)
                return true;
            if (distance <= marginOf())
                return true;

            // Far away: queued work will render it on approach. If no watch could be
            // established, fail open — a missing signal must not blank the block.
            return !observe(element, id);
        },

        defer(element: Element | null, id: string, work: () => void): void {
            if (!enabled || !element) {
                work();
                return;
            }
            if (disposedElements.has(element))
                return;

            const distance = distanceToViewport(element);
            if (distance !== null && distance <= marginOf()) {
                work();
                return;
            }

            queued.set(id, work);
            if (!observe(element, id)) {
                // Nothing will notify us, so do not leave the block waiting: render it
                // now rather than leaving a gap where the decoration belongs.
                runQueued(id);
            }
        },

        flush(): number {
            if (queued.size === 0)
                return 0;
            const pending = [...queued.entries()];
            queued.clear();
            for (const [, work] of pending) work();
            return pending.length;
        },

        discard(): void {
            queued.clear();
            // Mark every observed element as torn down so a still-pending observer
            // callback cannot resurrect its work.
            for (const element of observedElements) {
                disposedElements.add(element);
                unobserveByElement.get(element)?.();
            }
            observedElements.clear();
        },

        get queuedCount(): number {
            return queued.size;
        },
    };
}
