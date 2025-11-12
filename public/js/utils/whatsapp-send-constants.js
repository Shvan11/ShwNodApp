/**
 * WhatsApp Send Page Constants
 * Shared configuration and constants for the WhatsApp send page
 */

// Configuration Constants
export const CONFIG = {
    // Timing constants
    DEDUPLICATION_WINDOW_MS: 5000,
    PROGRESS_BAR_INTERVAL_MS: 200,
    PROGRESS_BAR_MAX_WIDTH: 90,
    HEARTBEAT_INTERVAL_MS: 60000,
    ERROR_DISPLAY_DURATION_MS: 10000,
    MAX_RECONNECT_ATTEMPTS: 20,

    // Delay constants
    WEBSOCKET_RECONNECT_DELAY_MS: 500,
    CLIENT_RESTART_DELAY_MS: 2000,
    LOGOUT_DELAY_MS: 1000,
    DEBOUNCE_DELAY_MS: 300,
    OPERATION_TIMEOUT_MS: 30000,

    // Retry constants
    RETRY_BASE_DELAY_MS: 1000,
    RETRY_MAX_DELAY_MS: 10000,
    RETRY_MAX_ATTEMPTS: 3,

    // Date range
    DATE_RANGE_DAYS_BACK: 7,
    DATE_RANGE_DAYS_FORWARD: 30
};

// API Endpoints
export const API_ENDPOINTS = {
    MESSAGE_COUNT: (date) => `/api/messaging/count/${date}`,
    MESSAGE_RESET: (date) => `/api/messaging/reset/${date}`,
    MESSAGE_STATUS: (date) => `/api/messaging/status/${date}`,
    WA_SEND: (date) => `/api/wa/send?date=${date}`,
    SEND_EMAIL: (date) => `/api/email/send-appointments?date=${date}`
};

// State Constants
export const UI_STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    SENDING: 'sending',
    COMPLETED: 'completed',
    ERROR: 'error'
};

export const MESSAGE_TYPES = {
    LOADING: 'loading',
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning'
};

export const BUTTON_STATES = {
    NORMAL: 'normal',
    LOADING: 'loading',
    CONFIRMING: 'confirming',
    DISABLED: 'disabled'
};

// Message Status Constants
export const MESSAGE_STATUS = {
    PENDING: 0,
    SERVER: 1,
    DEVICE: 2,
    READ: 3,
    PLAYED: 4,
    FAILED: -1,
    INVALID_PHONE: -2
};

export const MESSAGE_STATUS_TEXT = {
    [MESSAGE_STATUS.PENDING]: 'Pending',
    [MESSAGE_STATUS.SERVER]: 'Server',
    [MESSAGE_STATUS.DEVICE]: 'Device',
    [MESSAGE_STATUS.READ]: 'Read',
    [MESSAGE_STATUS.PLAYED]: 'Played',
    [MESSAGE_STATUS.FAILED]: 'Failed',
    [MESSAGE_STATUS.INVALID_PHONE]: 'Invalid Phone',
};

export const MESSAGE_STATUS_CLASS = {
    [MESSAGE_STATUS.PENDING]: 'status-pending',
    [MESSAGE_STATUS.SERVER]: 'status-server',
    [MESSAGE_STATUS.DEVICE]: 'status-device',
    [MESSAGE_STATUS.READ]: 'status-read',
    [MESSAGE_STATUS.PLAYED]: 'status-played',
    [MESSAGE_STATUS.FAILED]: 'status-failed',
    [MESSAGE_STATUS.INVALID_PHONE]: 'status-invalid',
};
