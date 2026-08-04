/**
 * M0 proof: parse → lower → TypeScript quick info → mapped hover.
 *
 * Success criterion (docs/ARCHITECTURE.md):
 *   hover on a binding introduced by `run` shows the correct TypeScript type.
 */

import path from "node:path";
import { lowerThunkSource } from "../packages/language-core/src/index";
import {
  createThunkProject,
  hoverAtOffset,
} from "../packages/language-service/src/index";

const root = path.resolve(import.meta.dirname, "..");
const fileName = path.join(root, "examples/basic.thunk");
const typesPath = path.join(root, "packages/types/src/index.ts");
const runtimePath = path.join(root, "packages/runtime/src/index.ts");

const source = `const random = thunk {
  return Math.random()
}

const program = thunk {
  const value = run random
  return value * 2
}
`;

const lowered = lowerThunkSource(source, fileName, {
  runtimeImportPath: runtimePath,
});

console.log("=== Lowered TypeScript ===\n");
console.log(lowered.generatedText);

const project = createThunkProject({
  files: { [fileName]: source },
  runtimeImportPath: runtimePath,
  moduleMap: {
    "@thunk/types": typesPath,
    "@thunk/runtime": runtimePath,
  },
});

console.log("\n=== Diagnostics ===");
for (const d of project.getDiagnostics(fileName)) {
  console.log(" -", d);
}

const nameOffset = source.indexOf("const value") + "const ".length;
const hover = hoverAtOffset(project, fileName, source, nameOffset);

console.log("\n=== Hover on `value` (from `const value = run random`) ===");
if (!hover || !hover.displayString) {
  console.error("FAIL: no hover result");
  console.error("diagnostics:", hover?.diagnostics);
  console.error("snippet:", hover?.generatedSnippet);
  process.exit(1);
}

console.log("display:", hover.displayString);
console.log("at generated:", hover.generatedPosition);

if (!/number/i.test(hover.displayString)) {
  console.error("FAIL: expected hover type to mention number, got:", hover.displayString);
  process.exit(1);
}

console.log("\nOK — M0 hover mapping works.");
