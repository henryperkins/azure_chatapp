
/**
 * ProjectDetailsRenderer – extracted UI rendering helpers (Phase-2)
 * ---------------------------------------------------------------
 * Handles all DOM rendering logic for project details: files, conversations,
 * artifacts, and project metadata. Extracted from oversized ProjectDetailsComponent
 * to enforce module size limits and separation of concerns.
 */

export function createProjectDetailsRenderer({
  domAPI,
  sanitizer,
  eventHandlers,
  logger,
  formatDate,
  formatBytes
} = {}) {
  const MODULE = 'ProjectDetailsRenderer';

  if (!domAPI || !sanitizer || !eventHandlers || !logger) {
    throw new Error(`[${MODULE}] Required dependencies missing: domAPI, sanitizer, eventHandlers, logger`);
  }

  const _log = (msg, extra = {}) => logger?.debug?.(`[${MODULE}] ${msg}`, {
    context: MODULE,
    ...extra
  });

  const _logError = (msg, err, extra = {}) => {
    logger?.error?.(`[${MODULE}] ${msg}`, err?.stack || err, {
      context: MODULE,
      ...extra
    });
  };

  function renderFiles(files = [], options = {}) {
    const { container, onDownload, onDelete, listenersContext } = options;

    if (!container) {
      _logError('renderFiles: container required');
      return;
    }

    try {
      // Clear existing content
      domAPI.setInnerHTML(container, '');

      if (!Array.isArray(files) || files.length === 0) {
        const empty = domAPI.createElement('div');
        empty.className = 'empty-state text-center p-4 text-base-content/60';
        domAPI.setTextContent(empty, 'No files uploaded yet');
        domAPI.appendChild(container, empty);
        return;
      }

      files.forEach(file => {
        const fileItem = _createFileItem(file, { onDownload, onDelete, listenersContext });
        domAPI.appendChild(container, fileItem);
      });

      _log('Rendered files', { fileCount: files.length });
    } catch (err) {
      _logError('Failed to render files', err);
    }
  }

  function renderConversations(conversations = [], options = {}) {
    const { container, projectId } = options;

    if (!container) {
      _logError('renderConversations: container required');
      return;
    }

    try {
      // Clear existing content
      domAPI.setInnerHTML(container, '');

      if (!Array.isArray(conversations) || conversations.length === 0) {
        const empty = domAPI.createElement('div');
        empty.className = 'empty-state text-center p-4 text-base-content/60';
        domAPI.setTextContent(empty, 'No conversations yet');
        domAPI.appendChild(container, empty);
      } else {
        conversations.forEach(conversation => {
          const conversationItem = _createConversationItem(conversation);
          domAPI.appendChild(container, conversationItem);
        });
      }

      // Update badge count in header if present
      const countEl = domAPI.getElementById('conversationCount');
      if (countEl) {
        domAPI.setTextContent(countEl, String(conversations.length));
      }

      _log('Rendered conversations', { conversationCount: conversations.length, projectId });
    } catch (err) {
      _logError('Failed to render conversations', err);
    }
  }

  function renderArtifacts(artifacts = [], options = {}) {
    const { container, onDownload, projectId, listenersContext } = options;

    if (!container) {
      _logError('renderArtifacts: container required');
      return;
    }

    try {
      // Clear existing content
      domAPI.setInnerHTML(container, '');

      if (!Array.isArray(artifacts) || artifacts.length === 0) {
        const empty = domAPI.createElement('div');
        empty.className = 'empty-state text-center p-4 text-base-content/60';
        domAPI.setTextContent(empty, 'No artifacts generated yet');
        domAPI.appendChild(container, empty);
        return;
      }

      artifacts.forEach(artifact => {
        const artifactItem = _createArtifactItem(artifact, { onDownload, projectId, listenersContext });
        domAPI.appendChild(container, artifactItem);
      });

      _log('Rendered artifacts', { artifactCount: artifacts.length, projectId });
    } catch (err) {
      _logError('Failed to render artifacts', err);
    }
  }

  function renderProjectData(projectData, elements) {
    if (!elements.container || !projectData) return;

    try {
      const { name, description, goals, customInstructions, created_at, archived } = projectData;

      if (elements.title) {
        elements.title.textContent = sanitizer.sanitize(name || "Untitled Project");
      }

      if (elements.projectNameDisplay) {
        elements.projectNameDisplay.textContent = sanitizer.sanitize(name || "Untitled Project");
      }

      if (elements.projectDescriptionDisplay) {
        domAPI.setInnerHTML(elements.projectDescriptionDisplay,
          sanitizer.sanitize(description || "No description provided."));
      }

      if (elements.projectGoalsDisplay) {
        domAPI.setInnerHTML(elements.projectGoalsDisplay,
          sanitizer.sanitize(goals || "No goals specified."));
      }

      if (elements.projectInstructionsDisplay) {
        domAPI.setInnerHTML(elements.projectInstructionsDisplay,
          sanitizer.sanitize(customInstructions || "No custom instructions."));
      }

      if (elements.projectCreatedDate && created_at && formatDate) {
        elements.projectCreatedDate.textContent = sanitizer.sanitize(formatDate(created_at));
      }

      _updateArchiveButton(archived, elements);
      _updateArchiveBadge(archived, elements);

      _log('Rendered project data', { projectName: name, archived });
    } catch (err) {
      _logError('Failed to render project data', err);
    }
  }

  function _createFileItem(file, { onDownload, onDelete, listenersContext }) {
    const doc = domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-box shadow-xs hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.fileId = file.id;

    domAPI.setInnerHTML(div, `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-xl text-primary">📄</span>
        <div class="flex flex-col min-w-0 flex-1">
          <div class="font-medium truncate" title="${sanitizer.sanitize(file.filename)}">
            ${sanitizer.sanitize(file.filename)}
          </div>
          <div class="text-xs text-base-content/70">
            ${sanitizer.sanitize(formatBytes ? formatBytes(file.file_size) : `${file.file_size} bytes`)} ·
            ${sanitizer.sanitize(formatDate ? formatDate(file.created_at) : file.created_at)}
          </div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-xs btn-square text-info hover:bg-info/10"
                aria-label="Download" data-action="download">⬇</button>
        <button class="btn btn-ghost btn-xs btn-square text-error hover:bg-error/10"
                aria-label="Delete" data-action="delete">✕</button>
      </div>
    `);

    const [downloadBtn, deleteBtn] = div.querySelectorAll("button");

    if (onDownload && downloadBtn) {
      eventHandlers.trackListener(
        downloadBtn, "click",
        () => onDownload(file.id, file.filename),
        { context: listenersContext, description: `DownloadFile_${file.id}` }
      );
    }

    if (onDelete && deleteBtn) {
      eventHandlers.trackListener(
        deleteBtn, "click",
        () => onDelete(file.id, file.filename),
        { context: listenersContext, description: `DeleteFile_${file.id}` }
      );
    }

    return div;
  }

  function _createConversationItem(cv) {
    const doc = domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "conversation-item";
    div.dataset.conversationId = cv.id;

    domAPI.setInnerHTML(div, `
      <h4 class="font-medium truncate mb-1">
        ${sanitizer.sanitize(cv.title || "Untitled conversation")}
      </h4>
      <p class="text-sm text-base-content/60 truncate leading-tight mt-0.5">
        ${sanitizer.sanitize(cv.last_message || "No messages yet")}
      </p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${sanitizer.sanitize(formatDate ? formatDate(cv.updated_at) : cv.updated_at)}</span>
        <span class="badge badge-ghost badge-sm">
          ${sanitizer.sanitize(cv.message_count || 0)} msgs
        </span>
      </div>
    `);

    return div;
  }

  function _createArtifactItem(art, { onDownload, projectId, listenersContext }) {
    const doc = domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "p-3 border-b border-base-300 hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.artifactId = art.id;

    domAPI.setInnerHTML(div, `
      <div class="flex justify-between items-center">
        <h4 class="font-medium truncate">
          ${sanitizer.sanitize(art.name || "Untitled artifact")}
        </h4>
        <span class="text-xs text-base-content/60">
          ${sanitizer.sanitize(formatDate ? formatDate(art.created_at) : art.created_at)}
        </span>
      </div>
      <p class="text-sm text-base-content/70 truncate mt-1">
        ${sanitizer.sanitize(art.description || art.type || "No description")}
      </p>
      <div class="mt-2">
        <button class="btn btn-xs btn-outline" data-action="download">Download</button>
      </div>
    `);

    const btn = div.querySelector("[data-action=download]");
    if (onDownload && btn) {
      eventHandlers.trackListener(
        btn, "click",
        () => onDownload(projectId, art.id),
        { context: listenersContext, description: `DownloadArtifact_${art.id}` }
      );
    }

    return div;
  }

  function _updateArchiveButton(isArchived, elements) {
    const archiveBtn = elements.container?.querySelector('#archiveProjectBtn');
    if (!archiveBtn) return;

    if (isArchived) {
      domAPI.setInnerHTML(archiveBtn, sanitizer.sanitize(`
        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4
                   M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8
                   m-9 4h4" />
        </svg>
        Unarchive Project
      `));
      archiveBtn.className = 'btn btn-success w-full';
      archiveBtn.setAttribute('aria-label', 'Unarchive this project');
    } else {
      domAPI.setInnerHTML(archiveBtn, sanitizer.sanitize(`
        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4
                   M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8
                   m-9 4h4" />
        </svg>
        Archive Project
      `));
      archiveBtn.className = 'btn btn-warning w-full';
      archiveBtn.setAttribute('aria-label', 'Archive this project');
    }
  }

  function _updateArchiveBadge(isArchived, elements) {
    const archiveBadge = elements.container?.querySelector('#projectArchivedBadge');
    if (!archiveBadge) return;

    if (isArchived) {
      archiveBadge.classList.remove('hidden');
    } else {
      archiveBadge.classList.add('hidden');
    }
  }

  return {
    renderFiles,
    renderConversations,
    renderArtifacts,
    renderProjectData,
    cleanup() {
      _log('cleanup()');
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
  };
}

export default createProjectDetailsRenderer;
