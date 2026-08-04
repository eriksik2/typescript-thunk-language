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

const valueOffset = source.indexOf("const value") + "const ".length;
const valueHover = hoverAtOffset(project, fileName, source, valueOffset);

console.log("\n=== Hover on `value` (from `const value = run random`) ===");
if (!valueHover || !valueHover.displayString) {
  console.error("FAIL: no hover result for value");
  console.error("diagnostics:", valueHover?.diagnostics);
  console.error("snippet:", valueHover?.generatedSnippet);
  process.exit(1);
}

console.log("display:", valueHover.displayString);
console.log("at generated:", valueHover.generatedPosition);

if (!/number/i.test(valueHover.displayString)) {
  console.error(
    "FAIL: expected hover type to mention number, got:",
    valueHover.displayString,
  );
  process.exit(1);
}

const randomOffset = source.indexOf("const random") + "const ".length;
const randomHover = hoverAtOffset(project, fileName, source, randomOffset);

console.log("\n=== Hover on `random` (thunk binding) ===");
if (!randomHover || !randomHover.displayString) {
  console.error("FAIL: no hover result for random");
  console.error("diagnostics:", randomHover?.diagnostics);
  process.exit(1);
}

console.log("display:", randomHover.displayString);

if (/RuntimeThunk/i.test(randomHover.displayString)) {
  console.error(
    "FAIL: hover still shows RuntimeThunk; expected Thunk, got:",
    randomHover.displayString,
  );
  process.exit(1);
}

if (!/Thunk/i.test(randomHover.displayString)) {
  console.error(
    "FAIL: expected hover type to mention Thunk, got:",
    randomHover.displayString,
  );
  process.exit(1);
}

if (!/^const random: Thunk<number>$/m.test(randomHover.displayString.trim())) {
  // Allow multiline pretty form; primary line must be Thunk<number> without EmptyProtocols
  const prettyOk =
    randomHover.displayString.includes("Thunk<number>") &&
    !randomHover.displayString.includes("EmptyProtocols") &&
    !/RuntimeThunk/i.test(randomHover.displayString);
  if (!prettyOk) {
    console.error(
      "FAIL: expected pretty Thunk<number> without EmptyProtocols, got:",
      randomHover.displayString,
    );
    process.exit(1);
  }
}

console.log("\nOK — hover shows number for run binding and pretty Thunk<number> for thunk.");


