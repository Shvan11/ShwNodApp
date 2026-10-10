import { describe, expect, it } from 'vitest';
import { locateWithin, removeEntryAt } from './fileSystemAccess';

/** A folder as a nested object: a string is a file, an object a subfolder. */
type Tree = { [name: string]: Tree | string };

interface FakeFile {
  kind: 'file';
  name: string;
  path: string[];
}

const fakeFile = (...path: string[]): FileSystemFileHandle =>
  ({ kind: 'file', name: path[path.length - 1], path }) as unknown as FileSystemFileHandle;

/** A directory handle over `tree`, sitting at `path` on the fake disk. */
function fakeDir(tree: Tree, path: string[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: path[path.length - 1],
    resolve: async (handle: FileSystemHandle) => {
      const target = (handle as unknown as FakeFile).path;
      const inside = target.length > path.length && path.every((part, i) => target[i] === part);
      return inside ? target.slice(path.length) : null;
    },
    getDirectoryHandle: async (name: string) => {
      const child = tree[name];
      if (typeof child !== 'object') throw new Error('NotFoundError');
      return fakeDir(child, [...path, name]);
    },
    removeEntry: async (name: string) => {
      if (!(name in tree)) throw new Error('NotFoundError');
      delete tree[name];
    },
  } as unknown as FileSystemDirectoryHandle;
}

const card = (): Tree => ({ 'IMG_1.JPG': 'a', 'IMG_2.JPG': 'b', sub: { 'IMG_3.JPG': 'c' } });
const AT = ['E:', 'DCIM', '100CANON'];

describe('locateWithin', () => {
  it('returns each handle\'s path under the folder, nested ones included', async () => {
    const dir = fakeDir(card(), AT);
    const paths = await locateWithin(dir, [fakeFile(...AT, 'IMG_1.JPG'), fakeFile(...AT, 'sub', 'IMG_3.JPG')]);
    expect(paths).toEqual([['IMG_1.JPG'], ['sub', 'IMG_3.JPG']]);
  });

  it('is null as soon as one handle is outside the folder', async () => {
    const dir = fakeDir(card(), AT);
    const paths = await locateWithin(dir, [
      fakeFile(...AT, 'IMG_1.JPG'),
      fakeFile('E:', 'DCIM', '101CANON', 'IMG_9.JPG'),
    ]);
    expect(paths).toBeNull();
  });

  it('is null for the same folder under another drive letter', async () => {
    const dir = fakeDir(card(), AT);
    expect(await locateWithin(dir, [fakeFile('F:', 'DCIM', '100CANON', 'IMG_1.JPG')])).toBeNull();
  });

  it('is null when resolve() itself fails', async () => {
    const dir = { resolve: () => Promise.reject(new Error('gone')) } as unknown as FileSystemDirectoryHandle;
    expect(await locateWithin(dir, [fakeFile(...AT, 'IMG_1.JPG')])).toBeNull();
  });
});

describe('removeEntryAt', () => {
  it('removes only the named entry, at any depth', async () => {
    const tree = card();
    const dir = fakeDir(tree, AT);
    await removeEntryAt(dir, ['IMG_2.JPG']);
    await removeEntryAt(dir, ['sub', 'IMG_3.JPG']);
    expect(tree).toEqual({ 'IMG_1.JPG': 'a', sub: {} });
  });

  it('rejects when the entry is not there, leaving the rest', async () => {
    const tree = card();
    await expect(removeEntryAt(fakeDir(tree, AT), ['IMG_7.JPG'])).rejects.toThrow();
    expect(tree).toEqual(card());
  });
});
