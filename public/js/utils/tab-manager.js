// utils/tab-manager.js
/**
 * TabManager - Singleton Tab Detection and Management
 *
 * Prevents duplicate tabs for specific pages (like appointments dashboard)
 * Uses localStorage heartbeat to detect if a tab is alive
 * Uses window.open() with named targets to focus existing tabs
 */

class TabManager {
  constructor() {
    this.registeredTabs = new Map();
    this.heartbeatInterval = 2000; // 2 seconds
    this.tabTimeout = 5000; // 5 seconds - consider tab dead if no heartbeat
  }

  /**
   * Register current tab as a singleton tab
   * @param {string} tabName - Unique identifier for this tab type (e.g., 'appointments')
   */
  register(tabName) {
    const tabId = `${tabName}-${Date.now()}-${Math.random()}`;
    const storageKey = `tab_${tabName}`;
    const timestampKey = `tab_${tabName}_timestamp`;

    // Store tab ID and initial timestamp
    localStorage.setItem(storageKey, tabId);
    localStorage.setItem(timestampKey, Date.now().toString());

    // Store in memory for this instance
    this.registeredTabs.set(tabName, {
      tabId,
      storageKey,
      timestampKey,
      heartbeatTimer: null
    });

    // Start heartbeat to prove we're alive
    this._startHeartbeat(tabName);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      this.unregister(tabName);
    });
  }

  /**
   * Unregister tab (cleanup on close)
   * @param {string} tabName - Tab name to unregister
   */
  unregister(tabName) {
    const tab = this.registeredTabs.get(tabName);
    if (!tab) return;

    // Stop heartbeat
    if (tab.heartbeatTimer) {
      clearInterval(tab.heartbeatTimer);
    }

    // Only clear localStorage if this is OUR tab
    const currentTabId = localStorage.getItem(tab.storageKey);
    if (currentTabId === tab.tabId) {
      localStorage.removeItem(tab.storageKey);
      localStorage.removeItem(tab.timestampKey);
    }

    this.registeredTabs.delete(tabName);
  }

  /**
   * Check if a tab is currently open
   * @param {string} tabName - Tab name to check
   * @returns {boolean} - True if tab is open and alive
   */
  isOpen(tabName) {
    const storageKey = `tab_${tabName}`;
    const timestampKey = `tab_${tabName}_timestamp`;

    const tabId = localStorage.getItem(storageKey);
    const timestamp = localStorage.getItem(timestampKey);

    if (!tabId || !timestamp) {
      return false;
    }

    // Check if heartbeat is recent (tab is alive)
    const age = Date.now() - parseInt(timestamp, 10);
    const isAlive = age < this.tabTimeout;

    if (!isAlive) {
      // Cleanup stale data
      localStorage.removeItem(storageKey);
      localStorage.removeItem(timestampKey);
    }

    return isAlive;
  }

  /**
   * Smart navigation - focus existing tab or open new one
   * @param {string} url - URL to navigate to
   * @param {string} tabName - Tab name for singleton detection
   * @returns {boolean} - True if focused existing, false if opened new
   */
  openOrFocus(url, tabName) {
    const targetName = `clinic_${tabName}`;

    // Check if tab is already open using our detection system
    if (this.isOpen(tabName)) {
      // Tab exists - focus it without refresh using empty URL
      const windowRef = window.open('', targetName);

      if (windowRef) {
        windowRef.focus();
        return true; // Focused existing
      }
    }

    // No existing tab - open new one with URL
    const windowRef = window.open(url, targetName);
    if (windowRef) {
      windowRef.focus();
    }
    return false; // Opened new
  }

  /**
   * Start heartbeat timer to prove tab is alive
   * @private
   */
  _startHeartbeat(tabName) {
    const tab = this.registeredTabs.get(tabName);
    if (!tab) return;

    // Clear any existing timer
    if (tab.heartbeatTimer) {
      clearInterval(tab.heartbeatTimer);
    }

    // Send heartbeat every 2 seconds
    tab.heartbeatTimer = setInterval(() => {
      const currentTabId = localStorage.getItem(tab.storageKey);

      // Only send heartbeat if we're still the registered tab
      if (currentTabId === tab.tabId) {
        localStorage.setItem(tab.timestampKey, Date.now().toString());
      } else {
        // Someone else took over - stop heartbeat
        clearInterval(tab.heartbeatTimer);
      }
    }, this.heartbeatInterval);
  }
}

// Create and export singleton instance
const tabManager = new TabManager();

export default tabManager;
