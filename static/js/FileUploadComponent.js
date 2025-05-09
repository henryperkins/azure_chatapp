/**
 * @module FileUploadComponent
 * @description Handles file upload UI and logic for projects using strict Dependency Injection.
 * Manages drag-and-drop, file selection, validation, and upload progress display.
 *
 * @param {Object} options - Dependency Injection options.
 * @param {Object} options.app - Required. App core utilities (validateUUID).
 * @param {Object} options.eventHandlers - Required. Event listener management (trackListener).
 * @param {Object} options.projectManager - Required. Handles the actual file upload API calls.
 * @param {Object} options.notify - Required. Context-aware notification utility.
 * @param {Object} options.domAPI - Required. DOM manipulation abstraction.
 * @param {Object} [options.scheduler] - Optional. Timing utilities (setTimeout, clearTimeout).
 * @param {string} [options.projectId] - Optional initial project ID.
 * @param {Function} [options.onUploadComplete] - Optional callback after uploads finish.
 * @param {Object} [options.elements] - Optional pre-resolved DOM element references.
 * @returns {FileUploadComponent} Instance of the component.
 */
export class FileUploadComponent {
  /**
   * @param {Object} options - Constructor options (see factory function JSDoc).
   */
  constructor(options = {}) {
    // --- Dependency resolution & Validation (Guideline #2) ---
    const getDep = (name, isRequired = true) => {
      const dep = options[name];
      if (isRequired && !dep) {
        throw new Error(`[FileUploadComponent] Missing required dependency: ${name}`);
      }
      return dep;
    };

    this.app = getDep('app');
    this.eventHandlers = getDep('eventHandlers');
    this.projectManager = getDep('projectManager');
    this.domAPI = getDep('domAPI'); // Inject domAPI
    const notifyRaw = getDep('notify');

    // Guideline #4: Use notify.withContext()
    this.notify = notifyRaw.withContext({
      module: 'FileUploadComponent',
      context: 'fileUpload'
    });

    // Deterministic timers (DI-friendly)
    this.scheduler = getDep('scheduler', false) || { setTimeout, clearTimeout }; // Optional dep

    this.projectId = options.projectId || null;
    this.onUploadComplete = options.onUploadComplete || (() => { });

    // --- Configuration ---
    this.fileConstants = {
      allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'],
      maxSizeMB: 30
    };

    // --- Elements (Lookup via domAPI on init, Guideline #2) ---
    this.elements = {
      fileInput: null, uploadBtn: null, dragZone: null,
      uploadProgress: null, progressBar: null, uploadStatus: null,
      // Store selectors from options or use defaults
      selectors: {
        fileInput: options.elements?.fileInput || '#fileInput',
        uploadBtn: options.elements?.uploadBtn || '#uploadFileBtn',
        dragZone: options.elements?.dragZone || '#dragDropZone',
        uploadProgress: options.elements?.uploadProgress || '#filesUploadProgress',
        progressBar: options.elements?.progressBar || '#fileProgressBar',
        uploadStatus: options.elements?.uploadStatus || '#uploadStatus'
      }
    };

    this.uploadState = { total: 0, completed: 0, failed: 0 }; // Renamed from uploadStatus
    this._handlersBound = false;
    this._listeners = []; // Guideline #3: Internal tracking for cleanup

    // Track listener cleanup (patchplan #4)
    this._unsubs = [];
  }

  /**
   * Set the current project ID for uploads.
   * @param {string} projectId
   */
  setProjectId(projectId) {
    this.projectId = projectId;
    this.notify.info('Project context set for uploads.', { source: 'setProjectId', extra: { projectId } });
  }

  /**
   * Initialize component: Find elements, bind events.
   * Should be called only when the DOM context (e.g., project details view) is ready.
   */
  init() {
    this.notify.info("Initializing file upload component...", { source: 'init' });
    if (this._handlersBound) return;
    if (!this._findElements()) {
      this.notify.error("Initialization failed: Could not find required DOM elements for file upload.", {
        source: 'init',
        group: true // Group critical init errors
      });
      return;
    }
    this._bindEvents();
    this._handlersBound = true;
    this.notify.info("File upload component initialized.", { source: 'init' });

    // --- Standardized "fileuploadcomponent:initialized" event ---
    const doc = this.domAPI?.getDocument?.() || (typeof document !== "undefined" ? document : null);
    if (doc) {
      if (this.domAPI?.dispatchEvent) {
        this.domAPI.dispatchEvent(doc,
          new CustomEvent('fileuploadcomponent:initialized',
            { detail: { success: true } }));
      } else {
        doc.dispatchEvent(new CustomEvent('fileuploadcomponent:initialized',
          { detail: { success: true } }));
      }
    }
  }

