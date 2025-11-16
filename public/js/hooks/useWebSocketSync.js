import { useEffect, useCallback, useState } from 'react';
import connectionManager from '../services/websocket-connection-manager.js';
import { WebSocketEvents } from '../constants/websocket-events.js';
import { config } from '../config/environment.js';

/**
 * Custom hook for WebSocket real-time appointment updates
 * Manages connection state and listens for appointment updates
 *
 * Uses the centralized connection manager to prevent duplicate connections
 */
export function useWebSocketSync(currentDate, onAppointmentsUpdated) {
    const [connectionStatus, setConnectionStatus] = useState('connecting');

    // Initialize WebSocket connection using connection manager
    useEffect(() => {
        const initializeWebSocket = async () => {
            console.log('[useWebSocketSync] Requesting WebSocket connection');

            try {
                // Use connection manager to ensure single connection
                await connectionManager.ensureConnected('daily-appointments', {
                    PDate: currentDate
                });

                setConnectionStatus('connected');
                console.log('[useWebSocketSync] WebSocket connected successfully');
            } catch (err) {
                // Initial connection failed, but auto-reconnect will retry automatically
                console.error('[useWebSocketSync] Connection failed, auto-reconnect will retry:', err);
                setConnectionStatus('connecting');
                // Don't disconnect - let auto-reconnect handle it
            }
        };

        initializeWebSocket();

        // Cleanup on unmount
        return () => {
            console.log('[useWebSocketSync] Cleanup - removing client type from connection manager');
            // Remove our client type, but DON'T disconnect
            // (other components may still need the connection)
            connectionManager.removeClientType('daily-appointments');
        };
    }, []);

    // Listen for connection events
    useEffect(() => {
        // Get the WebSocket service from connection manager
        const wsService = connectionManager.getService();

        const handleConnected = () => {
            console.log('[useWebSocketSync] WebSocket connected');
            setConnectionStatus('connected');
        };

        const handleDisconnected = () => {
            console.log('[useWebSocketSync] WebSocket disconnected');
            setConnectionStatus('disconnected');
        };

        const handleReconnecting = () => {
            console.log('[useWebSocketSync] WebSocket reconnecting...');
            setConnectionStatus('reconnecting');
        };

        const handleError = () => {
            console.error('[useWebSocketSync] WebSocket error');
            setConnectionStatus('error');
        };

        wsService.on('connected', handleConnected);
        wsService.on('disconnected', handleDisconnected);
        wsService.on('reconnecting', handleReconnecting);
        wsService.on('error', handleError);

        // Cleanup listeners
        return () => {
            wsService.off('connected', handleConnected);
            wsService.off('disconnected', handleDisconnected);
            wsService.off('reconnecting', handleReconnecting);
            wsService.off('error', handleError);
        };
    }, []);

    // Listen for appointment updates
    useEffect(() => {
        // Get the WebSocket service from connection manager
        const wsService = connectionManager.getService();

        const handleAppointmentsUpdated = (data) => {
            // Only reload if the update is for the currently displayed date
            if (data && data.date === currentDate) {
                console.log('📡 [useWebSocketSync] Appointments updated via WebSocket for date:', currentDate);
                onAppointmentsUpdated(data);
            }
        };

        wsService.on(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);

        // Cleanup listener
        return () => {
            wsService.off(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);
        };
    }, [currentDate, onAppointmentsUpdated]);

    return {
        connectionStatus,
        isConnected: connectionStatus === 'connected'
    };
}
