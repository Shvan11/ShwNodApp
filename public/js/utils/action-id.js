// utils/action-id.js
/**
 * Action ID Utilities
 *
 * Provides unique ID generation for tracking actions across WebSocket updates.
 * This enables robust event source detection (identifying if a WebSocket event
 * was triggered by the current client vs another client).
 *
 * Why Action IDs are better than timestamps:
 * - No clock skew issues
 * - No network latency concerns
 * - No race condition with multiple rapid actions
 * - 100% reliable source identification
 */

/**
 * Generate a unique action ID
 * Format: action_<timestamp>_<random>
 *
 * @returns {string} - Unique action ID
 */
export function generateActionId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `action_${timestamp}_${random}`;
}

/**
 * Action ID Manager Class
 * Tracks recent action IDs to detect own actions
 */
class ActionIdManager {
  constructor() {
    // Store recent action IDs (with automatic cleanup)
    this.recentActions = new Map();

    // Maximum age for action IDs (5 minutes)
    this.MAX_AGE_MS = 5 * 60 * 1000;

    // Cleanup interval (1 minute)
    this.CLEANUP_INTERVAL_MS = 60 * 1000;

    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Register a new action ID
   * @param {string} actionId - Action ID to register
   */
  registerAction(actionId) {
    this.recentActions.set(actionId, {
      timestamp: Date.now(),
      used: false
    });

    console.log(`[ActionIdManager] Registered action ID: ${actionId}`);
  }

  /**
   * Check if an action ID is from this client
   * @param {string} actionId - Action ID to check
   * @returns {boolean} - True if this is our own action
   */
  isOwnAction(actionId) {
    if (!actionId) return false;

    const action = this.recentActions.get(actionId);
    if (!action) return false;

    // Mark as used
    action.used = true;

    console.log(`[ActionIdManager] Detected own action: ${actionId}`);
    return true;
  }

  /**
   * Remove an action ID after it's been used
   * @param {string} actionId - Action ID to remove
   */
  removeAction(actionId) {
    this.recentActions.delete(actionId);
    console.log(`[ActionIdManager] Removed action ID: ${actionId}`);
  }

  /**
   * Clean up old action IDs
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [actionId, action] of this.recentActions.entries()) {
      const age = now - action.timestamp;

      // Remove if too old OR already used
      if (age > this.MAX_AGE_MS || action.used) {
        this.recentActions.delete(actionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[ActionIdManager] Cleaned up ${cleanedCount} old action IDs`);
    }
  }

  /**
   * Start periodic cleanup
   */
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get statistics
   * @returns {Object} - Manager statistics
   */
  getStats() {
    return {
      totalActions: this.recentActions.size,
      usedActions: Array.from(this.recentActions.values()).filter(a => a.used).length,
      unusedActions: Array.from(this.recentActions.values()).filter(a => !a.used).length
    };
  }
}

// Export singleton instance
export const actionIdManager = new ActionIdManager();

// Export class for testing
export { ActionIdManager };
