/**
 * Video Queries
 *
 * Database queries for educational video management.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). The dbo.V_Videos
 * view does not exist in the PG schema (views are recreated in Phase 5), so its
 * logic is inlined here: the `VideosPath` option (tbloptions) is concatenated with
 * `file_name`/`video_extension` to build the `Video` and `Image` URLs, mirroring the
 * original `CTE.Path + file_name + '.' + video_extension` / `+ '.jpg'` view. CRUD
 * still targets the tblvideos table.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import { log } from '../../../utils/logger.js';

// type definitions
export type Video = {
  id: number;
  description: string;
  Video: string;
  Image: string;
  category: number | null;
  details: string | null;
};

export interface VideoRecord {
  id: number;
  description: string;
  category: number | null;
  details: string | null;
  file_name: string | null;
  video_extension: string | null;
}

interface CreateVideoData {
  description: string;
  category?: number | null;
  details?: string | null;
  fileName: string;
  videoExtension: string;
}

interface UpdateVideoData {
  description?: string;
  category?: number | null;
  details?: string | null;
}

/**
 * Get all videos (inlines the former V_Videos view)
 */
export async function getAllVideos(): Promise<Video[]> {
  try {
    const db = getKysely();
    return await db
      .selectFrom('videos as v')
      .crossJoin(
        (eb) =>
          eb
            .selectFrom('options')
            .select('option_value as Path')
            .where('option_name', '=', 'VideosPath')
            .as('p')
      )
      .select((eb) => [
        'v.id',
        'v.description',
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.file_name')} || '.' || ${eb.ref('v.video_extension')}`.as(
          'Video'
        ),
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.file_name')} || '.jpg'`.as('Image'),
        'v.category',
        'v.details',
      ])
      .orderBy('v.description')
      .execute();
  } catch (error) {
    log.error('Error fetching all videos', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Get video by id (inlines the former V_Videos view)
 */
export async function getVideoById(id: number): Promise<Video | null> {
  try {
    const db = getKysely();
    const row = await db
      .selectFrom('videos as v')
      .crossJoin(
        (eb) =>
          eb
            .selectFrom('options')
            .select('option_value as Path')
            .where('option_name', '=', 'VideosPath')
            .as('p')
      )
      .where('v.id', '=', id)
      .select((eb) => [
        'v.id',
        'v.description',
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.file_name')} || '.' || ${eb.ref('v.video_extension')}`.as(
          'Video'
        ),
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.file_name')} || '.jpg'`.as('Image'),
        'v.category',
        'v.details',
      ])
      .executeTakeFirst();

    return row ?? null;
  } catch (error) {
    log.error('Error fetching video by id', { id, error: (error as Error).message });
    throw error;
  }
}

/**
 * Get video record for editing (uses tblvideos table)
 */
export async function getVideoRecord(id: number): Promise<VideoRecord | null> {
  try {
    const db = getKysely();
    const row = await db
      .selectFrom('videos')
      .where('id', '=', id)
      .select(['id', 'description', 'category', 'details', 'file_name', 'video_extension'])
      .executeTakeFirst();

    return row ?? null;
  } catch (error) {
    log.error('Error fetching video record', { id, error: (error as Error).message });
    throw error;
  }
}

/**
 * Get videos folder path from tbloptions
 */
export async function getVideosPath(): Promise<string> {
  try {
    const db = getKysely();
    const row = await db
      .selectFrom('options')
      .select('option_value')
      .where('option_name', '=', 'VideosPath')
      .executeTakeFirst();

    if (!row || !row.option_value) {
      throw new Error('VideosPath not configured in tbloptions');
    }

    return row.option_value;
  } catch (error) {
    log.error('Error fetching videos path', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Video category with id and name
 */
export type VideoCategory = {
  id: number;
  name: string;
};

/**
 * Get all video categories from tblVidCat
 */
export async function getVideoCategories(): Promise<VideoCategory[]> {
  try {
    const db = getKysely();
    return await db
      .selectFrom('video_categories')
      .select((eb) => ['vid_cat_id as id', eb.ref('category').$castTo<string>().as('name')])
      .orderBy('vid_cat_id')
      .execute();
  } catch (error) {
    log.error('Error fetching video categories', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Create new video record
 * @returns The id of the newly created video
 */
export async function createVideo(data: CreateVideoData): Promise<number> {
  try {
    const db = getKysely();
    const row = await db
      .insertInto('videos')
      .values({
        description: data.description,
        category: data.category ?? null,
        details: data.details ?? null,
        file_name: data.fileName,
        video_extension: data.videoExtension,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    log.info('Video record created', { id: row.id, description: data.description });
    return row.id;
  } catch (error) {
    log.error('Error creating video record', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Update video metadata
 */
export async function updateVideo(id: number, data: UpdateVideoData): Promise<boolean> {
  try {
    const setValues: Record<string, unknown> = {};

    if (data.description !== undefined) {
      setValues.description = data.description;
    }
    if (data.category !== undefined) {
      setValues.category = data.category;
    }
    if (data.details !== undefined) {
      setValues.details = data.details;
    }

    if (Object.keys(setValues).length === 0) {
      return false;
    }

    const db = getKysely();
    const result = await db
      .updateTable('videos')
      .set(setValues)
      .where('id', '=', id)
      .executeTakeFirst();

    const updated = Number(result.numUpdatedRows) > 0;

    if (updated) {
      log.info('Video record updated', { id });
    }

    return updated;
  } catch (error) {
    log.error('Error updating video record', { id, error: (error as Error).message });
    throw error;
  }
}

/**
 * Delete video record
 */
export async function deleteVideo(id: number): Promise<boolean> {
  try {
    const db = getKysely();
    const result = await db
      .deleteFrom('videos')
      .where('id', '=', id)
      .executeTakeFirst();

    const deleted = Number(result.numDeletedRows) > 0;

    if (deleted) {
      log.info('Video record deleted', { id });
    }

    return deleted;
  } catch (error) {
    log.error('Error deleting video record', { id, error: (error as Error).message });
    throw error;
  }
}
