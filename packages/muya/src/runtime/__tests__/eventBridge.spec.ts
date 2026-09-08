import { describe, expect, it, vi } from 'vitest';
import EventBridge from '../eventBridge';

type FakeRoot = HTMLElement & { dispatch: (event: string) => void };

function createRoot(): FakeRoot {
    const listeners = new Map<string, EventListener[]>();
    const root = {
        addEventListener(event: string, listener: EventListener) {
            const current = listeners.get(event) ?? [];
            current.push(listener);
            listeners.set(event, current);
        },
        removeEventListener(event: string, listener: EventListener) {
            const current = listeners.get(event) ?? [];
            listeners.set(event, current.filter(item => item !== listener));
        },
        dispatch(event: string) {
            for (const listener of listeners.get(event) ?? [])
                listener({ type: event } as Event);
        },
    } as unknown as FakeRoot;

    return root;
}

describe('eventBridge', () => {
    it('forwards root focus and blur events through the public event center', () => {
        const root = createRoot();
        const bridge = new EventBridge(root);
        const focus = vi.fn();
        const blur = vi.fn();
        bridge.eventCenter.on('focus', focus);
        bridge.eventCenter.on('blur', blur);

        root.dispatch('focus');
        root.dispatch('blur');

        expect(focus).toHaveBeenCalledOnce();
        expect(blur).toHaveBeenCalledOnce();
        bridge.destroy();
    });

    it('removes DOM and custom listeners during teardown', () => {
        const root = createRoot();
        const bridge = new EventBridge(root);
        const handler = vi.fn();
        bridge.eventCenter.on('focus', handler);

        bridge.destroy();
        root.dispatch('focus');
        bridge.eventCenter.emit('focus');

        expect(handler).not.toHaveBeenCalled();
        expect(bridge.eventCenter.events).toHaveLength(0);
        expect(bridge.eventCenter.listeners).toEqual({});
    });
});
