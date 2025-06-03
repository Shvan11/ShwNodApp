/**
 * WhatsApp Messaging Page - Production Ready
 * Handles all WhatsApp messaging functionality with clean architecture
 */
import EventEmitter from '../core/events.js';

// Configuration Constants
const CONFIG = {
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
const API_ENDPOINTS = {
    MESSAGE_COUNT: (date) => `/api/messaging/count/${date}`,
    MESSAGE_RESET: (date) => `/api/messaging/reset/${date}`,
    WA_SEND: (date) => `/api/wa/send?date=${date}`,
    WA_RESTART: '/api/wa/restart',
    WA_DESTROY: '/api/wa/destroy',
    WA_LOGOUT: '/api/wa/logout',
    WA_STATUS: '/api/wa/status'
};

// State Constants
const UI_STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting', 
    CONNECTED: 'connected',
    SENDING: 'sending',
    COMPLETED: 'completed',
    ERROR: 'error'
};

const MESSAGE_TYPES = {
    LOADING: 'loading',
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning'
};

const BUTTON_STATES = {
    NORMAL: 'normal',
    LOADING: 'loading',
    CONFIRMING: 'confirming',
    DISABLED: 'disabled'
};

/**
 * Input Validation Manager
 */
class ValidationManager {
    static validateMessageCountResponse(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid response format');
        }
        
        if (!data.success) {
            throw new Error(data.error || 'Operation failed');
        }
        
        if (!data.data || typeof data.data !== 'object') {
            throw new Error('Invalid data structure');
        }
        
        const requiredFields = ['eligibleForMessaging', 'alreadySent'];
        for (const field of requiredFields) {
            if (typeof data.data[field] !== 'number') {
                throw new Error(`Missing or invalid field: ${field}`);
            }
        }
        
        return data.data;
    }
    
    static validateApiResponse(data, expectedFields = []) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid response format');
        }
        
        for (const field of expectedFields) {
            if (!(field in data)) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        return data;
    }
    
    static validateDate(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            throw new Error('Invalid date format');
        }
        
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            throw new Error('Invalid date value');
        }
        
        return dateString;
    }
}

/**
 * Retry Manager with Exponential Backoff
 */
class RetryManager {
    static async withRetry(operation, options = {}) {
        const {
            maxAttempts = CONFIG.RETRY_MAX_ATTEMPTS,
            baseDelay = CONFIG.RETRY_BASE_DELAY_MS,
            maxDelay = CONFIG.RETRY_MAX_DELAY_MS,
            onRetry = null
        } = options;
        
        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                if (attempt === maxAttempts) {
                    break;
                }
                
                const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
                
                if (onRetry) {
                    onRetry(error, attempt, delay);
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }
}

/**
 * API Client with Validation and Retry
 */
class APIClient {
    constructor() {
        this.abortControllers = new Map();
    }
    
    async request(url, options = {}) {
        const requestId = `${Date.now()}-${Math.random()}`;
        
        // Cancel previous request with same ID if needed
        if (options.cancelPrevious && this.abortControllers.has(options.cancelPrevious)) {
            this.abortControllers.get(options.cancelPrevious).abort();
        }
        
        // Create abort controller
        const abortController = new AbortController();
        const requestKey = options.cancelPrevious || requestId;
        this.abortControllers.set(requestKey, abortController);
        
        try {
            return await RetryManager.withRetry(async () => {
                const response = await fetch(url, {
                    signal: abortController.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    },
                    ...options
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                return ValidationManager.validateApiResponse(data, options.expectedFields || []);
            }, {
                onRetry: (error, attempt, delay) => {
                    console.warn(`API request retry ${attempt} for ${url} after ${delay}ms:`, error.message);
                }
            });
        } finally {
            this.abortControllers.delete(requestKey);
        }
    }
    
    async get(url, options = {}) {
        return this.request(url, { method: 'GET', ...options });
    }
    
    async post(url, data = null, options = {}) {
        return this.request(url, {
            method: 'POST',
            body: data ? JSON.stringify(data) : undefined,
            ...options
        });
    }
    
    cancelRequest(requestKey) {
        if (this.abortControllers.has(requestKey)) {
            this.abortControllers.get(requestKey).abort();
            this.abortControllers.delete(requestKey);
        }
    }
    
    cancelAllRequests() {
        for (const [key, controller] of this.abortControllers) {
            controller.abort();
        }
        this.abortControllers.clear();
    }
}

/**
 * Button State Manager
 */
class ButtonStateManager {
    constructor(domManager) {
        this.domManager = domManager;
        this.buttonStates = new Map();
        this.originalTexts = new Map();
    }
    
    setButtonState(buttonName, state, options = {}) {
        const button = this.domManager.getElement(buttonName);
        if (!button) return;
        
        // Store original text if not already stored
        if (!this.originalTexts.has(buttonName)) {
            this.originalTexts.set(buttonName, button.textContent);
        }
        
        // Remove existing state classes
        const existingState = this.buttonStates.get(buttonName);
        if (existingState) {
            button.classList.remove(`btn-${existingState}`);
        }
        
        // Apply new state
        this.buttonStates.set(buttonName, state);
        button.classList.add(`btn-${state}`);
        
        switch (state) {
            case BUTTON_STATES.LOADING:
                button.disabled = true;
                button.textContent = options.text || 'Loading...';
                button.setAttribute('aria-busy', 'true');
                break;
                
            case BUTTON_STATES.CONFIRMING:
                button.disabled = false;
                button.textContent = options.text || 'Click Again to Confirm';
                button.setAttribute('aria-expanded', 'true');
                
                // Auto-reset after timeout
                if (options.timeout !== false) {
                    setTimeout(() => {
                        this.resetButton(buttonName);
                    }, options.timeout || 3000);
                }
                break;
                
            case BUTTON_STATES.DISABLED:
                button.disabled = true;
                button.removeAttribute('aria-busy');
                button.removeAttribute('aria-expanded');
                break;
                
            case BUTTON_STATES.NORMAL:
            default:
                button.disabled = false;
                button.textContent = options.text || this.originalTexts.get(buttonName);
                button.removeAttribute('aria-busy');
                button.removeAttribute('aria-expanded');
                break;
        }
    }
    
