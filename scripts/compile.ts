#!/usr/bin/env bun
/**
 * Compile a .thunk file to TypeScript and optionally run it.
 *
 *   bun scripts/compile.ts examples/control-flow.thunk
 *   bun scripts/compile.ts examples/control-flow.thunk --run
 */

import { lowerThunkSource } from "../packages/language-core/src/index";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const shouldRun = args.includes("--run");
const inputArg = args.find((a) => !a.startsWith("-"));

if (!inputArg) {
  console.error("Usage: bun scripts/compile.ts <file.thunk> [--run]");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const inputPath = path.resolve(inputArg);
const source = fs.readFileSync(inputPath, "utf8");

const outDir = path.join(path.dirname(inputPath), "out");
fs.mkdirSync(outDir, { recursive: true });

const base = path.basename(inputPath, ".thunk");
const outPath = path.join(outDir, `${base}.compiled.ts`);

const runtimePath = path.relative(
  outDir,
  path.join(root, "packages/runtime/src/index.ts"),
).replaceAll("\\", "/");
const runtimeImport = runtimePath.startsWith(".")
  ? runtimePath
  : `./${runtimePath}`;

const lowered = lowerThunkSource(source, inputPath, {
  runtimeImportPath: runtimeImport,
});

const banner = `/**\n * Generated from ${path.relative(root, inputPath)}\n * Do not edit — re-run: bun scripts/compile.ts ${path.relative(root, inputPath)}\n */\n\n`;

fs.writeFileSync(outPath, banner + lowered.generatedText);

console.log(`compiled → ${path.relative(root, outPath)}`);

if (shouldRun) {
  console.log(`\n--- running ${path.relative(root, outPath)} ---\n`);
  const proc = Bun.spawn(["bun", "run", outPath], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}
