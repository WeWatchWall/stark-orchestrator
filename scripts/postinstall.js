/**
 * postinstall.js – Links workspace packages so @stark-o/* imports resolve
 * when the mono-repo is installed outside a pnpm workspace
 * (e.g.  npm install -g stark-os).
 *
 * In a development checkout managed by pnpm, the workspace protocol
 * (`workspace:*`) already handles resolution, so this script exits early.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const packagesDir = join(rootDir, "packages");
const nodeModulesDir = join(rootDir, "node_modules");

// ---------------------------------------------------------------------------
// Guard: skip when running inside a pnpm workspace (dev checkout)
// ---------------------------------------------------------------------------
const pnpmLockExists = existsSync(join(rootDir, "pnpm-lock.yaml"));
const pnpmStoreExists = existsSync(join(nodeModulesDir, ".pnpm"));

if (pnpmLockExists && pnpmStoreExists) {
  console.log("[postinstall] pnpm workspace detected – skipping manual linking.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Discover workspace packages
// ---------------------------------------------------------------------------
if (!existsSync(packagesDir)) {
  // Nothing to link (e.g. partial install or CI artefact).
  process.exit(0);
}

const dirs = readdirSync(packagesDir, { withFileTypes: true }).filter((d) =>
  d.isDirectory(),
);

let linked = 0;

for (const dir of dirs) {
  const pkgJsonPath = join(packagesDir, dir.name, "package.json");
  if (!existsSync(pkgJsonPath)) continue;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    console.warn(`[postinstall] could not parse ${pkgJsonPath} – skipping.`);
    continue;
  }

  if (!pkg.name || pkg.private) continue;

  // e.g. "@stark-o/core" → scope = "@stark-o", name = "core"
  const parts = pkg.name.split("/");
  const scope = parts.length === 2 ? parts[0] : null;
  const shortName = parts.length === 2 ? parts[1] : pkg.name;

  const scopeDir = scope ? join(nodeModulesDir, scope) : nodeModulesDir;
  const linkPath = join(scopeDir, shortName);
  const target = join(packagesDir, dir.name);

  // Ensure the scope directory exists (e.g. node_modules/@stark-o)
  mkdirSync(scopeDir, { recursive: true });

  // If the path already exists, decide whether to replace it.
  if (existsSync(linkPath) || lstatExistsSafe(linkPath)) {
    try {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        // Remove stale symlink so we can recreate it.
        unlinkSync(linkPath);
      } else {
        // Real directory – npm may have hoisted it; leave it alone.
        console.log(
          `[postinstall] ${pkg.name} already exists as a directory – skipping.`,
        );
        continue;
      }
    } catch {
      // lstat failed – path is dangling or inaccessible; try to remove.
      try {
        unlinkSync(linkPath);
      } catch {
        /* best-effort */
      }
    }
  }

  // Create the symlink.
  // On Windows, use "junction" so no admin privileges are required.
  const type = platform() === "win32" ? "junction" : "dir";

  try {
    symlinkSync(target, linkPath, type);
    console.log(`[postinstall] linked ${pkg.name} → packages/${dir.name}`);
    linked++;
  } catch (err) {
    console.warn(`[postinstall] failed to link ${pkg.name}: ${err.message}`);
  }
}

console.log(
  `[postinstall] done – ${linked} workspace package(s) linked.`,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe lstat check for dangling symlinks (existsSync returns false for them). */
function lstatExistsSafe(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}
