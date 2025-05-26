/**
 * @module FileUploadComponent
 * @description Handles file upload UI and logic for projects using strict Dependency Injection.
 * Manages drag-and-drop, file selection, validation, and upload progress display.
 *
 * @param {Object} deps - Dependency Injection options.
 * @param {Object} deps.app - Required. App core utilities (validateUUID).
 * @param {Object} deps.eventHandlers - Required. Event listener management (trackListener).
 * @param {Object} deps.projectManager - Required. Handles the actual file upload API calls.
 * @param {Object} deps.domAPI - Required. DOM manipulation abstraction.
 * @param {Object} deps.logger - Required. Logging utility.
 * @param {Object} [deps.domReadinessService] - Optional. DOM readiness service.
 * @param {Object} [deps.scheduler] - Optional. Timing utilities (setTimeout, clearTimeout).
 * @param {string} [deps.projectId] - Optional initial project ID.
 * @param {Function} [deps.onUploadComplete] - Optional callback after uploads finish.
 * @param {Object} [deps.elements] - Optional pre-resolved DOM element references.
 * @returns {Object} FileUploadComponent API.
 */

const MODULE_CONTEXT = "FileUploadComponentContext";

export function createFileUploadComponent({
  app,
  eventHandlers,
  projectManager,
  domAPI,
  logger,
  domReadinessService,
  scheduler,
  projectId,
  onUploadComplete,
  elements
} = {}) {
  // --- Attempt auto-resolution of `logger` when not injected ---
  if (!logger) {
    try {
      const ds = eventHandlers?.DependencySystem;
      logger = ds?.modules?.get?.('logger');
    } catch { /* ignore – will be re-checked below */ }
  }
  // === Dependency validation block ===
  if (!app) throw new Error("[FileUploadComponent] Missing app");
  if (!eventHandlers) throw new Error("[FileUploadComponent] Missing eventHandlers");
  if (!projectManager) throw new Error("[FileUploadComponent] Missing projectManager");
  if (!domAPI) throw new Error("[FileUploadComponent] Missing domAPI");
  if (!logger) throw new Error("[FileUploadComponent] Missing logger");
  // domReadinessService and scheduler are optional

  // --- Configuration ---
  const fileConstants = {
    allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css', '.ini'],
    maxSizeMB: 30
  };

  // --- Elements (Lookup via domAPI on init) ---
  const _elements = {
    fileInput: null, uploadBtn: null, dragZone: null,
    uploadProgress: null, progressBar: null, uploadStatus: null,
    selectors: {
      fileInput: elements?.fileInput || '#fileInput',
      uploadBtn: elements?.uploadBtn || '#uploadFileBtn',
      dragZone: elements?.dragZone || '#dragDropZone',
      uploadProgress: elements?.uploadProgress || '#filesUploadProgress',
      progressBar: elements?.progressBar || '#fileProgressBar',
      uploadStatus: elements?.uploadStatus || '#uploadStatus'
    }
  };

  let _projectId = projectId || null;
  let _onUploadComplete = typeof onUploadComplete === 'function' ? onUploadComplete : () => {};
  let uploadState = { total: 0, completed: 0, failed: 0 };
  let _handlersBound = false;

  // Deterministic timers (DI-friendly)
  const _scheduler = scheduler || { setTimeout, clearTimeout };

  // --- API Methods ---

  function setProjectId(pid) {
    _projectId = pid;
  }

  async function init() {
    if (_handlersBound) return;
    try {
      if (domReadinessService) {
        // Only pass string selectors, not DOM element objects
        const stringSelectors = Object.values(_elements.selectors).filter(
          selector => typeof selector === 'string'
        );
        if (stringSelectors.length > 0) {
          await domReadinessService.dependenciesAndElements({
            domSelectors: stringSelectors,
            context: MODULE_CONTEXT + '::init'
          });
        }
      }
      if (!_findElements()) {
        logger.error('[FileUploadComponent] Required DOM elements not found', {
          context: MODULE_CONTEXT, projectId: _projectId || 'unknown'
        });
        throw new Error('[FileUploadComponent] Initialization failed: required DOM elements not found');
      }
      _bindEvents();
      _handlersBound = true;

      // Standardized "fileuploadcomponent:initialized" event
      const doc = domAPI?.getDocument?.();
      if (!doc) throw new Error('[FileUploadComponent] DOM unavailable via domAPI');
      if (domAPI?.dispatchEvent) {
        domAPI.dispatchEvent(
          doc,
          eventHandlers.createCustomEvent('fileuploadcomponent:initialized',{ detail:{ success:true } })
        );
      }
    } catch (error) {
      logger.error('[FileUploadComponent][init] Initialization failed', error, { context: MODULE_CONTEXT });
      throw error;
    }
  }

  function _findElements() {
    const els = _elements;
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
        els[key] = value;
      } else if (typeof value === "string") {
        els[key] = domAPI.querySelector(value);
      } else {
        els[key] = null;
      }
    }

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
      return false;
    }
    return true;
  }

  function _bindEvents() {
    const { fileInput, uploadBtn, dragZone } = _elements;
    const EH = eventHandlers;

    const track = (el, type, handler, description) => {
      if (!el) return;
      EH.trackListener(el, type, handler, {
        description: `FileUpload: ${description}`,
        module: 'FileUploadComponent',
        context: MODULE_CONTEXT
      });
    };

    // File input
    track(fileInput, 'change', (e) => _handleFileSelection(e), 'File Input Change');

    // Upload button
    track(uploadBtn, 'click', () => fileInput?.click(), 'Upload Button Click');

    // Drag-n-drop
    if (dragZone) {
      ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
        track(dragZone, eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (eventName === 'dragenter' || eventName === 'dragover') {
            dragZone.classList.add('border-primary');
          } else {
            dragZone.classList.remove('border-primary');
            if (eventName === 'drop') {
              _handleFileDrop(e);
            }
          }
        }, `DragZone ${eventName}`);
      });
      track(dragZone, 'click', () => fileInput?.click(), 'DragZone Click');
    }
  }

  function destroy() {
    if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
    _handlersBound = false;
  }

  function cleanup() {
    destroy();
  }

  function initialize(...args) {
    return init(...args);
  }

  function _handleFileSelection(e) {
    const files = e.target?.files;
    if (!files || files.length === 0) return;
    _uploadFiles(files);
    if (e.target) e.target.value = null;
  }

  function _handleFileDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    _uploadFiles(files);
  }

  async function _uploadFiles(files) {
    const pid = _projectId || app.getProjectId?.();
    if (!pid || !app.validateUUID?.(pid)) {
      logger.error('[FileUploadComponent][_uploadFiles] Invalid or missing projectId', { context: MODULE_CONTEXT });
      return;
    }

    const { validFiles, invalidFiles } = _validateFiles(files);

    invalidFiles.forEach(({ file, error }) => {
      logger.error('[FileUploadComponent][_uploadFiles] Invalid file', {
        fileName: file?.name,
        error,
        context: MODULE_CONTEXT
      });
    });

    if (validFiles.length === 0) {
      return;
    }

    _setupUploadProgress(validFiles.length);

    // Batching logic remains the same
    const BATCH_SIZE = 3;
    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(file => _uploadFile(pid, file)));
    }

    if (typeof _onUploadComplete === 'function') {
      _onUploadComplete();
    }
  }

  async function _uploadFile(pid, file) {
    try {
      if (typeof projectManager.uploadFileWithRetry !== "function") {
        throw new Error('projectManager.uploadFileWithRetry function not available');
      }
      await projectManager.uploadFileWithRetry(pid, { file });
      _updateUploadProgress(1, 0);
    } catch (error) {
      logger.error('[FileUploadComponent][_uploadFile] Upload failed', error, {
        fileName: file?.name,
        context: MODULE_CONTEXT
      });
      _updateUploadProgress(0, 1);
    }
  }

  function _validateFiles(files) {
    const { allowedExtensions, maxSizeMB } = fileConstants;
    const validFiles = [];
    const invalidFiles = [];
    for (let file of files) {
      // Replace forbidden characters and control chars with '_'
      const sanitizedName = file.name
        .split('')
        .map(c => {
          const code = c.charCodeAt(0);
          // Forbidden: < > : " / \ | ? * # % whitespace, DEL, or ASCII control chars
          if (
            '<>:"/\\|?*#%'.includes(c) ||
            /\s/.test(c) ||
            code < 32 || code === 127
          ) {
            return '_';
          }
          return c;
        })
        .join('');
      if (sanitizedName !== file.name) {
        try {
          const tempFile = new File([file], sanitizedName, { type: file.type });
          file = tempFile;
        } catch (err) {
          logger.error('[FileUploadComponent][_validateFiles] File name sanitization failed', err, {
            fileName: file?.name,
            context: MODULE_CONTEXT
          });
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
        validFiles.push(file);
      }
    }
    return { validFiles, invalidFiles };
  }

  function _setupUploadProgress(total) {
    uploadState = { total, completed: 0, failed: 0 };
    const { uploadProgress, progressBar, uploadStatus: statusEl } = _elements;
    if (uploadProgress) domAPI.removeClass(uploadProgress, 'hidden');
    if (progressBar) {
      domAPI.setProperty(progressBar, 'value', 0);
      domAPI.setProperty(progressBar, 'max', 100);
      domAPI.setProperty(progressBar, 'className', 'progress progress-info');
    }
    if (statusEl) domAPI.setTextContent(statusEl, `Uploading 0/${total} files...`);
  }

  function _updateUploadProgress(successCount, failedCount) {
    uploadState.completed += successCount;
    uploadState.failed += failedCount;
    const { total, completed, failed } = uploadState;
    const { progressBar, uploadStatus: statusEl, uploadProgress } = _elements;

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (progressBar) {
      domAPI.setProperty(progressBar, 'value', String(percent));

      let newClassName = 'progress';
      if (failed > 0) {
        newClassName += (completed === total ? ' progress-error' : ' progress-warning');
      } else if (completed === total) {
        newClassName += ' progress-success';
      } else {
        newClassName += ' progress-info';
      }
      domAPI.setProperty(progressBar, 'className', newClassName);
    }

    if (statusEl) {
      domAPI.setTextContent(statusEl, `Uploaded ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}.`);
    }

    if (completed === total && uploadProgress) {
      _scheduler.setTimeout(() => {
        if (uploadProgress) domAPI.addClass(uploadProgress, 'hidden');
      }, 2500);
    }
  }

  // Expose API
  return {
    setProjectId,
    init,
    initialize,
    destroy,
    cleanup,
    _handleFileSelection,
    _handleFileDrop
  };
}
