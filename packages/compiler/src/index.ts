/**
 * CLI stub — same lowering as the language service.
 * Emit / watch come after M0.
 */

import { lowerThunkSource } from "@thunk/language-core";

export function compileThunkSource(
  text: string,
  fileName = "input.thunk",
): { generatedText: string; fileName: string } {
  const lowered = lowerThunkSource(text, fileName);
  return {
    generatedText: lowered.generatedText,
    fileName: lowered.fileName,
  };
}
