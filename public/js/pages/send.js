// js/pages/send.js

/**
 * WhatsApp Messaging Application
 * Handles the UI and communication for sending WhatsApp messages
 * Updated for persistent WhatsApp client
 */
class WhatsAppMessenger {
    /**
     * Initialize the messenger
     */
    constructor() {
        // State properties
        this.urlParams = new URLSearchParams(window.location.search);
        this.dateparam = this.urlParams.get('date') || new Date().toISOString().slice(0, 10);
        this.ws = null;
        this.pollingInterval = null;
        this.pingInterval = null;
        this.finished = false;
        this.persons = [];
        this.sentCount = 0;
        this.failedCount = 0;
        this.manualDisconnect = false;
        this.clientReadyShown = false;
        this.sendingStarted = false;
        this.initAttempt = 0;  // Count initialization attempts
        this.maxInitAttempts = 5;  // Maximum number of attempts before showing retry button
        this.statusUpdateQueue = new Map(); // Queue for status updates to avoid duplicates
        // QR code handling properties
        this.qrFetchInProgress = false;
        this.qrRefreshTimer = null;
        this.qrExpiryTime = null;
        // DOM elements
        this.stateElement = document.getElementById("state");
        this.startButton = document.getElementById("startSendingBtn");
        this.qrImage = document.getElementById("qr");
        this.tableContainer = document.getElementById("table-container");
        this.restartButtonContainer = document.getElementById("restart-button-container");


        // Register page visibility change detection
        document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

      

       



        // Event bindings
        this.bindEvents();

        // Initialize
        this.init();
    }
// Add these methods
registerAsQRViewer() {
    fetch('/api/wa/register-qr-viewer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(err => console.error("Failed to register as QR viewer:", err));
  }
  
  unregisterAsQRViewer() {
    // Use sendBeacon for more reliable delivery during page unload
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/wa/unregister-qr-viewer');
    } else {
      // Fallback to fetch with keepalive
      fetch('/api/wa/unregister-qr-viewer', {
        method: 'POST',
        keepalive: true
      }).catch(() => {}); // Ignore errors during page unload
    }
  }
  
  handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      this.registerAsQRViewer();
    } else {
      this.unregisterAsQRViewer();
    }
  }
    /**
     * Bind DOM events
     */
    bindEvents() {
        // Start button click
        if (this.startButton) {
            this.startButton.addEventListener('click', () => {
                // If we're initializing, use the retry function
                if (this.startButton.dataset.action === 'retry') {
                    this.retryInitialization();
                    return;
                }

                // Normal send action
                this.startSending();
                this.startButton.disabled = true;
            });
        }

        // Prevent accidental page navigation
        window.addEventListener('beforeunload', (event) => {
            if (!this.finished && this.sendingStarted) {
                const message = 'Leaving this page will interrupt the WhatsApp sending process.';
                event.returnValue = message;
                return message;
            }
        });
    }

    /**
     * Add restart button to UI
     */
    addRestartButton() {
        if (!this.restartButtonContainer) return;

        // Remove any existing restart button
        const existingButton = document.getElementById('restartClientBtn');
        if (existingButton) {
            existingButton.remove();
        }

        // Create restart button
        const restartButton = document.createElement('button');
        restartButton.id = 'restartClientBtn';
        restartButton.className = 'action-button warning-button';
        restartButton.textContent = 'Restart WhatsApp Client';
        restartButton.addEventListener('click', () => this.restartClient());

        // Add to container
        this.restartButtonContainer.appendChild(restartButton);
        this.restartButtonContainer.style.display = 'block';
    }

    /**
     * Restart WhatsApp client
     */
    async restartClient() {
        console.log("Restarting WhatsApp client");

        // Update UI
        this.updateState('<div class="loader"></div> Restarting WhatsApp client...');

        // Disable restart button during restart
        const restartButton = document.getElementById('restartClientBtn');
        if (restartButton) {
            restartButton.disabled = true;
            restartButton.textContent = 'Restarting...';
        }

        try {
            // Call restart endpoint
            const response = await fetch(`${window.location.origin}/api/wa/restart`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            console.log("Restart response:", data);

            // Update UI with restart status
            this.updateState(data.message || 'Restarting WhatsApp client...');

            // Reset state
            this.clientReadyShown = false;
            this.initAttempt = 0;

            // Start polling for updates
            this.startPolling();

            // Re-enable restart button
            if (restartButton) {
                restartButton.disabled = false;
                restartButton.textContent = 'Restart WhatsApp Client';
            }
        } catch (error) {
            console.error("Error restarting WhatsApp client:", error);
            this.updateState('Error restarting WhatsApp client. Please try again.');

            // Re-enable restart button
            if (restartButton) {
                restartButton.disabled = false;
                restartButton.textContent = 'Retry Restart';
            }
        }
    }

    /**
     * Retry WhatsApp client initialization
     */
    retryInitialization() {
        console.log("Retrying WhatsApp client initialization");

        // Reset initialization state
        this.initAttempt = 0;

        // Update UI
        this.updateState('<div class="loader"></div> Reinitializing WhatsApp client...');
        this.startButton.style.display = 'none';

        // Fetch to restart the WhatsApp client
        fetch(`${window.location.origin}/api/wa/restart`, { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                console.log("Restart response:", data);
                this.updateState(data.message || 'Restarting WhatsApp client...');

                // Reconnect WebSocket and restart polling
                this.connectWebSocket();
                this.loadState();
            })
            .catch(error => {
                console.error("Error restarting WhatsApp client:", error);
                this.updateState('Error restarting WhatsApp client. Please refresh the page.');
            });
    }

    /**
     * Initialize the application
     */
    init() {
        console.log("Initializing with date:", this.dateparam);
        this.connectWebSocket();
        this.loadState();

        // Add restart button after initialization
        setTimeout(() => this.addRestartButton(), 2000);
    }

    /**
     * Start sending messages
     */
    startSending() {
        console.log("Starting sending process...");
        this.sendingStarted = true;
        this.sendWa();
    }

    /**
     * Connect to WebSocket server
     */
    connectWebSocket() {
        try {
            // Close any existing connection
            if (this.ws && this.ws.readyState === 1) {
                this.manualDisconnect = true;
                this.ws.close();
            }

            this.manualDisconnect = false;
            this.ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}?PDate=${this.dateparam}&clientType=waStatus`);

            this.ws.onopen = () => {
                console.log("WebSocket connected");
                // Clear any existing ping interval
                if (this.pingInterval) {
                    clearInterval(this.pingInterval);
                }

                // Keep connection alive with pings
                this.pingInterval = setInterval(() => {
                    if (this.ws && this.ws.readyState === 1) {
                        console.log("Sending ping to keep connection alive");
                        this.ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 30000); // Send ping every 30 seconds
            };

            this.ws.onmessage = (event) => {
                this.handleWebSocketMessage(event);
            };

            this.ws.onclose = (event) => {
                console.log("WebSocket connection closed", event.code, event.reason);
                // Clear ping interval
                if (this.pingInterval) {
                    clearInterval(this.pingInterval);
                    this.pingInterval = null;
                }

                // If not a manual disconnect and not finished, try to reconnect
                if (!this.manualDisconnect && !this.finished) {
                    console.log("Reconnecting WebSocket in 2 seconds...");
                    setTimeout(() => this.connectWebSocket(), 2000);
                }

                // Always ensure polling is active
                this.startPolling();
            };

            this.ws.onerror = (error) => {
                console.error("WebSocket error:", error);
                // Fallback to polling on error
                this.startPolling();
            };
        } catch (error) {
            console.error("Error creating WebSocket:", error);
            this.startPolling();
        }
    }

    /**
     * Handle WebSocket message
     * @param {MessageEvent} event - WebSocket message event
     */
    handleWebSocketMessage(event) {
        console.log("Raw WebSocket message received:", event.data);
        try {
            const data = JSON.parse(event.data);
            console.log("Parsed WebSocket message:", data);

            // Handle different message types
            if (data.messageType === "updated") {
                this.updateUI(data.tableData);
            } else if (data.messageType === "messageAckUpdated") {
                this.updateMessageStatus(data.messageId, data.status);
                // Update the table even after finished=true
                this.createTable(this.persons);
            } else if (data.qr) {
                this.updateQR(data.qr);
            }

            // Handle client status information
            if (data.clientStatus) {
                // Show information about the persistent client
                const statusInfo = data.clientStatus;
                console.log("Client status received:", statusInfo);

                // If client is inactive for too long, show restart button more prominently
                if (statusInfo.lastActivity && this.calculateInactiveTime(statusInfo.lastActivity) > 300000) { // 5 minutes
                    this.addRestartButton();
                    const restartBtn = document.getElementById('restartClientBtn');
                    if (restartBtn) {
                        restartBtn.classList.add('attention');
                    }
                }
            }

            // Check for client ready status
            // Added fallback check for clientReady property at the top level
            if ((data.clientReady || data.tableData?.clientReady) && !this.clientReadyShown && !this.sendingStarted) {
                console.log("Client is ready!");
                this.clientReadyShown = true;
                this.startButton.style.display = 'block';
                this.startButton.dataset.action = 'send';
            }

            // Process batch status updates
            if (data.statusUpdates && Array.isArray(data.statusUpdates)) {
                console.log(`Processing ${data.statusUpdates.length} status updates from WebSocket`);
                data.statusUpdates.forEach(update => {
                    this.updateMessageStatus(update.messageId, update.status);
                });

                // Update table after processing all updates
                this.createTable(this.persons);
            }

            // Still track finished state
            if (data.finished && !this.finished) {
                this.finished = true;
                this.updateFinishedState();
            }




        } catch (error) {
            console.error("Error parsing WebSocket message:", error);
        }



    }

    /**
     * Calculate time difference in milliseconds
     * @param {number} timestamp - Timestamp to compare with now
     * @returns {number} - Time difference in milliseconds
     */
    calculateInactiveTime(timestamp) {
        return Date.now() - timestamp;
    }

    /**
     * Send WhatsApp messages
     */
    async sendWa() {
        try {
            // First check client status
            const statusResponse = await fetch(`${window.location.origin}/api/wa/status`);
            const statusData = await statusResponse.json();

            if (!statusData.clientReady) {
                alert("WhatsApp client is not ready. Please wait for initialization to complete or restart the client.");
                this.startButton.disabled = false;
                return;
            }

            console.log("Client is ready, sending messages for date:", this.dateparam);

            // Use fetch with no-redirect options
            const response = await fetch(`${window.location.origin}/api/wa/send?date=${this.dateparam}`, {
                redirect: 'follow'
            });

            const data = await response.json();
            console.log("sendWa response:", data);
            this.updateState(data.htmltext || 'Starting to send messages...');

            // Always ensure polling is active as fallback
            this.startPolling();
        } catch (error) {
            console.error('Error sending WA:', error);
            this.updateState('Error starting process. Please try restarting the client.');
            this.startButton.disabled = false;
            this.startPolling();
        }
    }

    /**
     * Start polling for updates
     */
    startPolling() {
        // Only start polling if we don't already have polling running
        if (!this.pollingInterval && !this.finished) {
            console.log("Starting polling mechanism");
            this.pollingInterval = setInterval(() => this.loadState(), 2000);
        }
    }

    /**
     * Load current state from server
     */
    async loadState() {
        if (this.finished) {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
            return;
        }

        console.log("Polling for updates...");
        try {
            const response = await fetch(`${window.location.origin}/api/update`);
            const data = await response.json();
            console.log("Polling response:", data);

            // Always update state with what we get
            this.updateState(data.htmltext);

            // Check for client ready status
            if (data.clientReady && !this.clientReadyShown && !this.sendingStarted) {
                console.log("Client is ready from poll data!");
                this.clientReadyShown = true;
                this.startButton.style.display = 'block';
                this.startButton.dataset.action = 'send';
                this.updateState(`<p>Client is ready! ${data.sentMessages || 0} Messages Sent, ${data.failedMessages || 0} Failed</p><p>Click "Start Sending Messages" to begin</p>`);
            } else if (!data.clientReady && !this.clientReadyShown) {
                // Increment the initialization attempt counter
                this.initAttempt++;
                console.log(`Initialization attempt ${this.initAttempt} of ${this.maxInitAttempts}`);

                // If we've reached max attempts, show the retry button
                if (this.initAttempt >= this.maxInitAttempts) {
                    console.log("Max initialization attempts reached, showing retry button");
                    this.startButton.textContent = "Retry Initialization";
                    this.startButton.style.display = 'block';
                    this.startButton.dataset.action = 'retry';
                    this.updateState(`<p>WhatsApp client initialization failed after ${this.maxInitAttempts} attempts.</p><p>Click "Retry Initialization" to try again.</p>`);
                }
            }

            // Update persons array and table
            if (data.persons && data.persons.length > 0) {
                this.updatePersons(data.persons);
                this.createTable(this.persons);
            }

            // Process any status updates included in the response
            if (data.statusUpdates && data.statusUpdates.length > 0) {
                console.log("Processing status updates from polling:", data.statusUpdates);
                data.statusUpdates.forEach(update => {
                    this.updateMessageStatus(update.messageId, update.status);
                });

                // Update table only once after processing all updates
                this.createTable(this.persons);
            }

            // Update QR code if needed
            if (data.qr) {
                this.updateQR(data.qr);
            }

            // Check client status for potential issues
            if (data.clientStatus) {
                // If client has been inactive for too long, show restart button prominently
                if (data.clientStatus.lastActivity) {
                    const inactiveTime = this.calculateInactiveTime(data.clientStatus.lastActivity);
                    if (inactiveTime > 300000) { // 5 minutes
                        console.log(`Client inactive for ${inactiveTime}ms, showing restart button`);
                        this.addRestartButton();
                        const restartBtn = document.getElementById('restartClientBtn');
                        if (restartBtn) {
                            restartBtn.classList.add('attention');
                        }
                    }
                }
            }

            // Handle finished state
            if (data.finished) {
                this.finished = true;
                this.updateFinishedState();
            }
        } catch (error) {
            console.error('Error loading state:', error);
            this.updateState('Error updating state');
        }
    }

    /**
     * Update the persons array with new data
     * @param {Array} newPersons - New persons data
     */
    updatePersons(newPersons) {
        // Add new persons that aren't already in the list
        newPersons.forEach(newPerson => {
            // Check if person already exists in the list
            const existingIndex = this.persons.findIndex(p =>
                p.messageId === newPerson.messageId);

            if (existingIndex >= 0) {
                // Update existing person
                const existingPerson = this.persons[existingIndex];
                this.persons[existingIndex] = {
                    ...existingPerson,
                    ...newPerson,
                    // Keep status if it's more advanced
                    status: Math.max(existingPerson.status || 0, newPerson.status || 0)
                };
            } else {
                // Add new person
                this.persons.push(newPerson);
            }
        });

        console.log("Updated persons array:", this.persons);
    }

    /**
     * Update message status
     * @param {string} messageId - Message ID
     * @param {number} status - Status code
     */
    updateMessageStatus(messageId, status) {
        // Skip duplicate updates by using a queue with debouncing
        const existingUpdate = this.statusUpdateQueue.get(messageId);
        if (existingUpdate && existingUpdate.status >= status) {
            return; // Skip if we already have a higher status
        }

        // Queue this update
        this.statusUpdateQueue.set(messageId, { messageId, status, timestamp: Date.now() });

        console.log(`Updating message status: ${messageId} -> ${status}`);

        // Find the person with this message ID
        const personIndex = this.persons.findIndex(p => p.messageId === messageId);

        if (personIndex >= 0) {
            // Update the status if it's a higher level
            const currentStatus = this.persons[personIndex].status || 0;
            if (status > currentStatus) {
                this.persons[personIndex].status = status;
                // Table will be updated after processing all queued updates
            }
        } else {
            console.log(`Message ID ${messageId} not found in persons array`);
        }
    }

    /**
     * Get text representation of status code
     * @param {number} status - Status code
     * @returns {string} - HTML for status display
     */
    getStatusText(status) {
        switch (status) {
            case -1: return '<span class="status-error">&#10060; Error</span>'; // Error
            case 0: return '<span class="status-pending">&#8987; Pending</span>'; // Pending
            case 1: return '<span class="status-sent">&#10004; Sent</span>'; // Sent
            case 2: return '<span class="status-delivered">&#10004;&#10004; Delivered</span>'; // Delivered
            case 3: return '<span class="status-read">&#10004;&#10004; Read</span>'; // Read
            case 4: return '<span class="status-read">&#10004;&#10004; Played</span>'; // Played
            default: return '<span class="status-sent">&#10004; Sent</span>';
        }
    }

    /**
     * Count messages by status type
     * @returns {Object} - Counts by status
     */
    countStatusTypes() {
        let sent = 0;
        let delivered = 0;
        let read = 0;
        let error = 0;
        let pending = 0;

        this.persons.forEach(person => {
            const status = person.status || (person.success === '&#10004;' ? 1 : -1);
            if (status === -1) error++;
            else if (status === 0) pending++;
            else if (status === 1) sent++;
            else if (status === 2) delivered++;
            else if (status >= 3) read++;
        });

        return { sent, delivered, read, error, pending };
    }

    /**
     * Update UI with data
     * @param {Object} data - Data for UI update
     */
    updateUI(data) {
        if (data) {
            this.updateState(data.htmltext);

            if (data.persons && data.persons.length > 0) {
                this.updatePersons(data.persons);
                this.createTable(this.persons);
            }

            if (data.finished) {
                this.finished = true;
                this.updateFinishedState();
            }
        }
    }

    /**
     * Create results table
     * @param {Array} tableData - Data for table
     */
    createTable(tableData) {
        if (!tableData || tableData.length === 0) return;

        const table = document.createElement('table');
        table.border = "1";
        table.id = 'p_table';
        const tableBody = document.createElement('tbody');

        const header = table.createTHead();
        const headerRow = header.insertRow(0);
        ['Name', 'Phone', 'Status'].forEach(text => {
            const cell = headerRow.insertCell();
            cell.textContent = text;
            cell.style.fontWeight = 'bold';
        });

        tableData.forEach(rowData => {
            const row = document.createElement('tr');
            if (rowData.messageId) {
                row.dataset.messageId = rowData.messageId;
            }

            // Determine status
            let status = 0;
            if (rowData.status !== undefined) {
                status = rowData.status;
            } else if (rowData.success === '&#10004;') {
                status = 1; // Sent
            } else if (rowData.success === '&times;') {
                status = -1; // Error
            }

            // Set row class based on status
            row.className = status >= 1 ? 'true' : 'false';

            // Name cell
            const nameCell = document.createElement('td');
            nameCell.textContent = rowData.name;
            row.appendChild(nameCell);

            // Phone cell
            const phoneCell = document.createElement('td');
            phoneCell.textContent = rowData.number;
            row.appendChild(phoneCell);

            // Status cell
            const statusCell = document.createElement('td');
            statusCell.className = 'status-cell';
            statusCell.innerHTML = this.getStatusText(status);

            row.appendChild(statusCell);
            tableBody.appendChild(row);
        });

        table.appendChild(tableBody);

        // Add status summary above table
        const statusCounts = this.countStatusTypes();
        const summary = document.createElement('div');
        summary.className = 'message-count';
        summary.innerHTML = `
            Total: ${tableData.length} | 
            <span class="status-error">Failed: ${statusCounts.error}</span> | 
            <span class="status-pending">Pending: ${statusCounts.pending}</span> | 
            <span class="status-sent">Sent: ${statusCounts.sent}</span> | 
            <span class="status-delivered">Delivered: ${statusCounts.delivered}</span> | 
            <span class="status-read">Read: ${statusCounts.read}</span>
        `;

        this.tableContainer.innerHTML = '';
        this.tableContainer.appendChild(summary);
        this.tableContainer.appendChild(table);
    }

    /**
     * Update state element
     * @param {string} html - HTML to display
     */
    updateState(html) {
        if (this.stateElement) {
            this.stateElement.innerHTML = html;
        }
    }

    /**
     * Update QR code image
     * @param {string} qr - QR code data URL
     */
    // Update this method
    updateQR(qr) {
        if (!this.qrImage) return;

        // Clear any existing QR refresh timers
        if (this.qrRefreshTimer) {
            clearTimeout(this.qrRefreshTimer);
            this.qrRefreshTimer = null;
        }

        if (!qr) {
            // No QR code provided
            this.qrImage.style.display = 'none';
            this.updateQRErrorState("Waiting for QR code...");

            // Start fetching QR code after a short delay
            this.qrRefreshTimer = setTimeout(() => this.fetchQRImage(), 2000);
            return;
        }

        // Check if we need to fetch the QR image
        if (typeof qr === 'string') {
            if (qr.startsWith('data:image')) {
                // It's a data URL, use directly
                this.qrImage.src = qr;
                this.qrImage.style.display = 'block';

                // Hide any error message
                const errorElement = document.getElementById('qr-error');
                if (errorElement) errorElement.style.display = 'none';
            } else {
                // It's not a data URL, fetch the image
                this.fetchQRImage();
            }
        } else {
            console.error("Invalid QR code format received:", typeof qr);
            this.updateQRErrorState("Invalid QR code format received");

            // Retry after delay
            this.qrRefreshTimer = setTimeout(() => this.fetchQRImage(), 5000);
        }
    }

    async fetchQRImage() {
        if (this.qrFetchInProgress) return; // Prevent multiple simultaneous requests

        try {
            this.qrFetchInProgress = true;

            // Show loading state
            this.updateQRLoadingState(true);

            const response = await fetch('/api/wa/qr');
            const data = await response.json();

            if (response.ok && data.qr) {
                console.log("QR code fetched successfully");
                this.qrImage.src = data.qr;
                this.qrImage.style.display = 'block';

                // If QR code has expiry time, schedule a refresh
                if (data.expiryTime) {
                    const timeToExpiry = data.expiryTime - Date.now();
                    if (timeToExpiry > 0) {
                        // Refresh QR code 5 seconds before expiry
                        setTimeout(() => this.fetchQRImage(), Math.max(timeToExpiry - 5000, 1000));
                    }
                }

                // Hide any error message
                const errorElement = document.getElementById('qr-error');
                if (errorElement) errorElement.style.display = 'none';
            } else {
                // QR code not available yet
                console.log("QR code not available yet:", data.error || "Unknown error");
                this.updateQRErrorState(data.error || "QR code not available yet");

                // Retry after 3 seconds
                setTimeout(() => this.fetchQRImage(), 3000);
            }
        } catch (error) {
            console.error("Error fetching QR code:", error);
            this.updateQRErrorState("Failed to fetch QR code. Retrying...");

            // Retry after 5 seconds on error
            setTimeout(() => this.fetchQRImage(), 5000);
        } finally {
            this.qrFetchInProgress = false;
            this.updateQRLoadingState(false);
        }
    }

    // Add new helper methods for QR code display states
    updateQRLoadingState(isLoading) {
        // Create or update loading indicator
        let loadingElement = document.getElementById('qr-loading');
        if (!loadingElement && isLoading) {
            loadingElement = document.createElement('div');
            loadingElement.id = 'qr-loading';
            loadingElement.className = 'qr-loading';
            loadingElement.innerHTML = '<div class="loader"></div><p>Loading QR code...</p>';

            const qrContainer = this.qrImage.parentElement;
            qrContainer.appendChild(loadingElement);
        } else if (loadingElement) {
            loadingElement.style.display = isLoading ? 'block' : 'none';
        }
    }

    updateQRErrorState(errorMessage) {
        // Create or update error message
        let errorElement = document.getElementById('qr-error');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = 'qr-error';
            errorElement.className = 'qr-error';

            const qrContainer = this.qrImage.parentElement;
            qrContainer.appendChild(errorElement);
        }

        errorElement.innerHTML = `<p>${errorMessage}</p>`;
        errorElement.style.display = 'block';

        // Hide the QR image if there's an error
        this.qrImage.style.display = 'none';
    }



    /**
     * Update UI for finished state
     */
    updateFinishedState() {
        // Update UI to show completion
        if (this.stateElement) {
            const statusCounts = this.countStatusTypes();
            this.stateElement.innerHTML = `
                <p>Messages sent successfully! Status updates will continue to be received.</p>
                <p>
                    <span class="status-sent">Sent: ${statusCounts.sent}</span> | 
                    <span class="status-delivered">Delivered: ${statusCounts.delivered}</span> | 
                    <span class="status-read">Read: ${statusCounts.read}</span> | 
                    <span class="status-error">Failed: ${statusCounts.error}</span>
                </p>
                <p>Message statuses are being stored in the database and will be accessible for 24 hours.</p>
            `;
        }

        // Continue receiving updates via WebSocket, but stop polling
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }

        // Disable start button
        if (this.startButton) {
            this.startButton.disabled = true;
        }
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.messenger = new WhatsAppMessenger();
});