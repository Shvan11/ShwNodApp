import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The working dir is a temp folder; the name rules are the real ones.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'working-files-'));
vi.mock('./clinic-paths.js', async () => ({
  ...(await vi.importActual<typeof import('./working-file-names.js')>('./working-file-names.js')),
  workingDir: () => dir,
  workingFilePath: (name: string) => path.join(dir, name),
}));
vi.mock('./file-explorer.service.js', () => ({
  FileExplorerError: class FileExplorerError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));

const { listPatientWorkingFiles, resolveWorkingFile } = await import('./working-files.service.js');

beforeAll(() => {
  for (const name of [
    '2700.I12', // patient 27, session 0, Rest
    '2700.I51', // patient 27, session 0, OPG
    '2702.i50', // patient 27, session 2, ceph
    '2700.V51', // Dolphin's raw original of the OPG — not a displayable slot
    '2700.ACV', // Dolphin data file
    '27000.i51', // patient 270's session 0
    '2701.I12', // patient 27's session 1 — not one of the codes passed below
  ]) {
    fs.writeFileSync(path.join(dir, name), 'x');
  }
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('working files — every Dolphin slot of the patient’s own sessions', () => {
  it('lists the grid views AND the other slots, tagged with session and slot', async () => {
    const entries = await listPatientWorkingFiles(27, [0, 2]);
    const got = entries
      .map((e) => ({ name: e.name, tpCode: e.tpCode, view: e.view }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(got).toEqual([
      { name: '2700.I12', tpCode: 0, view: 'i12' },
      { name: '2700.I51', tpCode: 0, view: 'i51' },
      { name: '2702.i50', tpCode: 2, view: 'i50' },
    ]);
  });

  it('serves a slot of one of the patient’s sessions', async () => {
    await expect(resolveWorkingFile(27, '2700.I51', [0, 2])).resolves.toMatchObject({
      abs: path.join(dir, '2700.I51'),
    });
  });

  it.each([
    ['another patient’s file', '27000.i51'],
    ['a session not passed in', '2701.I12'],
    ['a raw original', '2700.V51'],
    ['a non-image file', '2700.ACV'],
    ['a path', '../2700.I51'],
  ])('refuses %s', async (_what, name) => {
    await expect(resolveWorkingFile(27, name, [0, 2])).rejects.toMatchObject({ status: 400 });
  });
});
