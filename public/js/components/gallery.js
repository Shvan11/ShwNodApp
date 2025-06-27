// js/components/gallery.js
/**
 * Photo Gallery component
 * Handles image display and lightbox functionality
 */
import { createNode } from '../core/dom.js';

class Gallery {
  /**
   * Create a new photo gallery
   * @param {string|HTMLElement} container - Gallery container element or selector
   * @param {Object} options - Gallery options
   */
  constructor(container, options = {}) {
    // Get container element
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
      
    if (!this.container) {
      throw new Error('Invalid gallery container');
    }
    
    // Default options
    this.options = Object.assign({
      itemSelector: 'a',
      imageSelector: 'img',
      lightboxEnabled: true,
      onImageClick: null,
      photoswipeOptions: {}
    }, options);
    
    // Initialize properties
    this.images = [];
    this.lightbox = null;
    
    // Initialize
    if (this.options.lightboxEnabled) {
      this.initLightbox();
    }
  }
  
  /**
   * Initialize PhotoSwipe lightbox
   * @private
   */
  async initLightbox() {
    try {
      // Import PhotoSwipe dynamically
      const PhotoSwipeLightbox = (await import('/photoswipe/dist/photoswipe-lightbox.esm.js')).default;
      
      // Create lightbox instance
      const options = {
        gallery: `#${this.container.id}`,
        children: this.options.itemSelector,
        pswpModule: () => import('/photoswipe/dist/photoswipe.esm.js'),
        ...this.options.photoswipeOptions
      };
      
      this.lightbox = new PhotoSwipeLightbox(options);
      
      // Add download button
      this.addDownloadButton();
      
      // Add send message button
      this.addSendMessageButton();
      
      // Initialize the lightbox
      this.lightbox.init();
    } catch (error) {
      console.error('Failed to initialize lightbox:', error);
    }
  }
  
  /**
   * Add download button to lightbox
   * @private
   */
  addDownloadButton() {
    if (!this.lightbox) return;
    
    this.lightbox.on('uiRegister', () => {
      this.lightbox.pswp.ui.registerElement({
        name: 'download-button',
        order: 8,
        isButton: true,
        tagName: 'a',
        
        // SVG icon
        html: {
          isCustomSVG: true,
          inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
          outlineID: 'pswp__icn-download'
        },
        
        // Setup download button
        onInit: (el, pswp) => {
          el.setAttribute('download', '');
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener');
          
          // Update download link and filename on slide change
          pswp.on('change', () => {
            const downloadLink = pswp.currSlide.data.src;
            const fileName = downloadLink.substring(downloadLink.lastIndexOf('/') + 1);
            const extension = fileName.slice(-3);
            
            // Set filename based on image type
            let downloadFileName = this.getDownloadFileName(extension, fileName);
            
            // Update download attributes
            el.setAttribute('download', downloadFileName);
            el.href = downloadLink;
          });
        }
      });
    });
  }
  
  /**
   * Add send message button to lightbox
   * @private
   */
  addSendMessageButton() {
    if (!this.lightbox) return;
    
    this.lightbox.on('uiRegister', () => {
      this.lightbox.pswp.ui.registerElement({
        name: 'send-message-button',
        order: 9,
        isButton: true,
        tagName: 'button',
        
        // SVG icon for send message
        html: {
          isCustomSVG: true,
          inner: '<path d="M2 21l21-9L2 3v7l15 2-15 2v7z" id="pswp__icn-send"/>',
          outlineID: 'pswp__icn-send'
        },
        
        // Setup send message button
        onInit: (el, pswp) => {
          el.setAttribute('title', 'Send Message');
          el.setAttribute('aria-label', 'Send Message');
          
          // Handle click event
          el.addEventListener('click', () => {
            const imageSrc = pswp.currSlide.data.src;
            this.openSendMessagePage(imageSrc);
          });
        }
      });
    });
  }
  
