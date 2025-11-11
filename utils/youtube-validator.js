/**
 * YouTube URL Validator
 * Validates and extracts YouTube video IDs from various URL formats
 */

/**
 * Check if a URL is a valid YouTube URL
 * Supports multiple formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 *
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid YouTube URL
 */
export function isValidYouTubeUrl(url) {
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
 * @param {string} url - YouTube URL
 * @returns {string|null} - Video ID or null if not found
 */
export function extractYouTubeVideoId(url) {
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
 * @param {string} url - YouTube URL
 * @returns {string|null} - Embed URL or null if invalid
 */
export function getYouTubeEmbedUrl(url) {
    const videoId = extractYouTubeVideoId(url);
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}

/**
 * Get YouTube thumbnail URL
 *
 * @param {string} url - YouTube URL
 * @param {string} quality - Thumbnail quality: 'default', 'hq', 'mq', 'sd', 'maxres'
 * @returns {string|null} - Thumbnail URL or null if invalid
 */
export function getYouTubeThumbnailUrl(url, quality = 'hq') {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return null;

    const qualityMap = {
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
 * @param {string} url - YouTube URL (any format)
 * @returns {string|null} - Standard watch URL or null if invalid
 */
export function formatYouTubeUrl(url) {
    const videoId = extractYouTubeVideoId(url);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
