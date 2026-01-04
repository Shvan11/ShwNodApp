/**
 * Public Video Routes
 *
 * Public endpoints for patient access to educational videos.
 * No authentication required - videos are educational content.
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';
import * as videoQueries from '../../services/database/queries/video-queries.js';

const router = Router();

// Type definitions
interface VideoIdParams {
  id: string;
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
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Convert Windows/UNC path from database to WSL-compatible path
 */
function normalizePath(dbPath: string): string {
  let normalizedPath = dbPath;
  const isWSL = process.platform === 'linux';

  if (isWSL) {
    if (normalizedPath.startsWith('\\\\CLINIC\\ovideos')) {
      normalizedPath = normalizedPath.replace('\\\\CLINIC\\ovideos', '/mnt/c/ovideos');
    } else if (/^[A-Za-z]:\\/.test(normalizedPath)) {
      const driveLetter = normalizedPath.charAt(0).toLowerCase();
      normalizedPath = normalizedPath.replace(/^[A-Za-z]:\\/, `/mnt/${driveLetter}/`);
    }
    normalizedPath = normalizedPath.replace(/\\/g, '/');
  }

  return normalizedPath;
}

// ==============================
// PUBLIC VIDEO ENDPOINTS
// ==============================

/**
 * Get video info (JSON)
 * GET /:id/info
 */
router.get('/:id/info', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid video ID' });
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    res.json({
      id: video.ID,
      title: video.Description,
      details: video.Details,
    });
  } catch (error) {
    log.error('[Public Video] Error fetching video info:', error);
    res.status(500).json({ error: 'Failed to fetch video info' });
  }
});

/**
 * Stream video file
 * GET /:id/stream
 */
router.get('/:id/stream', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid video ID' });
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const filePath = normalizePath(video.Video);

    if (!fs.existsSync(filePath)) {
      log.error('[Public Video] Video file not found:', { path: filePath });
      res.status(404).json({ error: 'Video file not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = getMimeType(filePath);

    if (range) {
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
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    log.error('[Public Video] Error streaming video:', error);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

/**
 * Download video file
 * GET /:id/download
 */
router.get('/:id/download', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid video ID' });
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const filePath = normalizePath(video.Video);

    if (!fs.existsSync(filePath)) {
      log.error('[Public Video] Video file not found:', { path: filePath });
      res.status(404).json({ error: 'Video file not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileName = `${video.Description.replace(/[^a-zA-Z0-9\s-]/g, '').trim()}${path.extname(filePath)}`;
    const mimeType = getMimeType(filePath);

    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    log.error('[Public Video] Error downloading video:', error);
    res.status(500).json({ error: 'Failed to download video' });
  }
});

/**
 * Public video page (HTML)
 * GET /:id
 */
router.get('/:id', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).send('Invalid video ID');
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      res.status(404).send('Video not found');
      return;
    }

    // Generate a simple HTML page with embedded video player
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(video.Description)} - Shwan Orthodontics</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    .logo {
      margin-bottom: 20px;
      text-align: center;
    }
    .logo h1 {
      color: white;
      font-size: 24px;
      font-weight: 600;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 800px;
      width: 100%;
      overflow: hidden;
    }
    .video-container {
      position: relative;
      padding-top: 56.25%;
      background: #000;
    }
    video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .content {
      padding: 24px;
    }
    .title {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 8px;
    }
    .details {
      color: #666;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .download-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #667eea;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
      transition: background 0.2s;
    }
    .download-btn:hover {
      background: #5a6fd6;
    }
    .footer {
      margin-top: 20px;
      color: rgba(255,255,255,0.8);
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="logo">
    <h1>Shwan Orthodontics</h1>
  </div>
  <div class="card">
    <div class="video-container">
      <video controls autoplay playsinline>
        <source src="/v/${id}/stream" type="video/mp4">
        Your browser does not support the video tag.
      </video>
    </div>
    <div class="content">
      <h2 class="title">${escapeHtml(video.Description)}</h2>
      ${video.Details ? `<p class="details">${escapeHtml(video.Details)}</p>` : ''}
      <a href="/v/${id}/download" class="download-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download Video
      </a>
    </div>
  </div>
  <p class="footer">Educational content from Shwan Orthodontics</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    log.error('[Public Video] Error rendering video page:', error);
    res.status(500).send('Failed to load video page');
  }
});

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

export default router;
