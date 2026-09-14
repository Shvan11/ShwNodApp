/**
 * `EnhancedCircuitBreaker` — trips after repeated WhatsApp failures and re-probes
 * through a HALF_OPEN window instead of hammering a dead client.
 *
 * Split out of whatsapp.ts (S2/C6): it was already a self-contained class there,
 * moved verbatim.
 */
import { log } from '../../utils/logger.js';
import type { CircuitBreakerState, CircuitBreakerStatus } from './whatsapp-types.js';

export class EnhancedCircuitBreaker {
  private failureThreshold: number;
  private timeout: number;
  private halfOpenMaxCalls: number;
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private state: CircuitBreakerState = 'CLOSED';
  private halfOpenCalls = 0;
  private lastStateChange: number = Date.now();

  constructor(threshold = 5, timeout = 60000, halfOpenMaxCalls = 3) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
  }

  async execute<T>(operation: () => Promise<T>, operationName = 'operation'): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime > this.timeout) {
        this.transitionToHalfOpen();
      } else {
        const timeUntilRetry = this.timeout - (Date.now() - (this.lastFailureTime || 0));
        throw new Error(
          `Circuit breaker is OPEN. Retry in ${Math.ceil(timeUntilRetry / 1000)} seconds`
        );
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new Error('Circuit breaker is HALF_OPEN with max calls reached');
    }

    try {
      if (this.state === 'HALF_OPEN') {
        this.halfOpenCalls++;
      }

      const result = await operation();
      this.onSuccess(operationName);
      return result;
    } catch (error) {
      this.onFailure(operationName, error as Error);
      throw error;
    }
  }

  private onSuccess(operationName: string): void {
    if (this.state === 'HALF_OPEN') {
      log.debug(`Circuit breaker healing: ${operationName}`);
      this.transitionToClosed();
    } else if (this.state === 'CLOSED') {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  private onFailure(operationName: string, error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    log.warn(
      `Circuit breaker failure ${this.failureCount}/${this.failureThreshold} for ${operationName}`,
      { error: error.message }
    );

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.transitionToOpen();
    }
  }

  private transitionToClosed(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    log.info('Circuit breaker → CLOSED');
  }

  private transitionToOpen(): void {
    this.state = 'OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    log.warn(`Circuit breaker → OPEN`, { failures: this.failureCount });
  }

  private transitionToHalfOpen(): void {
    this.state = 'HALF_OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    log.info('Circuit breaker → HALF_OPEN');
  }

  reset(): void {
    this.transitionToClosed();
    log.info('Circuit breaker manually reset');
  }

  /**
   * Record a failure that happened outside execute() — e.g. the reconnect loop
   * exhausting its attempts. Public so callers don't reach into private onFailure.
   */
  recordExternalFailure(operationName: string, error: Error): void {
    this.onFailure(operationName, error);
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isOpen: this.state === 'OPEN',
      timeInCurrentState: Date.now() - this.lastStateChange,
      halfOpenCalls: this.halfOpenCalls,
    };
  }
}
