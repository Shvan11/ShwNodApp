/**
 * Simple event emitter implementation
 */

export type EventListener<T = unknown> = (...args: T[]) => void;

export class EventEmitter {
  private events: Record<string, EventListener[]>;

  /**
   * Create a new event emitter
   */
  constructor() {
    this.events = {};
  }

  /**
   * Add an event listener
   * @param event - Event name
   * @param listener - Event listener function
   * @returns This instance for chaining
   */
  on<T = unknown>(event: string, listener: EventListener<T>): this {
    if (!this.events[event]) {
      this.events[event] = [];
    }

    this.events[event].push(listener as EventListener);
    return this;
  }

  /**
   * Add a one-time event listener
   * @param event - Event name
   * @param listener - Event listener function
   * @returns This instance for chaining
   */
  once<T = unknown>(event: string, listener: EventListener<T>): this {
    const onceWrapper: EventListener = (...args: unknown[]) => {
      (listener as EventListener)(...args);
      this.off(event, onceWrapper);
    };

    return this.on(event, onceWrapper);
  }

  /**
   * Remove an event listener
   * @param event - Event name
   * @param listener - Event listener function
   * @returns This instance for chaining
   */
  off<T = unknown>(event: string, listener: EventListener<T>): this {
    if (!this.events[event]) {
      return this;
    }

    const index = this.events[event].indexOf(listener as EventListener);
    if (index !== -1) {
      this.events[event].splice(index, 1);
    }

    return this;
  }

  /**
   * Emit an event
   * @param event - Event name
   * @param args - Event arguments
   * @returns True if event had listeners
   */
  emit(event: string, ...args: unknown[]): boolean {
    if (!this.events[event]) {
      return false;
    }

    this.events[event].forEach((listener) => {
      listener(...args);
    });

    return true;
  }

  /**
   * Remove all listeners for an event
   * @param event - Event name (optional, if not provided removes all events)
   * @returns This instance for chaining
   */
  removeAllListeners(event?: string): this {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }

    return this;
  }

  /**
   * Get all listeners for an event
   * @param event - Event name
   * @returns Array of listener functions
   */
  listeners(event: string): EventListener[] {
    return this.events[event] || [];
  }
}

export default EventEmitter;
