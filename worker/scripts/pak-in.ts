// Assembles everything the desktop app needs to run the worker itself, into
// app/src-tauri/resources/worker/.
//
//   cd worker && npm run pak-in
//
// Three pieces end up there:
//   node.exe      the runtime, copied from whatever Node built this. Shipping
//                 it is the only way an installed copy can be relied on to
//                 work -- an end user has no Node, and "install Node first" is
//                 exactly the manual step this whole change removes.
//   worker.cjs    the bundle from bundel.ts.
//   node_modules/ playwright + playwright-core only. They stay unbundled
//                 because they resolve their driver and browser binaries
//                 relative to their own package directory; Node's upward
//                 node_modules lookup from worker.cjs finds them here.
//
// Chromium itself is NOT copied. Playwright keeps it in a per-user cache
// (%LOCALAPPDATA%\ms-playwright), it is ~150 MB, and it is only needed for the
// review screenshots and the Shopify automation -- so it is fetched on first
// use instead of tripling the installer for everyone.

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { execPath } from "node:process";
import path from "node:path";

const DOEL = path.resolve("..", "app", "src-tauri", "resources", "worker");

async function grootte(pad: string): Promise<string> {
  const { size } = await stat(pad);
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

await rm(DOEL, { recursive: true, force: true });
await mkdir(path.join(DOEL, "node_modules"), { recursive: true });

await cp("dist-bundel/worker.cjs", path.join(DOEL, "worker.cjs"));
console.log(`worker.cjs      ${await grootte(path.join(DOEL, "worker.cjs"))}`);

await cp(execPath, path.join(DOEL, "node.exe"));
console.log(`node.exe        ${await grootte(path.join(DOEL, "node.exe"))}  (van ${execPath})`);

for (const pakket of ["playwright", "playwright-core"]) {
  await cp(path.join("node_modules", pakket), path.join(DOEL, "node_modules", pakket), {
    recursive: true,
  });
  console.log(`node_modules/${pakket}`);
}

console.log(`\nKlaar: ${DOEL}`);
