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
 *
 * Execution rearranges that contract algebraically so the flips never touch the
 * full-resolution image. With D = extract_R(rotate_θ(flip(I))), the conjugation
 * rotate_θ∘flip = flip∘rotate_θeff (θeff = −θ when exactly ONE flip is active;
 * θeff = θ for none/both — two flips are a 180° rotation, which commutes) and
 * extract_R∘flip = flip∘extract_M (M = R mirrored inside the rotated bounding
 * box) give:  D = flip( extract_M( rotate_θeff(I) ) ).
 * So pipeline A (rotate→extract→resize, NO flips — the order sharp honours)
 * produces the OUTPUT-sized region, and a tiny pipeline B flips that result.
 * This replaced materialising the whole flipped image to a lossless buffer (a
 * full-res PNG encode/decode per flipped slot — and the occlusal views default
 * to a flip, so that was the common case).
 */
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { VIEW_CODES } from '../../shared/photo-views.js';
import { getFileCategory } from '../../utils/file-mime.js';
import { workingFilePath } from '../files/clinic-paths.js';
import { resolveFileForServe, FileExplorerError } from '../files/file-explorer.service.js';
import { log } from '../../utils/logger.js';

/** The 8 fixed Dolphin view-code slots. Defense-in-depth: only these reach a filename. */
const ALLOWED_VIEWS = new Set<string>(VIEW_CODES);

/** Cap absurd inputs/outputs (phone photos ~40 MP are well under this). */
const MAX_INPUT_PIXELS = 300_000_000;
const MAX_OUTPUT_EDGE = 8000;

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
  /**
   * Natural (EXIF-oriented, un-rotated) pixel size of the media the client
   * cropped against. In "Fast proxy" mode that's the 2048 thumbnail, so the
   * `extract` rect arrives in proxy space and is scaled up to source space
   * here. Omitted / equal to the source dims → no scaling (Original mode).
   */
  cropSpace?: { width: number; height: number };
}

// Cap libvips' per-pipeline thread pool (process-wide, set once at import). Its default
// is one thread per CPU core, which — times the MAX_CONCURRENT pipelines below — pegs
// every core during a save and starves the Node event loop, so the whole app (SSE
// heartbeats, route loaders, image serving) stalls and appears frozen. One thread per
// pipeline keeps renders off the critical path; now that renders run in the background
// (see photo-editor.routes.ts), a little more wall-clock per image is a fine trade for
// a server that stays responsive to everyone else mid-save.
sharp.concurrency(1);

