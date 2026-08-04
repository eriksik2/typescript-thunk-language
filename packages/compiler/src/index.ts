/**
 * Compiler API — same lowering as the language service / CLI.
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
