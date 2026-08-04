/**
 * Convert language-core SourceMap (range pairs) into Volar CodeMapping segments.
 *
 * Resolution policy stays in language-core (most-specific overlap); this adapter
 * only changes representation so Volar can map hover/diagnostics.
 */

import type { CodeInformation, CodeMapping } from "@volar/language-core";
import {
  positionToOffset,
  type SourceMap,
} from "@thunk/language-core";

/** Features enabled on lowered TS ↔ .thunk mappings. */
export const THUNK_MAPPING_DATA: CodeInformation = {
  completion: true,
  format: false,
  navigation: true,
  semantic: true,
  structure: true,
  verification: true,
};

/**
 * Convert each Mapping to an offset-based CodeMapping segment.
 *
 * When original and generated spans differ in length, `generatedLengths` is set
 * so Volar can still translate endpoints.
 */
export function toVolarMappings(
  sourceMap: SourceMap,
  originalText: string,
  generatedText: string,
): CodeMapping[] {
  const result: CodeMapping[] = [];

  for (const mapping of sourceMap.mappings) {
    const sourceOffset = positionToOffset(originalText, mapping.original.start);
    const sourceEnd = positionToOffset(originalText, mapping.original.end);
    const generatedOffset = positionToOffset(
      generatedText,
      mapping.generated.start,
    );
    const generatedEnd = positionToOffset(
      generatedText,
      mapping.generated.end,
    );

    const sourceLength = Math.max(0, sourceEnd - sourceOffset);
    const generatedLength = Math.max(0, generatedEnd - generatedOffset);

    // Skip empty spans — they do not help mapping and confuse Volar memos.
    if (sourceLength === 0 && generatedLength === 0) continue;

    const codeMapping: CodeMapping = {
      sourceOffsets: [sourceOffset],
      generatedOffsets: [generatedOffset],
      lengths: [sourceLength === 0 ? generatedLength : sourceLength],
      data: THUNK_MAPPING_DATA,
    };

    if (sourceLength !== generatedLength && sourceLength > 0 && generatedLength > 0) {
      codeMapping.generatedLengths = [generatedLength];
      codeMapping.lengths = [sourceLength];
    } else if (sourceLength === 0 && generatedLength > 0) {
      // Generated-only glue (e.g. inserted `defer(`); pin to a zero-width source.
      codeMapping.lengths = [0];
      codeMapping.generatedLengths = [generatedLength];
    } else if (generatedLength === 0 && sourceLength > 0) {
      codeMapping.lengths = [sourceLength];
      codeMapping.generatedLengths = [0];
    }

    result.push(codeMapping);
  }

  return result;
}
