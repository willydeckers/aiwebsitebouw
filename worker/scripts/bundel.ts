// Bundles the worker into one file so it can ship inside the desktop app.
//
// The app is useless without this process: research, generatie, review and the
// Shopify jobs all run here. Until now it had to be started by hand from a
// checkout, which is why jobs sat in the queue for three weeks without anyone
// being able to tell "queued" from "nothing is running".
//
// Playwright stays external. It resolves its driver and browser binaries from
// its own package directory at runtime, so bundling its JS would leave those
// lookups pointing into a file that no longer exists. It is copied next to the
// bundle instead, by copieer-runtime.ts.

import { build } from "esbuild";
import { rm } from "node:fs/promises";

const UIT = "dist-bundel";

await rm(UIT, { recursive: true, force: true });

const resultaat = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  // Matches the Node we ship as the sidecar. Bundling for an older target
  // would silently down-level syntax this runtime handles natively.
  target: "node22",
  // CommonJS, not ESM: the bundle is loaded by a bare `node worker.cjs` with
  // no package.json beside it to declare module type.
  format: "cjs",
  outfile: `${UIT}/worker.cjs`,
  external: ["playwright", "playwright-core"],
  // The worker logs to stdout and its messages are read by a human; keeping
  // names intact means a stack trace still says which function threw.
  keepNames: true,
  metafile: true,
  logLevel: "info",
});

const bytes = Object.values(resultaat.metafile.outputs)[0]?.bytes ?? 0;
console.log(`worker.cjs: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
