import { useEffect, useCallback, useState } from 'react';
import wsService from '../services/websocket.js';
import { WebSocketEvents } from '../constants/websocket-events.js';
import { config } from '../config/environment.js';

/**
 * Custom hook for WebSocket real-time appointment updates
 * Manages connection state and listens for appointment updates
 */
export function useWebSocketSync(currentDate, onAppointmentsUpdated) {
    const [connectionStatus, setConnectionStatus] = useState('connecting');

    // Initialize WebSocket connection
    useEffect(() => {
        const initializeWebSocket = async () => {
            // Use environment configuration for WebSocket URL
            const wsUrl = config.wsUrl;

            // Set the base URL for WebSocket connection
            wsService.options.baseUrl = wsUrl;

            try {
                // Connect to WebSocket server with daily-appointments client type
                await wsService.connect({ clientType: 'daily-appointments' });
                setConnectionStatus('connected');
            } catch (err) {
                console.error('WebSocket connection failed:', err);
                setConnectionStatus('disconnected');
            }
        };

        initializeWebSocket();

        // Cleanup on unmount
        return () => {
            wsService.disconnect();
        };
    }, []);

    // Listen for connection events
    useEffect(() => {
        const handleConnected = () => {
            console.log('WebSocket connected');
            setConnectionStatus('connected');
        };

        const handleDisconnected = () => {
            console.log('WebSocket disconnected');
            setConnectionStatus('disconnected');
        };

        const handleReconnecting = () => {
            console.log('WebSocket reconnecting...');
            setConnectionStatus('reconnecting');
        };

        const handleError = () => {
            console.error('WebSocket error');
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
        const handleAppointmentsUpdated = (data) => {
            // Only reload if the update is for the currently displayed date
            if (data && data.date === currentDate) {
                console.log('📡 Appointments updated via WebSocket for date:', currentDate);
                onAppointmentsUpdated();
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
