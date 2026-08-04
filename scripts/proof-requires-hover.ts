/**
 * Proof: symbol + Requires surface hover (examples/requires.thunk shape).
 *
 * Catches regressions where TS expands typeof Database and pretty-print
 * mangled Thunk spans on `=>`, or symbol mappings broke identifier hover.
 */

import path from "node:path";
import {
  createThunkProject,
  hoverAtOffset,
} from "../packages/language-service/src/index";

const root = path.resolve(import.meta.dirname, "..");
const fileName = path.join(root, "examples/requires.thunk");
const typesPath = path.join(root, "packages/types/src/index.ts");
const runtimePath = path.join(root, "packages/runtime/src/index.ts");
const internalPath = path.join(root, "packages/runtime/src/internal.ts");

const source = `import { use, provide, layerOf } from "@thunk/runtime"

symbol Database {
  name: string
}

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}

const program: Thunk<string> = provide(
  fetchUser,
  layerOf(Database, { name: "ada" }),
)

const result = run program
`;

const project = createThunkProject({
  files: { [fileName]: source },
  moduleMap: {
    "@thunk/types": typesPath,
    "@thunk/runtime": runtimePath,
    "@thunk/runtime/internal": internalPath,
  },
});

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

const dbOffset = source.indexOf("symbol Database") + "symbol ".length;
const dbHover = hoverAtOffset(project, fileName, source, dbOffset);
console.log("=== Hover Database ===\n", dbHover?.displayString);
if (!dbHover?.displayString) fail("no hover for Database");
if (!/symbol/.test(dbHover.displayString)) fail(`expected symbol: ${dbHover.displayString}`);
if (!/name:\s*string/.test(dbHover.displayString)) {
  fail(`expected associated type: ${dbHover.displayString}`);
}
if (/__brand_|__assoc|__makeSymbol/.test(dbHover.displayString)) {
  fail(`encoding noise in Database hover: ${dbHover.displayString}`);
}

const fetchOffset = source.indexOf("const fetchUser") + "const ".length;
const fetchHover = hoverAtOffset(project, fileName, source, fetchOffset);
console.log("\n=== Hover fetchUser ===\n", fetchHover?.displayString);
if (!fetchHover?.displayString) fail("no hover for fetchUser");
if (!fetchHover.displayString.includes("Thunk<string>")) {
  fail(`expected Thunk<string>: ${fetchHover.displayString}`);
}
if (!/Requires\(Database\)/.test(fetchHover.displayString)) {
  fail(`expected Requires(Database): ${fetchHover.displayString}`);
}
if (/Protocols\s*\(|=>|__assoc|__brand_/.test(fetchHover.displayString)) {
  fail(`mangled fetchUser hover: ${fetchHover.displayString}`);
}

const programOffset = source.indexOf("const program") + "const ".length;
const programHover = hoverAtOffset(project, fileName, source, programOffset);
console.log("\n=== Hover program ===\n", programHover?.displayString);
if (!programHover?.displayString?.includes("Thunk<string>")) {
  fail(`expected Thunk<string> for program: ${programHover?.displayString}`);
}
if (/Requires\(|Protocols\s*\(|EmptyProtocols/.test(programHover.displayString)) {
  fail(`noisy program hover: ${programHover.displayString}`);
}

console.log("\nOK — requires.thunk surface hovers are pretty.");