    resetButton(buttonName) {
        this.setButtonState(buttonName, BUTTON_STATES.NORMAL);
    }
    
    isButtonInState(buttonName, state) {
        return this.buttonStates.get(buttonName) === state;
    }
}

/**
 * Application State Manager
 */
class AppStateManager extends EventEmitter {
    constructor() {
        super();
        this.state = {
            currentDate: null,
            connectionStatus: UI_STATES.DISCONNECTED,
            messageCount: null,
            sendingProgress: {
                started: false,
                finished: false,
                total: 0,
                sent: 0,
                failed: 0
            },
            clientStatus: {
                ready: false,
                qrCode: null,
                error: null
            }
        };
    }

    updateState(updates) {
        const oldState = { ...this.state };
        const originalUpdates = { ...updates }; // Keep original updates for the event
        
        // Deep merge for nested objects
        if (updates.sendingProgress) {
            this.state.sendingProgress = { ...this.state.sendingProgress, ...updates.sendingProgress };
            delete updates.sendingProgress;
        }
        
        if (updates.clientStatus) {
            this.state.clientStatus = { ...this.state.clientStatus, ...updates.clientStatus };
            delete updates.clientStatus;
        }
        
        this.state = { ...this.state, ...updates };
        this.emit('stateChanged', { oldState, newState: this.state, updates: originalUpdates });
    }

    getState() {
        return JSON.parse(JSON.stringify(this.state)); // Deep clone
    }

    reset() {
        const initialState = {
            connectionStatus: UI_STATES.DISCONNECTED,
            sendingProgress: {
                started: false,
                finished: false,
                total: 0,
                sent: 0,
                failed: 0
            },
            clientStatus: {
                ready: false,
                qrCode: null,
                error: null
            }
        };
        this.updateState(initialState);
    }
}

/**
 * DOM Element Manager with Accessibility
 */
class DOMManager {
    constructor() {
        this.elements = {};
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;

        // Cache all DOM elements
        this.elements = {
            // Date controls
            dateSelector: document.getElementById('dateSelector'),
            refreshDateBtn: document.getElementById('refreshDateBtn'),
            resetMessagingBtn: document.getElementById('resetMessagingBtn'),
            messageCountElement: document.getElementById('messageCount'),

            // Client controls  
            restartClientBtn: document.getElementById('restartClientBtn'),
            destroyClientBtn: document.getElementById('destroyClientBtn'),
            logoutClientBtn: document.getElementById('logoutClientBtn'),

            // Main UI
            stateElement: document.getElementById('state'),
            startButton: document.getElementById('startButton'),
            qrImage: document.getElementById('qrImage'),
            qrContainer: document.getElementById('qrContainer'),
            tableContainer: document.getElementById('tableContainer'),
            
            // Header status
            connectionText: document.querySelector('.connection-text')
        };

        // Validate required elements exist in DOM (even if hidden)
        const requiredElements = ['dateSelector', 'stateElement', 'startButton'];
        const missingElements = requiredElements.filter(id => {
            const element = this.elements[id];
            return !element || !document.contains(element);
        });
        
        if (missingElements.length > 0) {
            console.error('DOM elements found:', Object.keys(this.elements).filter(key => this.elements[key]));
            console.error('Missing elements:', missingElements);
            throw new Error(`Missing required DOM elements: ${missingElements.join(', ')}`);
        }

        // Setup accessibility
        this.setupAccessibility();

        this.initialized = true;
        console.log('DOM Manager initialized successfully');
    }
    
    setupAccessibility() {
        // Setup ARIA live regions
        if (this.elements.stateElement) {
            this.elements.stateElement.setAttribute('aria-live', 'polite');
            this.elements.stateElement.setAttribute('aria-atomic', 'true');
        }
        
        if (this.elements.messageCountElement) {
            this.elements.messageCountElement.setAttribute('aria-live', 'polite');
        }
        
        // Setup button labels
        const buttonLabels = {
            refreshDateBtn: 'Refresh message count for selected date',
            resetMessagingBtn: 'Reset all message statuses for selected date',
            restartClientBtn: 'Restart WhatsApp client while preserving authentication',
            destroyClientBtn: 'Close WhatsApp client browser but preserve authentication',
            logoutClientBtn: 'Completely logout WhatsApp client and clear authentication',
            startButton: 'Start sending WhatsApp messages to selected date appointments'
        };
        
        Object.entries(buttonLabels).forEach(([elementName, label]) => {
            const element = this.elements[elementName];
            if (element && !element.getAttribute('aria-label')) {
                element.setAttribute('aria-label', label);
            }
        });
    }

    getElement(elementName) {
        if (!this.initialized) {
            throw new Error('DOM Manager not initialized');
        }
        return this.elements[elementName];
    }

