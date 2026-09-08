import type { IMuyaPluginConstructor, Muya } from '../muya';

interface IPluginRegistration {
    plugin: IMuyaPluginConstructor;
    options: Record<string, unknown>;
}

/**
 * Coordinates Muya's static UI-plugin registrations and instance lifecycle.
 *
 * The registration array remains owned by Muya so the existing mutable
 * `Muya.plugins` surface keeps its behavior. This class only extracts the
 * plugin-specific orchestration from the Muya runtime itself.
 */
export default class PluginRegistry {
    register(
        registrations: IPluginRegistration[],
        plugin: IMuyaPluginConstructor,
        options: Record<string, unknown>,
    ) {
        registrations.push({ plugin, options });
    }

    instantiate(
        registrations: readonly IPluginRegistration[],
        muya: Muya,
    ): Record<string, unknown> {
        const instances: Record<string, unknown> = {};

        for (const { plugin: Plugin, options } of registrations)
            instances[Plugin.pluginName] = new Plugin(muya, options);

        return instances;
    }

    destroy(instances: Record<string, unknown>) {
        for (const plugin of Object.values(instances)) {
            const destroy = (plugin as { destroy?: unknown })?.destroy;
            if (typeof destroy === 'function')
                (destroy as () => void).call(plugin);
        }
    }
}
