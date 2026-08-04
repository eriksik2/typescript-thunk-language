import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

const ctx = await esbuild.context({
  entryPoints: {
    extension: join(root, "src/extension.ts"),
    server: join(
      root,
      "../language-service/src/server.ts",
    ),
  },
  bundle: true,
  outdir: join(root, "dist"),
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify,
  external: ["vscode"],
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "umd2esm",
      setup(build) {
        build.onResolve(
          { filter: /^(vscode-.*-languageservice|jsonc-parser)/ },
          (args) => {
            const pathUmdMay = require.resolve(args.path, {
              paths: [args.resolveDir],
            });
            const pathEsm = pathUmdMay
              .replace("/umd/", "/esm/")
              .replace("\\umd\\", "\\esm\\");
            return { path: pathEsm };
          },
        );
      },
    },
  ],
});

if (watch) {
  await ctx.watch();
  console.log("watching vscode extension…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("built packages/vscode/dist/{extension,server}.js");
}
