// core/events.js
/**
 * Simple event emitter implementation
 */
export class EventEmitter {
    /**
     * Create a new event emitter
     */
    constructor() {
      this.events = {};
    }
    
    /**
     * Add an event listener
     * @param {string} event - Event name
     * @param {Function} listener - Event listener function
     * @returns {EventEmitter} - This instance for chaining
     */
    on(event, listener) {
      if (!this.events[event]) {
        this.events[event] = [];
      }
      
      this.events[event].push(listener);
      return this;
    }
    
    /**
     * Add a one-time event listener
     * @param {string} event - Event name
     * @param {Function} listener - Event listener function
     * @returns {EventEmitter} - This instance for chaining
     */
    once(event, listener) {
      const onceWrapper = (...args) => {
        listener(...args);
        this.off(event, onceWrapper);
      };
      
      return this.on(event, onceWrapper);
    }
    
    /**
     * Remove an event listener
     * @param {string} event - Event name
     * @param {Function} listener - Event listener function
     * @returns {EventEmitter} - This instance for chaining
     */
    off(event, listener) {
      if (!this.events[event]) {
        return this;
      }
      
      const index = this.events[event].indexOf(listener);
      if (index !== -1) {
        this.events[event].splice(index, 1);
      }
      
      return this;
    }
    
    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {...any} args - Event arguments
     * @returns {boolean} - True if event had listeners
     */
    emit(event, ...args) {
      if (!this.events[event]) {
        return false;
      }
      
      this.events[event].forEach(listener => {
        listener(...args);
      });
      
      return true;
    }
    
    /**
     * Remove all listeners for an event
     * @param {string} event - Event name (optional, if not provided removes all events)
     * @returns {EventEmitter} - This instance for chaining
     */
    removeAllListeners(event) {
      if (event) {
        delete this.events[event];
      } else {
        this.events = {};
      }
      
      return this;
    }
    
    /**
     * Get all listeners for an event
     * @param {string} event - Event name
     * @returns {Function[]} - Array of listener functions
     */
    listeners(event) {
      return this.events[event] || [];
    }
  }
  
  export default EventEmitter;