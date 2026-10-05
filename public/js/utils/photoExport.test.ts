import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { COPY_MAX_EDGE, fitWithin, photoFileName, sessionBaseName, sessionZipName, zipFiles } from './photoExport';

describe('exported photo names', () => {
    const parts = { patientName: 'Ahmed Ali', session: 'Initial_01-01-2026' };

    it('names a photo by patient, session and view', () => {
        expect(photoFileName(parts, 'i13')).toBe('Ahmed Ali_Initial_01-01-2026_Smile.jpg');
        expect(photoFileName(parts, 'i23')).toBe('Ahmed Ali_Initial_01-01-2026_Upper.jpg');
    });

    it('names the zip after the session', () => {
        expect(sessionZipName(parts)).toBe('Ahmed Ali_Initial_01-01-2026.zip');
    });

    it('keeps an Arabic name as it is', () => {
        expect(photoFileName({ patientName: 'أحمد علي', session: 'Final_05-10-2026' }, 'i10')).toBe(
            'أحمد علي_Final_05-10-2026_Profile.jpg'
        );
    });

    it('replaces what Windows refuses in a file name', () => {
        expect(sessionBaseName({ patientName: 'A/B: "C"', session: 'Mid?_<1>' })).toBe('A-B- -C-_Mid-_-1-');
    });

    it('drops a trailing dot or space, and collapses runs of whitespace', () => {
        expect(sessionBaseName({ patientName: '  Sara   Omar. ', session: 'Progress ..' })).toBe(
            'Sara Omar_Progress'
        );
    });

    it('still gives a usable name when a part is missing', () => {
        expect(photoFileName({ patientName: null, session: 'Initial_01-01-2026' }, 'i12')).toBe(
            'Initial_01-01-2026_Rest.jpg'
        );
        expect(photoFileName({ patientName: null, session: null }, 'i12')).toBe('Rest.jpg');
        expect(sessionZipName({ patientName: '', session: undefined })).toBe('photos.zip');
    });
});

describe('fitWithin', () => {
    it('scales the longest edge down to the cap, keeping the shape', () => {
        expect(fitWithin(3665, 4227, COPY_MAX_EDGE)).toEqual({ width: 2601, height: 3000 });
        expect(fitWithin(4714, 2541, COPY_MAX_EDGE)).toEqual({ width: 3000, height: 1617 });
    });

    it('never enlarges a photo already within the cap', () => {
        expect(fitWithin(2400, 1600, COPY_MAX_EDGE)).toEqual({ width: 2400, height: 1600 });
        expect(fitWithin(3000, 3000, COPY_MAX_EDGE)).toEqual({ width: 3000, height: 3000 });
    });
});

describe('zipFiles', () => {
    it('stores each file under its name, bytes intact', async () => {
        const first = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
        const second = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 9]);
        const zip = await zipFiles([
            { name: 'أحمد_Initial_01-01-2026_Smile.jpg', blob: new Blob([first]) },
            { name: 'أحمد_Initial_01-01-2026_Upper.jpg', blob: new Blob([second]) },
        ]);
        expect(zip.type).toBe('application/zip');

        const unzipped = unzipSync(new Uint8Array(await zip.arrayBuffer()));
        expect(Object.keys(unzipped)).toEqual([
            'أحمد_Initial_01-01-2026_Smile.jpg',
            'أحمد_Initial_01-01-2026_Upper.jpg',
        ]);
        expect(Array.from(unzipped['أحمد_Initial_01-01-2026_Smile.jpg'])).toEqual(Array.from(first));
        expect(Array.from(unzipped['أحمد_Initial_01-01-2026_Upper.jpg'])).toEqual(Array.from(second));
    });
});