    setElementContent(elementName, content, options = {}) {
        const element = this.getElement(elementName);
        if (!element) {
            console.error(`Element ${elementName} not found when trying to set content:`, content);
            return;
        }
        
        console.log(`Setting content for ${elementName}:`, content);
        
        if (typeof content === 'string') {
            if (options.isHTML) {
                element.innerHTML = content;
            } else {
                element.textContent = content;
            }
        } else {
            element.textContent = String(content);
        }
        
        console.log(`Content set successfully for ${elementName}. Current content:`, element.textContent);
        
        // Announce to screen readers if specified
        if (options.announce && element.hasAttribute('aria-live')) {
            // Force screen reader announcement by briefly changing aria-live
            const originalLive = element.getAttribute('aria-live');
            element.setAttribute('aria-live', 'assertive');
            setTimeout(() => {
                element.setAttribute('aria-live', originalLive);
            }, 100);
        }
    }

    setElementAttribute(elementName, attribute, value) {
        const element = this.getElement(elementName);
        if (element) {
            element.setAttribute(attribute, value);
        }
    }

    toggleElementVisibility(elementName, visible) {
        const element = this.getElement(elementName);
        if (element) {
            element.style.display = visible ? 'block' : 'none';
            element.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
    }

    setElementDisabled(elementName, disabled) {
        const element = this.getElement(elementName);
        if (element) {
            element.disabled = disabled;
            element.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }
    }
}

/**
 * Message Display Manager with Auto-Clear
 */
class MessageDisplayManager {
    constructor(domManager) {
        this.domManager = domManager;
        this.activeMessages = new Set();
        this.messageTimers = new Map();
    }

    displayMessage(text, type = MESSAGE_TYPES.SUCCESS, duration = null) {
        const messageElement = this.domManager.getElement('messageCountElement');
        if (!messageElement) return;

        // Clear existing timer
        const existingTimer = this.messageTimers.get('messageCount');
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Clear existing message classes
        messageElement.className = `message-count-info ${type}`;
        messageElement.textContent = text;

        // Auto-clear after duration
        const autoClearDuration = duration || (
            type === MESSAGE_TYPES.ERROR ? CONFIG.ERROR_DISPLAY_DURATION_MS :
            type === MESSAGE_TYPES.SUCCESS ? 5000 :
            type === MESSAGE_TYPES.WARNING ? 7000 : null
        );
        
        if (autoClearDuration) {
            const timer = setTimeout(() => {
                if (messageElement.textContent === text) {
                    this.clearMessages();
                }
                this.messageTimers.delete('messageCount');
            }, autoClearDuration);
            
            this.messageTimers.set('messageCount', timer);
        }
    }

    displayError(error, context = '') {
        const errorText = context 
            ? `${context}: ${error.message || error}`
            : (error.message || error);
        
        this.displayMessage(errorText, MESSAGE_TYPES.ERROR);
        console.error(context || 'Error:', error);
    }

    displayLoading(text = 'Loading...') {
        this.displayMessage(text, MESSAGE_TYPES.LOADING);
    }

    displayWarning(text, persistent = false) {
        this.displayMessage(text, MESSAGE_TYPES.WARNING, persistent ? null : 7000);
    }

    clearMessages() {
        const messageElement = this.domManager.getElement('messageCountElement');
        if (messageElement) {
            messageElement.textContent = '';
            messageElement.className = 'message-count-info';
        }
        
        // Clear any active timers
        for (const [key, timer] of this.messageTimers) {
            clearTimeout(timer);
        }
        this.messageTimers.clear();
    }
    
    cleanup() {
        this.clearMessages();
    }
}

/**
 * Date Management Service
 */
class DateManager extends EventEmitter {
    constructor() {
        super();
        this.currentDate = this.getDefaultDate();
        this.dateOptions = [];
    }

    getDefaultDate() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const urlDate = urlParams.get('date');
            
            if (urlDate) {
                ValidationManager.validateDate(urlDate);
                return urlDate;
            }
        } catch (error) {
            console.warn('Invalid date in URL parameters:', error.message);
        }
        
        // No URL date specified - use smart default
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
        
        let defaultDate = new Date(today);
        
        if (dayOfWeek === 4) { // Today is Thursday
            // Default to Saturday (skip Friday weekend)
            defaultDate.setDate(today.getDate() + 2);
        } else if (dayOfWeek === 5) { // Today is Friday (weekend)
            // Default to Saturday (tomorrow)
            defaultDate.setDate(today.getDate() + 1);
        } else {
            // Default to tomorrow for all other days
            defaultDate.setDate(today.getDate() + 1);
        }
        
        return defaultDate.toISOString().slice(0, 10);
    }

    generateDateOptions(daysForward = CONFIG.DATE_RANGE_DAYS_FORWARD) {
        const today = new Date();
        const dates = [];
        
        // Add today
        dates.push(new Date(today));
        
        // Add future days
        for (let i = 1; i <= daysForward; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            dates.push(date);
        }

        this.dateOptions = dates.map(date => ({
            value: date.toISOString().slice(0, 10),
            label: this.formatDateLabel(date),
            isToday: this.isToday(date),
            isDefault: date.toISOString().slice(0, 10) === this.currentDate
        }));

        return this.dateOptions;
    }

    formatDateLabel(date) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = new Date();
        const dateStr = date.toISOString().slice(0, 10);
        const todayStr = today.toISOString().slice(0, 10);
        
