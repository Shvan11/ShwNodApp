/**
 * Video Queries
 *
 * Database queries for educational video management.
 * Uses V_Videos view for reading and tblvideos table for CRUD.
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES } from '../index.js';
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
 * Helper function to map columns to Video object
 */
function mapRowToVideo(columns: ColumnValue[]): Video {
  return {
    ID: columns[0].value as number,
    Description: columns[1].value as string,
    Video: columns[2].value as string,
    Image: columns[3].value as string,
    Category: columns[4].value as number | null,
    Details: columns[5].value as string | null,
  };
}

/**
 * Helper function to map columns to VideoRecord object
 */
function mapRowToVideoRecord(columns: ColumnValue[]): VideoRecord {
  return {
    ID: columns[0].value as number,
    Description: columns[1].value as string,
    Category: columns[2].value as number | null,
    Details: columns[3].value as string | null,
    FileName: columns[4].value as string | null,
    VideoExtension: columns[5].value as string | null,
  };
}

/**
 * Get all videos (uses V_Videos view)
 */
export async function getAllVideos(): Promise<Video[]> {
  try {
    const query = `
      SELECT ID, Description, Video, Image, Category, Details
      FROM dbo.V_Videos
      ORDER BY Description
    `;

    return executeQuery<Video>(query, [], mapRowToVideo);
  } catch (error) {
    log.error('Error fetching all videos', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Get video by ID (uses V_Videos view)
 */
export async function getVideoById(id: number): Promise<Video | null> {
  try {
    const query = `
      SELECT ID, Description, Video, Image, Category, Details
      FROM dbo.V_Videos
      WHERE ID = @id
    `;

    const result = await executeQuery<Video>(
      query,
      [['id', TYPES.Int, id]],
      mapRowToVideo
    );

    return result.length > 0 ? result[0] : null;
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
    const query = `
      SELECT ID, Description, Category, Details, FileName, VideoExtension
      FROM dbo.tblvideos
      WHERE ID = @id
    `;

    const result = await executeQuery<VideoRecord>(
      query,
      [['id', TYPES.Int, id]],
      mapRowToVideoRecord
    );

    return result.length > 0 ? result[0] : null;
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
    const query = `
      SELECT OptionValue
      FROM dbo.tbloptions
      WHERE OptionName = 'VideosPath'
    `;

    const result = await executeQuery<{ path: string }>(
      query,
      [],
      (columns: ColumnValue[]) => ({ path: columns[0].value as string })
    );

    if (result.length === 0 || !result[0].path) {
      throw new Error('VideosPath not configured in tbloptions');
    }

    return result[0].path;
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
    const query = `
      SELECT VidCatID, Category
      FROM dbo.tblVidCat
      ORDER BY VidCatID
    `;

    const result = await executeQuery<VideoCategory>(
      query,
      [],
      (columns: ColumnValue[]) => ({
        id: columns[0].value as number,
        name: columns[1].value as string,
      })
    );

    return result;
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
    const query = `
      INSERT INTO dbo.tblvideos (Description, Category, Details, FileName, VideoExtension)
      OUTPUT INSERTED.ID
      VALUES (@description, @category, @details, @fileName, @videoExtension)
    `;

    const result = await executeQuery<{ ID: number }>(
      query,
      [
        ['description', TYPES.NVarChar, data.description],
        ['category', TYPES.Int, data.category ?? null],
        ['details', TYPES.NVarChar, data.details ?? null],
        ['fileName', TYPES.NVarChar, data.fileName],
        ['videoExtension', TYPES.NVarChar, data.videoExtension],
      ],
      (columns: ColumnValue[]) => ({ ID: columns[0].value as number })
    );

    if (result.length === 0) {
      throw new Error('Failed to create video record');
    }

    log.info('Video record created', { id: result[0].ID, description: data.description });
    return result[0].ID;
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
    const setClauses: string[] = [];
    const params: [string, typeof TYPES[keyof typeof TYPES], unknown][] = [
      ['id', TYPES.Int, id],
    ];

    if (data.description !== undefined) {
      setClauses.push('Description = @description');
      params.push(['description', TYPES.NVarChar, data.description]);
    }

    if (data.category !== undefined) {
      setClauses.push('Category = @category');
      params.push(['category', TYPES.Int, data.category]);
    }

    if (data.details !== undefined) {
      setClauses.push('Details = @details');
      params.push(['details', TYPES.NVarChar, data.details]);
    }

    if (setClauses.length === 0) {
      return false;
    }

    const query = `
      UPDATE dbo.tblvideos
      SET ${setClauses.join(', ')}
      WHERE ID = @id
    `;

    const result = await executeQuery(query, params, () => ({}));
    const updated = (result.rowsAffected ?? 0) > 0;

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
    const query = `
      DELETE FROM dbo.tblvideos
      WHERE ID = @id
    `;

    const result = await executeQuery(
      query,
      [['id', TYPES.Int, id]],
      () => ({})
    );

    const deleted = (result.rowsAffected ?? 0) > 0;

    if (deleted) {
      log.info('Video record deleted', { id });
    }

    return deleted;
  } catch (error) {
    log.error('Error deleting video record', { id, error: (error as Error).message });
    throw error;
  }
}
