/**
 * FileUploadComponent.js (DependencySystem/DI Strict, NO window.*)
 * Handles file upload functionality for projects.
 *
 * Dependencies (DI ONLY, NO window.*):
 * - app: required (for notification, utility, API)
 * - eventHandlers: required (for listener binding)
 * - projectManager: required (for file upload workflows)
 *
 * Usage (from orchestrator or parent):
 *   import { FileUploadComponent } from './FileUploadComponent.js';
 *   const uploadComponent = new FileUploadComponent({ ...deps, ...elements });
 *   uploadComponent.init();
 *
 * No window.* access or global assignments. No DOM polling or event replay.
 */

export class FileUploadComponent {
  /**
   * @param {Object} options
   * @param {Object} options.app - Required. App/core dependency system with notification & api.
   * @param {Object} options.eventHandlers - Required. Tracked event handler utils.
   * @param {Object} options.projectManager - Required. Project file upload API.
   * @param {string} [options.projectId] - Optional, can be set later
   * @param {Function} [options.onUploadComplete]
   * @param {HTMLElement} [options.fileInput]
   * @param {HTMLElement} [options.uploadBtn]
   * @param {HTMLElement} [options.dragZone]
   * @param {HTMLElement} [options.uploadProgress]
   * @param {HTMLElement} [options.progressBar]
   * @param {HTMLElement} [options.uploadStatus]
   */
  constructor(options = {}) {
    // --- Dependency resolution (DI only; no window/global fallback) ---
    const getDep = (name, fallback) =>
      options[name] !== undefined
        ? options[name]
        : (typeof fallback === "function" ? fallback() : fallback);

    /** @type {Object} */
    this.app = getDep('app');
    /** @type {Object} */
    this.eventHandlers = getDep('eventHandlers');
    /** @type {Object} */
    this.projectManager = getDep('projectManager');
    if (!this.app || !this.eventHandlers || !this.projectManager) {
      throw new Error(
        "FileUploadComponent requires explicit 'app', 'eventHandlers', and 'projectManager' dependencies passed via options."
      );
    }

    this.projectId = options.projectId || null;
    this.onUploadComplete = options.onUploadComplete || (() => {});

    // --- Configuration ---
    this.fileConstants = {
      allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'],
      maxSizeMB: 30
    };

    // --- Elements (all DI or assigned on init, never polled) ---
    this.elements = {
      fileInput: options.fileInput || document.getElementById('fileInput'),
      uploadBtn: options.uploadBtn || document.getElementById('uploadFileBtn'),
      dragZone: options.dragZone || document.getElementById('dragDropZone'),
      uploadProgress: options.uploadProgress || document.getElementById('filesUploadProgress'),
      progressBar: options.progressBar || document.getElementById('fileProgressBar'),
      uploadStatus: options.uploadStatus || document.getElementById('uploadStatus')
    };

    /** @type {{total:number, completed:number, failed:number}} */
    this.uploadStatus = null;

    this._handlersBound = false;
  }

  /**
   * Set the current project ID for uploads.
   * @param {string} projectId
   */
  setProjectId(projectId) {
    this.projectId = projectId;
  }

  /**
   * Initialize component: (re)binds events, checks required DOM is present.
   * Should be called only when elements are ready.
   */
  init() {
    if (this._handlersBound) return;
    this._bindEvents();
    this._handlersBound = true;
  }

