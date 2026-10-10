import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseScan } from './scanScene';
import { scanFormat } from './scanFormats';

/**
 * Copy into an ArrayBuffer of this realm. Under jsdom, fflate's `strToU8` hands back
 * Node's buffer, which fails PLYLoader's `instanceof ArrayBuffer` (a browser has one realm).
 */
const toBuffer = (u8: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
};

/** A binary STL: 80-byte header, face count, then 50 bytes a face. */
function binaryStl(faces: number[][]): Uint8Array {
  const view = new DataView(new ArrayBuffer(84 + 50 * faces.length));
  view.setUint32(80, faces.length, true);
  faces.forEach((face, i) => {
    const at = 84 + i * 50;
    view.setFloat32(at + 8, 1, true); // normal (0, 0, 1)
    face.forEach((v, k) => view.setFloat32(at + 12 + k * 4, v, true));
  });
  return new Uint8Array(view.buffer);
}

const TWO_FACES = [
  [0, 0, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 0, 1, 1, 0, 0, 1, 0],
];

const ASCII_STL = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t
`;

const COLOURED_PLY = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_indices
end_header
0 0 0 255 0 0
1 0 0 0 255 0
0 1 0 0 0 255
3 0 1 2
`;

/** The scanners' layout: binary, no colour, no normals. */
function binaryPly(): Uint8Array {
  const header = strToU8(
    'ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n' +
      'element face 1\nproperty list uchar int vertex_indices\nend_header\n'
  );
  const body = new DataView(new ArrayBuffer(3 * 12 + 1 + 3 * 4));
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => body.setFloat32(i * 4, v, true));
  body.setUint8(36, 3);
  [0, 1, 2].forEach((v, i) => body.setInt32(37 + i * 4, v, true));
  const out = new Uint8Array(header.length + body.byteLength);
  out.set(header);
  out.set(new Uint8Array(body.buffer), header.length);
  return out;
}

describe('scanFormat', () => {
  it('knows STL, PLY and ZIP in any case, nothing else', () => {
    expect(scanFormat('upper.STL')).toBe('stl');
    expect(scanFormat('a.b.ply')).toBe('ply');
    expect(scanFormat('case.Zip')).toBe('zip');
    expect(scanFormat('scan.obj')).toBeNull();
    expect(scanFormat('stl')).toBeNull();
  });
});

describe('parseScan', () => {
  it('reads a binary STL', () => {
    const [part] = parseScan('upper.stl', toBuffer(binaryStl(TWO_FACES)));
    expect(part.name).toBe('upper.stl');
    expect(part.geometry.getAttribute('position').count).toBe(6);
    expect(part.geometry.hasAttribute('normal')).toBe(true);
  });

  it('reads an ASCII STL', () => {
    const [part] = parseScan('lower.stl', toBuffer(strToU8(ASCII_STL)));
    expect(part.geometry.getAttribute('position').count).toBe(3);
  });

  it('keeps a PLY’s vertex colours', () => {
    const [part] = parseScan('arch.ply', toBuffer(strToU8(COLOURED_PLY)));
    expect(part.geometry.hasAttribute('color')).toBe(true);
    expect(part.geometry.hasAttribute('normal')).toBe(true);
  });

  it('computes the normals a binary PLY lacks', () => {
    const [part] = parseScan('bite.ply', toBuffer(binaryPly()));
    expect(part.geometry.getAttribute('position').count).toBe(3);
    expect(part.geometry.hasAttribute('normal')).toBe(true);
    expect(part.geometry.hasAttribute('color')).toBe(false);
  });

  it('shows the STL and PLY files of a ZIP, skipping everything else', () => {
    const zip = zipSync({
      'case/upper.stl': binaryStl(TWO_FACES),
      'case/bite.ply': binaryPly(),
      'case/readme.txt': strToU8('hello'),
      '__MACOSX/case/._upper.stl': strToU8('resource fork'),
    });
    const parts = parseScan('case.zip', toBuffer(zip));
    expect(parts.map((p) => p.name).sort()).toEqual(['bite.ply', 'upper.stl']);
  });

  it('says so when a ZIP holds no scan', () => {
    const zip = zipSync({ 'notes.txt': strToU8('x') });
    expect(() => parseScan('case.zip', toBuffer(zip))).toThrow(/no STL or PLY/);
  });

  it('turns unreadable bytes into a message for the user', () => {
    expect(() => parseScan('broken.stl', new Uint8Array([1, 2, 3]).buffer)).toThrow(/broken\.stl/);
  });

  it('refuses a file type it does not show', () => {
    expect(() => parseScan('scan.obj', new ArrayBuffer(8))).toThrow(/not an STL, PLY or ZIP/);
  });
});
