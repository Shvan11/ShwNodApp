// components/modal.js
/**
 * Modal component
 * Provides a reusable modal dialog implementation
 */
import { createElement, createNode, appendElement, getElement } from '../core/dom.js';
import { generateId } from '../core/utils.js';

export class Modal {
  /**
   * Create a new modal component
   * @param {Object} options - Modal options
   */
  constructor(options = {}) {
    // Default options
    this.options = Object.assign({
      id: `modal-${generateId(6)}`,
      title: '',
      content: '',
      closable: true,
      closeOnEscape: true,
      closeOnOverlayClick: true,
      showCloseButton: true,
      customClass: '',
      width: null,
      height: null,
      position: 'center', // 'center', 'top', 'right', 'bottom', 'left'
      animation: 'fade', // 'fade', 'slide', 'scale', 'none'
      onOpen: null,
      onClose: null,
      appendTo: 'body',
    }, options);
    
    // Create modal elements
    this.create();
    
    // Bind event handlers
    this.bindEvents();
  }
  
  /**
   * Create modal elements
   * @private
   */
  create() {
    // Check if element with this ID already exists
    const existingElement = getElement(`#${this.options.id}`);
    if (existingElement) {
      this.element = existingElement;
      return;
    }
    
    // Create modal container
    this.element = createElement('div', {
      id: this.options.id,
      className: `modal ${this.options.customClass}`,
      style: {
        display: 'none'
      }
    });
    
    // Create modal content wrapper
    this.contentWrapper = createElement('div', {
      className: 'modal-content'
    });
    
    // Set custom dimensions if provided
    if (this.options.width) {
      this.contentWrapper.style.width = typeof this.options.width === 'number' 
        ? `${this.options.width}px` 
        : this.options.width;
    }
    
    if (this.options.height) {
      this.contentWrapper.style.height = typeof this.options.height === 'number' 
        ? `${this.options.height}px` 
        : this.options.height;
    }
    
    // Create header
    this.header = createElement('div', {
      className: 'modal-header'
    });
    
    // Create title
    if (this.options.title) {
      this.title = createElement('h2', {}, this.options.title);
      appendElement(this.header, this.title);
    }
    
    // Create close button
    if (this.options.showCloseButton) {
      this.closeButton = createElement('span', {
        className: 'modal-close',
        events: {
          click: () => this.close()
        }
      }, '&times;');
      
      appendElement(this.header, this.closeButton);
    }
    
    // Create body
    this.body = createElement('div', {
      className: 'modal-body'
    });
    
    // Set content
    if (typeof this.options.content === 'string') {
      if (this.options.content.trim().startsWith('<')) {
        // HTML content
        this.body.innerHTML = this.options.content;
      } else {
        // Text content
        this.body.textContent = this.options.content;
      }
    } else if (this.options.content instanceof HTMLElement) {
      // Element content
      appendElement(this.body, this.options.content);
    }
    
    // Assemble modal
    appendElement(this.contentWrapper, this.header);
    appendElement(this.contentWrapper, this.body);
    appendElement(this.element, this.contentWrapper);
    
    // Add to DOM
    const container = getElement(this.options.appendTo);
    if (container) {
      appendElement(container, this.element);
    } else {
      appendElement(document.body, this.element);
    }
  }
  
  /**
   * Bind event handlers
   * @private
   */
  bindEvents() {
    // Close on overlay click
    if (this.options.closeOnOverlayClick) {
      this.element.addEventListener('click', (event) => {
        if (event.target === this.element) {
          this.close();
        }
      });
    }
    
    // Close on escape key
    if (this.options.closeOnEscape) {
      document.addEventListener('keydown', this.handleKeyDown.bind(this));
    }
  }
  
  /**
   * Handle keydown event
   * @param {KeyboardEvent} event - Keyboard event
   * @private
   */
  handleKeyDown(event) {
    // Close on escape key if visible
    if (event.key === 'Escape' && this.isOpen()) {
      this.close();
    }
  }
  
