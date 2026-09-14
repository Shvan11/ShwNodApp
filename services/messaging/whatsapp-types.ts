/**
 * Shared types for the WhatsApp service.
 *
 * Split out of whatsapp.ts (S2/C6) along with the two collaborator classes
 * (`whatsapp-client-state.ts`, `whatsapp-circuit-breaker.ts`) and the session/profile
 * filesystem helpers (`whatsapp-session-files.ts`). Everything here was already a
 * standalone declaration in that file; nothing changed but its address.
 *
 * The `Puppeteer*` / `WhatsApp*` shapes are hand-written STRUCTURAL types over
 * whatsapp-web.js + its bundled Puppeteer — deliberately narrow (only what the
 * service actually calls), not the vendor types.
 */

/**
 * Client state lifecycle
 */
export type ClientState = 'DISCONNECTED' | 'INITIALIZING' | 'CONNECTED' | 'ERROR' | 'DESTROYED';

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * A queued lock acquirer. Both callbacks close over their own acquisition
 * timeout and clear it, so the handle isn't stored on the entry.
 */
export interface LockWaiter {
  resolve: () => void;
  reject: () => void;
}

/**
 * Client status information
 */
export interface ClientStatus {
  state: ClientState;
  connected: boolean;
  initializing: boolean;
  reconnectAttempts: number;
  lastError: string | undefined;
  hasActivePromise: boolean;
}

/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number | null;
  isOpen: boolean;
  timeInCurrentState: number;
  halfOpenCalls: number;
}

/**
 * WebSocket emitter interface
 */
export interface WebSocketEmitter {
  emit(event: string, data: unknown): boolean;
}

/**
 * Puppeteer browser interface (partial)
 */
export interface PuppeteerBrowser {
  pages(): Promise<PuppeteerPage[]>;
  close(): Promise<void>;
  // The real value is a Node ChildProcess; `pid` is declared because
  // ensureProfileUnlocked() needs it to confirm the browser is actually gone.
  process(): { kill(signal: string): void; pid?: number } | null;
}

/**
 * Puppeteer page interface (partial)
 */
export interface PuppeteerPage {
  close(): Promise<void>;
}

/**
 * WhatsApp client interface (partial)
 */
export interface WhatsAppClient {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  logout(): Promise<void>;
  getState(): Promise<string>;
  getNumberId(number: string): Promise<{ _serialized: string } | null>;
  sendMessage(chatId: string, content: string | unknown, options?: unknown): Promise<{ id: { id: string } }>;
  getChats(): Promise<WhatsAppChat[]>;
  getChatById(chatId: string): Promise<{ fetchMessages(options: { limit: number }): Promise<WhatsAppMessage[]> }>;
  pupBrowser?: PuppeteerBrowser;
  pupPage?: PuppeteerPage;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * LocalAuth strategy (partial) — the bits unlink() needs. `logout()` is the
 * library's own session-clear (`fs.rm(userDataDir, …)`); `userDataDir` is only
 * populated after the client has initialized, so the retained instance must be
 * the one that was actually used.
 */
export interface LocalAuthStrategy {
  logout(): Promise<void>;
  userDataDir?: string;
}

/**
 * WhatsApp message interface
 */
export interface WhatsAppMessage {
  id: { id: string };
  ack?: number;
}

/**
 * WhatsApp chat interface (partial — only the fields group lookup reads)
 */
export interface WhatsAppChat {
  id: { _serialized: string };
  name: string;
  isGroup: boolean;
}

/**
 * Person data for message events
 */
export interface Person {
  messageId?: string;
  appointmentId?: number;
  name: string;
  number: string;
  success: string;
  error?: string;
}

/**
 * Send result
 */
export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Session quality result
 */
export type SessionQuality = 'valid' | 'empty' | 'corrupted' | 'none';

/**
 * Cleanup result
 */
export interface CleanupResult {
  success: boolean;
  reason: string;
  attempt?: number;
  error?: string;
}

