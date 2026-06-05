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
import { getMediaMimeType } from '../../utils/video-mime.js';
import { streamFile } from '../../utils/stream-file.js';
import * as videoQueries from '../../services/database/queries/video-queries.js';
import * as videoContract from '../../shared/contracts/video.contract.js';

const router = Router();

// `:id` path param — contracted in shared/contracts/video.contract.ts (type-only).
type VideoIdParams = videoContract.VideoIdParams;

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
 * Stream video file
 * GET /:id/stream
 */
router.get('/:id/stream', async (req: Request<VideoIdParams>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid video id' });
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const filePath = normalizePath(video.Video);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      log.error('[Public Video] Video file not found:', { path: filePath });
      res.status(404).json({ error: 'Video file not found' });
      return;
    }
    const mimeType = getMediaMimeType(filePath);

    // Range validation + stream error handling live in the shared helper.
    streamFile(req, res, filePath, stat.size, mimeType);
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
      res.status(400).json({ error: 'Invalid video id' });
      return;
    }

    const video = await videoQueries.getVideoById(id);
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const filePath = normalizePath(video.Video);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      log.error('[Public Video] Video file not found:', { path: filePath });
      res.status(404).json({ error: 'Video file not found' });
      return;
    }
    const fileName = `${video.description.replace(/[^a-zA-Z0-9\s-]/g, '').trim()}${path.extname(filePath)}`;
    const mimeType = getMediaMimeType(filePath);

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    streamFile(req, res, filePath, stat.size, mimeType);
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
      res.status(400).send('Invalid video id');
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
  <title>${escapeHtml(video.description)} - Shwan Orthodontics</title>
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
    .share-btn {
      display: none;
      align-items: center;
      gap: 8px;
      background: #667eea;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      border: none;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .share-btn:hover {
      background: #5a6fd6;
    }
    .buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .footer {
      margin-top: 20px;
      color: rgba(255,255,255,0.8);
      font-size: 14px;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      opacity: 0;
      transition: opacity 0.3s;
      z-index: 1000;
    }
    .toast.show { opacity: 1; }
    .toast.warning { background: #f59e0b; }
    .toast.error { background: #dc3545; }
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
      <h2 class="title">${escapeHtml(video.description)}</h2>
      ${video.details ? `<p class="details">${escapeHtml(video.details)}</p>` : ''}
      <div class="buttons">
        <a href="/v/${id}/download" class="download-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download Video
        </a>
        <button id="shareBtn" class="share-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
          </svg>
          Share Video
        </button>
      </div>
    </div>
  </div>
  <p class="footer">Educational content from Shwan Orthodontics</p>
  <div id="toast" class="toast"></div>
  <script>
    (function() {
      // Blob caching pattern (duplicated from GridComponent.tsx)
      var cachedBlob = { url: null, blob: null, fetchId: 0 };
      var isSharing = false;
      var videoUrl = '/v/${id}/stream';
      var videoTitle = '${escapeHtml(video.description).replace(/'/g, "\\'")}';

      // Toast notification
      function showToast(message, type) {
        var toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast ' + type + ' show';
        setTimeout(function() {
          toast.classList.remove('show');
        }, 3000);
      }

      // Pre-fetch blob for sharing (duplicated from GridComponent.tsx)
      function prefetchBlobForShare() {
        if (!navigator.share || !navigator.canShare) return;

        var currentFetchId = ++cachedBlob.fetchId;
        cachedBlob.url = null;
        cachedBlob.blob = null;

        fetch(videoUrl)
          .then(function(response) {
            if (!response.ok) return;
            return response.blob();
          })
          .then(function(blob) {
            if (blob && currentFetchId === cachedBlob.fetchId) {
              cachedBlob.url = videoUrl;
              cachedBlob.blob = blob;
            }
          })
          .catch(function() {
            // Silent fail - user will see "please wait" message if they try to share
          });
      }

      // Native share handler (duplicated from GridComponent.tsx)
      function handleShare() {
        if (isSharing) return;
        isSharing = true;

        if (cachedBlob.url !== videoUrl || !cachedBlob.blob) {
          showToast('Please wait a moment and try again', 'warning');
          isSharing = false;
          return;
        }

        var fileName = videoTitle.replace(/[^a-zA-Z0-9\\s-]/g, '').trim() + '.mp4';
        var file = new File([cachedBlob.blob], fileName, { type: 'video/mp4' });

        navigator.share({ files: [file] })
          .catch(function(err) {
            if (err.name !== 'AbortError') {
              showToast('Failed to share video', 'error');
            }
          })
          .finally(function() {
            isSharing = false;
          });
      }

      // Initialize on page load
      if ('share' in navigator && 'canShare' in navigator) {
        var shareBtn = document.getElementById('shareBtn');
        shareBtn.style.display = 'inline-flex';
        shareBtn.addEventListener('click', handleShare);

        // Pre-fetch blob on page load
        prefetchBlobForShare();
      }
    })();
  </script>
</body>
</html>`;

    res.setHeader('Content-type', 'text/html');
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
