/**
 * WebSocket Connection Manager
 *
 * Multiplexes a single shared WebSocket across multiple feature hooks
 * (`useWebSocketSync`, `useWhatsAppWebSocket`, `useWhatsAppAuth`).
 *
 * All client-type registration goes through `REGISTER_CLIENT_TYPE` /
 * `UNREGISTER_CLIENT_TYPE` messages — never URL params — so every reconnect
 * carries the same registration state without relying on a fragile URL
 * round-trip that auto-reconnect would have dropped.
 */

import wsService, { type WebSocketService } from './websocket';
import { WebSocketEvents } from '../constants/websocket-events';

const DEBUG = false;

export type ClientTypeOptions = Record<string, unknown>;

class WebSocketConnectionManager {
  /**
   * The source of truth for what this tab is subscribed to. Keyed by
   * clientType, value is the options last passed by the hook (e.g. `{ date }`
   * for `'waStatus'`). The `'connected'` handler iterates this map on every
   * (re)connect and re-issues REGISTER for each entry.
   */
  private clientTypes = new Map<string, ClientTypeOptions>();

  constructor() {
    // Single source of registration: every successful (re)connect re-issues
    // REGISTER for each tracked type with its options. Server REGISTER is
    // idempotent (Set.add, qrViewerRegistered guard) so duplicates are safe.
    wsService.on('connected', () => {
      for (const [clientType, options] of this.clientTypes) {
        this.sendRegister(clientType, options);
      }
    });

    // Heartbeat-driven subscription reconciliation. The server stamps every
    // SERVER_HEARTBEAT with its authoritative broadcast-Set membership for
    // this socket. If our tracked clientTypes are not all present, we silently
    // re-register the missing ones — self-healing drift within ~15s no matter
    // what caused it (lost REGISTER, stale Set entry, NAT/tunnel reconnect).
    wsService.on('subscriptions_changed', (payload: {
      connectionId: string;
      subscriptions: string[];
      connectionIdChanged: boolean;
    }) => {
      const serverSubs = new Set(payload.subscriptions);
      if (payload.connectionIdChanged) {
        // Different server-side socket than we last saw — re-register
        // everything; we can't trust prior REGISTERs were delivered to this id.
        console.warn('[ConnectionManager] Server connectionId changed; re-registering all', {
          connectionId: payload.connectionId,
        });
        for (const [clientType, options] of this.clientTypes) {
          this.sendRegister(clientType, options);
        }
        return;
      }
      for (const [clientType, options] of this.clientTypes) {
        if (!serverSubs.has(clientType)) {
          console.warn('[ConnectionManager] Server missing subscription; re-registering', {
            clientType,
            serverSubs: payload.subscriptions,
          });
          this.sendRegister(clientType, options);
        }
      }
    });
  }

  /**
   * Ensure the shared socket is open and this clientType is registered.
   * Safe to call repeatedly; subsequent calls update the stored options and
   * re-issue REGISTER (server-side idempotent).
   */
  async ensureConnected(
    clientType: string,
    options: ClientTypeOptions = {}
  ): Promise<WebSocketService> {
    this.clientTypes.set(clientType, options);
    if (DEBUG) console.log('[ConnectionManager] ensureConnected', { clientType, options });

    if (wsService.isConnected) {
      // Send REGISTER immediately — handles the "already connected, new type
      // mounted" case without waiting for a (re)connect cycle.
      this.sendRegister(clientType, options);
      return wsService;
    }

    if (wsService.status === 'connecting') {
      // Auto-reconnect is already running; the 'connected' handler in the
      // constructor will fire REGISTER for every tracked type once it lands.
      await this.waitForNextConnected();
      return wsService;
    }

    // Truly disconnected, no connect in flight — kick one off.
    await wsService.connect();
    return wsService;
  }

  /**
   * Remove a clientType subscription. Sends UNREGISTER if connected; the
   * socket stays open for any other types still mounted.
   */
  removeClientType(clientType: string): void {
    if (!this.clientTypes.delete(clientType)) return;
    if (DEBUG) console.log('[ConnectionManager] removeClientType', { clientType });

    if (wsService.isConnected) {
      wsService
        .send(
          { type: WebSocketEvents.UNREGISTER_CLIENT_TYPE, data: { clientType } },
          { queueIfDisconnected: false }
        )
        .catch(() => { /* fire-and-forget */ });
    }
  }

  /**
   * Tear down the shared connection (page unload / critical errors only).
   */
  disconnect(): void {
    this.clientTypes.clear();
    wsService.disconnect();
  }

  /** Expose the underlying singleton for hooks that subscribe directly. */
  getService(): WebSocketService {
    return wsService;
  }

  private sendRegister(clientType: string, options: ClientTypeOptions): void {
    wsService
      .send(
        {
          type: WebSocketEvents.REGISTER_CLIENT_TYPE,
          data: { clientType, ...options },
        },
        { queueIfDisconnected: false }
      )
      .catch(() => { /* next 'connected' will retry */ });
  }

  private waitForNextConnected(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        wsService.off('connected', onConnected);
        wsService.off('error', onError);
      };
      const onConnected = () => { cleanup(); resolve(); };
      const onError = (e: unknown) => {
        cleanup();
        reject(e instanceof Error ? e : new Error('WebSocket connection failed'));
      };
      wsService.once('connected', onConnected);
      wsService.once('error', onError);
    });
  }
}

export default new WebSocketConnectionManager();
