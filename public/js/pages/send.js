/**
 * WhatsApp Messaging Application
 * Handles the UI and communication for sending WhatsApp messages
 */
class WhatsAppMessenger {
    constructor() {
        // State properties
        this.urlParams = new URLSearchParams(window.location.search);
        this.dateparam = this.urlParams.get('date') || new Date().toISOString().slice(0, 10);
        this.ws = null;
        this.pollingInterval = null;
        this.pingInterval = null;
        this.finished = false;
        this.persons = [];
        this.clientReadyShown = false;
        this.sendingStarted = false;
        this.initAttempt = 0;
        this.maxInitAttempts = 5;
        this.statusUpdateQueue = new Map();
        
        // DOM elements
        this.stateElement = document.getElementById("state");
        this.startButton = document.getElementById("startSendingBtn");
        this.qrImage = document.getElementById("qr");
        this.tableContainer = document.getElementById("table-container");
        this.restartButtonContainer = document.getElementById("restart-button-container");

        // Event bindings
        this.bindEvents();

        // Initialize
        this.init();
    }

    bindEvents() {
        // Start button click
        if (this.startButton) {
            this.startButton.addEventListener('click', () => {
                if (this.startButton.dataset.action === 'retry') {
                    this.retryInitialization();
                    return;
                }
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

    init() {
        console.log("Initializing with date:", this.dateparam);
        this.connectWebSocket();
        this.loadState();
        setTimeout(() => this.addRestartButton(), 2000);
    }

    addRestartButton() {
        if (!this.restartButtonContainer) return;

        const existingButton = document.getElementById('restartClientBtn');
        if (existingButton) {
            existingButton.remove();
        }

        const restartButton = document.createElement('button');
        restartButton.id = 'restartClientBtn';
        restartButton.className = 'action-button warning-button';
        restartButton.textContent = 'Restart WhatsApp Client';
        restartButton.addEventListener('click', () => this.restartClient());

        this.restartButtonContainer.appendChild(restartButton);
        this.restartButtonContainer.style.display = 'block';
    }

    async restartClient() {
        console.log("Restarting WhatsApp client");
        this.updateState('<div class="loader"></div> Restarting WhatsApp client...');

        const restartButton = document.getElementById('restartClientBtn');
        if (restartButton) {
            restartButton.disabled = true;
            restartButton.textContent = 'Restarting...';
        }

        try {
            const response = await fetch(`${window.location.origin}/api/wa/restart`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'}
            });

            const data = await response.json();
            console.log("Restart response:", data);
            this.updateState(data.message || 'Restarting WhatsApp client...');

            // Reset state
            this.clientReadyShown = false;
            this.initAttempt = 0;

            // Start polling for updates
            this.startPolling();

            if (restartButton) {
                restartButton.disabled = false;
                restartButton.textContent = 'Restart WhatsApp Client';
            }
        } catch (error) {
            console.error("Error restarting WhatsApp client:", error);
            this.updateState('Error restarting WhatsApp client. Please try again.');

            if (restartButton) {
                restartButton.disabled = false;
                restartButton.textContent = 'Retry Restart';
            }
        }
    }

    retryInitialization() {
        console.log("Retrying WhatsApp client initialization");
        this.initAttempt = 0;
        this.updateState('<div class="loader"></div> Reinitializing WhatsApp client...');
        this.startButton.style.display = 'none';

        fetch(`${window.location.origin}/api/wa/restart`, { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                console.log("Restart response:", data);
                this.updateState(data.message || 'Restarting WhatsApp client...');
                this.connectWebSocket();
                this.loadState();
            })
            .catch(error => {
                console.error("Error restarting WhatsApp client:", error);
                this.updateState('Error restarting WhatsApp client. Please refresh the page.');
            });
    }

    startSending() {
        console.log("Starting sending process...");
        this.sendingStarted = true;
        this.sendWa();
    }


    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        
        if (diff < 60000) {
          return 'Just now';
        } else if (diff < 3600000) {
          const minutes = Math.floor(diff / 60000);
          return `${minutes}m ago`;
        } else if (diff < 86400000) {
          const hours = Math.floor(diff / 3600000);
          return `${hours}h ago`;
        } else {
          const days = Math.floor(diff / 86400000);
          return `${days}d ago`;
        }
      }
      
      // ===== ENHANCE updateFinishedState METHOD =====
      // Find the existing updateFinishedState method and replace with:
      
      updateFinishedState() {
        // Update UI to show completion
        if (this.stateElement) {
          const statusCounts = this.countStatusTypes();
          this.stateElement.innerHTML = `
            <div class="completion-status">
              <h3>✅ Messages sent successfully!</h3>
              <p>Status updates will continue to be received.</p>
              <div class="final-stats">
                <span class="stat-item status-sent">Sent: ${statusCounts.sent}</span>
                <span class="stat-item status-delivered">Delivered: ${statusCounts.delivered}</span>
                <span class="stat-item status-read">Read: ${statusCounts.read}</span>
                <span class="stat-item status-error">Failed: ${statusCounts.error}</span>
              </div>
              <p class="note">Message statuses are being stored in the database and will be accessible for 24 hours.</p>
            </div>
          `;
        }
      
        // Stop polling, but continue receiving WebSocket updates
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
      
        // Disable start button
        if (this.startButton) {
          this.startButton.disabled = true;
          this.startButton.textContent = 'Completed';
        }
      }

    handleQRUpdate(data) {
        console.log("QR code received via WebSocket");
        
        if (data.qr && !data.clientReady) {
          this.updateQR(data.qr);
          this.updateState('<p>Please scan the QR code with your WhatsApp</p>');
        }
      }
      
      handleClientReady(data) {
        console.log("Client is ready from WebSocket!");
        
        if (this.qrImage) {
          this.qrImage.style.display = 'none';
        }
        
        if (!this.clientReadyShown && !this.sendingStarted) {
          this.clientReadyShown = true;
          this.startButton.style.display = 'block';
          this.startButton.disabled = false;
          this.startButton.dataset.action = 'send';
          this.updateState('<p>Client is ready! Click "Start Sending Messages" to begin</p>');
        }
      }
      
      handleSingleStatusUpdate(data) {
        console.log("Single status update received:", data);
        
        if (data.messageId && data.status !== undefined) {
          this.updateMessageStatus(data.messageId, data.status);
          this.createTable(this.persons);
        }
      }
      
      handleBatchStatusUpdate(data) {
        console.log("Batch status update received:", data);
        
        if (data.statusUpdates && Array.isArray(data.statusUpdates)) {
          let updatesProcessed = 0;
          
          data.statusUpdates.forEach(update => {
            if (update.messageId && update.status !== undefined) {
              this.updateMessageStatus(update.messageId, update.status);
              updatesProcessed++;
            }
          });
          
          if (updatesProcessed > 0) {
            this.createTable(this.persons);
            console.log(`Processed ${updatesProcessed} status updates`);
          }
        }
      }
      
      handleAppointmentUpdate(data) {
        console.log("Appointment update received:", data);
        
        if (data.tableData) {
          this.updateUI(data);
        }
      }
      
      handleSendingFinished(data) {
        console.log("Sending finished received:", data);
        
        if (data.finished && !this.finished) {
          this.finished = true;
          this.updateFinishedState();
        }
      }
      
      handleError(data) {
        console.error("Error message received:", data);
        
        if (data.error) {
          this.updateState(`<p class="error">Error: ${data.error}</p>`);
        }
      }
      
      handleLegacyMessage(message) {
        // Handle old message formats for backward compatibility
        if (message.messageType === "updated") {
          this.updateUI(message.tableData);
        } else if (message.messageType === "messageAckUpdated") {
          this.updateMessageStatus(message.messageId, message.status);
          this.createTable(this.persons);
        } else if (message.finished && !this.finished) {
          this.finished = true;
          this.updateFinishedState();
        }
      }
      
    connectWebSocket() {
        try {
            // Close any existing connection
            if (this.ws && this.ws.readyState === 1) {
                this.ws.close();
            }

            this.ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}?PDate=${this.dateparam}&clientType=waStatus`);

            this.ws.onopen = () => {
                console.log("WebSocket connected");
                if (this.pingInterval) {
                    clearInterval(this.pingInterval);
                }

                this.pingInterval = setInterval(() => {
                    if (this.ws && this.ws.readyState === 1) {
                        console.log("Sending ping to keep connection alive");
                        this.ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 30000);
            };

            this.ws.onmessage = (event) => {
                this.handleWebSocketMessage(event);
            };

            this.ws.onclose = (event) => {
                console.log("WebSocket connection closed", event.code, event.reason);
                if (this.pingInterval) {
                    clearInterval(this.pingInterval);
                    this.pingInterval = null;
                }

                // Reconnect unless manual disconnect or finished
                if (!this.finished) {
                    console.log("Reconnecting WebSocket in 2 seconds...");
                    setTimeout(() => this.connectWebSocket(), 2000);
                }

                // Ensure polling is active
                this.startPolling();
            };

            this.ws.onerror = (error) => {
                console.error("WebSocket error:", error);
                this.startPolling();
            };
        } catch (error) {
            console.error("Error creating WebSocket:", error);
            this.startPolling();
        }
    }

    handleWebSocketMessage(event) {
        console.log("Raw WebSocket message received:", event.data);
        
        try {
          const message = JSON.parse(event.data);
          console.log("Parsed WebSocket message:", message);
      
          // Validate message format
          if (!message.type || !message.data) {
            console.warn("Invalid message format received:", message);
            return;
          }
      
          // Handle different message types
          switch (message.type) {
            case 'qr_update':
              this.handleQRUpdate(message.data);
              break;
              
            case 'client_ready':
              this.handleClientReady(message.data);
              break;
              
            case 'message_status':
              this.handleSingleStatusUpdate(message.data);
              break;
              
            case 'batch_status':
              this.handleBatchStatusUpdate(message.data);
              break;
              
            case 'appointment_update':
              this.handleAppointmentUpdate(message.data);
              break;
              
            case 'sending_finished':
              this.handleSendingFinished(message.data);
              break;
              
            case 'error':
              this.handleError(message.data);
              break;
              
            case 'pong':
              console.log("Received pong response");
              break;
              
            default:
              // Handle legacy message formats for backward compatibility
              this.handleLegacyMessage(message);
          }
          
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      }

    async sendWa() {
        try {
            // Check client status
            const statusResponse = await fetch(`${window.location.origin}/api/wa/status`);
            const statusData = await statusResponse.json();

            if (!statusData.clientReady) {
                alert("WhatsApp client is not ready. Please wait for initialization to complete or restart the client.");
                this.startButton.disabled = false;
                return;
            }

            console.log("Client is ready, sending messages for date:", this.dateparam);
            const response = await fetch(`${window.location.origin}/api/wa/send?date=${this.dateparam}`, {
                redirect: 'follow'
            });

            const data = await response.json();
            console.log("sendWa response:", data);
            this.updateState(data.htmltext || 'Starting to send messages...');
            this.startPolling();
        } catch (error) {
            console.error('Error sending WA:', error);
            this.updateState('Error starting process. Please try restarting the client.');
            this.startButton.disabled = false;
            this.startPolling();
        }
    }

    startPolling() {
        if (!this.pollingInterval && !this.finished) {
            console.log("Starting polling mechanism");
            this.pollingInterval = setInterval(() => this.loadState(), 2000);
        }
    }

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

            // Handle QR code from polling
            if (data.qr && !data.clientReady) {
                console.log("QR code received via polling");
                this.updateQR(data.qr);
                this.updateState('<p>Please scan the QR code with your WhatsApp</p>');
            }

            // Handle client ready state
            if (data.clientReady && !this.clientReadyShown && !this.sendingStarted) {
                console.log("Client is ready from poll data!");
                if (this.qrImage) {
                    this.qrImage.style.display = 'none';
                }
                
                this.clientReadyShown = true;
                this.startButton.style.display = 'block';
                this.startButton.disabled = false;
                this.startButton.dataset.action = 'send';
                this.updateState(`<p>Client is ready! ${data.sentMessages || 0} Messages Sent, ${data.failedMessages || 0} Failed</p><p>Click "Start Sending Messages" to begin</p>`);
            } else if (!data.clientReady && !this.clientReadyShown) {
                // Update state text if not ready
                this.updateState(data.htmltext || 'Initializing the client...');
                
                // Increment the initialization attempt counter
                this.initAttempt++;
                console.log(`Initialization attempt ${this.initAttempt} of ${this.maxInitAttempts}`);

                // If we've reached max attempts, show the retry button
                if (this.initAttempt >= this.maxInitAttempts) {
                    console.log("Max initialization attempts reached, showing retry button");
                    this.startButton.textContent = "Retry Initialization";
                    this.startButton.style.display = 'block';
                    this.startButton.disabled = false;
                    this.startButton.dataset.action = 'retry';
                    this.updateState(`<p>WhatsApp client initialization failed after ${this.maxInitAttempts} attempts.</p><p>Click "Retry Initialization" to try again.</p>`);
                }
            }

            // Update persons array and table
            if (data.persons && data.persons.length > 0) {
                this.updatePersons(data.persons);
                this.createTable(this.persons);
            }

            // Process status updates
            if (data.statusUpdates && data.statusUpdates.length > 0) {
                data.statusUpdates.forEach(update => {
                    this.updateMessageStatus(update.messageId, update.status);
                });
                this.createTable(this.persons);
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

    updatePersons(newPersons) {
        newPersons.forEach(newPerson => {
          const existingIndex = this.persons.findIndex(p => 
            p.messageId === newPerson.messageId || 
            (p.name === newPerson.name && p.number === newPerson.number)
          );
      
          if (existingIndex >= 0) {
            // Update existing person
            const existingPerson = this.persons[existingIndex];
            this.persons[existingIndex] = {
              ...existingPerson,
              ...newPerson,
              // Keep status if it's more advanced
              status: Math.max(existingPerson.status || 0, newPerson.status || 0),
              lastUpdated: Date.now()
            };
          } else {
            // Add new person
            this.persons.push({
              ...newPerson,
              addedAt: Date.now(),
              lastUpdated: Date.now()
            });
          }
        });
      }

    updateMessageStatus(messageId, status) {
        // Skip duplicate updates using queue
        const existingUpdate = this.statusUpdateQueue.get(messageId);
        if (existingUpdate && existingUpdate.status >= status) {
          return;
        }
      
        // Queue this update with timestamp
        this.statusUpdateQueue.set(messageId, { 
          messageId, 
          status, 
          timestamp: Date.now() 
        });
      
        // Find the person with this message ID
        const personIndex = this.persons.findIndex(p => p.messageId === messageId);
      
        if (personIndex >= 0) {
          // Update the status if it's a higher level
          const currentStatus = this.persons[personIndex].status || 0;
          if (status > currentStatus) {
            this.persons[personIndex].status = status;
            this.persons[personIndex].lastUpdated = Date.now();
          }
        } else {
          // If person not found but we have a status update, log it
          console.warn(`Received status update for unknown message ID: ${messageId}`);
        }
      }

    getStatusText(status) {
        switch (status) {
            case -1: return '<span class="status-error">&#10060; Error</span>';
            case 0: return '<span class="status-pending">&#8987; Pending</span>';
            case 1: return '<span class="status-sent">&#10004; Sent</span>';
            case 2: return '<span class="status-delivered">&#10004;&#10004; Delivered</span>';
            case 3: return '<span class="status-read">&#10004;&#10004; Read</span>';
            case 4: return '<span class="status-read">&#10004;&#10004; Played</span>';
            default: return '<span class="status-sent">&#10004; Sent</span>';
        }
    }

    countStatusTypes() {
        let sent = 0, delivered = 0, read = 0, error = 0, pending = 0;

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

    updateUI(data) {
        if (!data) return;
        
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

    createTable(tableData) {
        if (!tableData || tableData.length === 0) return;
      
        const table = document.createElement('table');
        table.border = "1";
        table.id = 'p_table';
        table.className = 'message-status-table';
        
        const tableBody = document.createElement('tbody');
      
        // Create header
        const header = table.createTHead();
        const headerRow = header.insertRow(0);
        ['Name', 'Phone', 'Status', 'Last Updated'].forEach(text => {
          const cell = headerRow.insertCell();
          cell.textContent = text;
          cell.style.fontWeight = 'bold';
          cell.className = 'table-header';
        });
      
        // Sort table data by status and last updated
        const sortedData = [...tableData].sort((a, b) => {
          const statusA = a.status || (a.success === '&#10004;' ? 1 : 0);
          const statusB = b.status || (b.success === '&#10004;' ? 1 : 0);
          
          if (statusA !== statusB) {
            return statusB - statusA; // Higher status first
          }
          
          // If same status, sort by last updated (most recent first)
          const timeA = a.lastUpdated || a.addedAt || 0;
          const timeB = b.lastUpdated || b.addedAt || 0;
          return timeB - timeA;
        });
      
        sortedData.forEach(rowData => {
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
          row.className = status >= 1 ? 'status-success' : 'status-error';
      
          // Name cell
          const nameCell = document.createElement('td');
          nameCell.textContent = rowData.name;
          nameCell.className = 'name-cell';
          row.appendChild(nameCell);
      
          // Phone cell
          const phoneCell = document.createElement('td');
          phoneCell.textContent = rowData.number;
          phoneCell.className = 'phone-cell';
          row.appendChild(phoneCell);
      
          // Status cell
          const statusCell = document.createElement('td');
          statusCell.className = 'status-cell';
          statusCell.innerHTML = this.getStatusText(status);
          row.appendChild(statusCell);
      
          // Last updated cell
          const updatedCell = document.createElement('td');
          const lastUpdated = rowData.lastUpdated || rowData.addedAt;
          if (lastUpdated) {
            const timeAgo = this.getTimeAgo(lastUpdated);
            updatedCell.textContent = timeAgo;
            updatedCell.className = 'time-cell';
          } else {
            updatedCell.textContent = '-';
          }
          row.appendChild(updatedCell);
      
          tableBody.appendChild(row);
        });
      
        table.appendChild(tableBody);
      
        // Add status summary above table
        const statusCounts = this.countStatusTypes();
        const summary = document.createElement('div');
        summary.className = 'message-count';
        summary.innerHTML = `
          <div class="status-summary">
            <span class="summary-item">Total: <strong>${tableData.length}</strong></span>
            <span class="summary-item status-error">Failed: <strong>${statusCounts.error}</strong></span>
            <span class="summary-item status-pending">Pending: <strong>${statusCounts.pending}</strong></span>
            <span class="summary-item status-sent">Sent: <strong>${statusCounts.sent}</strong></span>
            <span class="summary-item status-delivered">Delivered: <strong>${statusCounts.delivered}</strong></span>
            <span class="summary-item status-read">Read: <strong>${statusCounts.read}</strong></span>
          </div>
        `;
      
        this.tableContainer.innerHTML = '';
        this.tableContainer.appendChild(summary);
        this.tableContainer.appendChild(table);
      }

    updateState(html) {
        if (this.stateElement) {
            this.stateElement.innerHTML = html;
        }
    }

    updateQR(qr) {
        if (!this.qrImage) return;

        if (!qr) {
            this.qrImage.style.display = 'none';
            return;
        }

        console.log("Updating QR code display");
        
        // Handle the QR code based on its format
        if (typeof qr === 'string') {
            if (qr.startsWith('data:image')) {
                // It's already a data URL
                this.qrImage.src = qr;
            } else {
                // It's a raw QR code string, convert to image
                this.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
            }
            this.qrImage.style.display = 'block';
        } else {
            console.error("Invalid QR code format received:", typeof qr);
        }
    }

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

        // Stop polling, but continue receiving WebSocket updates
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