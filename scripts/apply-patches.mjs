// Version-gated patch application (runs as `postinstall`).
//
// patch-package's own default is BEST-EFFORT: it will apply a patch to a
// package whose installed version differs from the one in the patch filename
// and merely print a warning (see node_modules/patch-package applyPatches.js).
// We don't want that. The whatsapp-web.js patch (patches/whatsapp-web.js+
// 1.34.7.patch) fixes the WA Web `_serialized` -> `$1` message-key rename
// (PR #201848) and is pinned to 1.34.7. On any OTHER version it must be
// reconciled by hand — deleted if the upstream fix has shipped, or regenerated
// against the new version — never blindly applied.
//
// So this wrapper applies each patch ONLY when the target package is at the
// EXACT version encoded in the patch filename; version-mismatched patches are
// hard-skipped with a loud reminder. Matched patches are applied with
// --error-on-fail (at the correct version, a failure is a real problem worth
// failing the install over).

import { readdirSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchesDir = join(root, 'patches');
const patchPackageBin = join(root, 'node_modules', 'patch-package', 'index.js');

let patchFiles;
try {
  patchFiles = readdirSync(patchesDir).filter((f) => f.endsWith('.patch'));
} catch {
  process.exit(0); // no patches/ dir -> nothing to do
}
if (patchFiles.length === 0) process.exit(0);

const installedVersionOf = (pkg) => {
  try {
    const pkgJson = join(root, 'node_modules', ...pkg.split('/'), 'package.json');
    return JSON.parse(readFileSync(pkgJson, 'utf8')).version;
  } catch {
    return undefined;
  }
};

const matched = [];
for (const file of patchFiles) {
  // patch-package filename: "<pkg>+<version>.patch"
  // (scoped: "@scope+name+version.patch")
  const parts = file.replace(/\.patch$/, '').split('+');
  const version = parts.pop();
  const pkg = parts.join('/'); // "name" or "@scope/name"
  const installed = installedVersionOf(pkg);

  if (installed === version) {
    matched.push(file);
  } else {
    console.warn(
      `[apply-patches] SKIP ${file}: ${pkg} is ${installed ?? 'not installed'}, ` +
        `patch is pinned to ${version}. Reconcile it — delete the patch if the ` +
        `upstream fix has shipped, else regenerate with ` +
        `\`npx patch-package ${pkg}\`.`,
    );
  }
}

if (matched.length === 0) process.exit(0);

// Apply only the version-matched patches. Feed them to patch-package from a
// throwaway dir so patches/ itself is never mutated (a killed process can't
// leave half-renamed files behind). patch-package resolves --patch-dir against
// the project root and rejects absolute paths, so the dir must live inside the
// project and be passed as a root-relative, forward-slashed path.
const cacheParent = join(root, 'node_modules', '.cache');
mkdirSync(cacheParent, { recursive: true });
const gatedDir = mkdtempSync(join(cacheParent, 'pp-gated-'));
try {
  for (const file of matched) {
    copyFileSync(join(patchesDir, file), join(gatedDir, file));
  }
  const relPatchDir = relative(root, gatedDir).split('\\').join('/');
  execFileSync(
    process.execPath,
    [patchPackageBin, '--patch-dir', relPatchDir, '--error-on-fail'],
    { cwd: root, stdio: 'inherit' },
  );
} finally {
  rmSync(gatedDir, { recursive: true, force: true });
}
