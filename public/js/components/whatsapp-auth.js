/**
 * WhatsApp Authentication Component
 * Reusable component for handling WhatsApp client authentication
 * Can be used standalone or embedded in other pages
 */

import EventEmitter from '../core/events.js';

// Configuration Constants
const CONFIG = {
    WEBSOCKET_RECONNECT_DELAY_MS: 500,
    CLIENT_RESTART_DELAY_MS: 2000,
    LOGOUT_DELAY_MS: 1000,
    QR_REFRESH_DELAY_MS: 30000, // Auto-refresh QR code every 30 seconds
    MAX_RECONNECT_ATTEMPTS: 10,
    HEARTBEAT_INTERVAL_MS: 30000
};

// Component States
const AUTH_STATES = {
    INITIALIZING: 'initializing',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    CHECKING_SESSION: 'checking_session',
    QR_REQUIRED: 'qr_required',
    AUTHENTICATED: 'authenticated',
    ERROR: 'error',
    DISCONNECTED: 'disconnected'
};

/**
 * WhatsApp Authentication Component
 */
export class WhatsAppAuthComponent extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.options = {
            container: '.auth-container',
            autoConnect: true,
            showControls: true,
            ...options
        };
        
        // State management
        this.state = {
            currentState: AUTH_STATES.INITIALIZING,
            clientReady: false,
            qrCode: null,
            error: null,
            connectionAttempts: 0
        };
        
        // DOM elements
        this.elements = {};
        
        // WebSocket connection manager
        this.connectionManager = null;
        
        // Timers
        this.qrRefreshTimer = null;
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        
        // Initialize
        this.initialize();
    }
    
    async initialize() {
        try {
            // Find and cache DOM elements
            this.cacheDOMElements();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Initialize WebSocket connection
            if (this.options.autoConnect) {
                await this.initializeWebSocket();
            }
            
            console.log('WhatsApp Auth Component initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize WhatsApp Auth Component:', error);
            this.setState(AUTH_STATES.ERROR, { error: error.message });
            this.emit('error', error);
        }
    }
    
    cacheDOMElements() {
        const container = document.querySelector(this.options.container);
        if (!container) {
            throw new Error(`Container not found: ${this.options.container}`);
        }
        
        this.elements = {
            container,
            authStatus: container.querySelector('#authStatus'),
            qrContainer: container.querySelector('#qrContainer'),
            qrImage: container.querySelector('#qrImage'),
            qrPlaceholder: container.querySelector('#qrPlaceholder'),
            successContainer: container.querySelector('#successContainer'),
            errorContainer: container.querySelector('#errorContainer'),
            errorMessage: container.querySelector('#errorMessage'),
            successMessage: container.querySelector('#successMessage'),
            retryBtn: container.querySelector('#retryBtn'),
            refreshBtn: container.querySelector('#refreshBtn'),
            restartBtn: container.querySelector('#restartBtn'),
            destroyBtn: container.querySelector('#destroyBtn'),
            logoutBtn: container.querySelector('#logoutBtn'),
            connectionText: container.querySelector('.connection-text'),
            connectionIndicator: container.querySelector('.connection-indicator')
        };
        
        // Validate required elements
        const requiredElements = ['authStatus'];
        const missingElements = requiredElements.filter(id => !this.elements[id]);
        
        if (missingElements.length > 0) {
            throw new Error(`Missing required DOM elements: ${missingElements.join(', ')}`);
        }
    }
    
    
    setupEventListeners() {
        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => this.handleRetry());
        }
        
        // Refresh QR button
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.addEventListener('click', () => this.handleRefreshQR());
        }
        
        // Restart button
        if (this.elements.restartBtn) {
            this.elements.restartBtn.addEventListener('click', () => this.handleRestart());
        }
        
        // Destroy button
        if (this.elements.destroyBtn) {
            this.elements.destroyBtn.addEventListener('click', () => this.handleDestroy());
        }
        
        // Logout button
        if (this.elements.logoutBtn) {
            this.elements.logoutBtn.addEventListener('click', () => this.handleLogout());
        }
        
        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.handlePageVisible();
            } else {
                this.handlePageHidden();
            }
        });
        
    }
    
    async initializeWebSocket() {
        try {
            console.log('Authentication component: Creating WebSocket connection for QR events');
            
            this.setupWebSocketConnection();
            
        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'Failed to connect to server' });
        }
    }
    
    setupWebSocketConnection() {
        // Create WebSocket connection for authentication with QR viewer registration
        const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${location.host}?clientType=auth&needsQR=true&timestamp=${Date.now()}`;
        
        console.log('Auth component connecting to:', wsUrl);
        
        this.authWebSocket = new WebSocket(wsUrl);
        
        this.authWebSocket.onopen = () => {
            console.log('Auth WebSocket connected successfully');
            this.setState(AUTH_STATES.CONNECTED);
            
            // Test message to verify connection is working
            console.log('Testing auth WebSocket by sending heartbeat...');
            this.authWebSocket.send(JSON.stringify({
                type: 'heartbeat_ping',
                data: { timestamp: Date.now() }
            }));
            
            this.requestInitialState();
        };
        
        this.authWebSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('Auth WebSocket received message type:', message.type);
                
                switch (message.type) {
                    case 'whatsapp_qr_updated':
                        console.log('Auth WebSocket received QR update!', message);
                        this.handleQRUpdate(message.data);
                        break;
                    case 'whatsapp_client_ready':
                        console.log('Auth WebSocket received client ready!', message);
                        this.handleClientReady(message.data);
                        break;
                    case 'whatsapp_initial_state_response':
                        console.log('Auth WebSocket received initial state!', message);
                        this.handleInitialState(message.data);
                        break;
                    default:
                        console.log('Auth WebSocket received unhandled message:', message);
                        break;
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.authWebSocket.onclose = () => {
            console.log('Auth WebSocket disconnected');
            this.setState(AUTH_STATES.DISCONNECTED);
        };
        
        this.authWebSocket.onerror = (error) => {
            console.error('Auth WebSocket error:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'WebSocket connection failed' });
        };
    }

    setupWebSocketHandlers() {
        // This method is no longer used since we're using manual WebSocket connection
        return;
        
        // Connection events
        this.connectionManager.on('connecting', () => {
            this.setState(AUTH_STATES.CONNECTING);
            this.updateConnectionStatus('Connecting...');
        });
        
        this.connectionManager.on('connected', () => {
            this.setState(AUTH_STATES.CONNECTED);
            this.updateConnectionStatus('Connected');
            this.requestInitialState();
            this.startHeartbeat();
            this.state.connectionAttempts = 0; // Reset on successful connection
        });
        
        this.connectionManager.on('disconnected', () => {
            this.setState(AUTH_STATES.DISCONNECTED);
            this.updateConnectionStatus('Disconnected');
            this.stopHeartbeat();
            this.scheduleReconnect();
        });
        
        this.connectionManager.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'Connection error' });
            this.updateConnectionStatus('Connection Error');
            this.scheduleReconnect();
        });
        
        // WhatsApp events (using universal naming convention)
        this.connectionManager.on('whatsapp_qr_updated', (data) => {
            this.handleQRUpdate(data);
        });
        
        this.connectionManager.on('whatsapp_client_ready', (data) => {
            this.handleClientReady(data);
        });
        
        this.connectionManager.on('whatsapp_initial_state_response', (data) => {
            this.handleInitialState(data);
        });
    }
    
    
    requestInitialState() {
        if (!this.authWebSocket || this.authWebSocket.readyState !== WebSocket.OPEN) {
            console.warn('Auth WebSocket not ready, cannot request initial state');
            return;
        }
        
        console.log('Auth component requesting WhatsApp initial state...');
        
        const message = {
            type: 'request_whatsapp_initial_state',
            data: {
                timestamp: Date.now()
            }
        };
        
        this.authWebSocket.send(JSON.stringify(message));
    }
    
    handleQRUpdate(data) {
        console.log('handleQRUpdate - QR Code updated:', !!data.qr, 'length:', data.qr?.length);
        console.log('handleQRUpdate - Raw QR data preview:', data.qr?.substring(0, 50) + '...');
        
        // Don't immediately show QR if we're checking for session or already authenticated
        if (this.state.currentState === AUTH_STATES.AUTHENTICATED) {
            console.log('handleQRUpdate - Already authenticated, ignoring QR update');
            return;
        }
        
        if (this.state.currentState === AUTH_STATES.CHECKING_SESSION) {
            console.log('handleQRUpdate - Still checking session, storing QR for later');
            this.state.qrCode = data.qr; // Store but don't show yet
            return;
        }
        
        // If we're not checking session, show the QR requirement
        this.setState(AUTH_STATES.QR_REQUIRED, { qrCode: data.qr });
        
        // Immediately update the QR code display if we're in QR_REQUIRED state
        if (this.state.currentState === AUTH_STATES.QR_REQUIRED) {
            console.log('handleQRUpdate - Calling displayQRCode immediately');
            this.displayQRCode();
        }
    }
    
    handleClientReady(data) {
        console.log('Client ready:', data);
        const isReady = data.clientReady || data.state === 'ready';
        
        if (isReady) {
            this.setState(AUTH_STATES.AUTHENTICATED, { clientReady: true });
        } else {
            this.setState(AUTH_STATES.QR_REQUIRED, { clientReady: false });
        }
    }
    
    handleInitialState(data) {
        console.log('handleInitialState - Initial state received:', data);
        console.log('handleInitialState - Has QR data:', !!data?.qr, 'QR length:', data?.qr?.length);
        console.log('handleInitialState - Client ready:', data?.clientReady);
        
        if (!data) {
            console.log('handleInitialState - No data received, staying in current state');
            return;
        }
        
        if (data.clientReady) {
            console.log('handleInitialState - Client is ready, setting AUTHENTICATED state');
            this.setState(AUTH_STATES.AUTHENTICATED, { clientReady: true });
        } else if (data.qr) {
            console.log('handleInitialState - QR code found, checking if session might exist');
            // Show "Checking for existing session..." first to give WhatsApp time to restore session
            this.setState(AUTH_STATES.CHECKING_SESSION, { qrCode: data.qr });
            
            // Wait a bit to see if client becomes ready (session restoration)
            setTimeout(() => {
                // Only show QR if we're still not authenticated after giving session time to restore
                if (this.state.currentState === AUTH_STATES.CHECKING_SESSION) {
                    console.log('handleInitialState - Session not restored, showing QR requirement');
                    this.setState(AUTH_STATES.QR_REQUIRED, { qrCode: data.qr });
                }
            }, 3000); // Wait 3 seconds for potential session restoration
        } else if (data.error) {
            console.log('handleInitialState - Error found:', data.error);
            this.setState(AUTH_STATES.ERROR, { error: data.error });
        } else {
            console.log('handleInitialState - No specific state, checking for session first');
            // Show session check instead of immediately requiring QR
            this.setState(AUTH_STATES.CHECKING_SESSION, { qrCode: null });
            
            // After a delay, if still not ready, request QR
            setTimeout(() => {
                if (this.state.currentState === AUTH_STATES.CHECKING_SESSION) {
                    this.setState(AUTH_STATES.QR_REQUIRED, { qrCode: null });
                }
            }, 3000);
        }
    }
    
    setState(newState, stateData = {}) {
        const oldState = this.state.currentState;
        
        this.state = {
            ...this.state,
            currentState: newState,
            ...stateData
        };
        
        console.log(`Auth state changed: ${oldState} → ${newState}`, stateData);
        
        this.updateUI();
        this.emit('stateChanged', { oldState, newState, state: this.state });
    }
    
    updateUI() {
        this.hideAllSections();
        
        switch (this.state.currentState) {
            case AUTH_STATES.INITIALIZING:
                this.showInitializing();
                break;
                
            case AUTH_STATES.CONNECTING:
                this.showConnecting();
                break;
                
            case AUTH_STATES.CHECKING_SESSION:
                this.showSessionCheck();
                break;
                
            case AUTH_STATES.QR_REQUIRED:
                this.showQRCode();
                break;
                
            case AUTH_STATES.AUTHENTICATED:
                this.showSuccess();
                break;
                
            case AUTH_STATES.ERROR:
                this.showError();
                break;
                
            case AUTH_STATES.DISCONNECTED:
                this.showDisconnected();
                break;
        }
        
        this.updateControls();
    }
    
    hideAllSections() {
        const sections = [
            'authStatus', 'qrContainer', 'successContainer', 'errorContainer'
        ];
        
        sections.forEach(section => {
            if (this.elements[section]) {
                this.elements[section].style.display = 'none';
            }
        });
    }
    
    showInitializing() {
        if (this.elements.authStatus) {
            this.elements.authStatus.style.display = 'block';
            this.elements.authStatus.innerHTML = `
                <div class="status-icon-container">
                    <span class="status-icon" aria-hidden="true">⏳</span>
                </div>
                <div class="status-text">
                    <h2>Initializing WhatsApp Client...</h2>
                    <p>Connecting to WhatsApp service</p>
                </div>
            `;
        }
    }
    
    showConnecting() {
        if (this.elements.authStatus) {
            this.elements.authStatus.style.display = 'block';
            this.elements.authStatus.innerHTML = `
                <div class="status-icon-container">
                    <span class="status-icon" aria-hidden="true">🔄</span>
                </div>
                <div class="status-text">
                    <h2>Connecting...</h2>
                    <p>Establishing connection to server</p>
                </div>
            `;
        }
    }
    
    showSessionCheck() {
        if (this.elements.authStatus) {
            this.elements.authStatus.style.display = 'block';
            this.elements.authStatus.innerHTML = `
                <div class="status-icon-container">
                    <span class="status-icon" aria-hidden="true">🔍</span>
                </div>
                <div class="status-text">
                    <h2>Checking for Existing Session...</h2>
                    <p>Looking for saved WhatsApp authentication</p>
                </div>
            `;
        }
    }
    
    showQRCode() {
        if (this.elements.qrContainer) {
            this.elements.qrContainer.style.display = 'block';
            
            // Always try to fetch the latest QR code from the API
            this.displayQRCode();
            
            this.startQRRefreshTimer();
        }
    }
    
    async displayQRCode() {
        console.log('displayQRCode called, current state:', this.state.currentState);
        console.log('QR code in state:', !!this.state.qrCode, 'length:', this.state.qrCode?.length);
        
        try {
            // Always fetch from the backend API since it handles the conversion properly
            console.log('Fetching QR code from API endpoint');
            const response = await fetch('/api/wa/qr');
            
            if (!response.ok) {
                if (response.status === 404) {
                    console.log('QR code not available yet via API');
                    this.showQRPlaceholder();
                    return;
                }
                throw new Error(`Failed to fetch QR code: ${response.status}`);
            }
            
            const qrResponse = await response.json();
            
            if (qrResponse.qr && this.elements.qrImage) {
                console.log('Using QR code from API response');
                this.elements.qrImage.src = qrResponse.qr;
                this.elements.qrImage.style.display = 'block';
                if (this.elements.qrPlaceholder) {
                    this.elements.qrPlaceholder.style.display = 'none';
                }
            } else {
                console.log('No QR code in API response');
                this.showQRPlaceholder();
            }
        } catch (error) {
            console.error('Failed to fetch QR code:', error);
            this.showQRPlaceholder();
        }
    }
    
    showQRPlaceholder() {
        if (this.elements.qrImage) {
            this.elements.qrImage.style.display = 'none';
        }
        if (this.elements.qrPlaceholder) {
            this.elements.qrPlaceholder.style.display = 'block';
        }
    }
    
    showSuccess() {
        if (this.elements.successContainer) {
            this.elements.successContainer.style.display = 'block';
        }
        
        this.stopQRRefreshTimer();
        this.emit('authenticated', { clientReady: true });
        
        // Handle successful authentication and redirect back if needed
        this.handleSuccessfulAuthentication();
    }
    
    showError() {
        if (this.elements.errorContainer) {
            this.elements.errorContainer.style.display = 'block';
            
            if (this.elements.errorMessage && this.state.error) {
                this.elements.errorMessage.textContent = this.state.error;
            }
        }
        
        this.stopQRRefreshTimer();
    }
    
    showDisconnected() {
        if (this.elements.authStatus) {
            this.elements.authStatus.style.display = 'block';
            this.elements.authStatus.innerHTML = `
                <div class="status-icon-container">
                    <span class="status-icon" aria-hidden="true">🔌</span>
                </div>
                <div class="status-text">
                    <h2>Disconnected</h2>
                    <p>Connection to server lost. Attempting to reconnect...</p>
                </div>
            `;
        }
    }
    
    updateControls() {
        if (!this.options.showControls) return;
        
        const showRetry = this.state.currentState === AUTH_STATES.ERROR || 
                         this.state.currentState === AUTH_STATES.DISCONNECTED;
        const showRefresh = this.state.currentState === AUTH_STATES.QR_REQUIRED;
        const showClientControls = this.state.currentState === AUTH_STATES.AUTHENTICATED || 
                                   this.state.currentState === AUTH_STATES.QR_REQUIRED ||
                                   this.state.currentState === AUTH_STATES.ERROR;
        const showLogout = this.state.currentState === AUTH_STATES.AUTHENTICATED ||
                          this.state.currentState === AUTH_STATES.QR_REQUIRED;
        
        if (this.elements.retryBtn) {
            this.elements.retryBtn.style.display = showRetry ? 'inline-flex' : 'none';
        }
        
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.style.display = showRefresh ? 'inline-flex' : 'none';
        }
        
        if (this.elements.restartBtn) {
            this.elements.restartBtn.style.display = showClientControls ? 'inline-flex' : 'none';
        }
        
        if (this.elements.destroyBtn) {
            this.elements.destroyBtn.style.display = showClientControls ? 'inline-flex' : 'none';
        }
        
        if (this.elements.logoutBtn) {
            this.elements.logoutBtn.style.display = showLogout ? 'inline-flex' : 'none';
        }
    }
    
    updateConnectionStatus(text) {
        if (this.elements.connectionText) {
            this.elements.connectionText.textContent = text;
        }
        
        if (this.elements.connectionIndicator) {
            const isConnected = this.state.currentState === AUTH_STATES.CONNECTED ||
                              this.state.currentState === AUTH_STATES.QR_REQUIRED ||
                              this.state.currentState === AUTH_STATES.AUTHENTICATED;
            
            this.elements.connectionIndicator.className = `connection-indicator ${
                isConnected ? 'connected' : 'disconnected'
            }`;
        }
    }
    
    // Timer Management
    startQRRefreshTimer() {
        this.stopQRRefreshTimer();
        this.qrRefreshTimer = setInterval(() => {
            if (this.state.currentState === AUTH_STATES.QR_REQUIRED) {
                this.requestInitialState();
            }
        }, CONFIG.QR_REFRESH_DELAY_MS);
    }
    
    stopQRRefreshTimer() {
        if (this.qrRefreshTimer) {
            clearInterval(this.qrRefreshTimer);
            this.qrRefreshTimer = null;
        }
    }
    
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.connectionManager && this.connectionManager.isConnected()) {
                this.connectionManager.send({
                    type: 'heartbeat_ping',
                    data: { timestamp: Date.now() }
                }).catch(error => {
                    console.warn('Heartbeat failed:', error);
                });
            }
        }, CONFIG.HEARTBEAT_INTERVAL_MS);
    }
    
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectTimer) return; // Already scheduled
        
        this.state.connectionAttempts++;
        
        if (this.state.connectionAttempts > CONFIG.MAX_RECONNECT_ATTEMPTS) {
            console.warn('Max reconnection attempts reached');
            this.setState(AUTH_STATES.ERROR, { error: 'Unable to maintain connection' });
            return;
        }
        
        const delay = Math.min(
            CONFIG.WEBSOCKET_RECONNECT_DELAY_MS * Math.pow(2, this.state.connectionAttempts - 1),
            30000
        );
        
        console.log(`Scheduling reconnect in ${delay}ms (attempt ${this.state.connectionAttempts})`);
        
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectWebSocket();
        }, delay);
    }
    
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    
    // Event Handlers
    async handleRetry() {
        this.setState(AUTH_STATES.INITIALIZING);
        this.state.connectionAttempts = 0;
        this.clearReconnectTimer();
        
        try {
            await this.connectWebSocket();
        } catch (error) {
            console.error('Retry failed:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'Retry failed' });
        }
    }
    
    handleRefreshQR() {
        this.requestInitialState();
        this.showQRPlaceholder();
    }
    
    async handleRestart() {
        try {
            const response = await fetch('/api/wa/restart', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                this.setState(AUTH_STATES.INITIALIZING);
                setTimeout(() => {
                    this.requestInitialState();
                }, CONFIG.CLIENT_RESTART_DELAY_MS);
            } else {
                throw new Error(result.error || 'Restart failed');
            }
        } catch (error) {
            console.error('Restart failed:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'Restart failed' });
        }
    }
    
    async handleDestroy() {
        try {
            const response = await fetch('/api/wa/destroy', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                this.setState(AUTH_STATES.INITIALIZING);
            } else {
                throw new Error(result.error || 'Destroy failed');
            }
        } catch (error) {
            console.error('Destroy failed:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'Destroy failed' });
        }
    }

    async handleLogout() {
        try {
            const response = await fetch('/api/wa/logout', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                this.setState(AUTH_STATES.INITIALIZING);
                setTimeout(() => {
                    this.requestInitialState();
                }, CONFIG.LOGOUT_DELAY_MS);
            } else {
                throw new Error(result.error || 'Logout failed');
            }
        } catch (error) {
            console.error('Logout failed:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'Logout failed' });
        }
    }
    
    handlePageVisible() {
        if (this.state.currentState === AUTH_STATES.QR_REQUIRED) {
            this.requestInitialState(); // Refresh state when page becomes visible
        }
    }
    
    handlePageHidden() {
        // Optionally pause some operations when page is hidden
    }
    
    // Public API
    isAuthenticated() {
        return this.state.currentState === AUTH_STATES.AUTHENTICATED && this.state.clientReady;
    }
    
    getState() {
        return { ...this.state };
    }
    
    async restart() {
        try {
            const response = await fetch('/api/wa/restart', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                this.setState(AUTH_STATES.INITIALIZING);
                setTimeout(() => {
                    this.requestInitialState();
                }, CONFIG.CLIENT_RESTART_DELAY_MS);
            } else {
                throw new Error(result.error || 'Restart failed');
            }
        } catch (error) {
            console.error('Restart failed:', error);
            this.setState(AUTH_STATES.ERROR, { error: 'Restart failed' });
        }
    }
    
    // Handle successful authentication and redirect back if needed
    handleSuccessfulAuthentication() {
        // Check for return URL in query parameters
        const urlParams = new URLSearchParams(window.location.search);
        const returnTo = urlParams.get('returnTo');
        
        if (returnTo) {
            console.log('Authentication successful, redirecting to:', returnTo);
            
            // Update success message to show redirecting
            if (this.elements.successMessage) {
                this.elements.successMessage.textContent = 'Redirecting you back to the messaging page...';
            }
            
            // Show success message briefly before redirect
            setTimeout(() => {
                try {
                    const decodedUrl = decodeURIComponent(returnTo);
                    // Add a timestamp to force refresh
                    const returnUrl = new URL(decodedUrl, window.location.origin);
                    returnUrl.searchParams.set('authCompleted', Date.now().toString());
                    
                    window.location.href = returnUrl.toString();
                } catch (error) {
                    console.error('Error parsing return URL:', error);
                    // Fallback to send page
                    window.location.href = '/send';
                }
            }, 2000); // Wait 2 seconds to show success message
        } else {
            console.log('Authentication successful, no return URL specified');
        }
    }
    
    
    // Cleanup
    destroy() {
        console.log('Destroying WhatsApp Auth Component');
        
        // Clear timers
        this.stopQRRefreshTimer();
        this.stopHeartbeat();
        this.clearReconnectTimer();
        
        // Disconnect WebSocket
        if (this.authWebSocket) {
            this.authWebSocket.close();
            this.authWebSocket = null;
        }
        
        if (this.connectionManager) {
            this.connectionManager.disconnect();
        }
        
        // Remove all listeners
        this.removeAllListeners();
        
        console.log('WhatsApp Auth Component destroyed');
    }
}

// Auto-initialize when loaded
document.addEventListener('DOMContentLoaded', () => {
    const container = document.querySelector('.auth-container');
    if (container) {
        window.whatsappAuth = new WhatsAppAuthComponent({
            container: '.auth-container'
        });
    }
});