// Release libvips' operation cache between pipelines. Its default retains up to
// ~50 MB / 100 ops across renders to speed repeated work — but this clinic renders
// photos intermittently, so that's just idle resident memory. Drop it; the per-render
// cost is negligible against keeping the process lean.
sharp.cache(false);

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
  const { personId, tpCode, view, sourceRelPath, flipH, flipV, rotation, extract, output, cropSpace } = input;

  // ── Validation (these values build a filename + drive a decode) ───────────────
  if (!/^\d+$/.test(String(personId))) throw new FileExplorerError('Invalid patient id', 400);
  if (!/^\d+$/.test(String(tpCode))) throw new FileExplorerError('Invalid timepoint code', 400);
  if (!ALLOWED_VIEWS.has(view)) throw new FileExplorerError(`Invalid view code: ${view}`, 400);
  if (!Number.isFinite(rotation)) throw new FileExplorerError('Invalid rotation', 400);
  // VIEW_OUTPUT (from the client) supplies the per-view ASPECT only. The saved view
  // keeps the crop's NATIVE pixel resolution — no upscaling, no downscaling — so it
  // carries the original's full detail; see the outW/outH derivation below, once the
  // crop rect R (and thus its native pixel size) is known.
  const aspect = output.width / output.height;

  // Validate + symlink-guard the source under the patient root; images only.
  const { abs: sourceAbs } = await resolveFileForServe(personId, sourceRelPath);
  if (getFileCategory(sourceRelPath) !== 'image') {
    throw new FileExplorerError('Source is not an image', 415);
  }

  const filename = `${personId}0${tpCode}.${view}`;
  const destAbs = workingFilePath(filename);
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

    // The requested crop rect, in flipped+rotated client pixel space. With free
    // panning / zoom-out the client can hand us a rect that runs past the image
    // edges; the uncovered margins are filled with white below (matching the
    // rotation fill), so the render is faithful to the editor preview instead of
    // being clamped.
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
      const targetAspect = aspect;
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

    // Proxy-space rect → source-space rect. MUST run before the mirror below
    // (the mirror works in full-image rotW/rotH) and before the intersection /
    // clamp math. The client crops against an EXIF-oriented preview, so cropSpace
    // compares against the post-orient (w, h); the rect itself lives in ROTATED
    // space, so the scale factors come from the two rotated bounding boxes.
    if (extract && cropSpace && (cropSpace.width !== w || cropSpace.height !== h)) {
      const proxyRotW = Math.round(
        Math.abs(cropSpace.width * Math.cos(rad)) + Math.abs(cropSpace.height * Math.sin(rad))
      );
      const proxyRotH = Math.round(
        Math.abs(cropSpace.width * Math.sin(rad)) + Math.abs(cropSpace.height * Math.cos(rad))
      );
      if (proxyRotW > 0 && proxyRotH > 0) {
        const scaleX = rotW / proxyRotW;
        const scaleY = rotH / proxyRotH;
        R = {
          left: Math.round(R.left * scaleX),
          top: Math.round(R.top * scaleY),
          width: Math.max(1, Math.round(R.width * scaleX)),
          height: Math.max(1, Math.round(R.height * scaleY)),
        };
      }
    }

    // Move the flips off the full-res image (see the header contract): mirror R
    // into the UN-flipped rotated space and negate the angle when exactly one
    // flip is active; a small post-pass (pipeline B below) flips the output-sized
    // result back. rotW/rotH are unchanged by the negation (|cos|,|sin| are even).
    const hasFlip = flipH || flipV;
    const thetaEff = flipH !== flipV ? -rotation : rotation;
    if (flipH) R.left = rotW - R.left - R.width;
    if (flipV) R.top = rotH - R.top - R.height;

    // Output = the crop's NATIVE pixel size: no upscaling, no downscaling. The extract
    // hands us exactly R.width×R.height source pixels and we write them 1:1, so the saved
    // view keeps the original's full resolution. Only a pathological zoom-out canvas (R
    // far larger than the source) is bounded by MAX_OUTPUT_EDGE, scaling both sides
    // together so the aspect ratio is preserved.
    const longEdge = Math.max(R.width, R.height);
    const fitScale = longEdge > MAX_OUTPUT_EDGE ? MAX_OUTPUT_EDGE / longEdge : 1;
    const outW = Math.max(1, Math.round(R.width * fitScale));
    const outH = Math.max(1, Math.round(R.height * fitScale));

    // The part of the requested rect that actually overlaps the image.
    const iLeft = Math.max(0, R.left);
    const iTop = Math.max(0, R.top);
    const iW = Math.min(rotW, R.left + R.width) - iLeft;
    const iH = Math.min(rotH, R.top + R.height) - iTop;

    const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

    // Pipeline A: NO flips, ever — sharp honours rotate→extract call order, but
    // applies flip/flop at a fixed stage that ignores call order (verified against
    // sharp 0.34: `flip().extract()` extracts then mirrors — the original occlusal
    // mis-crop bug). The mirrored rect + θeff above make this single un-flipped
    // pass produce exactly the mirror image of the desired crop; pipeline B at the
    // bottom flips the output-sized result back.
    let pipeline = sharp(sourceAbs, sharpOpts).autoOrient();
    if (rotation % 360 !== 0) pipeline = pipeline.rotate(thetaEff, { background: WHITE });

    let out: ReturnType<typeof sharp>;
    let needsFlipPass = hasFlip;
    if (iW <= 0 || iH <= 0) {
      // Rect lies entirely off the image → a blank white slot (flip-invariant).
      out = sharp({ create: { width: outW, height: outH, channels: 3, background: WHITE } });
      needsFlipPass = false;
    } else if (iLeft === R.left && iTop === R.top && iW === R.width && iH === R.height) {
      // Fully in-bounds (the common case) → straight extract + resize, no compositing.
      out = pipeline.extract({ left: iLeft, top: iTop, width: iW, height: iH }).resize(outW, outH, { fit: 'fill' });
    } else {
      // Partly out of bounds → resize just the visible region and lay it onto a white
      // canvas at the matching offset, so the empty margins are preserved 1:1.
      // (Offsets are computed in the mirrored frame — pipeline B flips the whole
      // composite, which lands them at the client-space positions.)
      const sx = outW / R.width;
      const sy = outH / R.height;
      const dx = clampInt((iLeft - R.left) * sx, 0, Math.max(0, outW - 1));
      const dy = clampInt((iTop - R.top) * sy, 0, Math.max(0, outH - 1));
      const dw = Math.min(Math.max(1, Math.round(iW * sx)), outW - dx);
      const dh = Math.min(Math.max(1, Math.round(iH * sy)), outH - dy);
      const regionBuf = await pipeline
        .extract({ left: iLeft, top: iTop, width: iW, height: iH })
        .resize(dw, dh, { fit: 'fill' })
        .png() // lossless intermediate — a bare .toBuffer() re-encodes JPEG (q80), a 2nd generation of loss
        .toBuffer();
      out = sharp({ create: { width: outW, height: outH, channels: 3, background: WHITE } }).composite([
        { input: regionBuf, left: dx, top: dy },
      ]);
    }

    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    const JPEG_OPTS = { quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' } as const;
    if (needsFlipPass) {
      // Pipeline B: flip the OUTPUT-sized result of pipeline A. Must be a separate
      // sharp instance — chaining .flip() onto pipeline A (or onto the composite)
      // would run it at the wrong fixed pipeline stage (the original bug class).
      // Raw intermediate: zero codec cost, bounded by the output size (≤ MAX_OUTPUT_EDGE).
      const { data, info } = await out.raw().toBuffer({ resolveWithObject: true });
      let flipped = sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      });
      if (flipV) flipped = flipped.flip();
      if (flipH) flipped = flipped.flop();
      await flipped.jpeg(JPEG_OPTS).toFile(tmpPath);
    } else {
      await out.jpeg(JPEG_OPTS).toFile(tmpPath);
    }
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

/**
 * Delete a single rendered view file `working/{personId}0{tpCode}.{view}` (the
 * cropped output) — backs the photo editor's per-view "Remove". Idempotent: a
 * missing file is a no-op. Guards mirror renderSlotToWorking so only a valid
 * (personId, tpCode, view) can ever form the path.
 */
export async function deleteWorkingView(personId: number, tpCode: number, view: string): Promise<void> {
  if (!/^\d+$/.test(String(personId))) throw new FileExplorerError('Invalid patient id', 400);
  if (!/^\d+$/.test(String(tpCode))) throw new FileExplorerError('Invalid timepoint code', 400);
  if (!ALLOWED_VIEWS.has(view)) throw new FileExplorerError(`Invalid view code: ${view}`, 400);
  const destAbs = workingFilePath(`${personId}0${tpCode}.${view}`);
  await fs.rm(destAbs, { force: true });
  log.info('[PhotoEditor] deleted view', { personId, tpCode, view });
}
