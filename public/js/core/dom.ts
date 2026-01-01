/**
 * DOM utility functions
 */

export interface ElementAttributes {
  className?: string;
  dataset?: Record<string, string>;
  style?: Record<string, string>;
  events?: Record<string, EventListener>;
  [key: string]: unknown;
}

export type ElementContent = string | HTMLElement | HTMLElement[];

/**
 * Get an element by selector
 * @param selector - CSS selector
 * @param parent - Parent element to search within
 * @returns Found element or null
 */
export function getElement<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: Document | HTMLElement = document
): T | null {
  return parent.querySelector<T>(selector);
}

/**
 * Get multiple elements by selector
 * @param selector - CSS selector
 * @param parent - Parent element to search within
 * @returns List of found elements
 */
export function getElements<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: Document | HTMLElement = document
): NodeListOf<T> {
  return parent.querySelectorAll<T>(selector);
}

/**
 * Create an element with attributes and content
 * @param tagName - HTML tag name
 * @param attributes - Element attributes
 * @param content - Element content
 * @returns Created element
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  attributes: ElementAttributes = {},
  content?: ElementContent
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);

  // Set attributes
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className' && typeof value === 'string') {
      element.className = value;
    } else if (key === 'dataset' && typeof value === 'object' && value !== null) {
      Object.entries(value as Record<string, string>).forEach(([dataKey, dataValue]) => {
        element.dataset[dataKey] = dataValue;
      });
    } else if (key === 'style' && typeof value === 'object' && value !== null) {
      Object.entries(value as Record<string, string>).forEach(([styleKey, styleValue]) => {
        if (styleValue !== undefined) {
          element.style.setProperty(styleKey, styleValue);
        }
      });
    } else if (key === 'events' && typeof value === 'object' && value !== null) {
      Object.entries(value as Record<string, EventListener>).forEach(([eventName, handler]) => {
        element.addEventListener(eventName, handler);
      });
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      element.setAttribute(key, String(value));
    }
  });

  // Add content
  if (content) {
    if (typeof content === 'string') {
      element.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      element.appendChild(content);
    } else if (Array.isArray(content)) {
      content.forEach((child) => {
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
 * @param html - HTML string
 * @returns Created element
 */
export function createNode<T extends HTMLElement = HTMLElement>(html: string): T | null {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstChild as T | null;
}

/**
 * Append a child element to a parent
 * @param parent - Parent element
 * @param child - Child element
 * @returns Child element
 */
export function appendElement<T extends HTMLElement>(parent: HTMLElement, child: T): T {
  parent.appendChild(child);
  return child;
}

/**
 * Remove an element from the DOM
 * @param element - Element to remove
 */
export function removeElement(element: HTMLElement | null): void {
  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

/**
 * Toggle a class on an element
 * @param element - Target element
 * @param className - Class to toggle
 * @param force - Force add or remove
 * @returns Whether class is now present
 */
export function toggleClass(element: HTMLElement, className: string, force?: boolean): boolean {
  return element.classList.toggle(className, force);
}

/**
 * Add a class to an element
 * @param element - Target element
 * @param className - Class to add
 */
export function addClass(element: HTMLElement, className: string): void {
  element.classList.add(className);
}

/**
 * Remove a class from an element
 * @param element - Target element
 * @param className - Class to remove
 */
export function removeClass(element: HTMLElement, className: string): void {
  element.classList.remove(className);
}

/**
 * Check if an element has a class
 * @param element - Target element
 * @param className - Class to check
 * @returns Whether element has class
 */
export function hasClass(element: HTMLElement, className: string): boolean {
  return element.classList.contains(className);
}

/**
 * Get or set element attributes
 * @param element - Target element
 * @param attribute - Attribute name or object of attributes
 * @param value - Attribute value if setting
 * @returns Attribute value or element for chaining
 */
export function attr(
  element: HTMLElement,
  attribute: string | Record<string, string>,
  value?: string
): string | null | HTMLElement {
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
  element.setAttribute(attribute, value!);
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
  attr,
};
