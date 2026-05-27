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

    // The requested crop rect, in rotated-image pixel space. With free panning /
    // zoom-out the client can hand us a rect that runs past the image edges; the
    // uncovered margins are filled with white below (matching the rotation fill),
    // so the render is faithful to the editor preview instead of being clamped.
    let R: { left: number; top: number; width: number; height: number };
    if (extract) {
      R = {
        left: Math.round(extract.left),
        top: Math.round(extract.top),
        width: Math.max(1, Math.round(extract.width)),
        height: Math.max(1, Math.round(extract.height)),
      };
    } else {
      // No crop supplied (slot never opened) → centre cover-crop to output aspect.
      const targetAspect = outW / outH;
      let cw = rotW;
      let ch = Math.round(rotW / targetAspect);
      if (ch > rotH) {
        ch = rotH;
        cw = Math.round(rotH * targetAspect);
      }
      const width = Math.max(1, Math.min(cw, rotW));
      const height = Math.max(1, Math.min(ch, rotH));
      R = { left: Math.round((rotW - width) / 2), top: Math.round((rotH - height) / 2), width, height };
    }

    // The part of the requested rect that actually overlaps the image.
    const iLeft = Math.max(0, R.left);
    const iTop = Math.max(0, R.top);
    const iW = Math.min(rotW, R.left + R.width) - iLeft;
    const iH = Math.min(rotH, R.top + R.height) - iTop;

    const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
    let pipeline = sharp(sourceAbs, sharpOpts).autoOrient();
    if (flipV) pipeline = pipeline.flip(); // vertical flip
    if (flipH) pipeline = pipeline.flop(); // horizontal mirror
    if (rotation % 360 !== 0) {
      pipeline = pipeline.rotate(rotation, { background: WHITE });
    }

    let out: ReturnType<typeof sharp>;
    if (iW <= 0 || iH <= 0) {
      // Rect lies entirely off the image → a blank white slot.
      out = sharp({ create: { width: outW, height: outH, channels: 3, background: WHITE } });
    } else if (iLeft === R.left && iTop === R.top && iW === R.width && iH === R.height) {
      // Fully in-bounds (the common case) → straight extract + resize, no compositing.
      out = pipeline.extract({ left: iLeft, top: iTop, width: iW, height: iH }).resize(outW, outH, { fit: 'fill' });
    } else {
      // Partly out of bounds → resize just the visible region and lay it onto a white
      // canvas at the matching offset, so the empty margins are preserved 1:1.
      const sx = outW / R.width;
      const sy = outH / R.height;
      const dx = clampInt((iLeft - R.left) * sx, 0, Math.max(0, outW - 1));
      const dy = clampInt((iTop - R.top) * sy, 0, Math.max(0, outH - 1));
      const dw = Math.min(Math.max(1, Math.round(iW * sx)), outW - dx);
      const dh = Math.min(Math.max(1, Math.round(iH * sy)), outH - dy);
      const regionBuf = await pipeline
        .extract({ left: iLeft, top: iTop, width: iW, height: iH })
        .resize(dw, dh, { fit: 'fill' })
        .toBuffer();
      out = sharp({ create: { width: outW, height: outH, channels: 3, background: WHITE } }).composite([
        { input: regionBuf, left: dx, top: dy },
      ]);
    }

    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await out.jpeg({ quality: 90, mozjpeg: true }).toFile(tmpPath);
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
