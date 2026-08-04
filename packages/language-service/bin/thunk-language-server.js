#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

if (process.argv.includes("--version")) {
  const pkg = require("../package.json");
  console.log(pkg.version ?? "0.0.0");
} else {
  await import(join(__dirname, "../dist/server.js"));
}
