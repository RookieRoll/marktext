import type { Muya } from '../../muya';
import { describe, expect, it, vi } from 'vitest';
import PluginRegistry from '../pluginRegistry';

type Registration = Parameters<PluginRegistry['register']>[0];

class FirstPlugin {
    static pluginName = 'first';

    constructor(
        public readonly muya: Muya,
        public readonly options: Record<string, unknown>,
    ) {}
}

class SecondPlugin {
    static pluginName = 'second';

    constructor(
        public readonly muya: Muya,
        public readonly options: Record<string, unknown>,
    ) {}
}

describe('pluginRegistry', () => {
    it('keeps registration data separate from instance creation', () => {
        const registry = new PluginRegistry();
        const registrations: Registration = [];
        const muya = {} as Muya;
        const options = { imagePathPicker: vi.fn() };

        registry.register(registrations, FirstPlugin, options);
        const instances = registry.instantiate(registrations, muya);

        expect(registrations).toEqual([{ plugin: FirstPlugin, options }]);
        expect(instances.first).toBeInstanceOf(FirstPlugin);
        expect((instances.first as FirstPlugin).muya).toBe(muya);
        expect((instances.first as FirstPlugin).options).toBe(options);
    });

    it('preserves constructor order while using pluginName as the instance key', () => {
        const registry = new PluginRegistry();
        const registrations: Registration = [];
        const muya = {} as Muya;
        const constructed: string[] = [];

        class TrackingFirstPlugin extends FirstPlugin {
            static override pluginName = 'first';

            constructor(...args: ConstructorParameters<typeof FirstPlugin>) {
                super(...args);
                constructed.push('first');
            }
        }

        class TrackingSecondPlugin extends SecondPlugin {
            static override pluginName = 'second';

            constructor(...args: ConstructorParameters<typeof SecondPlugin>) {
                super(...args);
                constructed.push('second');
            }
        }

        registrations.push(
            { plugin: TrackingFirstPlugin, options: { order: 1 } },
            { plugin: TrackingSecondPlugin, options: { order: 2 } },
        );

        const instances = registry.instantiate(registrations, muya);

        expect(constructed).toEqual(['first', 'second']);
        expect(Object.keys(instances)).toEqual(['first', 'second']);
    });

    it('destroys all instances that expose destroy and tolerates legacy plugins', () => {
        const registry = new PluginRegistry();
        const destroyA = vi.fn();
        const destroyB = vi.fn();
        const instances = {
            first: { destroy: destroyA },
            second: { destroy: destroyB },
            legacy: {},
        };

        expect(() => registry.destroy(instances)).not.toThrow();
        expect(destroyA).toHaveBeenCalledTimes(1);
        expect(destroyB).toHaveBeenCalledTimes(1);
    });
});
