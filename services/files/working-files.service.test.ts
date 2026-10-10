import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The working dir is a temp folder; the name rules are the real ones.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'working-files-'));
vi.mock('./clinic-paths.js', async () => ({
  ...(await vi.importActual<typeof import('./working-file-names.js')>('./working-file-names.js')),
  workingDir: () => dir,
  workingFilePath: (name: string) => path.join(dir, name),
  newTrashDir: (id: string | number) => path.join(dir, '.trash', String(id), 'stamp'),
}));
vi.mock('./file-explorer.service.js', () => ({
  FileExplorerError: class FileExplorerError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));

const { listPatientWorkingFiles, listSlotFiles, resolveWorkingFile, trashWorkingFile, trashWorkingSlot } =
  await import('./working-files.service.js');

const put = (...names: string[]): void => {
  for (const name of names) fs.writeFileSync(path.join(dir, name), 'x');
};
const exists = (name: string): boolean => fs.existsSync(path.join(dir, name));
const trashed = (id: number): string[] => fs.readdirSync(path.join(dir, '.trash', String(id), 'stamp', 'working')).sort();

beforeAll(() => {
  put(
    '2700.I12', // patient 27, session 0, Rest
    '2700.V12', // Dolphin's original of it
    '2700.I51', // patient 27, session 0, OPG
    '2702.i50', // patient 27, session 2, ceph
    '2702.V50', // Dolphin's original of it
    '2700.ACV', // Dolphin data file
    '27000.i51', // patient 270's session 0
    '27000.V51', // … and Dolphin's original of it
    '2701.I12', // patient 27's session 1 — not one of the codes passed below
    '2701.V12'
  );
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe('working files — every Dolphin slot of the patient’s own sessions', () => {
  it('lists the grid views AND the other slots, each image with Dolphin’s original of it', async () => {
    const entries = await listPatientWorkingFiles(27, [0, 2]);
    const got = entries
      .map((e) => ({ name: e.name, tpCode: e.tpCode, view: e.view, original: e.original }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(got).toEqual([
      { name: '2700.I12', tpCode: 0, view: 'i12', original: false },
      { name: '2700.I51', tpCode: 0, view: 'i51', original: false },
      { name: '2700.V12', tpCode: 0, view: 'i12', original: true },
      { name: '2702.i50', tpCode: 2, view: 'i50', original: false },
      { name: '2702.V50', tpCode: 2, view: 'i50', original: true },
    ]);
  });

  it('serves an image and an original of one of the patient’s sessions', async () => {
    await expect(resolveWorkingFile(27, '2700.I51', [0, 2])).resolves.toMatchObject({
      abs: path.join(dir, '2700.I51'),
    });
    await expect(resolveWorkingFile(27, '2700.V12', [0, 2])).resolves.toMatchObject({
      abs: path.join(dir, '2700.V12'),
    });
  });

  it.each([
    ['another patient’s file', '27000.i51'],
    ['another patient’s original', '27000.V51'],
    ['a session not passed in', '2701.I12'],
    ['an original of a session not passed in', '2701.V12'],
    ['a non-image file', '2700.ACV'],
    ['a path', '../2700.I51'],
  ])('refuses %s', async (_what, name) => {
    await expect(resolveWorkingFile(27, name, [0, 2])).rejects.toMatchObject({ status: 400 });
  });

  it('names a slot’s files by their real names: both of a pair, one slot or all of them', async () => {
    expect((await listSlotFiles(27, [0], ['i12'])).sort()).toEqual(['2700.I12', '2700.V12']);
    expect((await listSlotFiles(27, [0, 2])).sort()).toEqual(['2700.I12', '2700.I51', '2700.V12', '2702.V50', '2702.i50']);
    expect(await listSlotFiles(27, [5])).toEqual([]);
  });
});

describe('trashWorkingFile — the Working files page’s Delete takes the whole pair', () => {
  it('deleting the image moves Dolphin’s original of it to the trash too', async () => {
    put('3101.I22', '3101.V22', '3101.I21');
    const res = await trashWorkingFile(31, '3101.I22', [1]);
    expect(res).toEqual({ tpCode: 1, view: 'i22', removed: ['3101.I22', '3101.V22'] });
    expect(exists('3101.I22') || exists('3101.V22')).toBe(false);
    expect(exists('3101.I21')).toBe(true); // another slot of the session stays
    expect(trashed(31)).toEqual(['3101.I22', '3101.V22']);
  });

  it('deleting the original moves its image to the trash too', async () => {
    put('3200.i10', '3200.V10');
    const res = await trashWorkingFile(32, '3200.V10', [0]);
    expect(res).toEqual({ tpCode: 0, view: 'i10', removed: ['3200.V10', '3200.i10'] });
    expect(trashed(32)).toEqual(['3200.V10', '3200.i10']);
  });

  it('deletes a lone image, and a lone original', async () => {
    put('3300.I51', '3301.V20');
    await expect(trashWorkingFile(33, '3300.I51', [0, 1])).resolves.toMatchObject({ removed: ['3300.I51'] });
    await expect(trashWorkingFile(33, '3301.V20', [0, 1])).resolves.toMatchObject({ removed: ['3301.V20'] });
    expect(trashed(33)).toEqual(['3300.I51', '3301.V20']);
  });

  it('refuses another patient’s file and leaves it where it is', async () => {
    await expect(trashWorkingFile(27, '27000.i51', [0, 2])).rejects.toMatchObject({ status: 400 });
    await expect(trashWorkingFile(27, '27000.V51', [0, 2])).rejects.toMatchObject({ status: 400 });
    expect(exists('27000.i51') && exists('27000.V51')).toBe(true);
  });

  it('answers 404 for a slot of the patient’s that has no file', async () => {
    await expect(trashWorkingFile(27, '2700.i10', [0, 2])).rejects.toMatchObject({ status: 404 });
  });

  it('never splits a pair: a file Dolphin holds open puts the other back and answers 409', async () => {
    put('3400.I13', '3400.V13');
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith('3400.V13')) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
      return rename(from, to);
    });
    await expect(trashWorkingFile(34, '3400.I13', [0])).rejects.toMatchObject({ status: 409 });
    expect(exists('3400.I13') && exists('3400.V13')).toBe(true);
    expect(fs.readdirSync(path.join(dir, '.trash', '34', 'stamp', 'working'))).toEqual([]);
  });
});

describe('trashWorkingSlot — the photo editor’s Remove', () => {
  it('moves the view and Dolphin’s original of it, and is a no-op on an empty slot', async () => {
    put('3500.i23', '3500.V23', '3500.I24');
    expect((await trashWorkingSlot(35, 0, 'i23')).sort()).toEqual(['3500.V23', '3500.i23']);
    expect(exists('3500.I24')).toBe(true);
    await expect(trashWorkingSlot(35, 0, 'i23')).resolves.toEqual([]);
  });
});
