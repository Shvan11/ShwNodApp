// js/pages/grid.js
/**
 * Grid page controller
 * Handles patient photo gallery display
 */
import Gallery from '../components/gallery.js';
import patientService from '../services/patient.js';

class GridPageController {
  /**
   * Initialize the grid page controller
   */
  constructor() {
    // Parse URL parameters
    this.urlParams = new URLSearchParams(window.location.search);
    this.patientId = this.urlParams.get('code');
    this.timepoint = this.urlParams.get('tp') || '0';
    
    // Initialize properties
    this.gallery = null;
    
    // Load data
    this.init();
  }
  
  /**
   * Initialize the page
   */
  async init() {
    try {
      // Load gallery images
      await this.loadGalleryImages();
      
      // Load timepoints navigation
      this.loadTimepoints();
    } catch (error) {
      console.error('Error initializing grid page:', error);
    }
  }
  
  /**
   * Load gallery images
   */
  async loadGalleryImages() {
    try {
      const images = await patientService.getGalleryImages(this.patientId, this.timepoint);
      
      // Create gallery if needed
      if (!this.gallery) {
        this.gallery = new Gallery('#dolph_gallery', {
          photoswipeOptions: {
            // Add custom options for PhotoSwipe here
          }
        });
      }
      
      // Load images into gallery
      this.gallery.loadImages(images);
      
      // Set placeholders for missing images
      this.setPlaceholders(images);
    } catch (error) {
      console.error('Error loading gallery images:', error);
    }
  }
  
  /**
   * Set placeholders for missing images
   * @param {Array} images - Gallery images
   */
  setPlaceholders(images) {
    const imgtags = [
      document.querySelector("#apf"),
      document.querySelector("#afr"),
      document.querySelector("#afs"),
      document.querySelector("#aup"),
      document.querySelector("#alogo"),
      document.querySelector("#alw"),
      document.querySelector("#art"),
      document.querySelector("#act"),
      document.querySelector("#alf"),
    ];
    
    // Set placeholders based on image index
    for (let i = 0; i < imgtags.length; i++) {
      if (!images[i] && imgtags[i]) {
        if (i < 3) {
          imgtags[i].firstChild.src = "No_img_f.png";
        } else if (i < 6) {
          imgtags[i].firstChild.src = "No_img_o.png";
        } else {
          imgtags[i].firstChild.src = "No_img_r.png";
        }
      }
    }
  }
  
  /**
   * Load timepoints navigation
   */
  async loadTimepoints() {
    // Use the existing module.js function for consistency
    try {
      // Create a module script to call the function
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = `
        import { gettimepoints } from "/js/utils/navigation.js";
        gettimepoints("${this.patientId}", "${this.timepoint}");
      `;
      document.body.appendChild(script);
    } catch (error) {
      console.error('Error loading timepoints:', error);
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new GridPageController();
});