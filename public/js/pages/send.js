// js/pages/send.js

/**
 * WhatsApp Messaging Application
 * Handles the UI and communication for sending WhatsApp messages
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

        // DOM elements
        this.stateElement = document.getElementById("state");
        this.startButton = document.getElementById("startSendingBtn");
        this.qrImage = document.getElementById("qr");
        this.tableContainer = document.getElementById("table-container");

        // Event bindings
        this.bindEvents();
        
        // Initialize
        this.init();
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

            // Check for client ready status
            // Added fallback check for clientReady property at the top level
            if ((data.clientReady || data.tableData?.clientReady) && !this.clientReadyShown && !this.sendingStarted) {
                console.log("Client is ready!");
                this.clientReadyShown = true;
                this.startButton.style.display = 'block';
                this.startButton.dataset.action = 'send';
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
     * Send WhatsApp messages
     */
    async sendWa() {
        try {
            // Use fetch with no-redirect options
            const response = await fetch(`${window.location.origin}/api/wa/send?date=${this.dateparam}`, {
                redirect: 'follow'
            });

            const data = await response.json();
            console.log("sendWa response:", data);
            this.updateState(data.htmltext);

            // Always ensure polling is active as fallback
            this.startPolling();
        } catch (error) {
            console.error('Error sending WA:', error);
            this.updateState('Error starting process');
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
            }

            // Update QR code if needed
            if (data.qr) {
                this.updateQR(data.qr);
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
        console.log(`Updating message status: ${messageId} -> ${status}`);

        // Find the person with this message ID
        const personIndex = this.persons.findIndex(p => p.messageId === messageId);

        if (personIndex >= 0) {
            // Update the status if it's a higher level
            const currentStatus = this.persons[personIndex].status || 0;
            if (status > currentStatus) {
                this.persons[personIndex].status = status;
                // Update the table
                this.createTable(this.persons);
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
    updateQR(qr) {
        if (this.qrImage) {
            this.qrImage.src = qr;
            this.qrImage.style.display = 'block';
        }
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

        // Only stop polling, but keep WebSocket open for status updates
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