// components/comparison.js
/**
 * Image Comparison component
 * This component handles the comparison of two images with controls
 * for zooming, panning, rotation, and more.
 */
import { createNode } from '../core/dom.js';

export class ImageComparison {
  /**
   * Create a new image comparison component
   * @param {string|HTMLElement} canvasElement - Canvas element or selector
   * @param {Object} options - Component options
   */
  constructor(canvasElement, options = {}) {
    // Get canvas element
    this.canvas = typeof canvasElement === 'string' 
      ? document.querySelector(canvasElement) 
      : canvasElement;
      
    if (!this.canvas || this.canvas.tagName !== 'CANVAS') {
      throw new Error('Invalid canvas element');
    }
    
    this.context = this.canvas.getContext('2d');
    
    // Set options with defaults
    this.options = Object.assign({
      border: 10,
      orientation: 'v', // 'v' for vertical, 'h' for horizontal
      logoPath: 'logo_white.png',
      autoResize: true
    }, options);
    
    // Initialize properties
    this.factor1 = 6;
    this.factor2 = 6;
    this.logof = 3;
    this.orient = this.options.orientation;
    this.images = [];
    this.urls = [];
    this.imgOffsets = {
      img1: { h: 0, v: 0 },
      img2: { h: 0, v: 0 },
      logo: { h: 0, v: 0 }
    };
    this.rotation = {
      img1: 0,
      img2: 0
    };
    this.clip = {
      img1: 0,
      img2: 0
    };
    this.selectedImage = 1;
    this.pathDrawn = false;
    this.rotated = {
      img1: false,
      img2: false
    };
    
    // Create offscreen canvases
    this.setupOffscreenCanvases();
    
    // Initialize event listeners for any provided controls
    this.initControlListeners();
  }
  
  /**
   * Set up offscreen canvases for improved rendering
   * @private
   */
  setupOffscreenCanvases() {
    this.canvas1 = document.createElement('canvas');
    this.canvas2 = document.createElement('canvas');
    this.context1 = this.canvas1.getContext('2d');
    this.context2 = this.canvas2.getContext('2d');
    
    this.context.fillStyle = 'black';
    this.context1.fillStyle = 'black';
    this.context2.fillStyle = 'black';
  }
  
  /**
   * Initialize control element event listeners if provided
   * @private
   */
  initControlListeners() {
    // This function can be extended to handle controls
    // when implementing specific page integrations
  }
  
  /**
   * Load images from URLs
   * @param {string[]} urls - Array of image URLs
   * @returns {Promise<Image[]>} - Loaded images
   */
  async loadImages(urls) {
    this.urls = urls;
    this.images = [];
    
    // Load each image
    for (const url of urls) {
      try {
        const image = await this.loadImage(url);
        this.images.push(image);
      } catch (error) {
        console.error(`Failed to load image: ${url}`, error);
        // Add a placeholder image
        const placeholder = new Image();
        placeholder.width = 300;
        placeholder.height = 300;
        this.images.push(placeholder);
      }
    }
    
    // Set canvas dimensions based on images
    if (this.options.autoResize) {
      this.updateCanvasDimensions();
    }
    
    // Draw images
    await this.drawImages();
    
    return this.images;
  }
  
