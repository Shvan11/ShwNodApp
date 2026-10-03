/**
 * Put back the names of files that were uploaded with a non-ASCII (e.g. Arabic) name before
 * FE-F12-1 was fixed.
 *
 * WHAT HAPPENED: multer 2.x decoded every multipart `filename` as latin1 unless told otherwise,
 * while browsers send it as raw UTF-8. So `صورة المريض.txt` reached `originalname` as
 * `ØµÙØ±Ø© Ø§ÙÙØ±ÙØ¶.txt` and was saved under that name. The fix (`createUpload()` in
 * middleware/upload.ts) pins `defParamCharset: 'utf8'` for new uploads; this script repairs the
 * names already on disk.
 *
 * WHY IT IS SAFE TO DO MECHANICALLY: a latin1 mis-decode is lossless — every byte became one
 * code point below U+0100 — so `Buffer.from(name, 'latin1').toString('utf8')` gives the real name
 * back. A name is only touched when that round trip is EXACT (re-encoding the repaired name gives
 * the garbled one byte for byte) and the bytes are valid UTF-8 with no replacement character. A
 * genuine Latin-1 name (`Café.jpg`, `Ünal`) fails the UTF-8 decode and is left alone; its garbled
 * twin (`CafÃ©.jpg`) is repaired like an Arabic one. A target name that already exists is REPORTED and
 * skipped, never overwritten.
 *
 * Folder names were never affected (they travel in a JSON body), but a folder holding repaired
 * files is walked like any other. Only renames — nothing is deleted or rewritten.
 *
 *   node --env-file=.env scripts/repair-upload-names.mjs            # dry run: list what it would rename
 *   node --env-file=.env scripts/repair-upload-names.mjs --apply    # rename
 *   node --env-file=.env scripts/repair-upload-names.mjs --root <dir>   # another tree (e.g. the TV media folder)
 *
 * Default root: `<MACHINE_PATH>/clinic1` (the patient volume the file explorer writes into).
 * `.trash` and `.uploads` are skipped (trash is restore-by-hand; `.uploads` holds in-flight staging).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const APPLY = process.argv.includes('--apply');
const rootArg = (() => {
  const i = process.argv.indexOf('--root');
  return i > -1 ? process.argv[i + 1] : null;
})();

/** `MACHINE_PATH=C:` on Windows → `C:\clinic1`; under WSL the same drive is `/mnt/c/clinic1`. */
function defaultRoot() {
  const machine = process.env.MACHINE_PATH;
  if (!machine) {
    console.error('MACHINE_PATH is not set (run with --env-file=.env, or pass --root <dir>)');
    process.exit(1);
  }
  if (os.platform() !== 'win32' && /^[A-Za-z]:/.test(machine)) {
    return path.join('/mnt', machine[0].toLowerCase(), machine.slice(2).replace(/\\/g, '/'), 'clinic1');
  }
  return path.join(machine, 'clinic1');
}

const ROOT = path.resolve(rootArg ?? defaultRoot());
const SKIP_DIRS = new Set(['.trash', '.uploads']);

/** The repaired name, or null when `name` is not an exact latin1-mojibake of a UTF-8 name. */
function repairedName(name) {
  // Every code point must fit in one latin1 byte, and at least one must be non-ASCII.
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return null;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (decoded.includes('\ufffd')) return null; // not valid UTF-8 → a genuine latin1 name
  if (Buffer.from(decoded, 'utf8').toString('latin1') !== name) return null;
  return decoded;
}

const found = [];
const skipped = [];
let dirs = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    skipped.push({ path: dir, reason: `unreadable (${err.code ?? err.message})` });
    return;
  }
  dirs += 1;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (dir === ROOT && SKIP_DIRS.has(e.name)) continue;
      await walk(full);
      continue;
    }
    if (!e.isFile()) continue;
    const fixed = repairedName(e.name);
    if (fixed) found.push({ dir, from: e.name, to: fixed });
  }
}

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — scanning ${ROOT}`);
await walk(ROOT);

let renamed = 0;
for (const f of found) {
  const target = path.join(f.dir, f.to);
  const exists = await fs
    .access(target)
    .then(() => true)
    .catch(() => false);
  const rel = path.relative(ROOT, path.join(f.dir, f.from));
  if (exists) {
    skipped.push({ path: rel, reason: `target already exists: ${f.to}` });
    continue;
  }
  console.log(`  ${rel}\n    → ${f.to}`);
  if (APPLY) {
    try {
      await fs.rename(path.join(f.dir, f.from), target);
      renamed += 1;
    } catch (err) {
      skipped.push({ path: rel, reason: `rename failed (${err.code ?? err.message})` });
    }
  }
}

console.log(`\n${dirs} folders scanned · ${found.length} garbled names found · ${APPLY ? `${renamed} renamed` : 'nothing renamed (dry run)'}`);
if (skipped.length) {
  console.log(`${skipped.length} skipped:`);
  for (const s of skipped) console.log(`  ${s.path}: ${s.reason}`);
}
