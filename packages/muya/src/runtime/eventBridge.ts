import EventCenter from '../event/index';

/**
 * Owns Muya's host-facing event center and the root focus/blur bridge.
 *
 * Muya keeps exposing `eventCenter` for compatibility; this class only moves
 * construction and teardown of the bridge out of the facade.
 */
export default class EventBridge {
    public readonly eventCenter: EventCenter;

    constructor(domNode: HTMLElement) {
        this.eventCenter = new EventCenter();
        this.eventCenter.attachDOMEvent(domNode, 'focus', () => {
            this.eventCenter.emit('focus');
        });
        this.eventCenter.attachDOMEvent(domNode, 'blur', () => {
            this.eventCenter.emit('blur');
        });
    }

    destroy(): void {
        this.eventCenter.detachAllDomEvents();
        this.eventCenter.unsubscribeAll();
    }
}