        let label = `${dateStr} (${dayNames[date.getDay()]})`;
        
        if (dateStr === todayStr) {
            label += ' - Today';
        } else if (dateStr === new Date(today.getTime() - 86400000).toISOString().slice(0, 10)) {
            label += ' - Yesterday';  
        } else if (dateStr === new Date(today.getTime() + 86400000).toISOString().slice(0, 10)) {
            label += ' - Tomorrow';
        }
        
        return label;
    }

    isToday(date) {
        const today = new Date();
        return date.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
    }

    setCurrentDate(date) {
        try {
            ValidationManager.validateDate(date);
            
            if (date !== this.currentDate) {
                const oldDate = this.currentDate;
                this.currentDate = date;
                this.emit('dateChanged', { oldDate, newDate: date });
            }
        } catch (error) {
            console.error('Invalid date provided:', error.message);
            throw error;
        }
    }

    getCurrentDate() {
        return this.currentDate;
    }
}

/**
 * WebSocket Connection Manager with Proper Cleanup
 */
class WebSocketConnectionManager extends EventEmitter {
    constructor(websocketService, dateManager = null) {
        super();
        this.websocketService = websocketService;
        this.dateManager = dateManager;
        this.connectionState = UI_STATES.DISCONNECTED;
        this.boundHandlers = {};
        this.reconnectTimer = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // Create bound handlers for proper cleanup
        this.boundHandlers = {
            connecting: () => this.setConnectionState(UI_STATES.CONNECTING),
            connected: () => {
                this.setConnectionState(UI_STATES.CONNECTED);
                this.requestInitialState();
            },
            disconnected: () => this.setConnectionState(UI_STATES.DISCONNECTED),
            error: (error) => {
                this.setConnectionState(UI_STATES.ERROR);
                this.emit('connectionError', error);
            },
            qrUpdate: (data) => this.emit('qrCodeReceived', data),
            clientReady: (data) => this.emit('clientStatusChanged', data),
            messageStatus: (data) => this.emit('messageStatusUpdate', data),
            sendingFinished: (data) => this.emit('sendingCompleted', data),
            initialStateResponse: (data) => this.emit('initialStateReceived', data)
        };

        // Register event handlers
        this.websocketService.on('connecting', this.boundHandlers.connecting);
        this.websocketService.on('connected', this.boundHandlers.connected);
        this.websocketService.on('disconnected', this.boundHandlers.disconnected);
        this.websocketService.on('error', this.boundHandlers.error);
        
        // Message events (handle both naming conventions)
        this.websocketService.on('qrUpdate', this.boundHandlers.qrUpdate);
        this.websocketService.on('qr_update', this.boundHandlers.qrUpdate);
        this.websocketService.on('clientReady', this.boundHandlers.clientReady);
        this.websocketService.on('client_ready', this.boundHandlers.clientReady);
        this.websocketService.on('messageStatus', this.boundHandlers.messageStatus);
        this.websocketService.on('message_status', this.boundHandlers.messageStatus);
        this.websocketService.on('sendingFinished', this.boundHandlers.sendingFinished);
        this.websocketService.on('sending_finished', this.boundHandlers.sendingFinished);
        this.websocketService.on('initialStateResponse', this.boundHandlers.initialStateResponse);
        this.websocketService.on('initial_state_response', this.boundHandlers.initialStateResponse);
    }

    setConnectionState(state) {
        if (state !== this.connectionState) {
            const oldState = this.connectionState;
            this.connectionState = state;
            this.emit('connectionStateChanged', { oldState, newState: state });
        }
    }

    async connect(params = {}) {
        try {
            return await this.websocketService.connect(params);
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.scheduleReconnect();
            throw error;
        }
    }

    disconnect() {
        this.clearReconnectTimer();
        return this.websocketService.disconnect();
    }

    send(message, options = {}) {
        return this.websocketService.send(message, options);
    }

    requestInitialState() {
        console.log('Requesting initial state from server...');
        this.send({
            type: 'request_initial_state',
            data: {
                date: this.dateManager?.getCurrentDate() || new Date().toISOString().slice(0, 10),
                timestamp: Date.now()
            }
        }).catch(error => {
            console.error('Failed to request initial state:', error);
        });
    }

    isConnected() {
        return this.connectionState === UI_STATES.CONNECTED;
    }
    
    scheduleReconnect(delay = CONFIG.WEBSOCKET_RECONNECT_DELAY_MS) {
        this.clearReconnectTimer();
        
        this.reconnectTimer = setTimeout(() => {
            console.log('Attempting WebSocket reconnection...');
            this.connect().catch(error => {
                console.error('Reconnection failed:', error);
                // Schedule another attempt with exponential backoff
                this.scheduleReconnect(Math.min(delay * 2, 30000));
            });
        }, delay);
    }
    
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    cleanup() {
        // Clear reconnect timer
        this.clearReconnectTimer();
        
        // Remove all event listeners using bound handlers
        Object.entries(this.boundHandlers).forEach(([eventName, handler]) => {
            this.websocketService.off('connecting', handler);
            this.websocketService.off('connected', handler);
            this.websocketService.off('disconnected', handler);
            this.websocketService.off('error', handler);
            this.websocketService.off('qrUpdate', handler);
            this.websocketService.off('qr_update', handler);
            this.websocketService.off('clientReady', handler);
            this.websocketService.off('client_ready', handler);
            this.websocketService.off('messageStatus', handler);
            this.websocketService.off('message_status', handler);
            this.websocketService.off('sendingFinished', handler);
            this.websocketService.off('sending_finished', handler);
            this.websocketService.off('initialStateResponse', handler);
            this.websocketService.off('initial_state_response', handler);
        });
        
        // Disconnect
        this.disconnect();
    }
}

