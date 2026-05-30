/**
 * Video Queries
 *
 * Database queries for educational video management.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). The dbo.V_Videos
 * view does not exist in the PG schema (views are recreated in Phase 5), so its
 * logic is inlined here: the `VideosPath` option (tbloptions) is concatenated with
 * `FileName`/`VideoExtension` to build the `Video` and `Image` URLs, mirroring the
 * original `CTE.Path + FileName + '.' + VideoExtension` / `+ '.jpg'` view. CRUD
 * still targets the tblvideos table.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import { log } from '../../../utils/logger.js';

// Type definitions
export interface Video {
  ID: number;
  Description: string;
  Video: string;
  Image: string;
  Category: number | null;
  Details: string | null;
}

export interface VideoRecord {
  ID: number;
  Description: string;
  Category: number | null;
  Details: string | null;
  FileName: string | null;
  VideoExtension: string | null;
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
      .selectFrom('tblvideos as v')
      .crossJoin(
        (eb) =>
          eb
            .selectFrom('tbloptions')
            .select('OptionValue as Path')
            .where('OptionName', '=', 'VideosPath')
            .as('p')
      )
      .select((eb) => [
        'v.ID',
        'v.Description',
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.FileName')} || '.' || ${eb.ref('v.VideoExtension')}`.as(
          'Video'
        ),
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.FileName')} || '.jpg'`.as('Image'),
        'v.Category',
        'v.Details',
      ])
      .orderBy('v.Description')
      .execute();
  } catch (error) {
    log.error('Error fetching all videos', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Get video by ID (inlines the former V_Videos view)
 */
export async function getVideoById(id: number): Promise<Video | null> {
  try {
    const db = getKysely();
    const row = await db
      .selectFrom('tblvideos as v')
      .crossJoin(
        (eb) =>
          eb
            .selectFrom('tbloptions')
            .select('OptionValue as Path')
            .where('OptionName', '=', 'VideosPath')
            .as('p')
      )
      .where('v.ID', '=', id)
      .select((eb) => [
        'v.ID',
        'v.Description',
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.FileName')} || '.' || ${eb.ref('v.VideoExtension')}`.as(
          'Video'
        ),
        sql<string>`${eb.ref('p.Path')} || ${eb.ref('v.FileName')} || '.jpg'`.as('Image'),
        'v.Category',
        'v.Details',
      ])
      .executeTakeFirst();

    return row ?? null;
  } catch (error) {
    log.error('Error fetching video by ID', { id, error: (error as Error).message });
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
      .selectFrom('tblvideos')
      .where('ID', '=', id)
      .select(['ID', 'Description', 'Category', 'Details', 'FileName', 'VideoExtension'])
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
      .selectFrom('tbloptions')
      .select('OptionValue')
      .where('OptionName', '=', 'VideosPath')
      .executeTakeFirst();

    if (!row || !row.OptionValue) {
      throw new Error('VideosPath not configured in tbloptions');
    }

    return row.OptionValue;
  } catch (error) {
    log.error('Error fetching videos path', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Video category with ID and name
 */
export interface VideoCategory {
  id: number;
  name: string;
}

/**
 * Get all video categories from tblVidCat
 */
export async function getVideoCategories(): Promise<VideoCategory[]> {
  try {
    const db = getKysely();
    return await db
      .selectFrom('tblVidCat')
      .select((eb) => ['VidCatID as id', eb.ref('Category').$castTo<string>().as('name')])
      .orderBy('VidCatID')
      .execute();
  } catch (error) {
    log.error('Error fetching video categories', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Create new video record
 * @returns The ID of the newly created video
 */
export async function createVideo(data: CreateVideoData): Promise<number> {
  try {
    const db = getKysely();
    const row = await db
      .insertInto('tblvideos')
      .values({
        Description: data.description,
        Category: data.category ?? null,
        Details: data.details ?? null,
        FileName: data.fileName,
        VideoExtension: data.videoExtension,
      })
      .returning('ID')
      .executeTakeFirstOrThrow();

    log.info('Video record created', { id: row.ID, description: data.description });
    return row.ID;
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
      setValues.Description = data.description;
    }
    if (data.category !== undefined) {
      setValues.Category = data.category;
    }
    if (data.details !== undefined) {
      setValues.Details = data.details;
    }

    if (Object.keys(setValues).length === 0) {
      return false;
    }

    const db = getKysely();
    const result = await db
      .updateTable('tblvideos')
      .set(setValues)
      .where('ID', '=', id)
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
      .deleteFrom('tblvideos')
      .where('ID', '=', id)
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
