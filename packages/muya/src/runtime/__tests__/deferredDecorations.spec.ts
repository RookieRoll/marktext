import { describe, expect, it, vi } from 'vitest';
import { createDeferredDecorationGate } from '../../../src/runtime/deferredDecorations';

// Task 3.1/3.2/3.3: the viewport gate that keeps the open path from paying for
// the whole document's decorations.
//
// These are policy tests: the gate is exercised with an injected observer and
// stubbed geometry so the decisions (render now / queue / fail open) are
// deterministic and independent of any real layout.

function elementAt(top: number, height: number): Element {
    return ({
        getBoundingClientRect: () => ({ top, bottom: top + height }),
    }) as unknown as Element;
}

function setViewport(height: number): void {
    vi.stubGlobal('innerHeight', height);
}

/** Records observers so the test can decide when a block "comes into view". */
function createManualObservation() {
    const callbacks = new Map<Element, () => void>();
    const disconnected: Element[] = [];
    const observe = (element: Element, onNear: () => void): (() => void) => {
        callbacks.set(element, onNear);
        return () => {
            disconnected.push(element);
            callbacks.delete(element);
        };
    };
    return {
        observe,
        disconnected,
        approach(element: Element): void {
            callbacks.get(element)?.();
        },
        get observing(): number {
            return callbacks.size;
        },
    };
}

describe('viewport decoration gate — default scope', () => {
    it('renders immediately when the gate is not enabled', () => {
    // The product requirement is immediate rendering. With no option (and
    // `enabled: false`), nothing may be withheld or observed.
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ observe: observation.observe });

        expect(gate.enabled).toBe(false);
        // Even a block 5000px below the fold renders now.
        expect(gate.shouldRenderEagerly(elementAt(5000, 200), 'far')).toBe(true);
        expect(observation.observing).toBe(0);
        expect(gate.queuedCount).toBe(0);
    });

    it('runs deferred work inline when the gate is not enabled', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ observe: observation.observe });
        const work = vi.fn();

        gate.defer(elementAt(5000, 200), 'far', work);

        expect(work).toHaveBeenCalledTimes(1);
        expect(observation.observing).toBe(0);
        expect(gate.queuedCount).toBe(0);
    });

    it('explicitly disabling matches the default', () => {
        setViewport(1000);
        const gate = createDeferredDecorationGate({ enabled: false, margin: 1 });
        const work = vi.fn();

        expect(gate.shouldRenderEagerly(elementAt(9000, 100), 'far')).toBe(true);
        gate.defer(elementAt(9000, 100), 'far', work);
        expect(work).toHaveBeenCalledTimes(1);
    });
});

