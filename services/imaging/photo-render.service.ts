/**
 * Native photo render service (Phase 4) — produces a Dolphin-named view image in
 * the flat `working/` directory from a source original + a transform spec, using
 * sharp. Output is byte-compatible with Dolphin's export, so the existing photo
 * grid / portal render it unchanged (see `services/imaging/index.ts` getImageSizes
 * and the `/DolImgs` static mount).
 *
 * Transform contract (client preview must agree on this order — see the plan):
 *   autoOrient (EXIF) → flip/flop → rotate(angle) → extract(rect) → resize(fill) → jpeg
 * The client (react-easy-crop) pre-flips the source it crops against, so the
 * `extract` rect arrives in the same flipped+rotated space the server extracts from.
 */
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import config from '../../config/config.js';
import { createPathResolver } from '../../utils/path-resolver.js';
import { getFileCategory } from '../../utils/file-mime.js';
import { resolveFileForServe, FileExplorerError } from '../files/file-explorer.service.js';
import { log } from '../../utils/logger.js';

/** The 8 fixed Dolphin view-code slots. Defense-in-depth: only these reach a filename. */
const ALLOWED_VIEWS = new Set(['i10', 'i12', 'i13', 'i20', 'i21', 'i22', 'i23', 'i24']);

/** Cap absurd inputs/outputs (phone photos ~40 MP are well under this). */
const MAX_INPUT_PIXELS = 300_000_000;
const MAX_OUTPUT_EDGE = 5000;

export interface RenderSlotInput {
  personId: number;
  tpCode: number;
  view: string; // 'i10' … 'i24'
  /** Path relative to clinic1/{personId}/, e.g. "Initial_01-01-2026/IMG_001.jpg". */
  sourceRelPath: string;
  flipH: boolean;
  flipV: boolean;
  rotation: number; // degrees (MVP: multiples of 90)
  /** Omit → centre cover-crop to the output aspect. */
  extract?: { left: number; top: number; width: number; height: number };
  output: { width: number; height: number };
}

const pathResolver = createPathResolver(config.fileSystem.machinePath || '');

// ── Bounded concurrency: at most MAX_CONCURRENT decodes in flight across requests.
// Pairs with per-request sequential processing in the route to cap peak RAM.
const MAX_CONCURRENT = 2;
let active = 0;
const waiters: Array<() => void> = [];
function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}
function release(): void {
  const next = waiters.shift();
  if (next) next(); // transfer the slot (active unchanged)
  else active--;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Render one slot to `working/{personId}0{tpCode}.{view}` (lowercase, matching
 * getImageSizes). Atomic temp-file + rename on the working/ volume (no EXDEV).
 * Returns the written filename.
 */
export async function renderSlotToWorking(input: RenderSlotInput): Promise<string> {
  const { personId, tpCode, view, sourceRelPath, flipH, flipV, rotation, extract, output } = input;

  // ── Validation (these values build a filename + drive a decode) ───────────────
  if (!/^\d+$/.test(String(personId))) throw new FileExplorerError('Invalid patient id', 400);
  if (!/^\d+$/.test(String(tpCode))) throw new FileExplorerError('Invalid timepoint code', 400);
  if (!ALLOWED_VIEWS.has(view)) throw new FileExplorerError(`Invalid view code: ${view}`, 400);
  if (!Number.isFinite(rotation)) throw new FileExplorerError('Invalid rotation', 400);
  const outW = clampInt(output.width, 1, MAX_OUTPUT_EDGE);
  const outH = clampInt(output.height, 1, MAX_OUTPUT_EDGE);

  // Validate + symlink-guard the source under the patient root; images only.
  const { abs: sourceAbs } = await resolveFileForServe(personId, sourceRelPath);
  if (getFileCategory(sourceRelPath) !== 'image') {
    throw new FileExplorerError('Source is not an image', 415);
  }

  const filename = `${personId}0${tpCode}.${view}`;
  const destAbs = pathResolver(`working/${filename}`);
  const tmpPath = `${destAbs}.tmp-${process.pid}-${Date.now()}`;

  await acquire();
  try {
    const sharpOpts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' as const };

    // Dimensions AFTER EXIF auto-orient + the requested rotation, to clamp the rect.
    const meta = await sharp(sourceAbs, sharpOpts).metadata();
    if (!meta.width || !meta.height) throw new FileExplorerError('Unreadable image', 415);
    let w = meta.width;
    let h = meta.height;
    if (meta.orientation && meta.orientation >= 5) [w, h] = [h, w]; // EXIF 90° swap
    const rad = (rotation * Math.PI) / 180;
    const rotW = Math.round(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
    const rotH = Math.round(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));

    let left: number;
    let top: number;
    let width: number;
    let height: number;
    if (extract) {
      left = clampInt(extract.left, 0, Math.max(0, rotW - 1));
      top = clampInt(extract.top, 0, Math.max(0, rotH - 1));
      width = clampInt(extract.width, 1, rotW - left);
      height = clampInt(extract.height, 1, rotH - top);
    } else {
      // No crop supplied (slot never opened) → centre cover-crop to output aspect.
      const targetAspect = outW / outH;
      let cw = rotW;
      let ch = Math.round(rotW / targetAspect);
      if (ch > rotH) {
        ch = rotH;
        cw = Math.round(rotH * targetAspect);
      }
      width = Math.max(1, Math.min(cw, rotW));
      height = Math.max(1, Math.min(ch, rotH));
      left = Math.round((rotW - width) / 2);
      top = Math.round((rotH - height) / 2);
    }

    let pipeline = sharp(sourceAbs, sharpOpts).autoOrient();
    if (flipV) pipeline = pipeline.flip(); // vertical flip
    if (flipH) pipeline = pipeline.flop(); // horizontal mirror
    if (rotation % 360 !== 0) {
      pipeline = pipeline.rotate(rotation, { background: { r: 255, g: 255, b: 255, alpha: 1 } });
    }
    pipeline = pipeline
      .extract({ left, top, width, height })
      .resize(outW, outH, { fit: 'fill' })
      .jpeg({ quality: 90, mozjpeg: true });

    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await pipeline.toFile(tmpPath);
    await fs.rename(tmpPath, destAbs);

    log.info('[PhotoEditor] rendered view', { personId, tpCode, view, filename });
    return filename;
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    if (err instanceof FileExplorerError) throw err;
    log.warn('[PhotoEditor] render failed', {
      personId,
      tpCode,
      view,
      error: (err as Error).message,
    });
    throw new FileExplorerError(`Could not render view ${view}`, 422);
  } finally {
    release();
  }
}
