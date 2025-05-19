// components/clock.js
/**
 * Analog Clock Component
 * Renders an analog clock on a canvas element
 */
export class Clock {
    /**
     * Create a new analog clock
     * @param {string|HTMLCanvasElement} canvasElement - Canvas element or selector
     * @param {Object} options - Clock options
     */
    constructor(canvasElement, options = {}) {
      // Get canvas element
      this.canvas = typeof canvasElement === 'string'
        ? document.querySelector(canvasElement)
        : canvasElement;
        
      if (!this.canvas || this.canvas.tagName !== 'CANVAS') {
        throw new Error('Invalid canvas element for clock');
      }
      
      // Set up canvas context
      this.ctx = this.canvas.getContext('2d');
      this.radius = this.canvas.height / 2;
      this.ctx.translate(this.radius, this.radius);
      this.radius = this.radius * 0.9;
      
      // Set options with defaults
      this.options = Object.assign({
        updateInterval: 10000, // 10 seconds
        hourColor: '#333',
        minuteColor: '#333',
        faceGradient: true,
        autoStart: true
      }, options);
      
      // Set up timer
      this.timer = null;
      
      // Start the clock if autoStart
      if (this.options.autoStart) {
        this.start();
      }
    }
    
    /**
     * Start the clock
     * @returns {Clock} - This instance for chaining
     */
    start() {
      // Draw immediately
      this.draw();
      
      // Set up interval for updates
      this.timer = setInterval(() => this.draw(), this.options.updateInterval);
      
      return this;
    }
    
    /**
     * Stop the clock
     * @returns {Clock} - This instance for chaining
     */
    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      
      return this;
    }
    
    /**
     * Draw the clock
     * @returns {Clock} - This instance for chaining
     */
    draw() {
      this.drawFace();
      this.drawNumbers();
      this.drawTime();
      
      return this;
    }
    
    /**
     * Draw the clock face
     * @private
     */
    drawFace() {
      // Draw outer circle
      this.ctx.beginPath();
      this.ctx.arc(0, 0, this.radius, 0, 2 * Math.PI);
      this.ctx.fillStyle = 'white';
      this.ctx.fill();
      
      // Create gradient for edge if enabled
      if (this.options.faceGradient) {
        const grad = this.ctx.createRadialGradient(
          0, 0, this.radius * 0.95,
          0, 0, this.radius * 1.05
        );
        grad.addColorStop(0, '#333');
        grad.addColorStop(0.5, 'white');
        grad.addColorStop(1, '#333');
        this.ctx.strokeStyle = grad;
      } else {
        this.ctx.strokeStyle = '#333';
      }
      
      this.ctx.lineWidth = this.radius * 0.1;
      this.ctx.stroke();
      
      // Draw center circle
      this.ctx.beginPath();
      this.ctx.arc(0, 0, this.radius * 0.1, 0, 2 * Math.PI);
      this.ctx.fillStyle = '#333';
      this.ctx.fill();
    }
    
    /**
     * Draw clock numbers
     * @private
     */
    drawNumbers() {
      this.ctx.font = this.radius * 0.15 + 'px arial';
      this.ctx.textBaseline = 'middle';
      this.ctx.textAlign = 'center';
      
      for (let num = 1; num < 13; num++) {
        const ang = (num * Math.PI) / 6;
        
        // Save context before rotation
        this.ctx.save();
        
        // Rotate to number position
        this.ctx.rotate(ang);
        this.ctx.translate(0, -this.radius * 0.85);
        this.ctx.rotate(-ang);
        
        // Draw number
        this.ctx.fillText(num.toString(), 0, 0);
        
        // Restore context
        this.ctx.restore();
      }
    }
    
    /**
     * Draw clock hands
     * @private
     */
    drawTime() {
      const now = new Date();
      let hour = now.getHours();
      const minute = now.getMinutes();
      
      // Hour hand
      hour = hour % 12;
      // Calculate angle (hour hand rotates 30 degrees per hour plus 0.5 degrees per minute)
      const hourAngle = (hour * Math.PI / 6) + (minute * Math.PI / (6 * 60));
      this.drawHand(hourAngle, this.radius * 0.5, this.radius * 0.07, this.options.hourColor);
      
      // Minute hand
      // Calculate angle (minute hand rotates 6 degrees per minute)
      const minuteAngle = (minute * Math.PI / 30);
      this.drawHand(minuteAngle, this.radius * 0.8, this.radius * 0.07, this.options.minuteColor);
    }
    
    /**
     * Draw a clock hand
     * @param {number} pos - Position angle in radians
     * @param {number} length - Hand length
     * @param {number} width - Hand width
     * @param {string} color - Hand color
     * @private
     */
    drawHand(pos, length, width, color = '#333') {
      this.ctx.beginPath();
      this.ctx.lineWidth = width;
      this.ctx.lineCap = 'round';
      this.ctx.strokeStyle = color;
      
      // Save context
      this.ctx.save();
      
      // Rotate to hand position
      this.ctx.rotate(pos);
      
      // Draw hand
      this.ctx.moveTo(0, 0);
      this.ctx.lineTo(0, -length);
      this.ctx.stroke();
      
      // Restore context
      this.ctx.restore();
    }
    
    /**
     * Destroy the clock and clean up
     */
    destroy() {
      this.stop();
      
      // Clear the canvas
      this.ctx.clearRect(-this.radius, -this.radius, this.canvas.width, this.canvas.height);
      
      // Reset transformation
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  
  // Export default
  export default Clock;