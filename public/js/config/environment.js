/**
 * Environment Configuration
 *
 * Centralizes environment-specific URLs and settings.
 * In production, these values are automatically derived from window.location.
 * In development with Vite, you can override with environment variables.
 */

// Determine if we're in development mode
const isDevelopment = import.meta.env?.MODE === 'development';

// Get API URL
// In production: Same origin as the page
// In development: Can override with VITE_API_URL or defaults to localhost:3000
const getApiUrl = () => {
  if (typeof import.meta.env?.VITE_API_URL !== 'undefined') {
    return import.meta.env.VITE_API_URL;
  }

  if (isDevelopment) {
    return 'http://localhost:3000';
  }

  // Production: Use same origin
  return window.location.origin;
};

// Get WebSocket URL
// Automatically converts http:// to ws:// and https:// to wss://
const getWebSocketUrl = () => {
  if (typeof import.meta.env?.VITE_WS_URL !== 'undefined') {
    return import.meta.env.VITE_WS_URL;
  }

  const apiUrl = getApiUrl();
  const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws';
  const urlObj = new URL(apiUrl);

  return `${wsProtocol}://${urlObj.host}`;
};

// Export configuration
export const config = {
  // Environment
  isDevelopment,
  isProduction: !isDevelopment,

  // URLs
  apiUrl: getApiUrl(),
  wsUrl: getWebSocketUrl(),

  // Application settings
  appName: 'Shwan Orthodontics',
  version: '1.0.0',
};

// Log configuration in development
if (isDevelopment) {
  console.log('[Environment] Configuration loaded:', {
    mode: import.meta.env?.MODE,
    apiUrl: config.apiUrl,
    wsUrl: config.wsUrl,
  });
}

export default config;
