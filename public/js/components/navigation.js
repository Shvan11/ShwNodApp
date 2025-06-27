// components/navigation.js
/**
 * Enhanced Navigation Component
 * Provides cached, reusable navigation with automatic patient timepoint loading
 */
import { gettimepoints } from '../utils/navigation.js';

class NavigationComponent {
  constructor() {
    // Cache for timepoints data
    this.cache = new Map();
    this.loading = new Map(); // Track ongoing requests
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
  }

  /**
   * Load navigation for a patient with caching
   * @param {string} patientId - Patient ID
   * @param {string} currentPage - Current page identifier for highlighting
   * @returns {Promise<void>}
   */
  async loadNavigation(patientId, currentPage = '') {
    if (!patientId) {
      console.warn('NavigationComponent: No patient ID provided');
      return;
    }

    const cacheKey = `patient_${patientId}`;
    
    // Check if already loading for this patient
    if (this.loading.has(cacheKey)) {
      console.log('NavigationComponent: Already loading navigation for patient', patientId);
      return this.loading.get(cacheKey);
    }

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached.timestamp)) {
      console.log('NavigationComponent: Using cached navigation for patient', patientId);
      this.renderNavigation(cached.data, patientId, currentPage);
      return Promise.resolve();
    }

    // Create loading promise
    const loadingPromise = this.fetchAndRenderNavigation(patientId, currentPage);
    this.loading.set(cacheKey, loadingPromise);

    try {
      await loadingPromise;
    } finally {
      this.loading.delete(cacheKey);
    }
  }

  /**
   * Fetch timepoints and render navigation
   * @param {string} patientId - Patient ID
   * @param {string} currentPage - Current page identifier
   * @private
   */
  async fetchAndRenderNavigation(patientId, currentPage) {
    try {
      console.log('NavigationComponent: Fetching navigation for patient', patientId);
      
      // Fetch timepoints data
      const response = await fetch(`${window.location.origin}/api/gettimepoints?code=${patientId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const timepoints = await response.json();
      
      // Cache the data
      const cacheKey = `patient_${patientId}`;
      this.cache.set(cacheKey, {
        data: timepoints,
        timestamp: Date.now()
      });

      // Render navigation
      this.renderNavigation(timepoints, patientId, currentPage);
      
    } catch (error) {
      console.error('NavigationComponent: Failed to load navigation:', error);
      this.showNavigationError();
    }
  }

  /**
   * Render navigation using existing logic
   * @param {Array} timepoints - Timepoints data
   * @param {string} patientId - Patient ID  
   * @param {string} currentPage - Current page identifier
   * @private
   */
  renderNavigation(timepoints, patientId, currentPage) {
    // Use existing navigation logic but with cached data
    this.fillTimepoints(timepoints, patientId, currentPage);
  }

  /**
   * Fill timepoints navigation (enhanced version of existing logic)
   * @param {Array} timepoints - Timepoints data
   * @param {string} code - Patient code
   * @param {string} tp - Current timepoint/page
   * @private
   */
  fillTimepoints(timepoints, code, tp) {
    const photoslist = document.querySelector(".nav");
    if (!photoslist) {
      console.warn('NavigationComponent: No .nav element found');
      return;
    }

    photoslist.innerHTML = ""; // Clear existing content

    // Add timepoints from the fetched data
    if (timepoints) {
      timepoints.forEach((timepoint) => {
        this.addTab(
          photoslist,
          `${timepoint.tpDescription} ${this.formatDate(timepoint.tpDateTime)}`,
          `grid?code=${code}&tp=${timepoint.tpCode}`,
          timepoint.tpCode === tp
        );
      });
    }

    // Add static tabs
    const staticTabs = [
      { label: "Compare", href: `canvas?code=${code}`, id: "compare" },
      { label: "X-rays", href: `xrays?code=${code}`, id: "xrays" },
      { label: "Visit Summary", href: `visits-summary?PID=${code}`, id: "visitsSummary" },
      { label: "Payments", href: `payments?code=${code}`, id: "payments" },
      { label: "Home", href: "/", id: "home" },
    ];

    staticTabs.forEach((tab) => {
      this.addTab(photoslist, tab.label, tab.href, tab.id === tp);
    });
  }

  /**
   * Add a navigation tab
   * @param {HTMLElement} container - Container element
   * @param {string} label - Tab label
   * @param {string} href - Tab href
   * @param {boolean} isSelected - Whether tab is selected
   * @private
   */
  addTab(container, label, href, isSelected) {
    const tpitem = document.createElement("li");
    const alink = document.createElement("a");
    alink.textContent = label;
    alink.setAttribute("href", href);
    if (isSelected) {
      alink.className = "selectedTP";
    }
    tpitem.appendChild(alink);
    container.appendChild(tpitem);
  }

  /**
   * Format date helper
   * @param {string} dateTime - DateTime string
   * @returns {string} - Formatted date
   * @private
   */
  formatDate(dateTime) {
    return dateTime.substring(0, 10).split("-").reverse().join("-");
  }

  /**
   * Check if cache is still valid
   * @param {number} timestamp - Cache timestamp
   * @returns {boolean} - Whether cache is valid
   * @private
   */
  isCacheValid(timestamp) {
    return (Date.now() - timestamp) < this.cacheTimeout;
  }

  /**
   * Show navigation error state
   * @private
   */
  showNavigationError() {
    const photoslist = document.querySelector(".nav");
    if (photoslist) {
      photoslist.innerHTML = '<li><a href="/" style="color: #ff6b6b;">Navigation Error - Go Home</a></li>';
    }
  }

  /**
   * Clear cache for a specific patient or all patients
   * @param {string} [patientId] - Patient ID (optional, clears all if not provided)
   */
  clearCache(patientId = null) {
    if (patientId) {
      const cacheKey = `patient_${patientId}`;
      this.cache.delete(cacheKey);
      this.loading.delete(cacheKey);
      console.log('NavigationComponent: Cache cleared for patient', patientId);
    } else {
      this.cache.clear();
      this.loading.clear();
      console.log('NavigationComponent: All navigation cache cleared');
    }
  }

  /**
   * Preload navigation for a patient (useful for prefetching)
   * @param {string} patientId - Patient ID
   * @returns {Promise<void>}
   */
  async preloadNavigation(patientId) {
    return this.loadNavigation(patientId);
  }
}

// Export singleton instance
export default new NavigationComponent();