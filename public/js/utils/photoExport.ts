/**
 * Taking a rendered patient photo OUT of the app from the gallery grid: onto the
 * clipboard, into a named `.jpg`, or — a whole session — into one zip.
 *
 * A render is JPEG bytes under a Dolphin name (`10060.i13`), which neither Explorer
 * nor PowerPoint recognises, and the grid cell itself only shows a 480px thumbnail.
 * Everything here works from the full-resolution render and gives it a name a person
 * can file: `{patient}_{session}_{view}.jpg`.
 */
import { viewLabel } from '@shared/photo-views';

/** Characters Windows refuses in a file name, and control characters. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
const ILLEGAL_IN_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** One part of a file name: no path or reserved characters, no trailing dot or space
 *  (Windows drops those silently, so two different names would collide). */
function safePart(part: string | null | undefined): string {
    return (part ?? '')
        .replace(ILLEGAL_IN_FILE_NAME, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '');
}

export interface PhotoNameParts {
    patientName: string | null | undefined;
    /** The session the way its originals folder is named: `Initial_01-01-2026`. */
    session: string | null | undefined;
}

/** `Ahmed Ali_Initial_01-01-2026` — what every file exported from one session starts
 *  with, and the name of its zip. Empty when neither part is known. */
export function sessionBaseName({ patientName, session }: PhotoNameParts): string {
    return [patientName, session].map(safePart).filter(Boolean).join('_');
}

/** `Ahmed Ali_Initial_01-01-2026_Smile.jpg`. */
export function photoFileName(parts: PhotoNameParts, view: string): string {
    return `${[sessionBaseName(parts), viewLabel(view)].filter(Boolean).join('_')}.jpg`;
}

/** `Ahmed Ali_Initial_01-01-2026.zip`. */
export function sessionZipName(parts: PhotoNameParts): string {
    return `${sessionBaseName(parts) || 'photos'}.zip`;
}

/** A black bar over the eyes, as fractions of the photo's height. */
export interface EyeBar {
    top: number;
    height: number;
}

/** Matches the render service's own JPEG quality, for the one case a photo is
 *  re-encoded here (an eye bar drawn in). */
const JPEG_QUALITY = 0.95;

/**
 * Longest edge of a COPIED picture, in pixels. The clipboard takes PNG only, and a PNG
 * of a photograph is several times its JPEG: a full 3665×4227 render was 18.5 MB on the
 * clipboard against 3.4 MB on disk. Copy is the quick route into a slide, where this is
 * still more than a 4K screen shows; Download keeps the render's full resolution.
 */
export const COPY_MAX_EDGE = 3000;

/** `width`×`height` scaled DOWN so neither edge exceeds `maxEdge` — never up. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function fetchRender(url: string): Promise<Blob> {
    // eslint-disable-next-line no-restricted-syntax -- a raw image read as a Blob for the clipboard / a download, not a JSON API call
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Photo request failed (${response.status})`);
    const blob = await response.blob();
    return blob.type === 'image/jpeg' ? blob : blob.slice(0, blob.size, 'image/jpeg');
}

/** Decode `source` and encode it again as `type` — with the eye bar drawn in if asked,
 *  and scaled down to `maxEdge` if given. */
async function redraw(
    source: Blob,
    type: 'image/png' | 'image/jpeg',
    { eyeBar, maxEdge }: { eyeBar?: EyeBar | null; maxEdge?: number } = {}
): Promise<Blob> {
    const bitmap = await createImageBitmap(source);
    try {
        const { width, height } = maxEdge ? fitWithin(bitmap.width, bitmap.height, maxEdge) : bitmap;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        if (eyeBar) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, Math.round(height * eyeBar.top), width, Math.round(height * eyeBar.height));
        }
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
                type,
                JPEG_QUALITY
            );
        });
    } finally {
        bitmap.close();
    }
}

/** The render as a JPEG: its stored bytes, untouched unless an eye bar has to be drawn in. */
export async function photoAsJpeg(url: string, eyeBar?: EyeBar | null): Promise<Blob> {
    const stored = await fetchRender(url);
    return eyeBar ? redraw(stored, 'image/jpeg', { eyeBar }) : stored;
}

/** The async clipboard exists only on a secure origin (https, or localhost). */
export function canCopyImage(): boolean {
    return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

/**
 * Put the photo on the clipboard as a picture, at most `COPY_MAX_EDGE` on its longest
 * edge. PNG is the one image type the clipboard accepts. The item is given the PROMISE
 * rather than an awaited blob, so the write is issued inside the click that asked for
 * it — a write made after the download and re-encode has lost that user activation
 * where it is required.
 */
export async function copyPhoto(url: string, eyeBar?: EyeBar | null): Promise<void> {
    const png = fetchRender(url).then((stored) => redraw(stored, 'image/png', { eyeBar, maxEdge: COPY_MAX_EDGE }));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** Hand `blob` to the browser as a download called `fileName`. */
export function saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One zip of `files`. Stored, not deflated: a JPEG does not compress further. The
 *  library is loaded on first use, so the gallery does not carry it. */
export async function zipFiles(files: ReadonlyArray<{ name: string; blob: Blob }>): Promise<Blob> {
    const { zipSync } = await import('fflate');
    const entries: Record<string, Uint8Array> = {};
    for (const file of files) entries[file.name] = new Uint8Array(await file.blob.arrayBuffer());
    return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
}
