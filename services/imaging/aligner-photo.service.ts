import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../../config/config.js';
import type { AlignerPhoto } from '../../shared/contracts/aligner.contract.js';
import { log } from '../../utils/logger.js';

const r2Config = config.r2;

let s3Client: S3Client | null = null;

/** Is the doctor-portal storage (Cloudflare R2) configured on this install? */
export function isR2Configured(): boolean {
  return !!(r2Config.accountId && r2Config.accessKeyId && r2Config.secretAccessKey);
}

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const { accountId, accessKeyId, secretAccessKey } = r2Config;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 configuration is incomplete. Check your environment variables.');
  }

  s3Client = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    region: 'auto',
  });

  return s3Client;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  // 3D scan files (portal-submitted cases land these under sets/{id}/files/)
  zip: 'application/zip',
  stl: 'model/stl',
  ply: 'model/ply',
};

function mimeFromKey(key: string): string | null {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

function displayName(objectName: string): string {
  return objectName.replace(/^\d{10,}-/, '');
}

/**
 * Hard stop on the pagination loop below. A single case realistically holds a few
 * dozen attachments, so this only exists so a mis-scoped prefix (or a bucket-level
 * mishap) can't spin the loop into an unbounded list + one presign per key.
 */
const MAX_KEYS_PER_SET = 5_000;

/**
 * List all case photos uploaded for a specific aligner set. The row shape is the
 * contract's `AlignerPhoto` (shared/contracts/aligner.contract.ts) so a drift
 * between what we build and what the client parses is a compile error — note
 * `uploaded_at` is the ISO STRING the wire carries, not the SDK's `Date`.
 */
export async function listPhotosForSet(setId: number): Promise<AlignerPhoto[]> {
  // An install without the portal's storage has no doctor uploads to list — an empty
  // list, not a 500 on every set the page opens (found in RE1's runtime checks).
  if (!isR2Configured()) return [];
  const client = getS3Client();
  const bucketName = r2Config.bucketName;
  const prefix = `sets/${setId}/`;

  // ListObjectsV2 caps a page at 1000 keys; without following the continuation token
  // a set past that silently lost its oldest attachments from the staff view.
  const contents: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    contents.push(...(response.Contents || []));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    if (contents.length >= MAX_KEYS_PER_SET) {
      log.warn('Aligner set photo listing hit the key cap; truncating', {
        setId,
        cap: MAX_KEYS_PER_SET,
      });
      break;
    }
  } while (continuationToken);

  // Keys start with a fixed-width ms-epoch timestamp, so lexicographic desc = newest
  // first. Byte-wise (not localeCompare — locale collation would reorder the name
  // suffix), and 0 on a tie so the sort stays a valid total order.
  contents.sort((a, b) => {
    const ka = a.Key || '';
    const kb = b.Key || '';
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });

  return Promise.all(
    contents.map(async (o) => {
      const key = o.Key || '';
      const fileName = displayName(key.slice(key.lastIndexOf('/') + 1));

      const getCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      const view_url = await getSignedUrl(client, getCommand, { expiresIn: 3600 });

      return {
        path: key,
        file_name: fileName,
        file_size: o.Size ?? null,
        mime_type: mimeFromKey(key),
        uploaded_at: o.LastModified?.toISOString() ?? null,
        view_url,
      };
    })
  );
}

/**
 * A photo key that doesn't belong to the set it was requested under.
 *
 * Its own class so the route can answer 403 instead of reporting the guard as a
 * 500 "Failed to delete photo" — the check is a correct refusal, not a fault.
 */
export class PhotoOwnershipError extends Error {
  constructor(message = 'Photo does not belong to this aligner set.') {
    super(message);
    this.name = 'PhotoOwnershipError';
  }
}

/** No object under that key — deleted by the doctor since the list was read. */
export class PhotoNotFoundError extends Error {
  constructor(message = 'Photo not found.') {
    super(message);
    this.name = 'PhotoNotFoundError';
  }
}

/** Refuse a key outside `sets/<id>/` — the only check standing between a set id and another set's files. */
function assertKeyBelongsToSet(setId: number, key: string): void {
  if (!key.startsWith(`sets/${setId}/`)) {
    throw new PhotoOwnershipError();
  }
}

/** Upper bound on one attachment read (the portal caps an upload at 100 MB; a scan is ~10 MB). */
const READ_TIMEOUT_MS = 120_000;

/**
 * Read one attachment of a set into memory, for the staff app's 3D scan viewer.
 * Buffered like the 3Shape download proxy: portal files are at most 100 MB.
 */
export async function readPhotoForSet(setId: number, key: string): Promise<{ bytes: Buffer; fileName: string }> {
  assertKeyBelongsToSet(setId, key);

  const client = getS3Client();
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: r2Config.bucketName, Key: key }),
      { abortSignal: AbortSignal.timeout(READ_TIMEOUT_MS) }
    );
    if (!response.Body) throw new PhotoNotFoundError();
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    return { bytes, fileName: displayName(key.slice(key.lastIndexOf('/') + 1)) };
  } catch (error) {
    if ((error as { name?: string }).name === 'NoSuchKey') throw new PhotoNotFoundError();
    throw error;
  }
}

/**
 * Delete a case photo belonging to an aligner set.
 */
export async function deletePhotoForSet(setId: number, key: string): Promise<void> {
  assertKeyBelongsToSet(setId, key);

  const client = getS3Client();

  const command = new DeleteObjectCommand({
    Bucket: r2Config.bucketName,
    Key: key,
  });

  await client.send(command);
  log.info(`Deleted R2 photo ${key} for aligner set ${setId}`);
}
