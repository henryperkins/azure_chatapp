/**
 * @file projectDetailsRenderer.js
 * @description Renders the UI for the project details view. This module is responsible
 * for all DOM manipulation and does not contain business logic. It emits events for user interactions.
 */

const MODULE_CONTEXT = 'ProjectDetailsRenderer';

export function createProjectDetailsRenderer(dependencies) {
    const {
        domAPI,
        eventHandlers,
        eventService,
        logger,
        sanitizer,
        uiUtils, // Assumes a utility module for formatting
    } = dependencies;

    // Strict Dependency Validation
    const requiredDeps = ['domAPI', 'eventHandlers', 'eventService', 'logger', 'sanitizer', 'uiUtils'];
    for (const dep of requiredDeps) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    const elements = {
        get container() { return domAPI.getElementById('projectDetailsView'); },
        get title() { return domAPI.getElementById('projectTitle'); },
        get description() { return domAPI.getElementById('projectDescriptionDisplay'); },
        get goals() { return domAPI.getElementById('projectGoalsDisplay'); },
        get createdDate() { return domAPI.getElementById('projectCreatedDate'); },
        get filesList() { return domAPI.getElementById('filesList'); },
        get conversationsList() { return domAPI.getElementById('conversationsList'); },
        get tabBtns() { return domAPI.querySelectorAll('.project-tab'); },
        get tabPanes() { return domAPI.querySelectorAll('.tab-pane'); },
    };

    function _logInfo(msg, meta = {}) {
        logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
    }

    function _createFileItem(file) {
        const item = domAPI.createElement('div');
        domAPI.addClass(item, 'file-item flex items-center justify-between p-2 bg-base-200 rounded-lg');

        const content = `
            <div class="flex items-center gap-3 min-w-0">
                <span class="text-xl">${uiUtils.fileIcon(file.file_type)}</span>
                <div class="flex-1 min-w-0">
                    <div class="font-medium truncate" title="${sanitizer.sanitize(file.filename)}">${sanitizer.sanitize(file.filename)}</div>
                    <div class="text-xs text-base-content/60">
                        ${uiUtils.formatBytes(file.file_size)} &middot; ${uiUtils.formatDate(file.created_at)}
                    </div>
                </div>
            </div>
            <div class="flex-shrink-0">
                <button data-action="download-file" class="btn btn-ghost btn-sm btn-square" aria-label="Download file">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                </button>
                <button data-action="delete-file" class="btn btn-ghost btn-sm btn-square text-error" aria-label="Delete file">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        `;
        domAPI.setInnerHTML(item, sanitizer.sanitize(content));

        const downloadBtn = item.querySelector('[data-action="download-file"]');
        const deleteBtn = item.querySelector('[data-action="delete-file"]');

        eventHandlers.trackListener(downloadBtn, 'click', () => {
            eventService.emit('ui:projectDetails:downloadFileClicked', { fileId: file.id, fileName: file.filename });
        }, { context: MODULE_CONTEXT });

        eventHandlers.trackListener(deleteBtn, 'click', () => {
            eventService.emit('ui:projectDetails:deleteFileClicked', { fileId: file.id, fileName: file.filename });
        }, { context: MODULE_CONTEXT });

        return item;
    }

    function _renderList(container, items, itemCreator, emptyMessage) {
        if (!container) return;
        domAPI.setInnerHTML(container, '');
        if (!items || items.length === 0) {
            domAPI.setInnerHTML(container, `<div class="text-center p-4 text-base-content/60">${emptyMessage}</div>`);
            return;
        }
        const fragment = domAPI.createDocumentFragment();
        items.forEach(item => fragment.appendChild(itemCreator(item)));
        container.appendChild(fragment);
    }

    return {
        renderProject(projectData) {
            if (!projectData) return;
            _logInfo(`Rendering project data for "${projectData.name}"`);
            elements.title.textContent = sanitizer.sanitize(projectData.name || 'Untitled Project');
            elements.description.textContent = sanitizer.sanitize(projectData.description || 'No description provided.');
            elements.goals.textContent = sanitizer.sanitize(projectData.goals || 'No goals specified.');
            elements.createdDate.textContent = uiUtils.formatDate(projectData.created_at);
        },

        renderFiles(files) {
            _renderList(elements.filesList, files, _createFileItem, 'No files have been uploaded to this project yet.');
        },

        renderConversations(conversations) {
            // This assumes a separate component/function creates conversation items
            // For now, we'll just show a count.
            _logInfo(`Rendering ${conversations.length} conversations.`);
            const conversationsCountEl = domAPI.getElementById('conversationCount');
            if (conversationsCountEl) {
                conversationsCountEl.textContent = `${conversations.length} chats`;
            }
        },

        setActiveTab(tabName) {
            elements.tabBtns.forEach(btn => {
                const isActive = btn.dataset.tab === tabName;
                domAPI.toggleClass(btn, 'active', isActive);
            });
            elements.tabPanes.forEach(pane => {
                domAPI.toggleClass(pane, 'hidden', pane.id !== `${tabName}Tab`);
            });
        },

        cleanup() {
            _logInfo('Cleaning up renderer.');
            eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
        }
    };
}
