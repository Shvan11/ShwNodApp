/**
 * The 3D scan viewer's three.js half: turn STL / PLY bytes (or a ZIP of them) into
 * meshes and show them in a WebGL canvas with rotate / pan / zoom.
 *
 * `ScanViewerModal` imports this module dynamically, so three.js is downloaded only
 * when someone opens a scan.
 */
import {
  Box3,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { unzipSync } from 'fflate';
import { scanFormat } from './scanFormats';

/** One mesh of a scan: a file, or one STL/PLY inside a ZIP. */
export interface ScanPart {
  name: string;
  geometry: BufferGeometry;
}

/** What the modal holds on to. A file's meshes are added and shown/hidden under one key. */
export interface ScanView {
  add(key: string, parts: ScanPart[]): void;
  setVisible(key: string, visible: boolean): void;
  resetView(): void;
  dispose(): void;
}

/** A ZIP is opened in memory, so cap what it may unpack to. */
const MAX_ZIP_PARTS = 20;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;

/** Plaster-like tints for scans without colour; the next file gets the next tint. */
const STONE_TINTS = [0xe8ddcb, 0xd3dce6, 0xdbe5d0, 0xecd8d3];

function parseModel(name: string, bytes: ArrayBuffer): ScanPart {
  const format = scanFormat(name);
  let geometry: BufferGeometry;
  try {
    if (format === 'stl') {
      // STL carries a normal per face: kept as is (flat shading). Merging vertices for
      // smooth shading costs ~0.3 s on a 250k-triangle scan, for a look nobody asked for.
      geometry = new STLLoader().parse(bytes);
    } else if (format === 'ply') {
      geometry = new PLYLoader().parse(bytes);
      // The scanners' PLY exports carry colour but no normals; without normals the
      // lit material renders the mesh black.
      if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    } else {
      throw new Error('not a model');
    }
  } catch {
    throw new Error(`${name} could not be read as a 3D scan.`);
  }
  if ((geometry.getAttribute('position')?.count ?? 0) === 0) {
    geometry.dispose();
    throw new Error(`${name} contains no 3D geometry.`);
  }
  return { name, geometry };
}

/** The STL / PLY files of a ZIP (folders and the macOS `__MACOSX` copies skipped). */
function parseZip(bytes: ArrayBuffer): ScanPart[] {
  let count = 0;
  let total = 0;
  const entries = unzipSync(new Uint8Array(bytes), {
    filter: (file) => {
      const base = file.name.slice(file.name.lastIndexOf('/') + 1);
      const format = scanFormat(base);
      if (file.name.startsWith('__MACOSX/') || (format !== 'stl' && format !== 'ply')) return false;
      count += 1;
      total += file.originalSize;
      if (count > MAX_ZIP_PARTS || total > MAX_ZIP_BYTES) {
        throw new Error('This ZIP is too large to preview — download it instead.');
      }
      return true;
    },
  });
  const parts = Object.entries(entries).map(([path, data]) =>
    parseModel(
      path.slice(path.lastIndexOf('/') + 1),
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    )
  );
  if (parts.length === 0) throw new Error('This ZIP has no STL or PLY files to show.');
  return parts;
}

/** Parse a scan file into its meshes. Throws an Error with a message fit for the user. */
export function parseScan(fileName: string, bytes: ArrayBuffer): ScanPart[] {
  const format = scanFormat(fileName);
  if (format === 'zip') return parseZip(bytes);
  if (format === 'stl' || format === 'ply') return [parseModel(fileName, bytes)];
  throw new Error(`${fileName} is not an STL, PLY or ZIP file.`);
}

/**
 * An empty scene in a canvas appended to `host` (which must have a size: the canvas
 * fills it and follows it); files are added with `add()`. Meshes stay where the files
 * place them, never re-centred one by one: a modern scanner exports the upper and
 * lower jaw in one coordinate system, so shown together they sit in occlusion.
 */
export function mountScanScene(host: HTMLElement): ScanView {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // the host's background shows through (theme-aware)
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 1000);
  scene.add(new HemisphereLight(0xffffff, 0x8a8f99, 1.4));
  // A headlight: travels with the camera, so whatever side faces the viewer is lit.
  const headlight = new DirectionalLight(0xffffff, 1.6);
  headlight.position.set(0.3, 0.5, 0);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);
  scene.add(camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;

  const files = new Map<string, Mesh<BufferGeometry, MeshStandardMaterial>[]>();
  let needsRender = true;

  const add = (key: string, parts: ScanPart[]): void => {
    const tint = STONE_TINTS[files.size % STONE_TINTS.length];
    const meshes = parts.map((part) => {
      const hasColors = part.geometry.hasAttribute('color');
      const material = new MeshStandardMaterial({
        color: hasColors ? 0xffffff : tint,
        vertexColors: hasColors,
        roughness: 0.65,
        metalness: 0.05,
        side: DoubleSide, // scans are open surfaces; their inside shows through the gaps
      });
      const mesh = new Mesh(part.geometry, material);
      scene.add(mesh);
      return mesh;
    });
    files.set(key, meshes);
    needsRender = true;
  };

  const setVisible = (key: string, visible: boolean): void => {
    for (const mesh of files.get(key) ?? []) mesh.visible = visible;
    needsRender = true;
  };

  /**
   * Everything shown in view, from the front and a little above. Assumes Y is up, as
   * in the scanner exports seen so far; on a file that isn't, the user just rotates.
   */
  const resetView = (): void => {
    const bounds = new Box3();
    for (const meshes of files.values()) {
      for (const mesh of meshes) if (mesh.visible) bounds.expandByObject(mesh);
    }
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 1e-3);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
    camera.position.copy(sphere.center).addScaledVector(new Vector3(0, 0.55, 1).normalize(), distance);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.minDistance = radius * 0.05;
    controls.maxDistance = distance * 10;
    controls.update();
    needsRender = true;
  };

  const resize = (): void => {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false); // CSS sizes the canvas; this sets its pixels
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    needsRender = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // Draws only when something moved: `update()` reports true while a drag or the
  // damping after it is still changing the camera.
  let frame = 0;
  const loop = (): void => {
    frame = requestAnimationFrame(loop);
    if (controls.update() || needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }
  };
  loop();

  return {
    add,
    setVisible,
    resetView,
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const meshes of files.values()) {
        for (const mesh of meshes) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      }
      renderer.dispose();
      // Browsers keep ~16 live WebGL contexts per page; release this one now rather
      // than whenever the garbage collector gets to it.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