  /**
   * Open send message page with pre-filled attachment
   * @param {string} imagePath - Path to the image
   * @private
   */
  async openSendMessagePage(imagePath) {
    try {
      // Extract path from full URL if needed
      let webPath = imagePath;
      if (imagePath.includes('://')) {
        // Full URL like "http://localhost:3000/DolImgs/200.i13"
        const url = new URL(imagePath);
        webPath = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
      }
      
      console.log('Original path:', imagePath);
      console.log('Extracted web path:', webPath);
      
      // Convert web path to full UNC path via API (use original filename)
      const response = await fetch(`/api/convert-path?path=${encodeURIComponent(webPath)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to convert path: ${response.statusText}`);
      }
      
      const { fullPath } = await response.json();
      console.log('Converted to full path:', fullPath);
      
      // Open send-message.html with converted UNC path
      const sendMessageUrl = `/views/messaging/send-message.html?file=${encodeURIComponent(fullPath)}`;
      window.open(sendMessageUrl, '_blank');
      
    } catch (error) {
      console.error('Error converting path for send message:', error);
      
      // Fallback: use original path
      const sendMessageUrl = `/views/messaging/send-message.html?file=${encodeURIComponent(imagePath)}`;
      window.open(sendMessageUrl, '_blank');
    }
  }

  /**
   * Get download filename based on image type
   * @param {string} extension - File extension
   * @param {string} originalName - Original filename
   * @returns {string} - Descriptive filename
   * @private
   */
  getDownloadFileName(extension, originalName) {
    // Map of extension codes to descriptive names
    const fileNameMap = {
      'i10': 'Profile.jpg',
      'i12': 'Rest.jpg',
      'i13': 'Smile.jpg',
      'i23': 'Upper.jpg',
      'i24': 'Lower.jpg',
      'i20': 'Right.jpg',
      'i22': 'Center.jpg',
      'i21': 'Left.jpg'
    };
    
    // Default to original name with jpg extension
    const defaultName = `${originalName.split('.')[0]}.jpg`;
    
    return fileNameMap[extension] || defaultName;
  }
  
  /**
   * Load images into the gallery
   * @param {Array} images - Image data to load
   * @returns {Gallery} - This gallery instance
   */
  loadImages(images) {
    this.images = images.filter(Boolean); // Filter out nulls
    this.render();
    return this;
  }
  
  /**
   * Render the gallery
   * @private
   */
  render() {
    // Clear container
    this.container.innerHTML = '';
    
    // Create image elements
    this.images.forEach((image, index) => {
      if (!image) return;
      
      const imageLink = image.name ? `DolImgs/${image.name}` : '';
      if (!imageLink) return;
      
      // Create gallery item
      const item = createNode(`
        <a href="${imageLink}" 
           data-pswp-width="${image.width || 800}" 
           data-pswp-height="${image.height || 600}">
          <img src="${imageLink}" alt="Patient image ${index + 1}">
        </a>
      `);
      
      // Add click handler if provided
      if (typeof this.options.onImageClick === 'function') {
        const imgElement = item.querySelector('img');
        imgElement.addEventListener('click', (event) => {
          this.options.onImageClick(event, image, index);
        });
      }
      
      // Add to container
      this.container.appendChild(item);
    });
  }
  
  /**
   * Update a specific image
   * @param {number} index - Image index
   * @param {Object} imageData - New image data
   * @returns {Gallery} - This gallery instance
   */
  updateImage(index, imageData) {
    if (index < 0 || index >= this.images.length) return this;
    
    this.images[index] = imageData;
    this.render();
    return this;
  }
  
  /**
   * Set placeholder for missing images
   * @param {number} index - Image index
   * @param {string} type - Placeholder type ('f', 'o', or 'r')
   * @returns {Gallery} - This gallery instance
   */
  setPlaceholder(index, type = 'f') {
    if (index < 0 || index >= this.images.length) return this;
    
    const placeholderMap = {
      'f': 'No_img_f.png',
      'o': 'No_img_o.png',
      'r': 'No_img_r.png'
    };
    
    const placeholder = placeholderMap[type] || placeholderMap.f;
    
    // Get element
    const imgElement = this.container.querySelectorAll('img')[index];
    if (imgElement) {
      imgElement.src = placeholder;
    }
    
    return this;
  }
  
  /**
   * Dispose the gallery and clean up
   */
  dispose() {
    if (this.lightbox) {
      this.lightbox.destroy();
      this.lightbox = null;
    }
  }
}

// Export the Gallery class
export default Gallery;