// core/dom.js
/**
 * DOM utility functions
 */

/**
 * Get an element by selector
 * @param {string} selector - CSS selector
 * @param {HTMLElement} [parent=document] - Parent element to search within
 * @returns {HTMLElement|null} - Found element or null
 */
export function getElement(selector, parent = document) {
    return parent.querySelector(selector);
  }
  
  /**
   * Get multiple elements by selector
   * @param {string} selector - CSS selector
   * @param {HTMLElement} [parent=document] - Parent element to search within
   * @returns {NodeList} - List of found elements
   */
  export function getElements(selector, parent = document) {
    return parent.querySelectorAll(selector);
  }
  
  /**
   * Create an element with attributes and content
   * @param {string} tagName - HTML tag name
   * @param {Object} [attributes={}] - Element attributes
   * @param {string|HTMLElement|HTMLElement[]} [content] - Element content
   * @returns {HTMLElement} - Created element
   */
  export function createElement(tagName, attributes = {}, content) {
    const element = document.createElement(tagName);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'dataset') {
        Object.entries(value).forEach(([dataKey, dataValue]) => {
          element.dataset[dataKey] = dataValue;
        });
      } else if (key === 'style') {
        Object.entries(value).forEach(([styleKey, styleValue]) => {
          element.style[styleKey] = styleValue;
        });
      } else if (key === 'events') {
        Object.entries(value).forEach(([eventName, handler]) => {
          element.addEventListener(eventName, handler);
        });
      } else {
        element.setAttribute(key, value);
      }
    });
    
    // Add content
    if (content) {
      if (typeof content === 'string') {
        element.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        element.appendChild(content);
      } else if (Array.isArray(content)) {
        content.forEach(child => {
          if (child instanceof HTMLElement) {
            element.appendChild(child);
          }
        });
      }
    }
    
    return element;
  }
  
  /**
   * Create HTML from a string and return the first element
   * @param {string} html - HTML string
   * @returns {HTMLElement} - Created element
   */
  export function createNode(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstChild;
  }
  
  /**
   * Append a child element to a parent
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} child - Child element
   * @returns {HTMLElement} - Child element
   */
  export function appendElement(parent, child) {
    parent.appendChild(child);
    return child;
  }
  
  /**
   * Remove an element from the DOM
   * @param {HTMLElement} element - Element to remove
   */
  export function removeElement(element) {
    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }
  
  /**
   * Toggle a class on an element
   * @param {HTMLElement} element - Target element
   * @param {string} className - Class to toggle
   * @param {boolean} [force] - Force add or remove
   * @returns {boolean} - Whether class is now present
   */
  export function toggleClass(element, className, force) {
    return element.classList.toggle(className, force);
  }
  
  /**
   * Add a class to an element
   * @param {HTMLElement} element - Target element
   * @param {string} className - Class to add
   */
  export function addClass(element, className) {
    element.classList.add(className);
  }
  
  /**
   * Remove a class from an element
   * @param {HTMLElement} element - Target element
   * @param {string} className - Class to remove
   */
  export function removeClass(element, className) {
    element.classList.remove(className);
  }
  
  /**
   * Check if an element has a class
   * @param {HTMLElement} element - Target element
   * @param {string} className - Class to check
   * @returns {boolean} - Whether element has class
   */
  export function hasClass(element, className) {
    return element.classList.contains(className);
  }
  
  /**
   * Get or set element attributes
   * @param {HTMLElement} element - Target element
   * @param {string|Object} attribute - Attribute name or object of attributes
   * @param {string} [value] - Attribute value if setting
   * @returns {string|null|object} - Attribute value or element for chaining
   */
  export function attr(element, attribute, value) {
    // Get attribute
    if (typeof attribute === 'string' && value === undefined) {
      return element.getAttribute(attribute);
    }
    
    // Set attributes from object
    if (typeof attribute === 'object') {
      Object.entries(attribute).forEach(([key, val]) => {
        element.setAttribute(key, val);
      });
      return element;
    }
    
    // Set single attribute
    element.setAttribute(attribute, value);
    return element;
  }
  
  export default {
    getElement,
    getElements,
    createElement,
    createNode,
    appendElement,
    removeElement,
    toggleClass,
    addClass,
    removeClass,
    hasClass,
    attr
  };