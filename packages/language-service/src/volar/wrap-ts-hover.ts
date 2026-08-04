/**
 * Wrap Volar TypeScript language-service plugins so hover display strings
 * pretty-print `Thunk<T, P>` into surface form.
 */

import type {
  LanguageServicePlugin,
  LanguageServicePluginInstance,
} from "@volar/language-service";
import { prettyPrintThunkHover } from "./pretty-hover";

export function wrapTypeScriptServicesForThunkHover(
  plugins: LanguageServicePlugin[],
): LanguageServicePlugin[] {
  return plugins.map((plugin) => {
    const originalCreate = plugin.create.bind(plugin);
    return {
      ...plugin,
      create(context): LanguageServicePluginInstance {
        const instance = originalCreate(context);
        const innerHover = instance.provideHover?.bind(instance);
        if (!innerHover) return instance;

        return {
          ...instance,
          async provideHover(document, position, token) {
            const hover = await innerHover(document, position, token);
            if (!hover) return hover;
            return prettyPrintThunkHover(hover);
          },
        };
      },
    };
  });
}
