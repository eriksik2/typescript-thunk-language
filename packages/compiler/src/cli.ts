#!/usr/bin/env bun
/**
 * Thunk CLI — emit lowered TypeScript / run via Bun.
 *
 * Usage:
 *   thunk build <file> [--out <path>]
 *   thunk run <file.thunk>
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { compileThunkSource } from "./index";

function usage(): never {
  console.error(`Usage:
  thunk build <file> [--out <path>]
  thunk run <file.thunk>`);
  process.exit(1);
}

/** Sibling `.thunk.ts` — same naming as `lowerThunkSource`. */
function defaultOutPath(inputPath: string): string {
  if (inputPath.endsWith(".thunk")) {
    return inputPath.replace(/\.thunk$/, ".thunk.ts");
  }
  return `${inputPath}.ts`;
}

async function build(argv: string[]): Promise<void> {
  if (!argv[0]) usage();
  const inputPath = argv[0]!;
  let outPath: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out") {
      const value = argv[++i];
      if (!value) usage();
      outPath = value;
    } else {
      usage();
    }
  }

  const resolvedOut = outPath ?? defaultOutPath(inputPath);
  const text = await Bun.file(inputPath).text();
  const { generatedText } = compileThunkSource(text, inputPath);
  await Bun.write(resolvedOut, generatedText);
  console.log(resolvedOut);
}

async function run(argv: string[]): Promise<void> {
  if (!argv[0] || argv.length > 1) usage();
  const inputPath = path.resolve(argv[0]!);
  const outPath = defaultOutPath(inputPath);

  try {
    const text = await Bun.file(inputPath).text();
    const { generatedText } = compileThunkSource(text, inputPath);
    await Bun.write(outPath, generatedText);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const child = spawn("bun", [outPath], {
    stdio: "inherit",
    cwd: path.dirname(outPath),
  });

  const code: number = await new Promise((resolve) => {
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
    child.on("error", () => resolve(1));
  });
  process.exit(code);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === "build") {
    await build(argv.slice(1));
  } else if (cmd === "run") {
    await run(argv.slice(1));
  } else {
    usage();
  }
}

await main();
