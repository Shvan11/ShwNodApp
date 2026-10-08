import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The clinic volume is a temp folder; the path rules are the real ones.
const clinic = fs.mkdtempSync(path.join(os.tmpdir(), 'file-explorer-'));
vi.mock('./clinic-paths.js', () => ({
  clinicPath: (rel: string) => path.join(clinic, rel),
  patientDir: (id: string | number) => path.join(clinic, String(id)),
}));

const { transferEntries, FileExplorerError } = await import('./file-explorer.service.js');

const patient = path.join(clinic, '27');
const at = (rel: string) => path.join(patient, ...rel.split('/'));
const write = (rel: string, body = rel) => {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
  fs.writeFileSync(at(rel), body);
};
const read = (rel: string) => fs.readFileSync(at(rel), 'utf8');

beforeEach(() => {
  fs.rmSync(clinic, { recursive: true, force: true });
  fs.mkdirSync(patient, { recursive: true });
  write('a.jpg');
  write('Retainer/r.jpg');
  write('Retainer/Upper/u.jpg');
  fs.mkdirSync(at('Empty'));
  write('../28/other.jpg', 'patient 28');
});
afterAll(() => fs.rmSync(clinic, { recursive: true, force: true }));

describe('move', () => {
  it('moves a file and a folder into another folder', async () => {
    const r = await transferEntries(27, ['a.jpg', 'Retainer'], 'Empty', 'move');
    expect(r).toMatchObject({ succeeded: 2, failed: 0 });
    expect(r.results.map((x) => x.newPath)).toEqual(['Empty/a.jpg', 'Empty/Retainer']);
    expect(fs.existsSync(at('a.jpg'))).toBe(false);
    expect(read('Empty/Retainer/Upper/u.jpg')).toBe('Retainer/Upper/u.jpg');
  });

  it('keeps both on a name clash instead of overwriting', async () => {
    write('Empty/a.jpg', 'already there');
    const r = await transferEntries(27, ['a.jpg'], 'Empty', 'move');
    expect(r.results[0]).toMatchObject({ ok: true, newPath: 'Empty/a (1).jpg', renamed: true });
    expect(read('Empty/a.jpg')).toBe('already there');
    expect(read('Empty/a (1).jpg')).toBe('a.jpg');
  });

  it('reports an entry already in the destination as skipped', async () => {
    const r = await transferEntries(27, ['Retainer/r.jpg'], 'Retainer', 'move');
    expect(r.results[0]).toEqual({ relPath: 'Retainer/r.jpg', ok: true, skipped: true });
    expect(read('Retainer/r.jpg')).toBe('Retainer/r.jpg');
  });

  it('moves to the patient folder itself', async () => {
    const r = await transferEntries(27, ['Retainer/Upper/u.jpg'], '', 'move');
    expect(r.results[0]).toMatchObject({ ok: true, newPath: 'u.jpg' });
    expect(read('u.jpg')).toBe('Retainer/Upper/u.jpg');
  });

  it('refuses a folder into itself or one of its subfolders', async () => {
    for (const dest of ['Retainer', 'Retainer/Upper']) {
      const r = await transferEntries(27, ['Retainer'], dest, 'move');
      expect(r.results[0]).toMatchObject({ ok: false, error: 'Cannot move a folder into itself' });
    }
    expect(read('Retainer/Upper/u.jpg')).toBe('Retainer/Upper/u.jpg');
  });

  it('moves a folder once when its contents are selected with it', async () => {
    const r = await transferEntries(27, ['Retainer', 'Retainer/r.jpg', 'Retainer'], 'Empty', 'move');
    expect(r.results).toHaveLength(1);
    expect(read('Empty/Retainer/r.jpg')).toBe('Retainer/r.jpg');
  });
});

describe('copy', () => {
  it('copies a file into its own folder as a numbered duplicate, keeping its date', async () => {
    const old = new Date('2024-01-02T03:04:05Z');
    fs.utimesSync(at('a.jpg'), old, old);
    const r = await transferEntries(27, ['a.jpg'], '', 'copy');
    expect(r.results[0]).toMatchObject({ ok: true, newPath: 'a (1).jpg', renamed: true });
    expect(read('a.jpg')).toBe('a.jpg');
    expect(read('a (1).jpg')).toBe('a.jpg');
    expect(fs.statSync(at('a (1).jpg')).mtime.getTime()).toBe(old.getTime());
  });

  it('copies a folder with everything under it and leaves nothing staged', async () => {
    const r = await transferEntries(27, ['Retainer'], 'Empty', 'copy');
    expect(r).toMatchObject({ succeeded: 1, failed: 0 });
    expect(read('Empty/Retainer/Upper/u.jpg')).toBe('Retainer/Upper/u.jpg');
    expect(read('Retainer/Upper/u.jpg')).toBe('Retainer/Upper/u.jpg');
    expect(fs.readdirSync(path.join(clinic, '.uploads', '27'))).toEqual([]);
  });

  it('refuses a folder into its own subfolder', async () => {
    const r = await transferEntries(27, ['Retainer'], 'Retainer/Upper', 'copy');
    expect(r.results[0]).toMatchObject({ ok: false, error: 'Cannot copy a folder into itself' });
    expect(fs.readdirSync(at('Retainer/Upper'))).toEqual(['u.jpg']);
  });
});

describe('path safety', () => {
  it('fails an entry outside the patient folder without touching it', async () => {
    const r = await transferEntries(27, ['../28/other.jpg', 'a.jpg'], 'Empty', 'move');
    expect(r.results[0]).toMatchObject({ ok: false, error: 'Path is outside the patient folder' });
    expect(r.results[1]).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(clinic, '28', 'other.jpg'))).toBe(true);
  });

  it('refuses the patient folder itself as a source', async () => {
    const r = await transferEntries(27, ['.'], 'Empty', 'copy');
    expect(r.results[0]).toMatchObject({ ok: false, error: 'Cannot copy the patient folder itself' });
  });

  it('throws for a destination outside the patient, missing, or not a folder', async () => {
    await expect(transferEntries(27, ['a.jpg'], '../28', 'move')).rejects.toMatchObject({ status: 403 });
    await expect(transferEntries(27, ['a.jpg'], 'Nope', 'move')).rejects.toMatchObject({ status: 404 });
    await expect(transferEntries(27, ['Retainer/r.jpg'], 'a.jpg', 'copy')).rejects.toBeInstanceOf(
      FileExplorerError
    );
    expect(read('a.jpg')).toBe('a.jpg');
  });
});
