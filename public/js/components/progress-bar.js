// js/components/progress-bar.js
/**
 * Progress Bar Component
 * A reusable progress bar with animation functionality
 */
export class ProgressBar {
    /**
     * Create a new progress bar
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.filledBar - The filled bar element
     * @param {HTMLElement} options.emptyBar - The empty bar element
     * @param {number} options.interval - Animation interval in milliseconds
     */
    constructor(options) {
      this.filledBar = options.filledBar;
      this.emptyBar = options.emptyBar;
      this.interval = options.interval || 200;
      this.bTimer = null;
      this.absWidth = 0;
    }
    
    /**
     * Initialize and show the progress bar
     */
    initiate() {
      if (!this.filledBar || !this.emptyBar) return;
      
      this.width = "0%";
      this.text = "Sending...";
      this.filledBar.style.display = "block";
      this.emptyBar.style.display = "block";
      this.absWidth = 1;
      this.bTimer = 0;
      this.startBar();
    }
    
    /**
     * Start the progress animation
     */
    startBar() {
      this.bTimer = setInterval(() => this.progress(), this.interval);
    }
    
    /**
     * Update progress animation frame
     */
    progress() {
      if (this.absWidth >= 90) {
        clearInterval(this.bTimer);
      } else {
        this.absWidth++;
        this.filledBar.style.width = this.absWidth + "%";
      }
    }
    
    /**
     * Complete the progress bar animation
     */
    finish() {
      clearInterval(this.bTimer);
      this.filledBar.style.width = "100%";
      this.filledBar.textContent = "Done!";
    }
    
    /**
     * Reset the progress bar
     */
    reset() {
      clearInterval(this.bTimer);
      this.filledBar.style.display = "none";
      this.emptyBar.style.display = "none";
      this.filledBar.style.width = "0%";
      this.filledBar.textContent = "";
    }
    
    /**
     * Set the width of the progress bar
     * @param {string} value - Width value (e.g. "50%")
     */
    set width(value) {
      if (this.filledBar) {
        this.filledBar.style.width = value;
      }
    }
    
    /**
     * Set the text content of the progress bar
     * @param {string} value - Text content
     */
    set text(value) {
      if (this.filledBar) {
        this.filledBar.innerHTML = value;
      }
    }
  }
  
  export default ProgressBar;