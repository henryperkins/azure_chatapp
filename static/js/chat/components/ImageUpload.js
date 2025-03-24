/**
 * ImageUpload.js
 * Handles image upload and preview for chat
 */

export default class ImageUpload {
  constructor(options = {}) {
    this.buttonSelector = options.buttonSelector || '#chatAttachImageBtn';
    this.inputSelector = options.inputSelector || '#chatImageInput';
    this.previewContainerSelector = options.previewContainerSelector || '#chatImagePreview';
    this.previewImageSelector = options.previewImageSelector || '#chatPreviewImg';
    this.fileNameSelector = options.fileNameSelector || '#chatImageName';
    this.statusSelector = options.statusSelector || '#chatImageStatus';
    this.removeButtonSelector = options.removeButtonSelector || '#chatRemoveImageBtn';
    
    this.onChange = options.onChange || (() => {});
    this.onError = options.onError || console.error;
    this.showNotification = options.showNotification || window.showNotification || console.log;
    
    this.button = document.querySelector(this.buttonSelector);
    this.input = document.querySelector(this.inputSelector);
    this.previewContainer = document.querySelector(this.previewContainerSelector);
    this.previewImage = document.querySelector(this.previewImageSelector);
    this.fileName = document.querySelector(this.fileNameSelector);
    this.status = document.querySelector(this.statusSelector);
    this.removeButton = document.querySelector(this.removeButtonSelector);
    
    this._setupEventListeners();
  }

  /**
   * Set up event listeners
   */
  _setupEventListeners() {
    // Wait for DOM elements to be available
    if (!this._checkElements()) {
      console.error("Image upload elements not found in DOM. Will retry in 500ms.");
      setTimeout(() => this._setupEventListeners(), 500);
      return;
    }
    
    // Image attach button
    this.button.addEventListener("click", () => {
      const modelName = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
      if (modelName !== "o1") {
        this.showNotification("Vision features only work with the o1 model.", "warning");
        return;
      }
      this.input.click();
    });

    // Image input change handler
    this.input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file
      if (!this._validateFile(file)) {
        this.input.value = '';
        return;
      }
      
      try {
        if (this.previewImage) this.previewImage.src = URL.createObjectURL(file);
        if (this.fileName) this.fileName.textContent = file.name;
        if (this.status) this.status.textContent = "Ready to send";
        this.previewContainer.classList.remove("hidden");

        const base64 = await this._convertToBase64(file);
        window.MODEL_CONFIG = window.MODEL_CONFIG || {};
        window.MODEL_CONFIG.visionImage = base64;
        window.MODEL_CONFIG.visionDetail = "auto";
        
        this.onChange(base64);
      } catch (err) {
        this.onError("Error processing image:", err);
        this.showNotification("Failed to process the image", "error");
        this.previewContainer.classList.add("hidden");
      }
    });

    // Remove image button
    this.removeButton.addEventListener("click", () => {
      this.clear();
      if (window.MODEL_CONFIG) window.MODEL_CONFIG.visionImage = null;
      this.onChange(null);
    });
  }

  /**
   * Clear the image upload
   */
  clear() {
    if (this.input) this.input.value = '';
    if (this.previewContainer) this.previewContainer.classList.add("hidden");
  }

  /**
   * Check if all required elements are available
   */
  _checkElements() {
    return this.button && this.input && 
           this.previewContainer && this.removeButton;
  }

  /**
   * Validate file type and size
   */
  _validateFile(file) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      this.showNotification("Only JPEG and PNG images are supported", "error");
      return false;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      this.showNotification("Image must be smaller than 5MB", "error");
      return false;
    }
    
    return true;
  }

  /**
   * Convert file to base64
   */
  async _convertToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  }
}