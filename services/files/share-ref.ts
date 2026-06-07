/**
 * Shared resolver for a client `SendFileRef` → guarded absolute path + metadata.
 *
 * Every "share this patient file/image" target (LocalSend, Telegram, and more to
 * come) needs the same thing: turn the untrusted `{source, personId, ref}` the
 * browser sends into a safe on-disk path. That logic lives here once so each
 * sender service stays a thin transport over it.
 */
import path from 'path';
import { stat } from 'fs/promises';
import config from '../../config/config.js';
import { createPathResolver } from '../../utils/path-resolver.js';
import { resolveFileForServe, FileExplorerError } from './file-explorer.service.js';
import { getFileMimeType } from '../../utils/file-mime.js';
import type { SendFileRef } from '../../shared/contracts/localsend.contract.js';

export interface ResolvedShareFile {
  abs: string;
  size: number;
  name: string;
  fileType: string;
}

/** Resolve a client `SendFileRef` to a guarded absolute path + metadata. */
export async function resolveShareRef(ref: SendFileRef): Promise<ResolvedShareFile> {
  if (ref.source === 'patient-file') {
    const { abs, size } = await resolveFileForServe(ref.personId, ref.ref);
    return {
      abs,
      size,
      name: ref.displayName || path.basename(abs),
      fileType: getFileMimeType(abs),
    };
  }
  // patient-image — a rendered Dolphin view in the shared working/ dir.
  return resolveWorkingImage(ref);
}

/**
 * Safe resolver for a rendered patient image in the flat `working/` dir
 * (served to the browser as `/DolImgs/<basename>`). The basename must be a
 * bare Dolphin filename — no separators / traversal — and the resolved path
 * is containment-checked under `working/` (the real guard).
 */
async function resolveWorkingImage(ref: SendFileRef): Promise<ResolvedShareFile> {
  const basename = ref.ref;
  if (!/^\d+0\d+\.i\d+$/i.test(basename)) {
    throw new FileExplorerError('Invalid image reference', 400);
  }
  const machinePath = config.fileSystem.machinePath;
  if (!machinePath) throw new FileExplorerError('Server file path not configured', 500);
  const resolver = createPathResolver(machinePath);
  const root = resolver('working');
  const abs = resolver(`working/${basename}`);
  // Containment: the resolved path must stay under working/.
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new FileExplorerError('Path is outside the working folder', 403);
  }
  const st = await stat(abs).catch(() => {
    throw new FileExplorerError('Image not found', 404);
  });
  return {
    abs,
    size: st.size,
    name: ref.displayName || `${basename}.jpg`,
    fileType: 'image/jpeg',
  };
}
