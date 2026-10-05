/**
 * Small pure helpers shared by the patient's sets page and its pieces.
 */
import type { AlignerPhoto } from '../aligner.types';
import { formatLocaleDate, formatLocaleDateTime } from '../../../utils/formatters';

export const formatSetDate = (value: string | null | undefined): string =>
    formatLocaleDate(value, { year: 'numeric', month: 'short', day: 'numeric' }) || 'N/A';

export const formatSetDateTime = (value: string | null | undefined): string =>
    formatLocaleDateTime(value, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }) || 'N/A';

/**
 * A set's folder: `<root>\<doctor id>\<person id>\<set #>`. The root is the
 * install's `AlignerSetsFolder` option (FE-F17-7: it was `\\WORK_PC\Aligner_Sets`,
 * this clinic's machine, on every install); null when it isn't configured.
 */
export function setFolderPath(
    root: string | null | undefined,
    drId: number | null | undefined,
    personId: number,
    setSequence: number | null | undefined
): string | null {
    const base = (root ?? '').trim().replace(/[\\/]+$/, '');
    if (!base || !drId) return null;
    return `${base}\\${drId}\\${personId}\\${setSequence ?? ''}`;
}

/** The FontAwesome icon for a portal scan file, by extension. */
export function fileIconClass(photo: AlignerPhoto): string {
    const ext = photo.file_name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'zip':
        case 'rar':
        case '7z':
        case 'tar':
        case 'gz':
            return 'fas fa-file-archive';
        case 'stl':
        case 'ply':
        case 'obj':
        case '3ds':
        case 'fbx':
            return 'fas fa-cube';
        case 'pdf':
            return 'fas fa-file-pdf';
        case 'doc':
        case 'docx':
            return 'fas fa-file-word';
        default:
            return 'fas fa-file';
    }
}

/** An empty value is valid (it clears the link). */
export function isValidYouTubeUrl(url: string): boolean {
    if (!url) return true;
    return [
        /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^https?:\/\/youtu\.be\/[\w-]+/,
        /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/,
    ].some((pattern) => pattern.test(url));
}
