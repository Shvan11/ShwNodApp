/**
 * Custom hook for WhatsApp WebSocket connection management
 * Uses centralized connection manager to prevent duplicate connections
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGlobalState } from '../contexts/GlobalStateContext.jsx';
import { UI_STATES, CONFIG } from '../utils/whatsapp-send-constants.js';
import connectionManager from '../services/websocket-connection-manager.js';

/**
 * Custom hook for managing WhatsApp WebSocket connection
 */
export function useWhatsAppWebSocket(currentDate) {
    // Use global state for clientReady instead of duplicating listener
    const { whatsappClientReady: clientReady } = useGlobalState();

    const [connectionStatus, setConnectionStatus] = useState(UI_STATES.DISCONNECTED);
    const [sendingProgress, setSendingProgress] = useState({
        started: false,
        finished: false,
        total: 0,
        sent: 0,
        failed: 0
    });
    const [messageStatusUpdate, setMessageStatusUpdate] = useState(null);

    const wsRef = useRef(null);
    const reconnectTimerRef = useRef(null);

    // Setup WebSocket service using connection manager
    const setupWebSocket = useCallback(async () => {
        try {
            console.log('[useWhatsAppWebSocket] Setting up WebSocket connection');

            // Use connection manager to ensure single connection
            await connectionManager.ensureConnected('waStatus', {
                PDate: currentDate
            });

            console.log('[useWhatsAppWebSocket] WebSocket connected via connection manager');

            // Get the WebSocket service from connection manager
            const websocketService = connectionManager.getService();

            // Setup event handlers
            const handleConnecting = () => setConnectionStatus(UI_STATES.CONNECTING);
            const handleConnected = () => {
                setConnectionStatus(UI_STATES.CONNECTED);
                requestInitialState();
            };
            const handleDisconnected = () => setConnectionStatus(UI_STATES.DISCONNECTED);
            const handleError = (error) => {
                setConnectionStatus(UI_STATES.ERROR);
                console.error('WebSocket error:', error);
            };

            const handleMessageStatus = (data) => {
                setMessageStatusUpdate(data);
            };

            const handleSendingStarted = (data) => {
                setSendingProgress({
                    started: true,
                    finished: false,
                    total: data.total || 0,
                    sent: data.sent || 0,
                    failed: data.failed || 0
                });
            };

            const handleSendingProgress = (data) => {
                setSendingProgress(prev => ({
                    ...prev,
                    sent: data.sent || 0,
                    failed: data.failed || 0,
                    finished: data.finished || false
                }));
            };

            const handleSendingFinished = (data) => {
                setSendingProgress(prev => ({
                    ...prev,
                    finished: true
                }));
            };

            const handleInitialState = (data) => {
                if (data) {
                    // clientReady is now managed by GlobalStateContext, no need to set it here

                    if (data.sendingProgress && data.sendingProgress.started && !data.sendingProgress.finished) {
                        setSendingProgress(data.sendingProgress);
                    } else if (data.sendingProgress && data.sendingProgress.finished) {
                        // Clear finished progress
                        setSendingProgress({
                            started: false,
                            finished: false,
                            total: 0,
                            sent: 0,
                            failed: 0
                        });
                    }
                }
            };

            // Register event handlers
            // NOTE: whatsapp_client_ready is managed by GlobalStateContext - no duplicate listener needed
            websocketService.on('connecting', handleConnecting);
            websocketService.on('connected', handleConnected);
            websocketService.on('disconnected', handleDisconnected);
            websocketService.on('error', handleError);
            websocketService.on('whatsapp_message_status', handleMessageStatus);
            websocketService.on('whatsapp_sending_started', handleSendingStarted);
            websocketService.on('whatsapp_sending_progress', handleSendingProgress);
            websocketService.on('whatsapp_sending_finished', handleSendingFinished);
            websocketService.on('whatsapp_initial_state_response', handleInitialState);

            // Set connection status based on current state
            if (websocketService.isConnected) {
                setConnectionStatus(UI_STATES.CONNECTED);
                requestInitialState();
            } else {
                setConnectionStatus(UI_STATES.CONNECTING);
            }

            wsRef.current = websocketService;

            // Cleanup function
            return () => {
                websocketService.off('connecting', handleConnecting);
                websocketService.off('connected', handleConnected);
                websocketService.off('disconnected', handleDisconnected);
                websocketService.off('error', handleError);
                websocketService.off('whatsapp_message_status', handleMessageStatus);
                websocketService.off('whatsapp_sending_started', handleSendingStarted);
                websocketService.off('whatsapp_sending_progress', handleSendingProgress);
                websocketService.off('whatsapp_sending_finished', handleSendingFinished);
                websocketService.off('whatsapp_initial_state_response', handleInitialState);
            };
        } catch (error) {
            console.error('Failed to setup WebSocket listeners:', error);
            setConnectionStatus(UI_STATES.ERROR);
        }
    }, [currentDate]);

    // Request initial state from server
    const requestInitialState = useCallback(() => {
        if (wsRef.current && wsRef.current.isConnected) {
            console.log('Requesting initial state from server...');
            wsRef.current.send({
                type: 'request_whatsapp_initial_state',
                data: {
                    date: currentDate,
                    timestamp: Date.now()
                }
            }).catch(error => {
                console.error('Failed to request initial state:', error);
            });
        }
    }, [currentDate]);

    // Setup WebSocket on mount
    useEffect(() => {
        let cleanup;

        setupWebSocket().then(cleanupFn => {
            cleanup = cleanupFn;
        }).catch(error => {
            console.error('[useWhatsAppWebSocket] Failed to setup WebSocket:', error);
            setConnectionStatus(UI_STATES.ERROR);
        });

        return () => {
            console.log('[useWhatsAppWebSocket] Cleanup - removing event listeners');
            if (cleanup) cleanup();
            // Remove our client type from connection manager
            connectionManager.removeClientType('waStatus');
            // Clear any reconnect timers
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
            }
        };
    }, [setupWebSocket]);

    return {
        connectionStatus,
        clientReady,
        sendingProgress,
        messageStatusUpdate,
        requestInitialState
    };
}
