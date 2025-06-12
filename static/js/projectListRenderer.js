/**
 * @file projectListRenderer.js
 * @description Renders the project list UI, including cards, filters, and loading / empty / error states.
 * Pure renderer – no business logic. Emits UI intent via eventService.
 */

const MODULE_CONTEXT = 'ProjectListRenderer';

export function createProjectListRenderer(dependencies = {}) {
    const {
        domAPI,
        eventHandlers,
        eventService,
        logger,
        sanitizer,
        uiUtils
    } = dependencies;

    // --- Strict DI validation ------------------------------------------------
    const required = [
        'domAPI',
        'eventHandlers',
        'eventService',
        'logger',
        'sanitizer',
        'uiUtils'
    ];
    for (const dep of required) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    // --- Cached DOM look-ups --------------------------------------------------
    const elements = {
        get container() { return domAPI.getElementById('projectListView'); },
        get grid() { return domAPI.getElementById('projectCardsPanel'); },
        get filterTabs() { return domAPI.getElementById('projectFilterTabs'); },
        get createBtn() { return domAPI.getElementById('createProjectBtn'); }
    };

    // --- Internal helpers -----------------------------------------------------
    function _logInfo(msg, meta = {}) {
        logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
    }

    function _createProjectCard(project) {
        const card = domAPI.createElement('div');
        domAPI.addClass(card, 'project-card', 'group', 'cursor-pointer', 'p-4',
                               'rounded-lg', 'bg-base-200', 'hover:bg-base-300',
                               'transition-colors', 'select-none');
        card.dataset.projectId = project.id;

        const title = sanitizer.sanitize(project.name || 'Untitled Project');
        const description = sanitizer.sanitize(project.description || 'No description.');

        const inner = `
            <h3 class="font-bold truncate mb-1">${title}</h3>
            <p class="text-sm text-base-content/70 line-clamp-2 mb-3">${description}</p>
            <span class="text-xs text-base-content/60">
                Updated&nbsp;${uiUtils.formatDate(project.updated_at, true)}
            </span>
        `;
        domAPI.setInnerHTML(card, inner);

        eventHandlers.trackListener(card, 'click', () => {
            eventService.emit('ui:projectList:viewClicked', { projectId: project.id });
        }, { context: MODULE_CONTEXT });

        return card;
    }

    function _clearGrid() {
        if (elements.grid) domAPI.setInnerHTML(elements.grid, '');
    }

    // --- Public API -----------------------------------------------------------
    return {
        initialize() {
            this._bindUIEvents();
        },

        show() {
            if (elements.container) domAPI.removeClass(elements.container, 'hidden');
        },

        hide() {
            if (elements.container) domAPI.addClass(elements.container, 'hidden');
        },

        /* ---------- Rendering States ----------- */
        showLoadingState() {
            if (!elements.grid) return;
            _clearGrid();
            for (let i = 0; i < 6; i++) {
                const skeleton = domAPI.createElement('div');
                domAPI.addClass(skeleton, 'skeleton', 'h-24', 'rounded-lg', 'bg-base-200', 'animate-pulse');
                elements.grid.appendChild(skeleton);
            }
        },

        showErrorState(message = 'Failed to load projects.') {
            if (!elements.grid) return;
            _clearGrid();
            domAPI.setInnerHTML(
                elements.grid,
                `<div class="col-span-full text-center p-8 text-error">${sanitizer.sanitize(message)}</div>`
            );
        },

        renderProjects(projects = []) {
            if (!elements.grid) return;
            _clearGrid();

            if (projects.length === 0) {
                domAPI.setInnerHTML(
                    elements.grid,
                    '<div class="col-span-full text-center p-8 text-base-content/60">No projects found.</div>'
                );
                return;
            }

            // Build grid fragment
            const frag = domAPI.createDocumentFragment();
            projects.forEach(p => frag.appendChild(_createProjectCard(p)));
            elements.grid.appendChild(frag);
        },

        /* ---------- Filter Tabs ----------- */
        setActiveFilter(filterValue) {
            const tabs = elements.filterTabs?.querySelectorAll('[data-filter]');
            tabs?.forEach(tab => {
                const active = tab.dataset.filter === filterValue;
                domAPI.toggleClass(tab, 'active', active);
            });
        },

        /* ---------- Internal -------------------------------------------------- */
        _bindUIEvents() {
            // Filter tabs click
            if (elements.filterTabs) {
                eventHandlers.trackListener(
                    elements.filterTabs,
                    'click',
                    (e) => {
                        const btn = e.target.closest('[data-filter]');
                        if (btn) {
                            const filter = btn.dataset.filter;
                            this.setActiveFilter(filter);
                            eventService.emit('ui:projectList:filterChanged', { filter });
                        }
                    },
                    { context: MODULE_CONTEXT }
                );
            }

            // Create button click
            if (elements.createBtn) {
                eventHandlers.trackListener(
                    elements.createBtn,
                    'click',
                    () => eventService.emit('ui:projectList:createClicked'),
                    { context: MODULE_CONTEXT }
                );
            }
        },

        cleanup() {
            eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
        }
    };
}