  /**
   * Open the modal
   * @returns {Modal} - This instance for chaining
   */
  open() {
    // Set display style based on animation
    this.element.style.display = 'block';
    
    // Add animation class
    if (this.options.animation !== 'none') {
      this.element.classList.add(`modal-${this.options.animation}`);
    }
    
    // Call onOpen callback
    if (typeof this.options.onOpen === 'function') {
      this.options.onOpen(this);
    }
    
    return this;
  }
  
  /**
   * Close the modal
   * @returns {Modal} - This instance for chaining
   */
  close() {
    // Hide modal
    this.element.style.display = 'none';
    
    // Remove animation class
    if (this.options.animation !== 'none') {
      this.element.classList.remove(`modal-${this.options.animation}`);
    }
    
    // Call onClose callback
    if (typeof this.options.onClose === 'function') {
      this.options.onClose(this);
    }
    
    return this;
  }
  
  /**
   * Check if modal is open
   * @returns {boolean} - Whether modal is open
   */
  isOpen() {
    return this.element.style.display === 'block';
  }
  
  /**
   * Toggle modal visibility
   * @returns {Modal} - This instance for chaining
   */
  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
    
    return this;
  }
  
  /**
   * Set modal content
   * @param {string|HTMLElement} content - Modal content
   * @returns {Modal} - This instance for chaining
   */
  setContent(content) {
    if (typeof content === 'string') {
      if (content.trim().startsWith('<')) {
        // HTML content
        this.body.innerHTML = content;
      } else {
        // Text content
        this.body.textContent = content;
      }
    } else if (content instanceof HTMLElement) {
      // Element content
      this.body.innerHTML = '';
      appendElement(this.body, content);
    }
    
    return this;
  }
  
  /**
   * Set modal title
   * @param {string} title - Modal title
   * @returns {Modal} - This instance for chaining
   */
  setTitle(title) {
    if (!this.title) {
      this.title = createElement('h2');
      this.header.insertBefore(this.title, this.header.firstChild);
    }
    
    this.title.textContent = title;
    return this;
  }
  
  /**
   * Add a footer to the modal
   * @param {string|HTMLElement} content - Footer content
   * @returns {Modal} - This instance for chaining
   */
  addFooter(content) {
    if (!this.footer) {
      this.footer = createElement('div', {
        className: 'modal-footer'
      });
      
      appendElement(this.contentWrapper, this.footer);
    }
    
    if (typeof content === 'string') {
      if (content.trim().startsWith('<')) {
        // HTML content
        this.footer.innerHTML = content;
      } else {
        // Text content
        this.footer.textContent = content;
      }
    } else if (content instanceof HTMLElement) {
      // Element content
      this.footer.innerHTML = '';
      appendElement(this.footer, content);
    }
    
    return this;
  }
  
  /**
   * Add buttons to the modal
   * @param {Object[]} buttons - Array of button configurations
   * @returns {Modal} - This instance for chaining
   */
  addButtons(buttons) {
    if (!Array.isArray(buttons) || buttons.length === 0) {
      return this;
    }
    
    if (!this.footer) {
      this.footer = createElement('div', {
        className: 'modal-footer'
      });
      
      appendElement(this.contentWrapper, this.footer);
    }
    
    // Create button elements
    buttons.forEach(buttonConfig => {
      const button = createElement('button', {
        className: buttonConfig.className || 'btn',
        events: {
          click: (event) => {
            if (typeof buttonConfig.onClick === 'function') {
              buttonConfig.onClick(event, this);
            }
          }
        }
      }, buttonConfig.text || '');
      
      appendElement(this.footer, button);
    });
    
    return this;
  }
  
  /**
   * Destroy the modal and remove it from the DOM
   */
  destroy() {
    // Remove event listeners
    document.removeEventListener('keydown', this.handleKeyDown.bind(this));
    
    // Remove from DOM
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    
    // Clean up references
    this.element = null;
    this.contentWrapper = null;
    this.header = null;
    this.title = null;
    this.closeButton = null;
    this.body = null;
    this.footer = null;
  }
}

// Export default constructor
export default Modal;