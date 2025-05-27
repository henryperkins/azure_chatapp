/**
 * ProjectListComponent – guarded factory
 * Handles rendering and interaction with the project list UI.
 * Compliant with all frontend code guardrails (.clinerules).
 *
 * To use:
 *   import { createProjectListComponent } from './projectListComponent.js';
 *   const plc = createProjectListComponent({ ...dependencies });
 *   plc.initialize();
 *   // ... later, to clean up:
 *   plc.destroy();
 */

export function createProjectListComponent(deps) {
    // ----- Dependency Validation -----
    if (!deps) throw new Error('[ProjectListComponent] Missing dependencies object to factory.');

    const {
        projectManager: initialProjectManager,
        eventHandlers,
        modalManager,
        app,
        router,
        storage,
        sanitizer: htmlSanitizer,
        apiClient,
        domAPI,
        browserService,
        globalUtils,
        domReadinessService,
        APP_CONFIG,
        logger
    } = deps;

    // Allow projectManager to be reassigned later via setProjectManager()
    let projectManager = initialProjectManager;

    const MODULE_CONTEXT = "ProjectListComponent";

    // Allow projectManager to be null initially - it gets set later via setProjectManager()
    if (!eventHandlers || !router || !storage || !htmlSanitizer)
        throw new Error("[ProjectListComponent] Missing required dependencies: eventHandlers, router, storage, sanitizer.");
    if (!domAPI)
        throw new Error("[ProjectListComponent] domAPI injection is mandatory.");
    if (!domReadinessService)
        throw new Error("[ProjectListComponent] domReadinessService DI is mandatory.");
    if (!logger)
        throw new Error("[ProjectListComponent] logger DI is mandatory.");
    if (typeof htmlSanitizer.sanitize !== "function")
        throw new Error("[ProjectListComponent] htmlSanitizer must provide a .sanitize(html) method.");

    // ----- Internal State -----
    // Primary container used by the new template plus legacy fallback
    const ELEMENT_IDS = ["projectListView", "project-list-container"];
    let elementId = ELEMENT_IDS[0];
    let _doc = null;
    let element = null;
    let gridElement = null;
    let state = {
        projects: [],
        filter: "all",
        loading: false,
        customization: _loadCustomization(),
        initialized: false
    };
    let isRendering = false;
    const eventBus = new EventTarget();

    function _setState(partial) {
        state = { ...state, ...partial };
    }
    function _getProjectId(p) {
        return p?.uuid ?? p?.id ?? p?.project_id ?? p?.ID ?? null;
    }

    // ----- Initialization/Readiness -----
    async function initialize() {
        try {
            // Check app readiness using only DI domReadinessService
            await domReadinessService.dependenciesAndElements({
                deps: ['projectManager', 'eventHandlers'],
                domSelectors: [
                    '#projectListView',        // primary container
                    '.project-list-container'  // legacy fallback
                ],
                observeMutations: true,   // wait for template injection
                timeout: APP_CONFIG?.TIMEOUTS?.PROJECT_LIST_ELEMENTS ?? 15000,
                context: MODULE_CONTEXT + '_init'
            });
        } catch (err) {
            logger.error('[ProjectListComponent][initialize] dependenciesAndElements failed', err, { context: MODULE_CONTEXT });
            throw err;
        }

        _doc = domAPI.getDocument?.();
        if (state.initialized) return;

        // Try primary id, then legacy, then any matching selector
        element =
            domAPI.getElementById(elementId) ||
            domAPI.getElementById(ELEMENT_IDS[1]) ||
            domAPI.querySelector('#projectListView, .project-list-container');

        if (!element) {
            logger.error(`[ProjectListComponent] Element #${elementId} not found. Cannot initialize.`, null, { context: MODULE_CONTEXT });
            throw new Error(`[ProjectListComponent] Element #${elementId} not found. Cannot initialize.`);
        }
        if (element.classList.contains('mobile-grid')) {
            gridElement = element;
        } else if (domAPI?.querySelector) {
            gridElement = domAPI.querySelector('.mobile-grid', element);
        } else {
            gridElement = element.querySelector('.mobile-grid');
        }

        if (!gridElement) {
            logger.error(`'.mobile-grid' container not found within .project-list-container.`, null, { context: MODULE_CONTEXT });
            throw new Error(`'.mobile-grid' container not found within .project-list-container.`);
        }

        _bindEventListeners();
        _bindCreateProjectButtons();

        _setState({ initialized: true });

        eventBus.dispatchEvent(new CustomEvent('initialized', { detail: { success: true } }));

        try {
            const doc = domAPI.getDocument();
            if (doc) {
                domAPI.dispatchEvent(doc, new CustomEvent('projectListComponentInitialized', { detail: { success: true } }));
            }
        } catch (err) {
            logger.error('[ProjectListComponent] Failed to dispatch initialized event', err, { context: MODULE_CONTEXT });
        }

        // Remove any local isAuthenticated flags, always use appModule.state.isAuthenticated or listen to auth.AuthBus

        if (app?.DependencySystem?.modules?.get?.('appModule')?.state?.isAuthenticated) {
            _loadProjects();
        } else {
            _showLoginRequired();
        }
    }

    function _safeSetInnerHTML(el, rawHtml) {
        domAPI.setInnerHTML(el, rawHtml);
    }
    function _clearElement(el) {
        el.textContent = "";
    }
    function _bindEventListeners() {
        const doc = domAPI?.getDocument?.();
        const safeHandler = app?.DependencySystem?.modules?.get?.('safeHandler');
        const projectsLoadedHandler = (e) => renderProjects(e.detail);

        eventHandlers.trackListener(
            doc,
            "projectsLoaded",
            safeHandler(projectsLoadedHandler, 'ProjectListComponent:projectsLoaded'),
            { context: MODULE_CONTEXT }
        );
        eventHandlers.trackListener(
            gridElement,
            "click",
            safeHandler((e) => _handleCardClick(e), 'ProjectListComponent:gridElement:click'),
            { context: MODULE_CONTEXT }
        );
        eventHandlers.trackListener(
            doc,
            "projectCreated",
            safeHandler((e) => _handleProjectCreated(e.detail), 'ProjectListComponent:projectCreated'),
            { context: MODULE_CONTEXT }
        );
        eventHandlers.trackListener(
            doc,
            "projectUpdated",
            safeHandler((e) => _handleProjectUpdated(e.detail), 'ProjectListComponent:projectUpdated'),
            { context: MODULE_CONTEXT }
        );

        const handleAuthStateChange = async (e) => {
            const { authenticated } = e.detail || {};
            if (authenticated) {
                try {
                    await domReadinessService.dependenciesAndElements({
                        deps: ['app', 'projectManager', 'eventHandlers', 'auth'],
                        domSelectors: [
                            '.project-list-container', '.mobile-grid', '#projectFilterTabs'
                        ],
                        timeout: 10000,
                        context: MODULE_CONTEXT + '_authStateChange'
                    });
                    if (!state.initialized) {
                        await initialize();
                    }
                    await show();
                    await _loadProjects();
                } catch (err) {
                    logger.error('[ProjectListComponent][handleAuthStateChange] App or DOM readiness failed (post-auth)', err, { context: MODULE_CONTEXT });
                }
            } else {
                _showLoginRequired();
            }
        };

        // Listen to both variants.
        eventHandlers.trackListener(doc, "authStateChanged", safeHandler(handleAuthStateChange, 'ProjectListComponent:authStateChanged'), { context: MODULE_CONTEXT });
        eventHandlers.trackListener(doc, "auth:stateChanged", safeHandler(handleAuthStateChange, 'ProjectListComponent:auth:stateChanged'), { context: MODULE_CONTEXT });

        _bindFilterEvents();

        // Re-bind when template HTML arrives
        eventHandlers.trackListener(
            domAPI.getDocument(),
            'projectListHtmlLoaded',
            () => {
                _bindFilterEvents();
                if (!gridElement) {
                    const parent =
                        element ||
                        domAPI.getElementById(elementId) ||
                        domAPI.querySelector('#projectListView, .project-list-container');
                    if (parent) gridElement = domAPI.querySelector('.mobile-grid', parent);
                }
            },
            { once: true, context: MODULE_CONTEXT, description: 'rebindFilterTabsAfterTemplate' }
        );
    }
    function _bindFilterEvents() {
        const container = domAPI?.getElementById ? domAPI.getElementById("projectFilterTabs") : domAPI.getElementById("projectFilterTabs");
        if (!container) return;
        const tabs = domAPI?.querySelectorAll
            ? [...domAPI.querySelectorAll(".tab[data-filter]", container)]
            : [...container.querySelectorAll(".tab[data-filter]")];
        tabs.forEach(tab => _bindSingleFilterTab(tab, tab.dataset.filter));
        _bindFilterTablistKeyboardNav(container, tabs);
    }
    function _bindSingleFilterTab(tab, filterValue) {
        if (!filterValue) return;
        const clickHandler = () => _setFilter(filterValue);
        eventHandlers.trackListener(tab, "click", clickHandler, { context: MODULE_CONTEXT + ':bindSingleFilterTab:click' });

        eventHandlers.trackListener(tab, "keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                _setFilter(filterValue);
                tab.focus();
            }
        }, { context: MODULE_CONTEXT + ':bindSingleFilterTab:keydown' });
    }
    function _bindFilterTablistKeyboardNav(container, tabs) {
        eventHandlers.trackListener(container, "keydown", (event) => {
            const currentTab = (_doc || domAPI.getDocument()).activeElement;
            if (!tabs.includes(currentTab)) return;
            let idx = tabs.indexOf(currentTab);
            if (event.key === "ArrowRight" || event.key === "Right") {
                event.preventDefault();
                const nextIdx = (idx + 1) % tabs.length;
                tabs[nextIdx].focus();
            } else if (event.key === "ArrowLeft" || event.key === "Left") {
                event.preventDefault();
                const prevIdx = (idx - 1 + tabs.length) % tabs.length;
                tabs[prevIdx].focus();
            } else if (event.key === "Home") {
                event.preventDefault();
                tabs[0].focus();
            } else if (event.key === "End") {
                event.preventDefault();
                tabs[tabs.length - 1].focus();
            }
        }, { context: MODULE_CONTEXT + ':bindFilterTablistKeyboardNav' });
    }
    function _setFilter(filter) {
        _setState({ filter });
        _updateActiveTab();
        _updateUrl(filter);
        _loadProjects();
    }
    function _updateActiveTab() {
        const tabs = domAPI?.querySelectorAll
            ? domAPI.querySelectorAll("#projectFilterTabs .tab[data-filter]")
            : domAPI.querySelectorAll("#projectFilterTabs .tab[data-filter]");

        let activeTabId = null;
        tabs.forEach((tab) => {
            const isActive = tab.dataset.filter === state.filter;
            tab.classList.toggle("tab-active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
            tab.setAttribute("tabindex", isActive ? "0" : "-1");
            if (isActive) activeTabId = tab.id;
        });

        const mobileGridPanel = domAPI?.querySelector
            ? domAPI.querySelector(".mobile-grid", element)
            : element.querySelector(".mobile-grid");
        if (mobileGridPanel && activeTabId) {
            mobileGridPanel.setAttribute("aria-labelledby", activeTabId);
        }
    }
    function _updateUrl(filter) {
        try {
            if (app?.DependencySystem?.modules?.get?.('navigationService') &&
                typeof app.DependencySystem.modules.get('navigationService').updateUrlParams === 'function'
            ) {
                app.DependencySystem.modules.get('navigationService').updateUrlParams({ filter }, true);
            }
        } catch (e) {
            logger.error('[ProjectListComponent] updateUrlParams failed', e, { context: MODULE_CONTEXT });
        }
    }
    function renderProjects(data) {
        if (isRendering) return;
        isRendering = true;
        try {
            if (data && data.error && data.reason === 'auth_required') {
                _showLoginRequired();
                return;
            }
            if (data && data.error && typeof data.error === 'string') {
                _showErrorState(data.error || "Failed to load projects.");
                return;
            }
            const projects = _extractProjects(data);
            _setState({ projects: projects || [] });

            if (!gridElement) return;
            if (!projects?.length) {
                _showEmptyState();
                return;
            }
            _clearElement(gridElement);
            const fragment = (_doc || domAPI.getDocument()).createDocumentFragment();
            projects.forEach((_project) => {
                if (_project && typeof _project === "object")
                    fragment.appendChild(_createProjectCard(_project));
            });
            gridElement.appendChild(fragment);
            _makeVisible();
        } catch (err) {
            logger.error('[ProjectListComponent][renderProjects]', err, { context: MODULE_CONTEXT });
        } finally {
            isRendering = false;
        }
    }
    function _makeVisible() {
        if (gridElement) {
            gridElement.classList.remove("hidden");
            gridElement.style.display = "";
        }
        if (element) {
            element.classList.remove("hidden", "opacity-0");
            element.style.opacity = '1';
            element.style.display = "";
        }
    }
    function _extractProjects(data) {
        if (Array.isArray(data)) return data;
        const paths = ["projects", "data.projects", "data"];
        for (let path of paths) {
            const segments = path.split(".");
            let result = data;
            let valid = true;
            for (let seg of segments) {
                if (result && typeof result === "object" && seg in result) {
                    result = result[seg];
                } else {
                    valid = false;
                    break;
                }
            }
            if (valid && Array.isArray(result)) return result;
            if (valid && result && typeof result === "object" && result.id) {
                return [result];
            }
        }
        return [];
    }
    async function show() {
        if (isRendering) return;
        if (!state.initialized) {
            try {
                await initialize();
            } catch (err) {
                logger.error('[ProjectListComponent][show] initialize failed', err, { context: MODULE_CONTEXT });
            }
        }
        if (!gridElement) {
            const parentElement = element || domAPI.getElementById(elementId) || domAPI.getElementById(elementId);
            if (parentElement) {
                gridElement = parentElement.querySelector('.mobile-grid');
                if (!gridElement) {
                    const grid = domAPI?.createElement ?
                        domAPI.createElement('div') :
                        domAPI.createElement('div');
                    grid.className = "mobile-grid";
                    grid.setAttribute('role', 'tabpanel');
                    grid.setAttribute('aria-labelledby', 'filterTabAll');
                    grid.setAttribute('tabindex', '0');
                    parentElement.appendChild(grid);
                    gridElement = grid;
                }
            } else {
                logger.error('[ProjectListComponent][show] failed to create/find mobileGridElement', null, { context: MODULE_CONTEXT });
                return;
            }
        }
        try {
            await domReadinessService.elementsReady(
                ['#projectCardsPanel', '#projectFilterTabs'],
                { timeout: 5000, context: MODULE_CONTEXT + '_show' }
            );
        } catch (err) {
            logger.error('[ProjectListComponent][show] elementsReady failed', err, { context: MODULE_CONTEXT });
        }

        // CONSOLIDATED: Check authentication state before showing content
        const appModule = app?.DependencySystem?.modules?.get?.('appModule');
        const isAuthenticated = appModule?.state?.isAuthenticated ?? false;

        logger.debug('[ProjectListComponent][show] Checking auth state before showing content', {
            isAuthenticated,
            hasProjects: !!(state.projects && state.projects.length > 0),
            context: MODULE_CONTEXT
        });

        if (!isAuthenticated) {
            _showLoginRequired();
            return;
        }

        _makeVisible();
        if (state.projects && state.projects.length > 0 && !isRendering) {
            try {
                renderProjects(state.projects);
            } catch (err) {
                logger.error('[ProjectListComponent][show] renderProjects failed', err, { context: MODULE_CONTEXT });
            }
        } else if (!state.projects || state.projects.length === 0) {
            _loadProjects();
        }
    }
    async function _loadProjects() {
        try {
            await domReadinessService.dependenciesAndElements({
                deps: ['auth'],
                context: MODULE_CONTEXT + '_loadProjects'
            });

            // CONSOLIDATED: Check authentication state before loading projects
            const appModule = app?.DependencySystem?.modules?.get?.('appModule');
            const isAuthenticated = appModule?.state?.isAuthenticated ?? false;

            if (!isAuthenticated) {
                logger.debug('[ProjectListComponent][_loadProjects] User not authenticated, showing login required', { context: MODULE_CONTEXT });
                _showLoginRequired();
                return;
            }

            if (state.loading) return;
            if (!projectManager?.loadProjects) return;
            _setState({ loading: true });
            _showLoadingState();
            await projectManager.loadProjects(state.filter);
        } catch (error) {
            logger.error('[ProjectListComponent][_loadProjects] Failed to load projects', error, { context: MODULE_CONTEXT });
            _showErrorState("Failed to load projects");
        } finally {
            _setState({ loading: false });
        }
    }
    function _handleAction(action, projectId) {
        const project = state.projects.find(
            (p) => String(_getProjectId(p)) === projectId
        );
        if (!project) return;
        switch (action) {
            case "view":
                onViewProject(_getProjectId(project));
                break;
            case "edit":
                _openEditModal(project);
                break;
            case "delete":
                _confirmDelete(project);
                break;
            default:
        }
    }
    function _handleCardClick(e) {
        const projectCard = e.target.closest('.project-card');
        if (!projectCard) { return; }
        const projectId = projectCard.dataset.projectId;
        if (!projectId) { return; }
        const actionBtn = e.target.closest("[data-action]");
        if (actionBtn) { e.stopPropagation(); return; }
        const isCreateButton = e.target.closest('#createProjectBtn');
        if (isCreateButton) { return; }
        // CONSOLIDATED: Single source of truth - only check app.state
        const appModule = app?.DependencySystem?.modules?.get?.('appModule');
        if (appModule?.state?.isAuthenticated) {
            onViewProject(projectId);
        } else {
            eventBus.dispatchEvent(new CustomEvent("requestLogin"));
        }
    }
    function _handleProjectCreated(project) {
        if (!project) return;
        _setState({ projects: [project, ...state.projects] });
        renderProjects(state.projects);
    }
    function _handleProjectUpdated(updatedProject) {
        if (!updatedProject) return;
        const idx = state.projects.findIndex(
            (p) => String(_getProjectId(p)) === String(_getProjectId(updatedProject))
        );
        if (idx >= 0) {
            const newProjects = [...state.projects];
            newProjects[idx] = updatedProject;
            _setState({ projects: newProjects });
            renderProjects(state.projects);
        }
    }
    function _bindCreateProjectButtons() {
        if (!modalManager) return;
        if (!eventHandlers?.trackListener)
            throw new Error("[ProjectListComponent] eventHandlers.trackListener is required for button events.");

        // Event-delegation via a single tracked listener
        eventHandlers.trackListener(
            domAPI.getDocument(),
            'click',
            (e) => {
                const btn = e.target.closest('#createProjectBtn');
                if (btn) _openNewProjectModal();
            },
            { context: MODULE_CONTEXT, description: 'delegate:createProjectBtn' }
        );
    }
    function _openNewProjectModal() {
        if (!modalManager?.show) { return; }
        modalManager.show("project");
    }
    function _openEditModal(project) {
        if (!modalManager?.show) { return; }
        modalManager.show("project", {
            updateContent: (modalEl) => {
                const nameInput = modalEl.querySelector("#projectModalNameInput");
                if (nameInput) nameInput.value = project.name || "";
            }
        });
    }
    async function _confirmDelete(project) {
        if (modalManager?.confirmAction) {
            let ok = false;
            try {
                ok = await new Promise(resolve => {
                    modalManager.confirmAction({
                        title: `Delete "${project.name}"?`,
                        message: `This cannot be undone.`,
                        confirmText: "Delete",
                        confirmClass: "btn-error",
                        onConfirm: () => resolve(true),
                        onCancel: () => resolve(false)
                    });
                });
            } catch (err) {
                logger.error('[ProjectListComponent][_confirmDelete]', err, { context: MODULE_CONTEXT });
            }
            if (ok) _executeDelete(project.id);
        }
    }
    async function _executeDelete(projectId) {
        if (!projectManager?.deleteProject) return;
        try {
            await projectManager.deleteProject(projectId);
            _loadProjects();
        } catch (err) {
            logger.error('[ProjectListComponent][_executeDelete]', err, { context: MODULE_CONTEXT });
        }
    }
    function _showLoadingState() {
        if (!gridElement) return;
        _clearElement(gridElement);
        gridElement.classList.add("mobile-grid");
        for (let i = 0; i < 6; i++) {
            const skeleton = domAPI.createElement("div");
            skeleton.className = "bg-base-200 animate-pulse rounded-box p-4 mb-2 max-w-full w-full";
            const raw = `
              <div class="h-6 bg-base-300 rounded w-3/4 mb-3"></div>
              <div class="h-4 bg-base-300 rounded w-full mb-2"></div>
              <div class="h-4 bg-base-300 rounded w-2/3 mb-2"></div>
              <div class="h-3 bg-base-300 rounded w-1/3 mt-6"></div>
            `;
            _safeSetInnerHTML(skeleton, raw);
            gridElement.appendChild(skeleton);
        }
    }
    function _showEmptyState() {
        _makeVisible();
        if (!gridElement) return;
        _clearElement(gridElement);
        gridElement.classList.add("mobile-grid");
        const emptyDiv = domAPI.createElement("div");
        emptyDiv.className = "project-list-empty";
        _safeSetInnerHTML(emptyDiv, `
          <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p class="mt-4 text-lg text-base-content">No projects found</p>
          <p class="mt-1">Create a new project to get started</p>
          <button id="createProjectBtn" class="btn btn-primary mt-4">Create Project</button>
        `);
        gridElement.appendChild(emptyDiv);
        const createBtn = domAPI.getElementById("createProjectBtn");
        if (createBtn) {
            eventHandlers.trackListener(
                createBtn,
                "click",
                () => _openNewProjectModal(),
                { context: MODULE_CONTEXT + ':showEmptyState:createBtn' }
            );
        }
    }
    function _showLoginRequired() {
        if (!element) return;
        _clearElement(element);
        element.classList.add("grid", "project-list");
        const loginDiv = domAPI.createElement("div");
        loginDiv.className = "project-list-fallback";
        _safeSetInnerHTML(loginDiv, `
          <p class="mt-4 text-lg">Please log in to view your projects</p>
          <button id="loginButton" class="btn btn-primary mt-4">Login</button>
        `);
        element.appendChild(loginDiv);
        const loginBtn = domAPI.getElementById("loginButton");
        if (loginBtn) {
            eventHandlers.trackListener(
                loginBtn,
                "click",
                (e) => {
                    e.preventDefault();

                    // Bubble the request up to global listeners so ModalManager can react
                    const doc = domAPI.getDocument();
                    if (doc && typeof domAPI.dispatchEvent === 'function') {
                        domAPI.dispatchEvent(doc, new CustomEvent('requestLogin'));
                    }

                    // Keep local bus notification (optional, component-internal)
                    eventBus.dispatchEvent(new CustomEvent('requestLogin'));
                },
                { context: MODULE_CONTEXT, description: 'loginBtn:requestLogin' }
            );
        }
    }
    function _showErrorState(message) {
        if (!element) return;
        _clearElement(element);
        element.classList.add("grid", "project-list");
        const msg = message || "An unknown error occurred.";
        const errorDiv = domAPI.createElement("div");
        errorDiv.className = "project-list-error";
        _safeSetInnerHTML(errorDiv, `
          <svg class="w-16 h-16 mx-auto text-error/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="mt-4 text-lg text-error">${msg}</p>
          <button id="retryButton" class="btn btn-outline btn-error mt-4">Retry</button>
          <div class="mt-4 text-sm text-base-content/70">
            If the issue persists, check console logs for more details.
          </div>
        `);
        element.appendChild(errorDiv);
        const retryBtn = domAPI.getElementById("retryButton");
        if (retryBtn) {
            eventHandlers.trackListener(
                retryBtn,
                "click",
                () => _loadProjects(),
                { context: MODULE_CONTEXT + ':showErrorState:retryBtn' }
            );
        }
    }
    function _createProjectCard(project) {
        const card = domAPI.createElement("div");
        card.className = _computeCardClasses(project);
        const projectId = _getProjectId(project) ?? "";
        card.dataset.projectId = String(projectId);
        card.append(
            _buildCardHeader(project),
            _buildCardDescription(project),
            _buildCardFooter(project)
        );
        return card;
    }
    function _computeCardClasses(_project) {
        const theme = state.customization.theme || "default";
        const themeBg = theme === "default" ? "bg-base-100" : `bg-${theme}`;
        const themeText = theme === "default" ? "text-base-content" : `text-${theme}-content`;
        return `project-card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-all border border-base-300 rounded-box p-4 flex flex-col h-full mb-3 max-w-full w-full overflow-hidden`;
    }
    function _buildCardHeader(project) {
        const header = domAPI.createElement("div");
        header.className = "flex justify-between items-start";
        const titleEl = domAPI.createElement("h3");
        titleEl.className = "font-semibold text-lg sm:text-xl mb-2 project-name truncate";
        titleEl.textContent = project.name || project.title || "Unnamed Project";
        const actions = domAPI.createElement("div");
        actions.className = "flex gap-1";
        const projectId = _getProjectId(project);
        [
            {
                action: "view",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5
                       c4.478 0 8.268 2.943 9.542 7
                       -1.274 4.057-5.064 7-9.542 7
                       -4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          `,
                label: "View Project"
            },
            {
                action: "edit",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                       m-1.414-9.414a2 2 0 112.828 2.828
                       L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          `,
                label: "Edit Project"
            },
            {
                action: "delete",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                       a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
                       a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          `,
                label: "Delete Project",
                className: "text-error hover:bg-error/10"
            }
        ].forEach((btnDef) => {
            actions.appendChild(_createActionButton({ ...btnDef, projectId }));
        });
        header.appendChild(titleEl);
        header.appendChild(actions);
        return header;
    }
    function _buildCardDescription(project) {
        if (state.customization.showDescription && project.description) {
            const description = domAPI.createElement("p");
            description.className = "text-sm text-base-content/70 mb-3 line-clamp-2";
            description.textContent = project.description;
            return description;
        }
        return domAPI.createElement("span");
    }
    function _buildCardFooter(project) {
        const footer = domAPI.createElement("div");
        footer.className = "mt-auto pt-2 flex justify-between text-xs text-base-content/70";
        if (state.customization.showDate && project.updated_at) {
            const dateEl = domAPI.createElement("span");
            dateEl.textContent = _formatDate(project.updated_at);
            footer.appendChild(dateEl);
        }
        const badges = domAPI.createElement("div");
        badges.className = "flex gap-1";
        if (project.pinned) {
            const pinBadge = domAPI.createElement("span");
            pinBadge.textContent = "📌";
            pinBadge.classList.add("tooltip");
            pinBadge.dataset.tip = "Pinned";
            badges.appendChild(pinBadge);
        }
        if (project.archived) {
            const archiveBadge = domAPI.createElement("span");
            archiveBadge.textContent = "📦";
            archiveBadge.classList.add("tooltip");
            archiveBadge.dataset.tip = "Archived";
            badges.appendChild(archiveBadge);
        }
        footer.appendChild(badges);
        return footer;
    }
    function _createActionButton(btnDef) {
        const button = domAPI.createElement("button");
        button.className = `btn btn-ghost btn-xs btn-square min-w-[44px] min-h-[44px] ${btnDef.className || ""}`;
        button.setAttribute("aria-label", btnDef.label);
        button.dataset.action = btnDef.action;
        button.title = btnDef.label;
        let iconString = btnDef.icon;
        if (typeof iconString !== "string" || !iconString.trim()) {
            iconString = `<svg width="16" height="16" fill="currentColor"><rect width="16" height="16" fill="grey"/></svg>`;
        }
        _safeSetInnerHTML(button, iconString);
        eventHandlers.trackListener(button, 'click', (e) => {
            e.stopPropagation();
            _handleAction(btnDef.action, btnDef.projectId);
        }, { context: MODULE_CONTEXT + ':createActionButton:click' });
        return button;
    }
    function _formatDate(dateString) {
        if (!dateString) return "";
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch (err) {
            logger.error('[ProjectListComponent][_formatDate]', err, { context: MODULE_CONTEXT });
            return dateString;
        }
    }
    function _loadCustomization() {
        try {
            const saved = storage.getItem("projectCardsCustomization");
            return saved ? JSON.parse(saved) : _getDefaultCustomization();
        } catch (err) {
            logger.error('[ProjectListComponent][_loadCustomization]', err, { context: MODULE_CONTEXT });
            return _getDefaultCustomization();
        }
    }
    function _getDefaultCustomization() {
        return {
            theme: "default",
            showDescription: true,
            showDate: true
        };
    }
    // --- Navigation callback can be overridden after creation ---
    function onViewProject(projectObjOrId) {
        const projectId = (typeof projectObjOrId === "object" && projectObjOrId.id) ? projectObjOrId.id : projectObjOrId;
        // --- Set project context before navigation ---
        const appModule = app?.DependencySystem?.modules?.get?.('appModule');
        if (appModule && typeof appModule.setCurrentProject === "function") {
            // Already have project object
            if (typeof projectObjOrId === "object" && projectObjOrId.id) {
                appModule.setCurrentProject(projectObjOrId);
            } else if (projectId) {
                // Try to locate project object in state
                const projectObj = state.projects.find(p => {
                    const pid = p?.uuid ?? p?.id ?? p?.project_id ?? p?.ID ?? null;
                    return String(pid) === String(projectId);
                });
                if (projectObj) {
                    appModule.setCurrentProject(projectObj);
                } else {
                    appModule.setCurrentProject({ id: projectId });
                }
            }
        }
        if (app?.DependencySystem?.modules?.get?.('navigationService')
            && typeof app.DependencySystem.modules.get('navigationService').navigateToProject === "function"
        ) {
            app.DependencySystem.modules.get('navigationService').navigateToProject(projectId);
        }
    }
    // --- Exposed cleanup API per .clinerules ---
    function destroy() {
        if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
            eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
        }
        if (domReadinessService && typeof domReadinessService.destroy === 'function') {
            domReadinessService.destroy();
        }
        _setState({ initialized: false });
    }

    return {
        initialize,
        destroy,
        renderProjects, // for test/debug
        show,
        onViewProject, // can be overridden
        eventBus,
        setProjectManager: (pm) => {
            projectManager = pm;
        }
    };
}

// No top-level logic, no test/polyfill code outside factory per .clinerules.