  /** Find elements using injected domAPI */
  _findElements() {
    const els = this.elements;
    const sources = els.selectors;
    const elementKeys = [
      'fileInput',
      'uploadBtn',
      'dragZone',
      'uploadProgress',
      'progressBar',
      'uploadStatus'
    ];

    for (const key of elementKeys) {
      const value = sources[key];

      if (
        typeof value === "object" &&
        value !== null &&
        typeof value.nodeType === "number"
      ) {
        // It's a DOM element instance
        els[key] = value;
      } else if (typeof value === "string") {
        // It's a selector
        els[key] = this.domAPI.querySelector(value);
      } else {
        // Unexpected type
        this.notify.error(
          `Invalid source for DOM element '${key}'. Expected DOM element or selector string.`,
          {
            source: "_findElements",
            group: true,
            extra: { key, receivedSourceType: typeof value }
          }
        );
        els[key] = null;
      }
    }

    // Check if critical elements were found
    if (
      !(
        els.fileInput &&
        els.uploadBtn &&
        els.dragZone &&
        els.uploadProgress &&
        els.progressBar &&
        els.uploadStatus
      )
    ) {
      this.notify.warn(
        "Not all DOM elements for FileUploadComponent were found or resolved.",
        {
          source: "_findElements",
          group: true,
          extra: {
            fileInputFound: !!els.fileInput,
            uploadBtnFound: !!els.uploadBtn,
            dragZoneFound: !!els.dragZone,
            uploadProgressFound: !!els.uploadProgress,
            progressBarFound: !!els.progressBar,
            uploadStatusFound: !!els.uploadStatus
          }
        }
      );
      return false;
    }
    return true;
  }