describe('viewport decoration gate', () => {
    it('renders a block that is already on screen', () => {
        setViewport(1000);
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100 });

        // Fully inside the viewport.
        expect(gate.shouldRenderEagerly(elementAt(100, 400), 'formula-1')).toBe(true);
        expect(gate.queuedCount).toBe(0);
    });

    it('queues a block far below the viewport instead of rendering it', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100, observe: observation.observe });

        // 5000px below a 1000px viewport, well past the 100px margin.
        expect(gate.shouldRenderEagerly(elementAt(5000, 200), 'formula-2')).toBe(false);
        expect(observation.observing).toBe(1);
    });

    it('renders a block that comes near the viewport', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100, observe: observation.observe });
        const element = elementAt(5000, 200);

        gate.shouldRenderEagerly(element, 'formula-3');
        const work = vi.fn();
        gate.defer(element, 'formula-3', work);
        expect(work).not.toHaveBeenCalled();

        // The user scrolls to the block (task 3.3).
        observation.approach(element);

        expect(work).toHaveBeenCalledTimes(1);
        expect(gate.queuedCount).toBe(0);
    });

    it('treats a block within the overscan margin as on screen', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, margin: 500, observe: observation.observe });

        // 300px below the fold, inside a 500px overscan.
        expect(gate.shouldRenderEagerly(elementAt(1300, 100), 'near')).toBe(true);
        expect(observation.observing).toBe(0);
    });

    it('fails open when geometry cannot be measured', () => {
        setViewport(1000);
        const gate = createDeferredDecorationGate();

        // No element at all (detached block, fake node in a test harness).
        expect(gate.shouldRenderEagerly(null, 'detached')).toBe(true);

        // An element whose measurement throws must not swallow the render.
        const throwing = {
            getBoundingClientRect: () => {
                throw new Error('layout unavailable');
            },
        } as unknown as Element;
        expect(gate.shouldRenderEagerly(throwing, 'throwing')).toBe(true);
    });

    it('fails open when there is no viewport to compare against', () => {
        setViewport(0);
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100 });

        expect(gate.shouldRenderEagerly(elementAt(5000, 200), 'no-viewport')).toBe(true);
        expect(gate.queuedCount).toBe(0);
    });

    it('fails open when no observer is available', () => {
        setViewport(1000);
        // `observe` returning null models an environment without
        // IntersectionObserver. Nothing can notify us later, so gating would strand
        // the decoration permanently — the gate must answer "render now".
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100, observe: () => null });
        const element = elementAt(5000, 200);

        expect(gate.shouldRenderEagerly(element, 'formula-4')).toBe(true);
        expect(gate.queuedCount).toBe(0);

        // Same for a direct deferral: no watch ⇒ run it rather than queue forever.
        const work = vi.fn();
        gate.defer(element, 'formula-4b', work);
        expect(work).toHaveBeenCalledTimes(1);
        expect(gate.queuedCount).toBe(0);
    });

    it('collapses repeated updates for one block to the latest work', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100, observe: observation.observe });
        const element = elementAt(5000, 200);
        const first = vi.fn();
        const second = vi.fn();

        gate.defer(element, 'formula-5', first);
        gate.defer(element, 'formula-5', second);
        expect(gate.queuedCount).toBe(1);

        gate.flush();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('renders once when a queued block comes into view', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100, observe: observation.observe });
        const element = elementAt(5000, 200);
        const work = vi.fn();

        expect(gate.shouldRenderEagerly(element, 'formula-6')).toBe(false);
        gate.defer(element, 'formula-6', work);
        expect(work).not.toHaveBeenCalled();

        // The block scrolls near the viewport: exactly one render (task 3.3).
        observation.approach(element);
        observation.approach(element);

        expect(work).toHaveBeenCalledTimes(1);
        expect(gate.queuedCount).toBe(0);
    });

    it('flushes everything for callers that no longer need gating', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100, observe: observation.observe });
        const first = vi.fn();
        const second = vi.fn();
        const elementA = elementAt(5000, 100);
        const elementB = elementAt(6000, 100);

        gate.defer(elementA, 'a', first);
        gate.defer(elementB, 'b', second);
        expect(gate.flush()).toBe(2);

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(gate.flush()).toBe(0);
    });

    it('drops queued work when the document is replaced', () => {
        setViewport(1000);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, margin: 100, observe: observation.observe });
        const stale = vi.fn();
        const element = elementAt(5000, 100);

        gate.defer(element, 'stale', stale);
        gate.discard();

        // A pending observer callback for the OUTGOING document must not resurrect
        // its render into detached DOM.
        observation.approach(element);

        expect(stale).not.toHaveBeenCalled();
        expect(gate.flush()).toBe(0);
    });

    it('defaults the overscan to one viewport height', () => {
        setViewport(800);
        const observation = createManualObservation();
        const gate = createDeferredDecorationGate({ enabled: true, observe: observation.observe });

        // 700px below the fold: inside the default 800px overscan.
        expect(gate.shouldRenderEagerly(elementAt(1500, 100), 'inside-default')).toBe(true);
        // 900px below the fold: outside it.
        expect(gate.shouldRenderEagerly(elementAt(1900, 100), 'outside-default')).toBe(false);
    });
});
