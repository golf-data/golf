import { build } from "esbuild";

await build({
  entryPoints: {
    index: "src/index.ts",
    http: "src/http.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  sourcemap: false,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
