/**
 * Video Routes
 *
 * Provides endpoints for educational video management including
 * listing, streaming, uploading, updating, and deleting videos.
 */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendSuccess } from '../../utils/error-response.js';
import * as videoQueries from '../../services/database/queries/video-queries.js';
import { generateVideoQRCode } from '../../services/imaging/qrcode.js';

const router = Router();

// Cache for videos path from database
let cachedVideosPath: string | null = null;

/**
 * Get the videos upload path, converting for WSL if needed
 */
async function getVideosUploadPath(): Promise<string> {
  if (!cachedVideosPath) {
    cachedVideosPath = await videoQueries.getVideosPath();
  }
  return normalizePath(cachedVideosPath);
}

// Configure multer for video uploads with disk storage
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      const uploadPath = await getVideosUploadPath();
      cb(null, uploadPath);
    } catch (error) {
      cb(error as Error, '');
    }
  },
  filename: (_req, file, cb) => {
    // Generate unique filename based on timestamp
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${baseName}_${timestamp}${ext}`);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void => {
  // Accept video files and images
  const videoTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
  const imageTypes = ['image/jpeg', 'image/png', 'image/jpg'];

  if (videoTypes.includes(file.mimetype) || imageTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only video files (mp4, webm, ogg) and images (jpg, png) are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max for videos
  },
});

// Type definitions
interface VideoIdParams {
  id: string;
}

interface CreateVideoBody {
  description: string;
  category?: string;
  details?: string;
}

interface UpdateVideoBody {
  description?: string;
  category?: string;
  details?: string;
}

/**
 * Get MIME type based on file extension
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Convert Windows/UNC path from database to WSL-compatible path
 *
 * Database path: \\CLINIC\ovideos\filename.mp4
 * Windows local: C:\ovideos\filename.mp4
 * WSL path:      /mnt/c/ovideos/filename.mp4
 */
function normalizePath(dbPath: string): string {
  let normalizedPath = dbPath;

  // Check if running on WSL (Linux) or Windows
  const isWSL = process.platform === 'linux';

  if (isWSL) {
    // Convert UNC path \\CLINIC\ovideos\ to /mnt/c/ovideos/
    // The UNC path starts with two backslashes (\\CLINIC)
    if (normalizedPath.startsWith('\\\\CLINIC\\ovideos')) {
      normalizedPath = normalizedPath.replace('\\\\CLINIC\\ovideos', '/mnt/c/ovideos');
    }
    // Convert Windows path C:\ovideos\ to /mnt/c/ovideos/
    else if (/^[A-Za-z]:\\/.test(normalizedPath)) {
      const driveLetter = normalizedPath.charAt(0).toLowerCase();
      normalizedPath = normalizedPath.replace(/^[A-Za-z]:\\/, `/mnt/${driveLetter}/`);
    }
    // Convert remaining backslashes to forward slashes for Linux
    normalizedPath = normalizedPath.replace(/\\/g, '/');
  }

  return normalizedPath;
}

// ==============================
// READ ENDPOINTS
// ==============================

/**
 * Get all videos
 * GET /
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const videos = await videoQueries.getAllVideos();
    sendSuccess(res, videos);
  } catch (error) {
    log.error('[Videos] Error fetching videos:', error);
    ErrorResponses.serverError(res, 'Failed to fetch videos', error as Error);
  }
});

/**
 * Get video categories (for filter dropdown)
 * GET /categories
 */
router.get('/categories', async (_req: Request, res: Response): Promise<void> => {
  try {
    const categories = await videoQueries.getVideoCategories();
    sendSuccess(res, categories);
  } catch (error) {
    log.error('[Videos] Error fetching categories:', error);
    ErrorResponses.serverError(res, 'Failed to fetch categories', error as Error);
  }
});

/**
 * Get single video details
 * GET /:id
 */
router.get('/:id', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      ErrorResponses.invalidParameter(res, 'id');
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      ErrorResponses.notFound(res, 'Video');
      return;
    }

    sendSuccess(res, video);
  } catch (error) {
    log.error('[Videos] Error fetching video:', error);
    ErrorResponses.serverError(res, 'Failed to fetch video', error as Error);
  }
});

/**
 * Stream video file with Range support
 * GET /:id/stream
 */
router.get('/:id/stream', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      ErrorResponses.invalidParameter(res, 'id');
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      ErrorResponses.notFound(res, 'Video');
      return;
    }

    const filePath = normalizePath(video.Video);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      log.error('[Videos] Video file not found:', { path: filePath });
      ErrorResponses.notFound(res, 'Video file');
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = getMimeType(filePath);

    if (range) {
      // Handle range request for video seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      fileStream.pipe(res);
    } else {
      // No range - send entire file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    log.error('[Videos] Error streaming video:', error);
    ErrorResponses.serverError(res, 'Failed to stream video', error as Error);
  }
});

/**
 * Get video thumbnail
 * GET /:id/thumbnail
 */
router.get('/:id/thumbnail', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      ErrorResponses.invalidParameter(res, 'id');
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      ErrorResponses.notFound(res, 'Video');
      return;
    }

    const filePath = normalizePath(video.Image);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      log.warn('[Videos] Thumbnail not found:', { path: filePath });
      // Return a 404 or default placeholder
      ErrorResponses.notFound(res, 'Thumbnail');
      return;
    }

    const stat = fs.statSync(filePath);
    const mimeType = getMimeType(filePath);

    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
    });

    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    log.error('[Videos] Error fetching thumbnail:', error);
    ErrorResponses.serverError(res, 'Failed to fetch thumbnail', error as Error);
  }
});

/**
 * Generate QR code for sharing video
 * GET /:id/qr
 */
router.get('/:id/qr', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      ErrorResponses.invalidParameter(res, 'id');
      return;
    }

    // Verify video exists
    const video = await videoQueries.getVideoById(id);
    if (!video) {
      ErrorResponses.notFound(res, 'Video');
      return;
    }

    // Generate QR code
    const qrResult = await generateVideoQRCode(id);

    sendSuccess(res, {
      qr: qrResult.qr,
      url: qrResult.url,
      title: video.Description,
    });
  } catch (error) {
    log.error('[Videos] Error generating QR code:', error);
    ErrorResponses.serverError(res, 'Failed to generate QR code', error as Error);
  }
});

// ==============================
// CREATE ENDPOINT
// ==============================

/**
 * Upload new video
 * POST /
 * Multipart form: video (required), thumbnail (optional), description, category, details
 */
router.post(
  '/',
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  async (req: Request<object, object, CreateVideoBody>, res: Response): Promise<void> => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      if (!files?.video?.[0]) {
        ErrorResponses.missingParameter(res, 'video file');
        return;
      }

      const { description, category, details } = req.body;

      if (!description) {
        // Clean up uploaded files if validation fails
        if (files.video?.[0]) fs.unlinkSync(files.video[0].path);
        if (files.thumbnail?.[0]) fs.unlinkSync(files.thumbnail[0].path);
        ErrorResponses.missingParameter(res, 'description');
        return;
      }

      const videoFile = files.video[0];
      const thumbnailFile = files.thumbnail?.[0];

      // Extract filename without extension
      const ext = path.extname(videoFile.filename);
      const fileName = path.basename(videoFile.filename, ext);

      // If thumbnail provided, rename to match video filename with .jpg extension
      if (thumbnailFile) {
        const uploadPath = await getVideosUploadPath();
        const newThumbnailPath = path.join(uploadPath, `${fileName}.jpg`);

        if (thumbnailFile.path !== newThumbnailPath) {
          fs.renameSync(thumbnailFile.path, newThumbnailPath);
        }
      }

      // Create database record
      const newId = await videoQueries.createVideo({
        description,
        category: category ? parseInt(category, 10) : undefined,
        details: details || undefined,
        fileName,
        videoExtension: ext.replace('.', ''),
      });

      // Fetch the created video to return full details
      const video = await videoQueries.getVideoById(newId);

      log.info('[Videos] Video uploaded successfully', { id: newId, fileName });
      sendSuccess(res, video, 'Video uploaded successfully');
    } catch (error) {
      log.error('[Videos] Error uploading video:', error);
      ErrorResponses.serverError(res, 'Failed to upload video', error as Error);
    }
  }
);

// ==============================
// UPDATE ENDPOINT
// ==============================

/**
 * Update video metadata
 * PUT /:id
 */
router.put('/:id', async (req: Request<VideoIdParams, object, UpdateVideoBody>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      ErrorResponses.invalidParameter(res, 'id');
      return;
    }

    const { description, category, details } = req.body;

    // Check if video exists
    const existing = await videoQueries.getVideoById(id);
    if (!existing) {
      ErrorResponses.notFound(res, 'Video');
      return;
    }

    // Update video metadata
    const updated = await videoQueries.updateVideo(id, {
      description,
      category: category !== undefined ? (category === '' ? null : parseInt(category, 10)) : undefined,
      details: details !== undefined ? (details === '' ? null : details) : undefined,
    });

    if (!updated) {
      ErrorResponses.badRequest(res, 'No fields to update');
      return;
    }

    // Fetch updated video
    const video = await videoQueries.getVideoById(id);

    log.info('[Videos] Video updated successfully', { id });
    sendSuccess(res, video, 'Video updated successfully');
  } catch (error) {
    log.error('[Videos] Error updating video:', error);
    ErrorResponses.serverError(res, 'Failed to update video', error as Error);
  }
});

// ==============================
// DELETE ENDPOINT
// ==============================

/**
 * Delete video
 * DELETE /:id
 */
router.delete('/:id', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      ErrorResponses.invalidParameter(res, 'id');
      return;
    }

    // Get video details before deleting
    const video = await videoQueries.getVideoById(id);
    if (!video) {
      ErrorResponses.notFound(res, 'Video');
      return;
    }

    // Delete video file
    const videoPath = normalizePath(video.Video);
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
      log.info('[Videos] Video file deleted', { path: videoPath });
    }

    // Delete thumbnail file
    const thumbnailPath = normalizePath(video.Image);
    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath);
      log.info('[Videos] Thumbnail file deleted', { path: thumbnailPath });
    }

    // Delete database record
    const deleted = await videoQueries.deleteVideo(id);
    if (!deleted) {
      ErrorResponses.serverError(res, 'Failed to delete video record');
      return;
    }

    log.info('[Videos] Video deleted successfully', { id });
    sendSuccess(res, { id }, 'Video deleted successfully');
  } catch (error) {
    log.error('[Videos] Error deleting video:', error);
    ErrorResponses.serverError(res, 'Failed to delete video', error as Error);
  }
});

export default router;
