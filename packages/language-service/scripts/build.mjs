import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

const ctx = await esbuild.context({
  entryPoints: {
    server: join(root, "src/server.ts"),
  },
  bundle: true,
  outfile: undefined,
  outdir: join(root, "dist"),
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify,
  external: ["typescript"],
  define: { "process.env.NODE_ENV": '"production"' },
});

if (watch) {
  await ctx.watch();
  console.log("watching language-service server…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("built language-service dist/server.js");
}