  /** Bind event listeners via eventHandlers (Guideline #3) */
  _bindEvents() {
    const { fileInput, uploadBtn, dragZone } = this.elements;
    const EH = this.eventHandlers;

    const track = (el, type, handler, description) => {
      if (!el) return;
      // Use Guideline #3 pattern: track locally for specific component cleanup
      const remover = EH.trackListener(el, type, handler, {
        description: `FileUpload: ${description}`,
        module: 'FileUploadComponent', // Add context for central cleanup if supported
        context: 'fileUpload'
      });
      this._unsubs.push(remover);
      // Keep prior logic for full safety
      if (remover && typeof remover.remove === 'function') {
        this._listeners.push(remover);
      } else {
        this._listeners.push({ element: el, type, handler: handler, description });
      }
    };

    // --- File input ---
    track(fileInput, 'change', (e) => this._handleFileSelection(e), 'File Input Change');

    // --- Upload button ---
    track(uploadBtn, 'click', () => fileInput?.click(), 'Upload Button Click');

    // --- Drag-n-drop ---
    if (dragZone) {
      ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
        track(dragZone, eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Use domAPI compatible classList access if needed, but direct is usually fine here
          if (eventName === 'dragenter' || eventName === 'dragover') {
            dragZone.classList.add('border-primary');
          } else {
            dragZone.classList.remove('border-primary');
            if (eventName === 'drop') {
              this._handleFileDrop(e);
            }
          }
        }, `DragZone ${eventName}`);
      });
      track(dragZone, 'click', () => fileInput?.click(), 'DragZone Click');
    }
  }

  /** Cleanup listeners (Guideline #3) */
  destroy() {
    this.notify.info("Destroying FileUploadComponent, removing listeners.", { source: 'destroy' });
    this._listeners.forEach(l => {
      if (typeof l.remove === 'function') {
        l.remove(); // Use removal handle if provided by trackListener
      } else if (l.element && this.eventHandlers.untrackListener) {
        this.eventHandlers.untrackListener(l.element, l.type, l.handler);
      }
    });
    this._listeners = [];
    if (this._unsubs) {
      this._unsubs.forEach(fn => typeof fn === 'function' && fn());
      this._unsubs.length = 0;
    }
    this._handlersBound = false;
  }

  /**
   * Teardown listeners and refs (external compatible, Guideline #3)
   */
  cleanup() {
    this.destroy();
  }

  /**
   * TEMP alias – kept until all callers switch to .init().
   * Delegates to .init() so old code keeps working.
   */
  initialize(...args) {
    return this.init(...args);
  }

  /** @private */
  _handleFileSelection(e) {
    const files = e.target?.files; // Safely access files
    if (!files || files.length === 0) return;
    this._uploadFiles(files);
    // Reset input so same file can be selected again
    if (e.target) e.target.value = null;
  }

  /** @private */
  _handleFileDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    this._uploadFiles(files);
  }

  /** Main upload flow (Guideline #4 for notifications) */
  async _uploadFiles(files) {
    const projectId = this.projectId || this.app.getProjectId?.();
    if (!projectId || !this.app.validateUUID?.(projectId)) {
      // Guideline #4: Structured notification
      this.notify.error('Cannot upload: No valid project selected.', {
        source: '_uploadFiles',
        group: true
      });
      return;
    }

    const { validFiles, invalidFiles } = this._validateFiles(files);

    invalidFiles.forEach(({ file, error }) => {
      // Guideline #4: Structured notification
      this.notify.error(`Skipped File: ${error}`, {
        source: '_uploadFiles',
        group: true, // Group validation errors
        extra: { fileName: file.name, fileSize: file.size }
      });
    });

    if (validFiles.length === 0) {
      this.notify.info('No valid files selected for upload.', { source: '_uploadFiles' });
      return;
    }

    this._setupUploadProgress(validFiles.length);
    this.notify.info(`Starting upload of ${validFiles.length} file(s).`, {
      source: '_uploadFiles',
      extra: { count: validFiles.length, projectId }
    });


    // Batching logic remains the same
    const BATCH_SIZE = 3;
    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(file => this._uploadFile(projectId, file)));
    }

    this.notify.info(`Upload process finished for ${validFiles.length} file(s).`, {
      source: '_uploadFiles',
      extra: { completed: this.uploadState.completed, failed: this.uploadState.failed }
    });

    // Check if onUploadComplete is a function before calling
    if (typeof this.onUploadComplete === 'function') {
      this.onUploadComplete();
    }
  }

  /** Upload a single file (Guideline #4, #5) */
  async _uploadFile(projectId, file) {
    const { projectManager } = this;
    const trace = this.app.DependencySystem?.getCurrentTraceIds?.() || {}; // Get trace info if possible
    const transactionId = trace.transactionId || this.app.DependencySystem?.generateTransactionId?.();

    try {
      if (typeof projectManager.uploadFileWithRetry !== "function") {
        throw new Error('projectManager.uploadFileWithRetry function not available');
      }
      // Use projectManager's method which should handle API calls and retries
      await projectManager.uploadFileWithRetry(projectId, { file });

      this._updateUploadProgress(1, 0);
      // Guideline #4: Structured notification
      this.notify.success(`Uploaded: ${file.name}`, {
        source: '_uploadFile',
        group: false, // Individual success messages are often better
        extra: { fileName: file.name, fileSize: file.size, projectId }
      });
    } catch (error) {
      // Guideline #5: Rich error context
      const errorMsg = this._getUploadErrorMessage(error);
      this.notify.error(`Upload Failed: ${file.name} - ${errorMsg}`, {
        source: '_uploadFile',
        group: true, // Group upload errors
        originalError: error, // Include original error
        traceId: trace.traceId,
        transactionId: transactionId,
        extra: { fileName: file.name, fileSize: file.size, projectId }
      });
      this._updateUploadProgress(0, 1);
      // No need for a second user-facing notification here, the error above is sufficient.
    }
  }

  /** File validation logic remains the same */
  _validateFiles(files) {
    const { allowedExtensions, maxSizeMB } = this.fileConstants;
    const validFiles = [];
    const invalidFiles = [];
    // eslint-disable-next-line no-control-regex
    for (let file of files) {
      // Basic sanitization - replace potentially problematic characters
      // A more robust library might be needed for complex cases, but this covers common issues.
      const sanitizedName = file.name.replace(/[<>:"/\\|?*#%\s\x00-\x1F\x7F]/g, '_'); // eslint-disable-line no-control-regex

      if (sanitizedName !== file.name) {
        // Use a temporary File object with the sanitized name for validation checks
        // Note: This doesn't change the actual File object being uploaded,
        // the backend MUST perform its own robust sanitization.
        // This client-side check is mainly for early feedback.
        try {
          const tempFile = new File([file], sanitizedName, { type: file.type });
          file = tempFile; // Use the sanitized version for checks below
        } catch {
          // If File constructor fails (e.g., in older envs or due to name issues)
          invalidFiles.push({ file: file, error: `Filename contains invalid characters` });
          continue;
        }
      }

      if (file.name.length === 0 || file.name === '.' || file.name === '..') {
        invalidFiles.push({ file: file, error: `Invalid filename` });
        continue;
      }

      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
      const isValidExt = allowedExtensions.includes(ext);
      const isValidSize = file.size <= maxSizeMB * 1024 * 1024;

      if (!isValidExt) {
        invalidFiles.push({
          file,
          error: `Invalid file type (${ext || 'none'}). Allowed: ${allowedExtensions.join(', ')}`
        });
      } else if (!isValidSize) {
        invalidFiles.push({
          file,
          error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB)`
        });
      } else {
        validFiles.push(file); // Add the original file if valid
      }
    }
    return { validFiles, invalidFiles };
  }


  /** Show initial progress */
  _setupUploadProgress(total) {
    this.uploadState = { total, completed: 0, failed: 0 };
    const { uploadProgress, progressBar, uploadStatus: statusEl } = this.elements;
    if (uploadProgress) uploadProgress.classList.remove('hidden');
    if (progressBar) {
      progressBar.value = 0;
      progressBar.max = 100; // Ensure max is set
      progressBar.className = 'progress progress-info'; // Use daisyUI classes
    }
    if (statusEl) statusEl.textContent = `Uploading 0/${total} files...`;
  }

  /** Update progress */
  _updateUploadProgress(successCount, failedCount) {
    this.uploadState.completed += successCount;
    this.uploadState.failed += failedCount;
    const { total, completed, failed } = this.uploadState;
    const { progressBar, uploadStatus: statusEl, uploadProgress } = this.elements;

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (progressBar) {
      progressBar.value = percent;
      // Update progress bar color based on state
      progressBar.className = 'progress'; // Reset base class
      if (failed > 0) {
        progressBar.classList.add(completed === total ? 'progress-error' : 'progress-warning');
      } else if (completed === total) {
        progressBar.classList.add('progress-success');
      } else {
        progressBar.classList.add('progress-info');
      }
    }

    if (statusEl) {
      statusEl.textContent = `Uploaded ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}.`;
    }

    if (completed === total && uploadProgress) {
      this.notify.info(`Upload complete. ${this.uploadState.completed - this.uploadState.failed}/${total} succeeded.`, { source: '_updateUploadProgress' });
      // Delay hiding the upload progress bar to allow users to see the completion status before it disappears.
      // This ensures the UI feedback is not too abrupt after the upload finishes.
      this.scheduler.setTimeout(() => {
        if (uploadProgress) uploadProgress.classList.add('hidden');
      }, 2500); // Slightly longer delay
    }
  }

  /** Error message helper remains the same */
  _getUploadErrorMessage(error) {
    const message = error?.message || error?.data?.detail || "Unknown error";
    // Be more specific based on potential status codes or messages
    if (error?.status === 401 || error?.status === 403) return "Authentication/Authorization failed";
    if (error?.status === 413 || message.includes('too large') || message.includes('size')) return `File exceeds ${this.fileConstants.maxSizeMB}MB limit`;
    if (error?.status === 400 && message.includes('token limit')) return 'Project token limit exceeded';
    if (error?.status === 422 || message.includes('validation')) return "Invalid file type or format";
    if (error?.status === 500) return "Server error during upload";
    if (message.includes('NetworkError') || error?.message === 'Failed to fetch') return "Network error. Please check connection.";
    return message; // Fallback to original message
  }
}

// Guideline #1: Factory function export
export const createFileUploadComponent = (opts) => new FileUploadComponent(opts);