  /**
   * Load a single image
   * @param {string} url - Image URL
   * @returns {Promise<Image>} - Loaded image
   * @private
   */
  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = url;
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
    });
  }
  
  /**
   * Update canvas dimensions based on loaded images
   * @private
   */
  updateCanvasDimensions() {
    if (this.images.length < 2) return;
    
    const b = this.options.border;
    
    if (this.orient === 'v') {
      // Vertical orientation
      const width = this.images[0].width / this.factor1;
      const height1 = this.images[0].height / this.factor1;
      const height2 = this.images[1].height * (width / this.images[1].width);
      
      this.canvas.width = width + 2 * b;
      this.canvas.height = height1 + height2 + 4 * b;
      this.canvas1.width = width + 2 * b;
      this.canvas1.height = height1 + 2 * b;
      this.canvas2.width = width + 2 * b;
      this.canvas2.height = height2 + 2 * b;
      
      this.factor2 = this.images[1].width / width;
    } else {
      // Horizontal orientation
      const height = this.images[0].height / this.factor1;
      const width1 = this.images[0].width / this.factor1;
      const width2 = this.images[1].width * height / this.images[1].height;
      
      this.factor2 = this.images[1].width / width2;
      this.canvas.width = width1 + width2 + 4 * b;
      this.canvas.height = height + 2 * b;
      this.canvas1.width = width1 + 2 * b;
      this.canvas1.height = height + 2 * b;
      this.canvas2.width = width2 + 2 * b;
      this.canvas2.height = height + 2 * b;
    }
    
    // Notify size change
    this.notifySizeChange();
  }
  
  /**
   * Notify that canvas size has changed
   * @private
   */
  notifySizeChange() {
    // This can be used to update UI elements or dispatch an event
    if (typeof this.options.onSizeChange === 'function') {
      this.options.onSizeChange({
        width: this.canvas.width,
        height: this.canvas.height
      });
    }
  }
  
  /**
   * Draw all images (main entry point for rendering)
   * @returns {Promise<void>}
   */
  async drawImages() {
    if (this.options.autoResize) {
      // Auto mode - set dimensions and draw
      await this.drawAuto();
    } else {
      // Manual mode - draw each image separately
      await this.drawOne(0);
      await this.drawOne(1);
      this.redrawCanvas();
    }
    
    // Enable buttons if any
    const buttons = document.querySelectorAll('.PButton');
    buttons.forEach((button) => {
      button.disabled = false;
    });
    
    return this;
  }
  
  /**
   * Draw images in auto mode
   * @returns {Promise<void>}
   * @private
   */
  async drawAuto() {
    const b = this.options.border;
    
    // Update dimensions
    this.updateCanvasDimensions();
    
    // Draw individual images
    await this.drawOne(0);
    await this.drawOne(1);
    
    // Draw logo
    this.drawLogo();
    
    return this;
  }
  
  /**
   * Draw a single image
   * @param {number} index - Image index (0 or 1)
   * @returns {Promise<void>}
   * @private
   */
  async drawOne(index) {
    const imageNum = index + 1;
    const factor = this[`factor${imageNum}`];
    const offsetH = this.imgOffsets[`img${imageNum}`].h;
    const offsetV = this.imgOffsets[`img${imageNum}`].v;
    const b = this.options.border;
    const clip = this.clip[`img${imageNum}`];
    const rotation = this.rotation[`img${imageNum}`];
    const rotated = this.rotated[`img${imageNum}`];
    
    const canvases = [this.canvas1, this.canvas2];
    const contexts = [this.context1, this.context2];
    const context = contexts[index];
    const canvas = canvases[index];
    
    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    if (!this.images[index]) return;
    
    // Calculate dimensions
    const width = this.images[index].width / factor;
    const height = this.images[index].height / factor;
    const widthDiff = canvas.width - 2 * b - width;
    const heightDiff = canvas.height - 2 * b - height;
    
    // Save context for clipping and rotation
    context.save();
    
    // Apply clipping if needed
    if (clip > 0) {
      context.beginPath();
      context.rect(
        clip,
        clip,
        canvas.width - 2 * clip,
        canvas.height - 2 * clip
      );
      context.clip();
    }
    
    // Apply rotation if needed
    if (rotated || rotation !== 0) {
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.translate(-canvas.width / 2, -canvas.height / 2);
    }
    
    // Draw the image based on positioning conditions
    if (widthDiff >= 0 && heightDiff >= 0) {
      // Image fits within canvas
      context.drawImage(
        this.images[index],
        widthDiff / 2 + offsetH,
        heightDiff / 2 + offsetV,
        width,
        height
      );
    } else if (widthDiff >= 0 && heightDiff < 0) {
      // Image is taller than canvas
      const absHeightDiff = Math.abs(heightDiff);
      context.drawImage(
        this.images[index],
        0,
        (absHeightDiff / 2) * factor - offsetV,
        width * factor,
        (height - absHeightDiff) * factor,
        b + offsetH + widthDiff / 2,
        b,
        width,
        canvas.height - 2 * b
      );
    } else if (widthDiff < 0 && heightDiff < 0) {
      // Image is larger than canvas in both dimensions
      const absWidthDiff = Math.abs(widthDiff);
      const absHeightDiff = Math.abs(heightDiff);
      context.drawImage(
        this.images[index],
        (absWidthDiff / 2) * factor - offsetH,
        (absHeightDiff / 2) * factor - offsetV,
        (width - absWidthDiff) * factor,
        (height - absHeightDiff) * factor,
        b,
        b,
        canvas.width - 2 * b,
        canvas.height - 2 * b
      );
    } else if (widthDiff < 0 && heightDiff >= 0) {
      // Image is wider than canvas
      const absWidthDiff = Math.abs(widthDiff);
      context.drawImage(
        this.images[index],
        (absWidthDiff / 2) * factor - offsetH,
        0,
        (width - absWidthDiff) * factor,
        height * factor,
        b,
        b + offsetV + heightDiff / 2,
        canvas.width - 2 * b,
        height
      );
    }
    
    // Restore context
    context.restore();
    
    // Reset rotation flag if needed
    if (rotated && rotation === 0) {
      this.rotated[`img${imageNum}`] = false;
    }
    
    return this;
  }
  
  /**
   * Draw the logo
   * @returns {this}
   * @private
   */
  drawLogo() {
    if (!this.images[2]) return this;
    
    const logoWidth = this.images[2].width / this.logof;
    const logoHeight = (this.images[2].height * logoWidth) / this.images[2].width;
    
    const logoX = this.canvas.width / 2 - logoWidth / 2 + this.imgOffsets.logo.h;
    const logoY = this.canvas.height / 2 - logoHeight / 1.3 + this.imgOffsets.logo.v;
    
    // Draw base images first
    this.redrawCanvasNoLogo();
    
    // Draw logo on top
    this.context.drawImage(
      this.images[2],
      logoX,
      logoY,
      logoWidth,
      logoHeight
    );
    
    return this;
  }
  
  /**
   * Redraw canvas without logo
   * @returns {this}
   * @private
   */
  redrawCanvasNoLogo() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    if (this.orient === 'v') {
      // Vertical orientation
      this.context.drawImage(this.canvas1, 0, 0);
      this.context.drawImage(this.canvas2, 0, this.canvas.height / 2);
    } else {
      // Horizontal orientation
      this.context.drawImage(this.canvas1, 0, 0);
      this.context.drawImage(this.canvas2, this.canvas.width / 2, 0);
    }
    
    return this;
  }
  
  /**
   * Redraw the entire canvas (with logo)
   * @returns {this}
   */
  redrawCanvas() {
    this.drawLogo();
    return this;
  }
  
  /**
   * Set the active image for transformations
   * @param {number} index - Image index (1, 2, or 3 for logo)
   * @returns {this}
   */
  setSelectedImage(index) {
    this.selectedImage = index;
    return this;
  }
  
  /**
   * Change the orientation
   * @returns {Promise<this>}
   */
  async changeOrientation() {
    this.orient = this.orient === 'v' ? 'h' : 'v';
    await this.drawImages();
    return this;
  }
  
  /**
   * Zoom in the selected image
   * @returns {Promise<this>}
   */
  async zoomIn() {
    if (this.selectedImage === 3) {
      // Logo selected
      this.logof = Math.max(0.5, this.logof - 0.1);
      this.drawLogo();
    } else {
      // Image 1 or 2 selected
      this[`factor${this.selectedImage}`] = Math.max(0.5, this[`factor${this.selectedImage}`] - 0.1);
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Zoom out the selected image
   * @returns {Promise<this>}
   */
  async zoomOut() {
    if (this.selectedImage === 3) {
      // Logo selected
      this.logof += 0.1;
      this.drawLogo();
    } else {
      // Image 1 or 2 selected
      this[`factor${this.selectedImage}`] += 0.1;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Move the selected image to the right
   * @returns {Promise<this>}
   */
  async moveRight() {
    if (this.selectedImage === 3) {
      // Logo selected
      this.imgOffsets.logo.h += 5;
      this.drawLogo();
    } else {
      // Image 1 or 2 selected
      this.imgOffsets[`img${this.selectedImage}`].h += 10;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Move the selected image to the left
   * @returns {Promise<this>}
   */
  async moveLeft() {
    if (this.selectedImage === 3) {
      // Logo selected
      this.imgOffsets.logo.h -= 5;
      this.drawLogo();
    } else {
      // Image 1 or 2 selected
      this.imgOffsets[`img${this.selectedImage}`].h -= 10;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Move the selected image up
   * @returns {Promise<this>}
   */
  async moveUp() {
    if (this.selectedImage === 3) {
      // Logo selected
      this.imgOffsets.logo.v -= 5;
      this.drawLogo();
    } else {
      // Image 1 or 2 selected
      this.imgOffsets[`img${this.selectedImage}`].v -= 10;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Move the selected image down
   * @returns {Promise<this>}
   */
  async moveDown() {
    if (this.selectedImage === 3) {
      // Logo selected
      this.imgOffsets.logo.v += 5;
      this.drawLogo();
    } else {
      // Image 1 or 2 selected
      this.imgOffsets[`img${this.selectedImage}`].v += 10;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Rotate the selected image clockwise
   * @param {number} degrees - Degrees to rotate
   * @returns {Promise<this>}
   */
  async rotateClockwise(degrees = 1) {
    if (this.selectedImage !== 3) {
      this.rotation[`img${this.selectedImage}`] += degrees;
      this.rotated[`img${this.selectedImage}`] = true;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Rotate the selected image counter-clockwise
   * @param {number} degrees - Degrees to rotate
   * @returns {Promise<this>}
   */
  async rotateCounterClockwise(degrees = 1) {
    if (this.selectedImage !== 3) {
      this.rotation[`img${this.selectedImage}`] -= degrees;
      this.rotated[`img${this.selectedImage}`] = true;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Increase clipping on the selected image
   * @returns {Promise<this>}
   */
  async increaseClip() {
    if (this.selectedImage !== 3) {
      this.clip[`img${this.selectedImage}`] += 10;
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Decrease clipping on the selected image
   * @returns {Promise<this>}
   */
  async decreaseClip() {
    if (this.selectedImage !== 3) {
      this.clip[`img${this.selectedImage}`] = Math.max(0, this.clip[`img${this.selectedImage}`] - 10);
      await this.drawOne(this.selectedImage - 1);
      this.redrawCanvas();
    }
    return this;
  }
  
  /**
   * Toggle a bisecting line on the canvas
   * @returns {Promise<this>}
   */
  async toggleBisect() {
    if (this.pathDrawn) {
      // Remove bisect line
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.pathDrawn = false;
      await this.drawOne(0);
      await this.drawOne(1);
      this.redrawCanvas();
    } else {
      // Draw bisect line
      this.context.beginPath();
      this.context.moveTo(this.canvas.width / 2, 0);
      this.context.lineTo(this.canvas.width / 2, this.canvas.height);
      this.context.stroke();
      this.pathDrawn = true;
    }
    return this;
  }
  
  /**
   * Remove the logo from the canvas
   * @returns {Promise<this>}
   */
  async removeLogo() {
    this.redrawCanvasNoLogo();
    return this;
  }
  
  /**
   * Reset all transformations
   * @returns {this}
   */
  reset() {
    // Reset all parameters
    this.factor1 = 6;
    this.factor2 = 6;
    this.orient = this.options.orientation;
    this.imgOffsets = {
      img1: { h: 0, v: 0 },
      img2: { h: 0, v: 0 },
      logo: { h: 0, v: 0 }
    };
    this.rotation = {
      img1: 0,
      img2: 0
    };
    this.clip = {
      img1: 0,
      img2: 0
    };
    this.rotated = {
      img1: false,
      img2: false
    };
    
    // Redraw
    this.redrawCanvas();
    return this;
  }
  
  /**
   * Set canvas size
   * @param {string|Object} size - 'auto' or {width, height}
   * @returns {this}
   */
  setCanvasSize(size) {
    if (size === 'auto') {
      this.options.autoResize = true;
      if (this.images.length > 0) {
        this.drawAuto();
      }
      return this;
    }
    
    this.options.autoResize = false;
    
    if (typeof size === 'string') {
      size = JSON.parse(size);
    }
    
    this.canvas.width = size.width;
    this.canvas1.width = size.width;
    this.canvas2.width = size.width;
    
    this.canvas.height = size.height;
    this.canvas1.height = size.height / 2;
    this.canvas2.height = size.height / 2;
    
    // Adjust zoom factors if needed
    if (this.canvas.height > 1350) {
      this.factor1 -= 1;
      this.factor2 -= 1;
    }
    
    if (this.images.length > 0) {
      this.drawOne(0);
      this.drawOne(1);
      this.redrawCanvas();
    }
    
    return this;
  }
  
  /**
   * Get the canvas as a data URL
   * @param {string} type - Image type (default: 'image/png')
   * @param {number} quality - Image quality for JPEG (default: 0.92)
   * @returns {string} - Data URL
   */
  toDataURL(type = 'image/png', quality = 0.92) {
    return this.canvas.toDataURL(type, quality);
  }
}

// Export default constructor
export default ImageComparison;