/**
 * YouTube URL Validator
 * Validates and extracts YouTube video IDs from various URL formats
 */

/**
 * Thumbnail quality options
 */
export type ThumbnailQuality = 'default' | 'hq' | 'mq' | 'sd' | 'maxres';

/**
 * Check if a URL is a valid YouTube URL
 * Supports multiple formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 *
 * @param url - URL to validate
 * @returns True if valid YouTube URL
 */
export function isValidYouTubeUrl(url: string | null | undefined): boolean {
  if (!url) return true; // Allow empty/null

  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^https?:\/\/youtu\.be\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/
  ];

  return patterns.some(pattern => pattern.test(url));
}

/**
 * Extract YouTube video ID from URL
 *
 * @param url - YouTube URL
 * @returns Video ID or null if not found
 */
export function extractYouTubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;

  const patterns = [
    /youtube\.com\/watch\?v=([\w-]+)/,
    /youtu\.be\/([\w-]+)/,
    /youtube\.com\/embed\/([\w-]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Get YouTube embed URL from any YouTube URL format
 *
 * @param url - YouTube URL
 * @returns Embed URL or null if invalid
 */
export function getYouTubeEmbedUrl(url: string | null | undefined): string | null {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}

/**
 * Get YouTube thumbnail URL
 *
 * @param url - YouTube URL
 * @param quality - Thumbnail quality: 'default', 'hq', 'mq', 'sd', 'maxres'
 * @returns Thumbnail URL or null if invalid
 */
export function getYouTubeThumbnailUrl(
  url: string | null | undefined,
  quality: ThumbnailQuality = 'hq'
): string | null {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;

  const qualityMap: Record<ThumbnailQuality, string> = {
    'default': 'default.jpg',
    'hq': 'hqdefault.jpg',
    'mq': 'mqdefault.jpg',
    'sd': 'sddefault.jpg',
    'maxres': 'maxresdefault.jpg'
  };

  const filename = qualityMap[quality] || qualityMap['hq'];
  return `https://img.youtube.com/vi/${videoId}/${filename}`;
}

/**
 * Format YouTube URL to standard watch format
 *
 * @param url - YouTube URL (any format)
 * @returns Standard watch URL or null if invalid
 */
export function formatYouTubeUrl(url: string | null | undefined): string | null {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

export default {
  isValidYouTubeUrl,
  extractYouTubeVideoId,
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  formatYouTubeUrl
};
