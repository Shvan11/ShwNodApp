/**
 * WhatsApp Send App - Main Application Component
 * Complete WhatsApp messaging system converted to React
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useDateManager } from '../hooks/useDateManager.js';
import { useWhatsAppWebSocket } from '../hooks/useWhatsAppWebSocket.js';
import { useMessageCount } from '../hooks/useMessageCount.js';
import { useMessageStatus } from '../hooks/useMessageStatus.js';
import DateSelector from '../components/whatsapp-send/DateSelector.jsx';
import ConnectionStatus from '../components/whatsapp-send/ConnectionStatus.jsx';
import ProgressBar from '../components/whatsapp-send/ProgressBar.jsx';
import ActionButtons from '../components/whatsapp-send/ActionButtons.jsx';
import MessageStatusTable from '../components/whatsapp-send/MessageStatusTable.jsx';
import { API_ENDPOINTS } from '../utils/whatsapp-send-constants.js';
import { APIClient } from '../utils/whatsapp-api-client.js';

const apiClient = new APIClient();

export default function WhatsAppSendApp() {
    // Date management
    const { currentDate, dateOptions, setCurrentDate } = useDateManager();

    // WebSocket connection and state
    const {
        connectionStatus,
        clientReady,
        sendingProgress,
        messageStatusUpdate,
        requestInitialState
    } = useWhatsAppWebSocket(currentDate);

    // Message count
    const {
        messageCount,
        loading: countLoading,
        displayMessage,
        refresh: refreshMessageCount
    } = useMessageCount(currentDate);

    // Message status table
    const {
        messages,
        loading: statusLoading,
        summary,
        refresh: refreshMessageStatus,
        formatDisplayDate,
        MESSAGE_STATUS_TEXT,
        MESSAGE_STATUS_CLASS,
        escapeHtml
    } = useMessageStatus(currentDate, messageStatusUpdate);

    // UI state
    const [toastMessage, setToastMessage] = useState(null);
    const [resetConfirm, setResetConfirm] = useState(false);
    const [emailConfirm, setEmailConfirm] = useState(false);

    // Show toast notification
    const showToast = useCallback((message, type = 'success') => {
        setToastMessage({ message, type });
        setTimeout(() => setToastMessage(null), 5000);
    }, []);

    // Handle date change
    const handleDateChange = useCallback((newDate) => {
        setCurrentDate(newDate);
    }, [setCurrentDate]);

    // Handle refresh
    const handleRefresh = useCallback(async () => {
        await refreshMessageCount();
    }, [refreshMessageCount]);

    // Handle reset messages
    const handleReset = useCallback(async () => {
        if (!resetConfirm) {
            setResetConfirm(true);
            setTimeout(() => setResetConfirm(false), 3000);
            return;
        }

        try {
            const result = await apiClient.post(API_ENDPOINTS.MESSAGE_RESET(currentDate));

            if (result.success) {
                showToast(
                    `Reset completed: ${result.data?.appointmentsReset || 0} appointments reset`,
                    'success'
                );
                await refreshMessageCount();
            } else {
                throw new Error(result.error || 'Reset failed');
            }
        } catch (error) {
            showToast(`Failed to reset: ${error.message}`, 'error');
        } finally {
            setResetConfirm(false);
        }
    }, [resetConfirm, currentDate, showToast, refreshMessageCount]);

    // Handle send email
    const handleSendEmail = useCallback(async () => {
        if (!emailConfirm) {
            setEmailConfirm(true);
            setTimeout(() => setEmailConfirm(false), 3000);
            return;
        }

        try {
            const result = await apiClient.post(
                API_ENDPOINTS.SEND_EMAIL(currentDate),
                null,
                { expectedFields: ['success'] }
            );

            if (result.success) {
                showToast(
                    `Email sent successfully! ${result.appointmentCount} appointments`,
                    'success'
                );
            } else {
                throw new Error(result.error || 'Email sending failed');
            }
        } catch (error) {
            showToast(`Failed to send email: ${error.message}`, 'error');
        } finally {
            setEmailConfirm(false);
        }
    }, [emailConfirm, currentDate, showToast]);

    // Handle start sending
    const handleStartSending = useCallback(async () => {
        if (!clientReady) {
            showToast('WhatsApp client is not ready', 'error');
            return;
        }

        try {
            await apiClient.get(API_ENDPOINTS.WA_SEND(currentDate));
            showToast('Messages sending started', 'success');
        } catch (error) {
            showToast(`Failed to start sending: ${error.message}`, 'error');
        }
    }, [clientReady, currentDate, showToast]);

    // Check for auth completion redirect
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const authCompleted = urlParams.get('authCompleted');

        if (authCompleted) {
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            // Request initial state to refresh client status
            requestInitialState();
        }
    }, [requestInitialState]);

    const sendingInProgress = sendingProgress.started && !sendingProgress.finished;

    return (
        <div id="app">
            <main className="container main-layout" role="main">
                <div className="page-header-area">
                    <h2>WhatsApp Messaging</h2>
                    <div className="connection-status" aria-live="polite">
                        <span
                            className={`connection-indicator ${
                                clientReady ? 'connected' : 'disconnected'
                            }`}
                            aria-hidden="true"
                        ></span>
                        <span className="connection-text">
                            {clientReady ? 'Client Ready' : 'Authentication Required'}
                        </span>
                    </div>
                </div>

                {/* Date Selection Panel */}
                <DateSelector
                    currentDate={currentDate}
                    dateOptions={dateOptions}
                    onDateChange={handleDateChange}
                    displayMessage={displayMessage}
                    onRefresh={handleRefresh}
                    onReset={handleReset}
                    onSendEmail={handleSendEmail}
                    loading={countLoading}
                />

                {/* Status and Action Area */}
                <section className="status-area">
                    <ConnectionStatus
                        connectionStatus={connectionStatus}
                        clientReady={clientReady}
                        sendingProgress={sendingProgress}
                    />

                    {/* Progress Display for Message Sending */}
                    <ProgressBar sendingProgress={sendingProgress} />

                    {/* Main Action Button */}
                    <ActionButtons
                        clientReady={clientReady}
                        onStartSending={handleStartSending}
                        sendingInProgress={sendingInProgress}
                        sendingProgress={sendingProgress}
                    />
                </section>

                {/* Results and Content Area */}
                <section className="content-area">
                    <div id="tableContainer" className="results-container" role="region" aria-label="Message sending results">
                        <MessageStatusTable
                            messages={messages}
                            loading={statusLoading}
                            currentDate={currentDate}
                            formatDisplayDate={formatDisplayDate}
                            MESSAGE_STATUS_TEXT={MESSAGE_STATUS_TEXT}
                            MESSAGE_STATUS_CLASS={MESSAGE_STATUS_CLASS}
                            escapeHtml={escapeHtml}
                            summary={summary}
                        />
                    </div>
                </section>
            </main>

            {/* Toast Notification */}
            {toastMessage && (
                <div
                    id="toastContainer"
                    className={`toast-container toast-${toastMessage.type}`}
                    role="alert"
                    aria-live="assertive"
                >
                    <div className="toast-message">
                        <span>{toastMessage.message}</span>
                        <button
                            className="toast-close"
                            onClick={() => setToastMessage(null)}
                            aria-label="Close notification"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
