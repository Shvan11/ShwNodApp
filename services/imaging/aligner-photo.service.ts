import { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';

const r2Config = config.r2;

let s3Client: S3Client | null = null;

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

export interface AlignerPhoto {
  path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: Date | null;
  view_url: string;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

function mimeFromKey(key: string): string | null {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

function displayName(objectName: string): string {
  return objectName.replace(/^\d{10,}-/, '');
}

/**
 * List all case photos uploaded for a specific aligner set.
 */
export async function listPhotosForSet(setId: number): Promise<AlignerPhoto[]> {
  const client = getS3Client();
  const bucketName = r2Config.bucketName || 'aligner-portal-files';
  const prefix = `sets/${setId}/`;

  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  });

  const response = await client.send(command);
  const contents = response.Contents || [];

  // Keys start with a fixed-width ms-epoch timestamp, so lexicographic desc = newest first.
  contents.sort((a, b) => ((b.Key || '') < (a.Key || '') ? -1 : 1));

  const photos = await Promise.all(
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
        file_size: o.Size !== undefined ? o.Size : null,
        mime_type: mimeFromKey(key),
        uploaded_at: o.LastModified || null,
        view_url,
      };
    })
  );

  return photos;
}

/**
 * Delete a case photo belonging to an aligner set.
 */
export async function deletePhotoForSet(setId: number, key: string): Promise<void> {
  const expectedPrefix = `sets/${setId}/`;
  if (!key.startsWith(expectedPrefix)) {
    throw new Error('Forbidden: Photo does not belong to this aligner set.');
  }

  const client = getS3Client();
  const bucketName = r2Config.bucketName || 'aligner-portal-files';

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await client.send(command);
  log.info(`Deleted R2 photo ${key} for aligner set ${setId}`);
}
