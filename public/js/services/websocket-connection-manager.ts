/**
 * WebSocket Connection Manager
 *
 * Coordinates WebSocket connections across multiple components to prevent
 * connection thrashing and race conditions.
 *
 * Key Features:
 * - Single connection shared across all components
 * - Prevents duplicate connection attempts
 * - Tracks which client types need the connection
 * - Graceful handling of connection failures
 */

import wsService, { WebSocketService } from './websocket';

export interface ConnectionOptions {
  PDate?: string;
  clientType?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  status: string;
  clientTypes: string[];
  hasActiveConnection: boolean;
}

class WebSocketConnectionManager {
  private connectionPromise: Promise<WebSocketService> | null = null;
  private clientTypes: Set<string> = new Set();
  private isConnecting = false;
  private lastConnectionAttempt: number | null = null;
  private readonly CONNECTION_DEBOUNCE_MS = 100;

  constructor() {
    // Initialize
  }

  /**
   * Ensure WebSocket is connected
   * @param clientType - Type of client requesting connection
   * @param options - Additional connection options
   * @returns Connected WebSocket service
   */
  async ensureConnected(
    clientType: string,
    options: ConnectionOptions = {}
  ): Promise<WebSocketService> {
    // Track this client type
    this.clientTypes.add(clientType);

    console.log(`[ConnectionManager] Connection requested by ${clientType}`);
    console.log(`[ConnectionManager] Active client types:`, Array.from(this.clientTypes));

    // If already connected, return immediately
    if (wsService.isConnected) {
      console.log(`[ConnectionManager] Already connected - returning existing connection`);
      return wsService;
    }

    // If connection in progress, wait for it
    if (this.connectionPromise) {
      console.log(`[ConnectionManager] Connection in progress - waiting for completion`);
      try {
        await this.connectionPromise;
        return wsService;
      } catch {
        // Connection failed, but we'll try again below
        console.log(`[ConnectionManager] Previous connection attempt failed, retrying`);
      }
    }

    // Check if we should debounce (multiple rapid requests)
    const now = Date.now();
    if (this.lastConnectionAttempt && now - this.lastConnectionAttempt < this.CONNECTION_DEBOUNCE_MS) {
      console.log(`[ConnectionManager] Debouncing connection request`);
      await new Promise((resolve) => setTimeout(resolve, this.CONNECTION_DEBOUNCE_MS));

      // After debounce, check if connection was established
      if (wsService.isConnected) {
        return wsService;
      }
    }

    // Start new connection
    this.lastConnectionAttempt = now;
    this.isConnecting = true;

    console.log(
      `[ConnectionManager] Starting new connection for client types:`,
      Array.from(this.clientTypes)
    );

    // Build connection parameters
    const connectionParams: ConnectionOptions = {
      // Pass all client types as comma-separated string
      clientType: Array.from(this.clientTypes).join(','),
      timestamp: Date.now(),
      ...options,
    };

    // Create connection promise
    this.connectionPromise = wsService
      .connect(connectionParams)
      .then(() => {
        console.log(`[ConnectionManager] Connection established successfully`);
        this.isConnecting = false;
        return wsService;
      })
      .catch((error: Error) => {
        console.error('[ConnectionManager] Connection failed:', error);
        this.isConnecting = false;
        this.connectionPromise = null;
        throw error;
      });

    try {
      await this.connectionPromise;
      return wsService;
    } catch (error) {
      this.connectionPromise = null;
      throw error;
    }
  }

  /**
   * Remove a client type from the connection
   * @param clientType - Type of client disconnecting
   */
  removeClientType(clientType: string): void {
    this.clientTypes.delete(clientType);
    console.log(`[ConnectionManager] Client type ${clientType} removed`);
    console.log(`[ConnectionManager] Remaining client types:`, Array.from(this.clientTypes));

    // If no more client types, we could disconnect
    // But for robustness, we'll keep the connection alive
    // (it will be closed on page unload anyway)
  }

  /**
   * Disconnect and reset
   * Only call this on page unload or critical errors
   */
  disconnect(): void {
    console.log('[ConnectionManager] Disconnecting WebSocket');
    this.connectionPromise = null;
    this.clientTypes.clear();
    this.isConnecting = false;
    wsService.disconnect();
  }

  /**
   * Get connection status
   * @returns Connection status information
   */
  getStatus(): ConnectionStatus {
    return {
      isConnected: wsService.isConnected,
      isConnecting: this.isConnecting,
      status: wsService.status,
      clientTypes: Array.from(this.clientTypes),
      hasActiveConnection: this.connectionPromise !== null,
    };
  }

  /**
   * Get the WebSocket service instance
   * @returns WebSocket service
   */
  getService(): WebSocketService {
    return wsService;
  }
}

// Export singleton instance
export default new WebSocketConnectionManager();
