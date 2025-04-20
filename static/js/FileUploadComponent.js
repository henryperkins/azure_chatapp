/**
 * FileUploadComponent.js
 * Handles file upload functionality for projects
 */
class FileUploadComponent {
  constructor(options = {}) {
    this.projectId = options.projectId || null;
    this.onUploadComplete = options.onUploadComplete || (() => {});

    // File upload config
    this.fileConstants = {
      allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'],
      maxSizeMB: 30
    };

    // Element references
    this.elements = {
      fileInput: options.fileInput || null,
      uploadBtn: options.uploadBtn || null,
      dragZone: options.dragZone || null,
      uploadProgress: options.uploadProgress || null,
      progressBar: options.progressBar || null,
      uploadStatus: options.uploadStatus || null
    };

    // Bind events
    this._bindEvents();
  }

  /**
   * Bind event listeners
   * @private
   */
  _bindEvents() {
    // File input
    if (this.elements.fileInput) {
      window.eventHandlers.trackListener(this.elements.fileInput, 'change', (e) => {
        this._handleFileSelection(e);
      });
    }

    // Upload button
    if (this.elements.uploadBtn) {
      window.eventHandlers.trackListener(this.elements.uploadBtn, 'click', () => {
        this.elements.fileInput?.click();
      });
    }

    // Drag and drop
    if (this.elements.dragZone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        window.eventHandlers.trackListener(this.elements.dragZone, eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (eventName === 'dragenter' || eventName === 'dragover') {
            this.elements.dragZone.classList.add('border-primary');
          } else {
            this.elements.dragZone.classList.remove('border-primary');
            if (eventName === 'drop') {
              this._handleFileDrop(e);
            }
          }
        });
      });

      // Click on drag zone
      window.eventHandlers.trackListener(this.elements.dragZone, 'click', () => {
        this.elements.fileInput?.click();
      });
    }
  }

  /**
   * Handle file selection from input
   * @param {Event} e - Change event
   * @private
   */
  _handleFileSelection(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    this._uploadFiles(files);
    e.target.value = null;
  }

  /**
   * Handle file drop
   * @param {Event} e - Drop event
   * @private
   */
  _handleFileDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    this._uploadFiles(files);
  }

  /**
   * Upload files
   * @param {FileList} files - Files to upload
   * @private
   */
  async _uploadFiles(files) {
    if (!this.projectId) {
      window.showNotification('No project selected', 'error');
      return;
    }

    const { validFiles, invalidFiles } = this._validateFiles(files);

    // Handle invalid files
    invalidFiles.forEach(({ file, error }) => {
      window.showNotification(`Skipped ${file.name}: ${error}`, 'error');
    });

    if (validFiles.length === 0) return;

    // Show progress
    this._setupUploadProgress(validFiles.length);

    // Upload files in batches
    const BATCH_SIZE = 3;
    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(file => this._uploadFile(file)));
    }

    this.onUploadComplete();
  }

  /**
   * Upload a single file
   * @param {File} file - File to upload
   * @returns {Promise<void>}
   * @private
   */
  async _uploadFile(file) {
    try {
      if (!window.projectManager?.uploadFile) {
        throw new Error('Upload function not available');
      }

      await window.projectManager.uploadFileWithRetry(this.projectId, { file });
      this._updateUploadProgress(1, 0);
      window.showNotification(`${file.name} uploaded successfully`, 'success');
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);
      this._updateUploadProgress(0, 1);
      const errorMsg = this._getUploadErrorMessage(error, file.name);
      window.showNotification(`Failed to upload ${file.name}: ${errorMsg}`, 'error');
    }
  }

  /**
   * Validate files
   * @param {FileList] files - Files to validate
   * @returns {Object} - Valid and invalid files
   * @private
   */
  _validateFiles(files) {
    const validFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      // Basic filename sanitization
      const sanitizedName = file.name.replace(/[^\w\.\-]/g, '_');
      if (sanitizedName !== file.name) {
        invalidFiles.push({
          file,
          error: `Invalid characters in filename`
        });
        continue;
      }

      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isValidExt = this.fileConstants.allowedExtensions.includes(ext);
      const isValidSize = file.size <= this.fileConstants.maxSizeMB * 1024 * 1024;

      if (!isValidExt) {
        invalidFiles.push({
          file,
          error: `Invalid file type (${ext}). Allowed: ${this.fileConstants.allowedExtensions.join(', ')}`
        });
      } else if (!isValidSize) {
        invalidFiles.push({
          file,
          error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${this.fileConstants.maxSizeMB}MB)`
        });
      } else {
        validFiles.push(file);
      }
    }

    return { validFiles, invalidFiles };
  }

  /**
   * Set up upload progress
   * @param {number} total - Total files
   * @private
   */
  _setupUploadProgress(total) {
    this.uploadStatus = { total, completed: 0, failed: 0 };

    if (this.elements.uploadProgress) {
      this.elements.uploadProgress.classList.remove('hidden');
    }

    if (this.elements.progressBar) {
      this.elements.progressBar.value = 0;
      this.elements.progressBar.classList.remove('progress-success', 'progress-error');
      this.elements.progressBar.classList.add('progress-info');
    }

    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent = `Uploading 0/${total} files`;
    }
  }

  /**
   * Update upload progress
   * @param {number} success - Successful uploads
   * @param {number} failed - Failed uploads
   * @private
   */
  _updateUploadProgress(success, failed) {
    this.uploadStatus.completed += (success + failed);
    this.uploadStatus.failed += failed;
    const { total, completed, failed: totalFailed } = this.uploadStatus;

    if (this.elements.progressBar) {
      const percent = Math.round((completed / total) * 100);
      this.elements.progressBar.value = percent;
      this.elements.progressBar.classList.remove('progress-info', 'progress-success', 'progress-error');
      this.elements.progressBar.classList.add(totalFailed > 0 ?
        (totalFailed === completed ? 'progress-error' : 'progress-warning') : 'progress-success');
    }

    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent = `Uploading ${completed}/${total} files${totalFailed > 0 ? ` (${totalFailed} failed)` : ''}`;
    }

    // Hide when complete
    if (completed === total && this.elements.uploadProgress) {
      setTimeout(() => {
        this.elements.uploadProgress.classList.add('hidden');
      }, 2000);
    }
  }

  /**
   * Get error message for upload error
   * @param {Error} error - Error object
   * @param {string} fileName - File name
   * @returns {string} - Error message
   * @private
   */
  _getUploadErrorMessage(error, fileName) {
    const message = error.message || 'Unknown error';

    if (message.includes('auth') || error.status === 401) {
      return 'Authentication failed';
    }

    if (message.includes('too large') || message.includes('size')) {
      return `File exceeds ${this.fileConstants.maxSizeMB}MB limit`;
    }

    if (message.includes('token limit')) {
      return 'Project token limit exceeded';
    }

    if (message.includes('validation') || error.status === 422) {
      return 'File format not supported';
    }

    return message;
  }
}

// Export to window
window.FileUploadComponent = FileUploadComponent;