  /** Bind event listeners (never poll DOM) */
  _bindEvents() {
    const { fileInput, uploadBtn, dragZone } = this.elements;
    const EH = this.eventHandlers;

    // --- File input: file selection
    if (fileInput) {
      EH.trackListener(fileInput, 'change', (e) => {
        this._handleFileSelection(e);
      });
    }

    // --- Upload button: triggers file input
    if (uploadBtn) {
      EH.trackListener(uploadBtn, 'click', () => {
        fileInput?.click();
      });
    }

    // --- Drag-n-drop: highlight, drop, click
    if (dragZone) {
      ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
        EH.trackListener(dragZone, eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (eventName === 'dragenter' || eventName === 'dragover') {
            dragZone.classList.add('border-primary');
          } else {
            dragZone.classList.remove('border-primary');
            if (eventName === 'drop') {
              this._handleFileDrop(e);
            }
          }
        });
      });
      // Click on dragZone mimics clicking input
      EH.trackListener(dragZone, 'click', () => {
        fileInput?.click();
      });
    }
  }

  /** @private */
  _handleFileSelection(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    this._uploadFiles(files);
    // Reset input so same file can be selected again
    e.target.value = null;
  }

  /** @private */
  _handleFileDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    this._uploadFiles(files);
  }

  /**
   * Main upload flow: validates, batches, uploads, and shows progress.
   * @private
   * @param {FileList|Array<File>} files
   */
  async _uploadFiles(files) {
    const { app } = this;
    const projectId = this.projectId || app.getProjectId?.();
    if (!projectId || !app.validateUUID?.(projectId)) {
      app.showNotification?.('No valid project selected', 'error');
      return;
    }

    // Centralized file validation — use internal method for extension/filename, let manager do size as needed
    const { validFiles, invalidFiles } = this._validateFiles(files);

    invalidFiles.forEach(({ file, error }) => {
      app.showNotification?.(`Skipped ${file.name}: ${error}`, 'error');
    });

    if (validFiles.length === 0) return;

    this._setupUploadProgress(validFiles.length);

    // Batch in groups to avoid overwhelming the backend
    const BATCH_SIZE = 3;
    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(file => this._uploadFile(projectId, file)));
    }

    this.onUploadComplete();
  }

  /**
   * Upload a single file
   * @private
   * @param {string} projectId
   * @param {File} file
   * @returns {Promise<void>}
   */
  async _uploadFile(projectId, file) {
    const { app, projectManager } = this;
    try {
      if (typeof projectManager.uploadFileWithRetry !== "function") {
        throw new Error('Upload function not available');
      }
      await projectManager.uploadFileWithRetry(projectId, { file });
      this._updateUploadProgress(1, 0);
      app.showNotification?.(`${file.name} uploaded successfully`, 'success');
    } catch (error) {
      if (app && typeof app.showNotification === "function") {
        // Optionally log error via notification (rare, normally only notify user)
        // app.showNotification(`[FileUploadComponent] Upload error for ${file.name}: ${error?.message || error}`, 'error');
      } else if (typeof console !== "undefined") {
        // Last-resort fallback for dev debugging only
        console.error(`[FileUploadComponent] (fallback) Upload error for ${file.name}:`, error);
      }
      this._updateUploadProgress(0, 1);
      const errorMsg = this._getUploadErrorMessage(error, file.name);
      app.showNotification?.(`Failed to upload ${file.name}: ${errorMsg}`, 'error');
    }
  }

  /**
   * Validate files against extension, name, and size.
   * @private
   * @param {FileList|Array<File>} files
   * @returns {{validFiles: File[], invalidFiles: Array<{file: File, error: string}>}}
   */
  _validateFiles(files) {
    const { allowedExtensions, maxSizeMB } = this.fileConstants;
    const validFiles = [];
    const invalidFiles = [];
    for (const file of files) {
      const sanitizedName = file.name.replace(/[^\w.-]/g, '_');
      if (sanitizedName !== file.name) {
        invalidFiles.push({ file, error: `Invalid characters in filename` });
        continue;
      }
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isValidExt = allowedExtensions.includes(ext);
      const isValidSize = file.size <= maxSizeMB * 1024 * 1024;
      if (!isValidExt) {
        invalidFiles.push({
          file,
          error: `Invalid file type (${ext}). Allowed: ${allowedExtensions.join(', ')}`
        });
      } else if (!isValidSize) {
        invalidFiles.push({
          file,
          error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB)`
        });
      } else {
        validFiles.push(file);
      }
    }
    return { validFiles, invalidFiles };
  }

  /** Show initial progress state. */
  _setupUploadProgress(total) {
    this.uploadStatus = { total, completed: 0, failed: 0 };
    const { uploadProgress, progressBar, uploadStatus: statusEl } = this.elements;
    // Show progress bar
    if (uploadProgress) {
      uploadProgress.classList.remove('hidden');
    }
    if (progressBar) {
      progressBar.value = 0;
      progressBar.classList.remove('progress-success', 'progress-error', 'progress-warning');
      progressBar.classList.add('progress-info');
    }
    if (statusEl) {
      statusEl.textContent = `Uploading 0/${total} files`;
    }
  }

  /** Update progress, state, and finish UX. */
  _updateUploadProgress(success, failed) {
    this.uploadStatus.completed += (success + failed);
    this.uploadStatus.failed += failed;
    const { total, completed, failed: totalFailed } = this.uploadStatus;
    const { progressBar, uploadStatus: statusEl, uploadProgress } = this.elements;

    if (progressBar) {
      const percent = Math.round((completed / total) * 100);
      progressBar.value = percent;
      progressBar.classList.remove('progress-info', 'progress-success', 'progress-error', 'progress-warning');
      progressBar.classList.add(
        totalFailed > 0 ?
          (totalFailed === completed ? 'progress-error' : 'progress-warning') :
          'progress-success'
      );
    }
    if (statusEl) {
      statusEl.textContent = `Uploading ${completed}/${total} files${totalFailed > 0 ? ` (${totalFailed} failed)` : ''}`;
    }
    // Cosmetic: Keep the progress bar visible for 2 seconds after all uploads finish for user feedback.
    // If you want a CSS fadeout/transition instead, prefer to add it in CSS and remove this timer for a snappier UI.
    if (completed === total && uploadProgress) {
      setTimeout(() => {
        uploadProgress.classList.add('hidden');
      }, 2000);
    }
  }

  /**
   * Derives user friendly error message from error/response.
   * @private
   */
  _getUploadErrorMessage(error) {
    const message = error?.message || "Unknown error";
    if (message.includes('auth') || error?.status === 401) return "Authentication failed";
    if (message.includes('too large') || message.includes('size')) return `File exceeds ${this.fileConstants.maxSizeMB}MB limit`;
    if (message.includes('token limit')) return 'Project token limit exceeded';
    if (message.includes('validation') || error?.status === 422) return "File format not supported";
    return message;
  }
}

export default FileUploadComponent;