/**
 * Main WhatsApp Messenger Application
 */
class WhatsAppMessengerApp extends EventEmitter {
    constructor() {
        super();
        
        // Initialize managers
        this.stateManager = new AppStateManager();
        this.domManager = new DOMManager();
        this.messageDisplay = new MessageDisplayManager(this.domManager);
        this.dateManager = new DateManager();
        this.apiClient = new APIClient();
        
        // Will be initialized after websocket import
        this.connectionManager = null;
        this.buttonStateManager = null;
        
        // Cleanup tracking
        this.cleanupTasks = [];
        this.debounceTimers = new Map();
    }

    async initialize() {
        try {
            console.log('Initializing WhatsApp Messenger Application');
            
            // Initialize DOM
            this.domManager.initialize();
            
            // Initialize button state manager
            this.buttonStateManager = new ButtonStateManager(this.domManager);
            
            // Initialize WebSocket connection
            await this.initializeWebSocket();
            
            // Setup date management
            this.setupDateManagement();
            
            // Setup event handlers
            this.setupEventHandlers();
            
            // Setup UI state management
            this.setupUIStateManagement();
            
            // Load initial data
            await this.loadInitialData();
            
            console.log('WhatsApp Messenger Application initialized successfully');
            
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.messageDisplay.displayError(error, 'Initialization failed');
            throw error;
        }
    }

    async initializeWebSocket() {
        // Import websocket service
        const websocketService = (await import('../services/websocket.js')).default;
        
        // Create connection manager
        this.connectionManager = new WebSocketConnectionManager(websocketService, this.dateManager);
        
        // Setup connection event handlers
        this.connectionManager.on('connectionStateChanged', ({ newState }) => {
            this.stateManager.updateState({ connectionStatus: newState });
        });

        this.connectionManager.on('connectionError', (error) => {
            this.messageDisplay.displayError(error, 'WebSocket connection error');
        });

        this.connectionManager.on('qrCodeReceived', (data) => {
            this.handleQRCode(data);
        });

        this.connectionManager.on('clientStatusChanged', (data) => {
            this.handleClientStatusChange(data);
        });

        this.connectionManager.on('messageStatusUpdate', (data) => {
            this.handleMessageStatusUpdate(data);
        });

        this.connectionManager.on('sendingCompleted', (data) => {
            this.handleSendingCompleted(data);
        });

        this.connectionManager.on('initialStateReceived', (data) => {
            this.handleInitialState(data);
        });
    }

    setupDateManagement() {
        // Generate date options
        this.dateManager.generateDateOptions();
        
        // Populate date selector
        this.populateDateSelector();
        
        // Set initial date
        this.dateManager.setCurrentDate(this.dateManager.getDefaultDate());
        
        // Listen for date changes with debouncing
        this.dateManager.on('dateChanged', ({ newDate }) => {
            this.debounceOperation('dateChange', () => {
                this.stateManager.updateState({ currentDate: newDate });
                this.onDateChanged(newDate);
            }, CONFIG.DEBOUNCE_DELAY_MS);
        });
    }

    setupEventHandlers() {
        // Date selector
        const dateSelector = this.domManager.getElement('dateSelector');
        if (dateSelector) {
            const dateChangeHandler = (event) => {
                this.dateManager.setCurrentDate(event.target.value);
            };
            dateSelector.addEventListener('change', dateChangeHandler);
            this.cleanupTasks.push(() => {
                dateSelector.removeEventListener('change', dateChangeHandler);
            });
        }

        // Control buttons
        this.setupControlButtons();
        
        // Main action button
        const startButton = this.domManager.getElement('startButton');
        if (startButton) {
            const startHandler = () => this.handleStartSending();
            startButton.addEventListener('click', startHandler);
            this.cleanupTasks.push(() => {
                startButton.removeEventListener('click', startHandler);
            });
        }
    }

    setupControlButtons() {
        const buttons = [
            { element: 'refreshDateBtn', handler: () => this.handleRefresh() },
            { element: 'resetMessagingBtn', handler: () => this.handleReset() },
            { element: 'restartClientBtn', handler: () => this.handleRestart() },
            { element: 'destroyClientBtn', handler: () => this.handleDestroy() },
            { element: 'logoutClientBtn', handler: () => this.handleLogout() }
        ];

        buttons.forEach(({ element, handler }) => {
            const btn = this.domManager.getElement(element);
            if (btn) {
                btn.addEventListener('click', handler);
                this.cleanupTasks.push(() => {
                    btn.removeEventListener('click', handler);
                });
            }
        });
    }

    setupUIStateManagement() {
        // Listen for state changes and update UI accordingly
        const stateChangeHandler = ({ newState, updates }) => {
            this.updateUI(newState, updates);
        };
        this.stateManager.on('stateChanged', stateChangeHandler);
        this.cleanupTasks.push(() => {
            this.stateManager.off('stateChanged', stateChangeHandler);
        });
    }

