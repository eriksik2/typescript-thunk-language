#!/usr/bin/env bun
/**
 * Thunk CLI — emit lowered TypeScript via language-core.
 *
 * Usage: thunk build <file> [--out <path>]
 */

import { compileThunkSource } from "./index";

function usage(): never {
  console.error("Usage: thunk build <file> [--out <path>]");
  process.exit(1);
}

/** Sibling `.thunk.ts` — same naming as `lowerThunkSource`. */
function defaultOutPath(inputPath: string): string {
  if (inputPath.endsWith(".thunk")) {
    return inputPath.replace(/\.thunk$/, ".thunk.ts");
  }
  return `${inputPath}.ts`;
}

function parseArgs(argv: string[]): { inputPath: string; outPath: string } {
  if (argv[0] !== "build" || !argv[1]) {
    usage();
  }

  const inputPath = argv[1]!;
  let outPath: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out") {
      const value = argv[++i];
      if (!value) usage();
      outPath = value;
    } else {
      usage();
    }
  }

  return { inputPath, outPath: outPath ?? defaultOutPath(inputPath) };
}

async function main(): Promise<void> {
  const { inputPath, outPath } = parseArgs(process.argv.slice(2));

  try {
    const text = await Bun.file(inputPath).text();
    const { generatedText } = compileThunkSource(text, inputPath);
    await Bun.write(outPath, generatedText);
    console.log(outPath);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

await main();