    populateDateSelector() {
        const dateSelector = this.domManager.getElement('dateSelector');
        if (!dateSelector) return;

        // Clear existing options
        dateSelector.innerHTML = '';

        // Add date options
        this.dateManager.dateOptions.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            optionElement.selected = option.isDefault;
            dateSelector.appendChild(optionElement);
        });
    }

    async loadInitialData() {
        await this.loadMessageCount();
        await this.connectWebSocket();
    }

    async loadMessageCount() {
        const currentDate = this.dateManager.getCurrentDate();
        this.messageDisplay.displayLoading('Loading message count...');

        try {
            const data = await this.apiClient.get(
                API_ENDPOINTS.MESSAGE_COUNT(currentDate),
                { 
                    cancelPrevious: 'messageCount',
                    expectedFields: ['success', 'data']
                }
            );

            const count = ValidationManager.validateMessageCountResponse(data);
            this.stateManager.updateState({ messageCount: count });
            
            const message = this.formatMessageCountDisplay(count);
            this.messageDisplay.displayMessage(message, MESSAGE_TYPES.SUCCESS);
            
        } catch (error) {
            this.messageDisplay.displayError(error, 'Failed to load message count');
            this.stateManager.updateState({ messageCount: null });
        }
    }

    formatMessageCountDisplay(count) {
        const actualSendable = Math.max(0, count.eligibleForMessaging || 0);
        let message = `${actualSendable} messages ready to send`;
        
        if (count.alreadySent > 0) {
            message += ` (${count.alreadySent} already sent`;
            if (count.pending && count.pending > 0) {
                message += `, ${count.pending} pending`;
            }
            message += ')';
        } else if (count.pending && count.pending > 0) {
            message += ` (${count.pending} pending)`;
        }
        
        return message;
    }

    async connectWebSocket() {
        try {
            const connectionParams = {
                PDate: this.dateManager.getCurrentDate(),
                clientType: 'waStatus',
                needsQR: 'true'
            };
            
            await this.connectionManager.connect(connectionParams);
        } catch (error) {
            this.messageDisplay.displayError(error, 'WebSocket connection failed');
        }
    }

    // Utility Methods
    debounceOperation(key, operation, delay) {
        if (this.debounceTimers.has(key)) {
            clearTimeout(this.debounceTimers.get(key));
        }
        
        const timer = setTimeout(() => {
            this.debounceTimers.delete(key);
            operation();
        }, delay);
        
        this.debounceTimers.set(key, timer);
    }

    // Event Handlers
    handleQRCode(data) {
        this.stateManager.updateState({
            clientStatus: { 
                ready: false, 
                qrCode: data.qr, 
                error: null 
            }
        });
    }

    handleClientStatusChange(data) {
        console.log('Received client status change:', data);
        
        this.stateManager.updateState({
            clientStatus: {
                ready: data.clientReady || data.state === 'ready',
                qrCode: data.clientReady ? null : this.stateManager.getState().clientStatus.qrCode,
                error: data.error || null
            }
        });
    }

    handleMessageStatusUpdate(data) {
        // Update message status in UI
        this.emit('messageStatusUpdated', data);
    }

    handleSendingCompleted(data) {
        this.stateManager.updateState({
            sendingProgress: {
                finished: true
            }
        });
        
        this.buttonStateManager.resetButton('startButton');
        this.messageDisplay.displayMessage('Message sending completed!', MESSAGE_TYPES.SUCCESS);
    }

    handleInitialState(data) {
        console.log('Received initial state:', data);
        
        if (data) {
            console.log('Processing initial state - clientReady:', data.clientReady, 'qr:', !!data.qr);
            
            // Update client status
            if (data.clientReady !== undefined || data.qr !== undefined) {
                const newClientStatus = {
                    ready: data.clientReady || false,
                    qrCode: data.qr || null,
                    error: data.error || null
                };
                
                console.log('Updating client status to:', newClientStatus);
                
                this.stateManager.updateState({
                    clientStatus: newClientStatus
                });
            }
            
            // Update sending progress if available
            if (data.sendingProgress) {
                console.log('Updating sending progress:', data.sendingProgress);
                this.stateManager.updateState({
                    sendingProgress: data.sendingProgress
                });
            }
        }
    }

    async handleStartSending() {
        const state = this.stateManager.getState();
        
        if (!state.clientStatus.ready) {
            this.messageDisplay.displayError('WhatsApp client is not ready');
            return;
        }

        this.buttonStateManager.setButtonState('startButton', BUTTON_STATES.LOADING, {
            text: 'Starting...'
        });

        try {
            this.stateManager.updateState({
                sendingProgress: {
                    started: true,
                    finished: false,
                    total: state.messageCount?.eligibleForMessaging || 0,
                    sent: 0,
                    failed: 0
                }
            });

            const result = await this.apiClient.get(API_ENDPOINTS.WA_SEND(this.dateManager.getCurrentDate()));
            this.messageDisplay.displayMessage('Messages sending started', MESSAGE_TYPES.SUCCESS);
            
        } catch (error) {
            this.messageDisplay.displayError(error, 'Failed to start sending');
            this.stateManager.updateState({
                sendingProgress: {
                    started: false,
                    finished: false,
                    total: 0,
                    sent: 0,
                    failed: 0
                }
            });
            this.buttonStateManager.resetButton('startButton');
        }
    }

    async handleRefresh() {
        this.buttonStateManager.setButtonState('refreshDateBtn', BUTTON_STATES.LOADING, {
            text: 'Refreshing...'
        });
        
        try {
            await this.loadMessageCount();
        } finally {
            this.buttonStateManager.resetButton('refreshDateBtn');
        }
    }

    async handleReset() {
        const currentDate = this.dateManager.getCurrentDate();
        
        // Handle confirmation state
        if (!this.buttonStateManager.isButtonInState('resetMessagingBtn', BUTTON_STATES.CONFIRMING)) {
            this.buttonStateManager.setButtonState('resetMessagingBtn', BUTTON_STATES.CONFIRMING, {
                text: 'Click Again to Confirm',
                timeout: 3000
            });
            return;
        }

        this.buttonStateManager.setButtonState('resetMessagingBtn', BUTTON_STATES.LOADING, {
            text: 'Resetting...'
        });

        try {
            const result = await this.apiClient.post(API_ENDPOINTS.MESSAGE_RESET(currentDate));
            
            if (result.success) {
                this.messageDisplay.displayMessage(
                    `Reset completed: ${result.data?.appointmentsReset || 0} appointments reset`, 
                    MESSAGE_TYPES.SUCCESS
                );
                
                // Reload message count
                await this.loadMessageCount();
            } else {
                throw new Error(result.error || 'Reset failed');
            }
        } catch (error) {
            this.messageDisplay.displayError(error, 'Failed to reset messaging');
        } finally {
            this.buttonStateManager.resetButton('resetMessagingBtn');
        }
    }

    async handleRestart() {
        this.buttonStateManager.setButtonState('restartClientBtn', BUTTON_STATES.LOADING, {
            text: 'Restarting...'
        });

        try {
            const result = await this.apiClient.post(API_ENDPOINTS.WA_RESTART);
            
            if (result.success) {
                this.messageDisplay.displayMessage(result.message || 'Client restarted successfully', MESSAGE_TYPES.SUCCESS);
                
                // Reset client status to wait for reconnection
                this.stateManager.updateState({
                    clientStatus: {
                        ready: false,
                        qrCode: null,
                        error: null
                    }
                });
                
                // Request new initial state after restart
                setTimeout(() => {
                    if (this.connectionManager.isConnected()) {
                        this.connectionManager.requestInitialState();
                    }
                }, CONFIG.CLIENT_RESTART_DELAY_MS);
            } else {
                throw new Error(result.error || 'Restart failed');
            }
        } catch (error) {
            this.messageDisplay.displayError(error, 'Failed to restart WhatsApp client');
        } finally {
            this.buttonStateManager.resetButton('restartClientBtn');
        }
    }

    async handleDestroy() {
        // Handle confirmation state
        if (!this.buttonStateManager.isButtonInState('destroyClientBtn', BUTTON_STATES.CONFIRMING)) {
            this.buttonStateManager.setButtonState('destroyClientBtn', BUTTON_STATES.CONFIRMING, {
                text: 'Click Again to Confirm',
                timeout: 3000
            });
            return;
        }

        this.buttonStateManager.setButtonState('destroyClientBtn', BUTTON_STATES.LOADING, {
            text: 'Destroying...'
        });

        try {
            const result = await this.apiClient.post(API_ENDPOINTS.WA_DESTROY);
            
            if (result.success) {
                this.messageDisplay.displayMessage(result.message || 'Client destroyed successfully', MESSAGE_TYPES.SUCCESS);
                
                // Update client status
                this.stateManager.updateState({
                    clientStatus: {
                        ready: false,
                        qrCode: null,
                        error: null
                    }
                });
            } else {
                throw new Error(result.error || 'Destroy failed');
            }
        } catch (error) {
            this.messageDisplay.displayError(error, 'Failed to destroy WhatsApp client');
        } finally {
            this.buttonStateManager.resetButton('destroyClientBtn');
        }
    }

    async handleLogout() {
        // Handle confirmation state
        if (!this.buttonStateManager.isButtonInState('logoutClientBtn', BUTTON_STATES.CONFIRMING)) {
            this.buttonStateManager.setButtonState('logoutClientBtn', BUTTON_STATES.CONFIRMING, {
                text: 'Click Again to Confirm',
                timeout: 5000 // Longer timeout for logout
            });
            return;
        }

        this.buttonStateManager.setButtonState('logoutClientBtn', BUTTON_STATES.LOADING, {
            text: 'Logging out...'
        });

        try {
            const result = await this.apiClient.post(API_ENDPOINTS.WA_LOGOUT);
            
            if (result.success) {
                this.messageDisplay.displayMessage(result.message || 'Client logged out successfully', MESSAGE_TYPES.SUCCESS);
                
                // Reset client status completely
                this.stateManager.updateState({
                    clientStatus: {
                        ready: false,
                        qrCode: null,
                        error: null
                    }
                });
                
                // Request new QR code after logout
                setTimeout(() => {
                    if (this.connectionManager.isConnected()) {
                        this.connectionManager.requestInitialState();
                    }
                }, CONFIG.LOGOUT_DELAY_MS);
            } else {
                throw new Error(result.error || 'Logout failed');
            }
        } catch (error) {
            this.messageDisplay.displayError(error, 'Failed to logout WhatsApp client');
        } finally {
            this.buttonStateManager.resetButton('logoutClientBtn');
        }
    }

    onDateChanged(newDate) {
        console.log(`Date changed to: ${newDate}`);
        this.loadMessageCount();
        
        // Reconnect WebSocket with new date parameters
        if (this.connectionManager && this.connectionManager.isConnected()) {
            // Disconnect and reconnect with new date
            this.connectionManager.disconnect();
            setTimeout(() => {
                this.connectWebSocket();
            }, CONFIG.WEBSOCKET_RECONNECT_DELAY_MS);
        }
    }

    updateUI(state, updates) {
        console.log('updateUI called with state:', state, 'updates:', updates);
        
        // Update connection status
        if (updates.connectionStatus) {
            console.log('Updating connection status to:', state.connectionStatus);
            this.updateConnectionStatus(state.connectionStatus);
        }

        // Update client status
        if (updates.clientStatus) {
            console.log('Updating client status to:', state.clientStatus);
            this.updateClientStatus(state.clientStatus);
        }

        // Update sending progress
        if (updates.sendingProgress) {
            console.log('Updating sending progress to:', state.sendingProgress);
            this.updateSendingProgress(state.sendingProgress);
        }
    }

    updateConnectionStatus(status) {
        console.log(`Connection status: ${status}`);
        
        // Visual connection indicator could be added here
        const statusMessages = {
            [UI_STATES.CONNECTING]: 'Connecting to server...',
            [UI_STATES.CONNECTED]: 'Connected to server',
            [UI_STATES.DISCONNECTED]: 'Disconnected from server',
            [UI_STATES.ERROR]: 'Connection error'
        };
        
        if (status === UI_STATES.ERROR || status === UI_STATES.DISCONNECTED) {
            this.messageDisplay.displayWarning(statusMessages[status]);
        }
    }

    updateClientStatus(clientStatus) {
        console.log('updateClientStatus called with:', clientStatus);
        
        // Update QR code display
        if (clientStatus.qrCode) {
            this.domManager.setElementAttribute('qrImage', 'src', clientStatus.qrCode);
            this.domManager.setElementAttribute('qrImage', 'alt', 'WhatsApp QR Code for authentication');
            this.domManager.toggleElementVisibility('qrImage', true);
            this.domManager.toggleElementVisibility('qrContainer', true);
        } else {
            this.domManager.toggleElementVisibility('qrImage', false);
            this.domManager.toggleElementVisibility('qrContainer', false);
        }

        // Update start button state
        this.domManager.setElementDisabled('startButton', !clientStatus.ready);
        this.domManager.toggleElementVisibility('startButton', clientStatus.ready);

        // Update status text with accessibility
        if (clientStatus.ready) {
            console.log('Setting status to ready');
            this.domManager.setElementContent('stateElement', '✅ WhatsApp client is ready!', { announce: true });
            this.domManager.setElementContent('connectionText', 'Client Ready');
        } else if (clientStatus.qrCode) {
            console.log('Setting status to QR code needed');
            this.domManager.setElementContent('stateElement', '📱 Please scan the QR code with WhatsApp', { announce: true });
            this.domManager.setElementContent('connectionText', 'Scan QR Code');
        } else if (clientStatus.error) {
            console.log('Setting status to error:', clientStatus.error);
            this.domManager.setElementContent('stateElement', `❌ Error: ${clientStatus.error}`, { announce: true });
            this.domManager.setElementContent('connectionText', 'Error');
        } else {
            console.log('Setting status to initializing');
            this.domManager.setElementContent('stateElement', '⏳ Initializing WhatsApp client...');
            this.domManager.setElementContent('connectionText', 'Initializing...');
        }
    }

    updateSendingProgress(progress) {
        if (progress.started && !progress.finished) {
            const progressText = `📤 Sending messages... ${progress.sent}/${progress.total}`;
            this.domManager.setElementContent('stateElement', progressText, { announce: true });
            
            // Update button to show progress
            this.buttonStateManager.setButtonState('startButton', BUTTON_STATES.LOADING, {
                text: `Sending ${progress.sent}/${progress.total}`
            });
        } else if (progress.finished) {
            const completedText = `✅ Completed! ${progress.sent} sent, ${progress.failed} failed`;
            this.domManager.setElementContent('stateElement', completedText, { announce: true });
        }
    }

    // Cleanup
    cleanup() {
        console.log('Cleaning up WhatsApp Messenger Application');
        
        // Cancel all API requests
        this.apiClient.cancelAllRequests();
        
        // Clear all debounce timers
        for (const [key, timer] of this.debounceTimers) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        
        // Run all cleanup tasks
        this.cleanupTasks.forEach(task => {
            try {
                task();
            } catch (error) {
                console.error('Error during cleanup:', error);
            }
        });
        this.cleanupTasks = [];

        // Cleanup managers
        if (this.connectionManager) {
            this.connectionManager.cleanup();
        }
        
        if (this.messageDisplay) {
            this.messageDisplay.cleanup();
        }

        // Clear state
        if (this.stateManager) {
            this.stateManager.reset();
        }

        console.log('Cleanup completed');
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        window.whatsappMessenger = new WhatsAppMessengerApp();
        await window.whatsappMessenger.initialize();
        
        // Handle page unload
        window.addEventListener('beforeunload', () => {
            if (window.whatsappMessenger) {
                window.whatsappMessenger.cleanup();
            }
        });
        
    } catch (error) {
        console.error('Failed to initialize WhatsApp Messenger:', error);
        
        // Show error to user
        const errorElement = document.createElement('div');
        errorElement.className = 'initialization-error';
        errorElement.innerHTML = `
            <h2>Initialization Failed</h2>
            <p>Failed to initialize WhatsApp Messenger: ${error.message}</p>
            <button onclick="location.reload()">Retry</button>
        `;
        errorElement.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 20px; border: 2px solid #dc3545;
            border-radius: 8px; text-align: center; z-index: 1000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        document.body.appendChild(errorElement);
    }
});