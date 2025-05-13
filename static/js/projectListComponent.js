/**
 * ProjectListComponent
 * Handles rendering and interaction with the project list UI.
 *
 * External dependencies required (directly or indirectly):
 *
 * Required (throws error if missing):
 * • projectManager – expected methods: loadProjects(filter), deleteProject(id)
 * • eventHandlers – at least trackListener(…) (+ optional cleanup)
 * • router – navigate(url) and getURL()
 * • notify – with .withContext() returning { debug, info, warn, error, success }
 * • storage – getItem(k), setItem(k,v)
 * • sanitizer – sanitize(html)
 *
 * Optional but used:
 * • modalManager – show(modalName, opts), confirmAction(opts)
 * • app – setCurrentProjectId(id) and app.state.{isAuthenticated,currentUser}, app.config.debug
 * • apiClient – patch(url, body)
 * • domAPI – wrapper with:
 *   · getElementById, querySelector, querySelectorAll, createElement, getDocument, addClass, removeClass, setTextContent, preventDefault
 *   (falls back to global document if missing)
 * • browserService – only stored; not used yet in shown code
 * • globalUtils – same: received but not used
 *
 * Implicit global environments/objects:
 * • document (global) – fallback when domAPI is not provided
 * • window (only in comments/tests)
 *
 * External events expected:
 * • Fires/listens to DOM events: projectsLoaded, projectCreated, projectUpdated, authStateChanged, projectlistcomponent:initialized, requestLogin.
 *
 * There are no other hidden external dependencies.
 *
 * Usage:
 *   import { ProjectListComponent } from './projectListComponent.js';
 *   const projectList = new ProjectListComponent({
 *     projectManager,
 *     eventHandlers,
 *     modalManager,
 *     app,
 *     router,
 *     notify,
 *     storage,
 *     sanitizer
 *   });
 *   projectList.initialize();
 */

const MODULE_CONTEXT = "ProjectListComponent";

export class ProjectListComponent {
    /**
     * @param {Object} deps
     * @param {Object} deps.projectManager       - ProjectManager instance (required)
     * @param {Object} deps.eventHandlers        - EventHandlers instance (required)
     * @param {Object} deps.modalManager         - ModalManager instance (optional)
     * @param {Object} deps.app                  - App instance (optional)
     * @param {Object} deps.router               - Router abstraction (required)
     * @param {Object} deps.notify               - DI notification interface (required: success, error, warn, info, etc)
     * @param {Object} deps.storage              - Storage abstraction (required)
     * @param {Object} deps.sanitizer            - HTML sanitizer abstraction (required)
     * @param {Object} deps.apiClient            - API client abstraction (required for preference patch)
     */
    constructor({
        projectManager,
        eventHandlers,
        modalManager,
        app,
        router,
        notify,
        storage,
        sanitizer,
        apiClient,
        domAPI,
        browserService,
        errorReporter      = null,   // ← NEW
        backendLogger      = null,   // ← NEW
        globalUtils
    } = {}) {
        // Assign DI fields before any usage
        this.projectManager = projectManager;
        this.eventHandlers = eventHandlers;
        this.modalManager = modalManager;
        this.app = app;
        this.router = router;
        this.browserService = browserService;
        this.globalUtils = globalUtils;
        this.errorReporter = errorReporter;
        this.backendLogger = backendLogger;
        this.eventBus      = new EventTarget();   // ← dedicated intra-module bus

        if (!domAPI) throw new Error("[ProjectListComponent] domAPI injection is mandatory.");
        this.domAPI  = domAPI;
        this._doc    = null;     // set after app-ready in initialize()

        this.DependencySystem = app?.DependencySystem || eventHandlers?.DependencySystem; // Get DependencySystem from app or eventHandlers
        this.navigationService = this.DependencySystem?.modules?.get('navigationService');


        // DI notify: use context/group everywhere; see notification-system.md
        this.notify = notify.withContext({ context: 'projectListComponent', module: 'ProjectListComponent' });
        this.apiClient = apiClient;

        this.storage = storage;
        this.htmlSanitizer = sanitizer;

        // --- DI-logged construction ---
        const constructorContext = { group: true, context: 'projectListComponent', module: 'ProjectListComponent', source: 'constructor' };
        if (this.appConfig && this.appConfig.DEBUG) {
            this.notify.info('[ProjectListComponent] CONSTRUCTOR called', { ...constructorContext, stack: (new Error()).stack });
        } else {
            this.notify.info('[ProjectListComponent] CONSTRUCTOR called', constructorContext);
        }

        this.notify.debug('[ProjectListComponent] Optional dependencies status:', {
            group: false, // Keep constructor logs less noisy
            context: 'projectListComponent', module: 'ProjectListComponent', source: 'constructor',
            extra: {
                modalManager: !!this.modalManager,
                app: !!this.app,
                apiClient: !!this.apiClient,
                domAPI: !!this.domAPI
            }
        });

        if (this.backendLogger && typeof this.backendLogger.log === 'function') {
          this.backendLogger.log({
            level  : 'info',
            module : 'ProjectListComponent',
            message: 'constructor'
          });
        }

        if (
            !this.projectManager ||
            !this.eventHandlers ||
            !this.router ||
            !this.storage ||
            !this.htmlSanitizer
        ) {
            this.notify.error(
                '[ProjectListComponent] Missing required dependencies: projectManager, eventHandlers, router, notificationHandler, storage, sanitizer are required.',
                { group: true, context: 'projectListComponent' }
            );
            throw new Error(
                "[ProjectListComponent] Missing required dependencies: projectManager, eventHandlers, router, notificationHandler, storage, sanitizer are required."
            );
        }
        if (typeof this.htmlSanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] htmlSanitizer must provide a .sanitize(html) method.");
        }

        // Default navigation callback - now triggers details load then navigation
        this.onViewProject = (projectObjOrId) => {
            const projectId = (typeof projectObjOrId === "object" && projectObjOrId.id) ? projectObjOrId.id : projectObjOrId;
            this.notify.info(`[ProjectListComponent] onViewProject called for projectId: ${projectId}. Using NavigationService.`, { group: true, context: 'projectListComponent' });

            if (this.navigationService && typeof this.navigationService.navigateToProject === "function") {
                this.navigationService.navigateToProject(projectId);
            } else {
                this.notify.error("[ProjectListComponent] NavigationService.navigateToProject is not available.", { group: true, context: 'projectListComponent' });
                // Fallback or further error handling if NavigationService is critical and missing
            }
        };

        this.elementId = "projectList";
        this.state = {
            projects: [],
            filter: "all",
            loading: false,
            customization: this._loadCustomization(),
            initialized: false
        };
        this.element = null;
    }

    _captureError(err, source){
      this.errorReporter?.capture?.(err, {
        module : 'ProjectListComponent',
        context: 'projectListComponent',
        source
      });
    }

    _setState(partial){
      this.state = { ...this.state, ...partial };
    }

    /** Resolve the canonical identifier we should send to router / API */
    _getProjectId(p) {
      return p?.uuid ?? p?.id ?? p?.project_id ?? p?.ID ?? null;
    }

    /** Initialize component once DOM has #projectList */
    async initialize() { // Changed to async
        if (this.DependencySystem?.waitFor)
          await this.DependencySystem.waitFor(['app:ready']);
        this._doc = this.domAPI.getDocument?.();
        // --- DI-logged initialization ---
        if (this.appConfig && this.appConfig.DEBUG) {
            this.notify.info('[ProjectListComponent] INITIALIZE called', {
                group: true, context: 'projectListComponent', stack: (new Error()).stack
            });
        } else {
            this.notify.info('[ProjectListComponent] INITIALIZE called', {
                group: true, context: 'projectListComponent'
            });
        }
        if (this.state.initialized) {
            if (this.app?.config?.debug) {
                this.notify.info('[ProjectListComponent] Already initialized.', { group: true, context: 'projectListComponent' });
            }
            this.notify.info('Project list is already initialized.', { group: true, context: 'projectListComponent' });
            return;
        }

        const docAPI = this.domAPI;
        this._doc = docAPI.getDocument?.();
        this.element = docAPI?.getElementById
            ? docAPI.getElementById(this.elementId)
            : this._doc.getElementById(this.elementId);

        if (!this.element) {
            this.notify.error(
                `[ProjectListComponent] Main element #${this.elementId} not found. Initialization cannot proceed.`,
                { group: true, context: 'projectListComponent', source: 'initialize_findElement' }
            );
            throw new Error(
                `[ProjectListComponent] Element #${this.elementId} not found. Cannot initialize.`
            );
        } else {
            this.notify.info(`[ProjectListComponent] Main element #${this.elementId} found.`, { group: true, context: 'projectListComponent', source: 'initialize_findElement' });
        }

        // Use the root element itself as the grid if it has the .grid class
        if (this.element.classList.contains('grid')) {
            this.gridElement = this.element;
        } else if (docAPI?.querySelector) {
            this.gridElement = docAPI.querySelector('.grid', this.element);
        } else {
            this.gridElement = this.element.querySelector('.grid');
        }

        if (!this.gridElement) {
            this.notify.error(
                `[ProjectListComponent.INIT] '.grid' container not found inside #${this.elementId}. Element HTML might be: ${this.element.innerHTML.substring(0,100)}. Initialization cannot proceed.`,
                { group: true, context: 'projectListComponent', source: 'initialize_findGridElement' }
            );
            throw new Error(`'.grid' container not found within #${this.elementId}.`);
        } else {
            this.notify.info('[ProjectListComponent] gridElement found successfully.', { group: true, context: 'projectListComponent', source: 'initialize_findGridElement' });
        }

        // Wait for critical internal/sibling DOM elements to be ready
        // These are elements ProjectListComponent itself needs to bind to directly.
        // Assumes this.element (#projectList) is already confirmed by app.js's waitForDepsAndDom
        const criticalSelectors = ['#projectFilterTabs', '#projectListCreateBtn', '#emptyStateCreateBtn', '#loginButton', '#retryButton'];
        // Filter out selectors for elements that might not always be present (e.g., conditional UI)
        // For now, let's assume #projectFilterTabs and #projectListCreateBtn are essential for basic operation.
        // Others like #emptyStateCreateBtn are conditional.
        // A more robust solution might involve checking for their containers if the elements themselves are dynamic.
        const essentialSelectors = ['#projectFilterTabs', '#projectListCreateBtn'];

        try {
            await this.globalUtils.waitForDepsAndDom({
                DependencySystem: this.app?.DependencySystem || this.eventHandlers?.DependencySystem,
                domSelectors: essentialSelectors,
                timeout: 10000, // Increased timeout
                notify: this.notify,
                domAPI: docAPI, // Pass the injected domAPI
                source: 'ProjectListComponent_InternalDOMWait'
            });
            this.notify.info('[ProjectListComponent] Essential internal DOM elements ready.', { group: true, context: 'projectListComponent', selectors: essentialSelectors });
        } catch (err) {
            this._captureError(err, 'initialize');
            this.errorReporter?.capture?.(err, {
              module : 'ProjectListComponent',
              source : 'initialize',
              context: MODULE_CONTEXT
            });
            this.notify.error('[ProjectListComponent] Timeout or error waiting for essential internal DOM elements. Component initialization will halt.', {
                group: true, context: 'projectListComponent', originalError: err, selectors: essentialSelectors
            });
            // If essential selectors are not found, the component cannot initialize correctly.
            throw err; // Re-throw the error to stop initialization.
        }

        this._bindEventListeners();
        this._bindCreateProjectButtons();

        this._setState({ initialized: true });
        if (this.app?.config?.debug) {
            this.notify.info('[ProjectListComponent] Initialized successfully.', { group: true, context: 'projectListComponent' });
        }
        this.notify.success('Project list loaded.', { group: true, context: 'projectListComponent' });

        // --- Standardized "projectlistcomponent:initialized" event ---
        this.eventBus.dispatchEvent(new CustomEvent('initialized', { detail: { success: true } }));

        if (this.backendLogger && typeof this.backendLogger.log === 'function') {
          this.backendLogger.log({
            level  : 'info',
            module : 'ProjectListComponent',
            message: 'initialized'
          });
        }

        this._loadProjects();
    }

    /** Private helper: sanitize and set HTML */
    _safeSetInnerHTML(element, rawHtml) {
        if (!this.htmlSanitizer || typeof this.htmlSanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] Missing htmlSanitizer implementation");
        }
        if (typeof rawHtml !== "string" || !rawHtml.trim()) {
            this.notify.error("[ProjectListComponent] Tried to set innerHTML with non-string or empty input", {
                group: true, context: "projectListComponent", source: "_safeSetInnerHTML", element, rawHtml
            });
            throw new Error("[ProjectListComponent] _safeSetInnerHTML expected non-empty string");
        }
        try {
            element.innerHTML = this.htmlSanitizer.sanitize(rawHtml);
        } catch (err) {
            this._captureError(err, '_safeSetInnerHTML');
            this.errorReporter?.capture?.(err, {
              module : 'ProjectListComponent',
              source : '_safeSetInnerHTML',
              context: MODULE_CONTEXT
            });
            /* ------------------------------------------------------------------
             *  DOMPurify failed — fall back to safe plain-text insertion
             * ------------------------------------------------------------------ */
            this.notify.error("[ProjectListComponent] DOMPurify.sanitize failed – falling back to plain-text content", {
                group: true,
                context: "projectListComponent",
                source: "_safeSetInnerHTML",
                error: err,
                rawInputPreview: typeof rawHtml === "string" ? rawHtml.slice(0, 200) : ""
            });

            try {
                // Strip HTML tags with a simple regex and insert as plain text
                const plain = typeof rawHtml === "string"
                    ? rawHtml.replace(/<[^>]*>/g, "")
                    : String(rawHtml);
                element.textContent = plain;
            } catch (innerErr) {
                this._captureError(innerErr, '_safeSetInnerHTML_fallback');
                this.errorReporter?.capture?.(innerErr, {
                  module : 'ProjectListComponent',
                  source : '_safeSetInnerHTML_fallback',
                  context: MODULE_CONTEXT
                });
                // As a last resort, clear the element
                element.textContent = "";
                this.notify.error("[ProjectListComponent] Fallback plain-text insertion also failed", {
                    context: "projectListComponent",
                    source: "_safeSetInnerHTML_fallback",
                    error: innerErr
                });
            }
            // Do NOT re-throw – allow rendering to continue and avoid recursive loops
        }
    }

    /** Private helper: clear element content */
    _clearElement(element) {
        element.textContent = "";
    }

    /** Bind core event listeners */
    _bindEventListeners() {
        const docAPI = this.domAPI;
        const doc = docAPI?.getDocument?.();
        const projectsLoadedHandler = (e) => this.renderProjects(e.detail);
        this.eventHandlers.trackListener(
            doc,
            "projectsLoaded",
            projectsLoadedHandler,
            { description: "ProjectList: projectsLoaded", context: MODULE_CONTEXT }
        );

        // Fix: Attach the click handler to the grid, not #projectList root
        this.eventHandlers.trackListener(
            this.gridElement,
            "click",
            (e) => this._handleCardClick(e),
            { description: "ProjectList: Card Click", context: MODULE_CONTEXT }
        );

        this.eventHandlers.trackListener(
            doc,
            "projectCreated",
            (e) => this._handleProjectCreated(e.detail),
            { description: "ProjectList: projectCreated", context: MODULE_CONTEXT }
        );
        this.eventHandlers.trackListener(
            doc,
            "projectUpdated",
            (e) => this._handleProjectUpdated(e.detail),
            { description: "ProjectList: projectUpdated", context: MODULE_CONTEXT }
        );

        this.eventHandlers.trackListener(
            doc,
            "authStateChanged",
            (e) => {
                const { authenticated, user, source } = e.detail || {};
                this.notify.debug(`[ProjectListComponent] Auth state changed: ${authenticated}, source: ${source || 'unknown'}`, {
                    authenticated,
                    userId: user?.id,
                    source: source || 'unknown'
                });

                if (authenticated) {
                    // Make sure the component is visible
                    this.show();

                    // Load projects with a small delay to ensure auth state is fully processed
                    setTimeout(() => {
                        this._loadProjects();
                        this.notify.info('[ProjectListComponent] Loading projects after authentication state change');
                    }, 100);
                } else {
                    // If not authenticated, show login required
                    this._showLoginRequired();
                    this.notify.info('[ProjectListComponent] Showing login required after authentication state change');
                }
            },
            { description: "ProjectList: authStateChanged", context: MODULE_CONTEXT }
        );

        this._bindFilterEvents();
    }

    /**
     * Bind filter tab clicks & ARIA tab keyboard navigation
     * Splits into per-tab and tablist helpers for testability and hygiene.
     */
    _bindFilterEvents() {
        const docAPI = this.domAPI;
        const container = docAPI?.getElementById
            ? docAPI.getElementById("projectFilterTabs")
            : docAPI.getElementById("projectFilterTabs");
        if (!container) return;
        const tabs = docAPI?.querySelectorAll
            ? [...docAPI.querySelectorAll(".tab[data-filter]", container)]
            : [...container.querySelectorAll(".tab[data-filter]")];
        tabs.forEach(tab => this._bindSingleFilterTab(tab, tab.dataset.filter));
        this._bindFilterTablistKeyboardNav(container, tabs);
    }

    /**
     * Wire click/activation events for a single filter tab.
     * @param {HTMLElement} tab
     * @param {string} filterValue
     * @private
     */
    _bindSingleFilterTab(tab, filterValue) {
        if (!filterValue) return;
        const clickHandler = () => this._setFilter(filterValue);
        this.eventHandlers.trackListener(tab, "click", clickHandler, {
            description: `ProjectList: Filter tab click (${filterValue})`, context: MODULE_CONTEXT
        });
        // Accessibility: handle keydown on individual tab for activation (Enter, Space)
        this.eventHandlers.trackListener(tab, "keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this._setFilter(filterValue);
                tab.focus();
            }
        }, {
            description: `ProjectList: Tab keydown (Enter/Space) activation (${filterValue})`, context: MODULE_CONTEXT
        });
    }

    /**
     * Global keyboard navigation for the whole tab-list (Arrow, Home, End).
     * @param {HTMLElement} container
     * @param {HTMLElement[]} tabs
     * @private
     */
    _bindFilterTablistKeyboardNav(container, tabs) {
        const docAPI = this.domAPI;
        this.eventHandlers.trackListener(container, "keydown", (event) => {
            const currentTab = (this._doc || docAPI.getDocument()).activeElement;
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
        }, {
            description: "ProjectList: ARIA tablist keyboard navigation", context: MODULE_CONTEXT
        });
    }

    /** Apply a new filter */
    _setFilter(filter) {
        this._setState({ filter });
        this._updateActiveTab();
        this._updateUrl(filter);
        this.notify.info(`Filter applied: ${filter}`, { group: true });
        this._loadProjects();
    }

    /** Visually highlight active tab & update tabindex/aria-labelledby for a11y */
    _updateActiveTab() {
        const docAPI = this.domAPI;
        const tabs = docAPI?.querySelectorAll
            ? docAPI.querySelectorAll("#projectFilterTabs .tab[data-filter]")
            : docAPI.querySelectorAll("#projectFilterTabs .tab[data-filter]");
        let activeTabId = null;
        tabs.forEach((tab) => {
            const isActive = tab.dataset.filter === this.state.filter;
            tab.classList.toggle("tab-active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
            tab.setAttribute("tabindex", isActive ? "0" : "-1");
            if (isActive) activeTabId = tab.id;
        });
        // Update aria-labelledby for the project card grid/tabpanel
        const projectCardsPanel = docAPI?.getElementById
            ? docAPI.getElementById("projectCardsPanel")
            : docAPI.getElementById("projectCardsPanel");
        if (projectCardsPanel && activeTabId) {
            projectCardsPanel.setAttribute("aria-labelledby", activeTabId);
        }
    }

    /** Update URL via router abstraction */
    _updateUrl(filter) {
        try {
            if (this.navigationService && typeof this.navigationService.updateUrlParams === 'function') {
                this.navigationService.updateUrlParams({ filter }, true); // true to replace history
                this.notify.debug(`[ProjectListComponent] Updated URL with filter: ${filter} using NavigationService.updateUrlParams.`, { group: true, context: 'projectListComponent' });
            } else {
                this.notify.warn('[ProjectListComponent] NavigationService.updateUrlParams not available for filter URL update.', { group: true, context: 'projectListComponent' });
                // Fallback to old router method if absolutely necessary and router is still a dependency
                // const current = this.router.getURL();
                // const url = new URL(current);
                // url.searchParams.set("filter", filter);
                // this.router.navigate(url.toString());
            }
        } catch (e) {
            this.errorReporter?.capture?.(e, {
              module : 'ProjectListComponent',
              source : '_updateUrl',
              context: MODULE_CONTEXT
            });
            this.notify.warn('[ProjectListComponent] Failed to update URL with filter', {
                group: true, context: 'projectListComponent', error: e
            });
        }
    }

    /** Render list of projects */
    renderProjects(data) {
        const docAPI = this.domAPI;
        // Track if we're already in a rendering cycle to prevent recursive loops
        if (this._isRendering) {
            this.notify.warn("[ProjectListComponent] Preventing recursive renderProjects call", {
                group: true,
                context: 'projectListComponent',
                source: 'renderProjects'
            });
            return;
        }

        this._isRendering = true;

        try {
            // Handle unauthenticated: projectManager emits { error: true, reason: 'auth_required' }
            if (data && data.error && data.reason === 'auth_required') {
                this._showLoginRequired();
                return;
            }

            // Handle generic errors passed in the event detail
            if (data && data.error && typeof data.error === 'string') {
                this.notify.error(`[ProjectListComponent] Received error in projectsLoaded event: ${data.error}`, {
                    group: true, context: 'projectListComponent', source: 'renderProjects', detail: data
                });
                this._showErrorState(data.error || "Failed to load projects.");
                return;
            }

            const projects = this._extractProjects(data);
            this._setState({ projects: projects || [] });

            if (!this.gridElement) {
                this.notify.error("[ProjectListComponent.renderProjects] Grid element not found.", {
                    group: true, context: 'projectListComponent'
                });
                return;
            }
            if (!projects?.length) {
                this._showEmptyState();
                this.notify.info("No projects found for this filter.", { group: true, context: 'projectListComponent' });
                return;
            }

            this._clearElement(this.gridElement);
            const fragment = (this._doc || docAPI.getDocument()).createDocumentFragment();
            projects.forEach((_project) => {
                if (_project && typeof _project === "object") {
                    fragment.appendChild(this._createProjectCard(_project));
                }
            });
            this.gridElement.appendChild(fragment);

            // Make the container visible without triggering another render cycle
            this._makeVisible();
        } catch (error) {
            this._captureError(error, 'renderProjects');
            this.errorReporter?.capture?.(error, {
              module : 'ProjectListComponent',
              source : 'renderProjects',
              context: MODULE_CONTEXT
            });
            this.notify.error("[ProjectListComponent.renderProjects] Error rendering projects", {
                group: true,
                context: 'projectListComponent',
                source: 'renderProjects',
                originalError: error
            });
        } finally {
            this._isRendering = false;
        }
    }

    /**
     * Helper method to make the component visible without triggering a render cycle
     * Extracted from show() to avoid recursive calls
     */
    _makeVisible() {
        const docAPI = this.domAPI;
        // Make the grid element visible
        if (this.gridElement) {
            this.gridElement.classList.remove("hidden");
        }

        // Make the main element visible
        if (this.element) { // This is #projectList
            this.element.classList.remove("hidden", "opacity-0"); // Ensure opacity-0 is also removed
            this.element.style.opacity = '1'; // Explicitly set opacity
        }

        // Ensure the main container #projectListView is also visible and opacity is reset
        const listViewContainer = docAPI?.getElementById("projectListView") || docAPI.getElementById("projectListView");
        if (listViewContainer) {
            listViewContainer.classList.remove("hidden", "opacity-0");
            listViewContainer.style.display = "";

            // Force a reflow to ensure CSS transitions apply
            void listViewContainer.offsetHeight;

            this.notify.debug("[ProjectListComponent._makeVisible] Made listViewContainer visible", {
                group: true,
                context: "projectListComponent",
                listViewClasses: listViewContainer.className,
                listViewDisplay: listViewContainer.style.display
            });
        } else {
            this.notify.warn("[ProjectListComponent._makeVisible] listViewContainer not found", {
                group: true,
                context: "projectListComponent"
            });
        }
    }

    /** Extract projects array/object */
    _extractProjects(data) {
        // No direct document usage here
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

    /** Show the list container */
    show() {
        const docAPI = this.domAPI;
        // Track if we're already in a show/render cycle to prevent recursive loops
        if (this._isRendering) {
            this.notify.warn("[ProjectListComponent] Preventing recursive show call during rendering", {
                group: true,
                context: 'projectListComponent',
                source: 'show'
            });
            return;
        }

        // Log the call to help with debugging
        this.notify.debug("[ProjectListComponent.show] Called", {
            group: true,
            context: "projectListComponent",
            hasGridElement: !!this.gridElement,
            hasElement: !!this.element
        });

        // Check if the grid element exists
        if (!this.gridElement) {
            this.notify.warn("[ProjectListComponent.show] grid element not found.", {
                group: true,
                context: "projectListComponent"
            });

            // Try to find or create the grid element
            const parentElement = this.element || docAPI?.getElementById(this.elementId) || docAPI.getElementById(this.elementId);
            if (parentElement) {
                // Look for existing grid
                this.gridElement = parentElement.querySelector('.grid');

                // If not found, create it
                if (!this.gridElement) {
                    this.notify.info("[ProjectListComponent.show] Creating missing grid element", {
                        group: true,
                        context: "projectListComponent"
                    });

                    const grid = docAPI?.createElement ?
                        docAPI.createElement('div') :
                        docAPI.createElement('div');

                    grid.className = "grid gap-6 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 py-2";
                    grid.setAttribute('id', 'projectCardsPanel');
                    grid.setAttribute('role', 'tabpanel');
                    grid.setAttribute('aria-labelledby', 'filterTabAll');
                    grid.setAttribute('tabindex', '0');

                    parentElement.appendChild(grid);
                    this.gridElement = grid;
                }
            } else {
                this.notify.error("[ProjectListComponent.show] Cannot find or create grid element - parent element not found", {
                    group: true,
                    context: "projectListComponent"
                });
                return;
            }
        }

        // Make the component visible using the shared helper
        this._makeVisible();

        // If we have projects, render them - but only if we're not already rendering
        if (this.state.projects && this.state.projects.length > 0 && !this._isRendering) {
            try {
                this.renderProjects(this.state.projects);
            } catch (error) {
                this._captureError(error, 'show');
                this.errorReporter?.capture?.(error, {
                  module : 'ProjectListComponent',
                  source : 'show',
                  context: MODULE_CONTEXT
                });
                this.notify.error("[ProjectListComponent.show] Error rendering projects", {
                    group: true,
                    context: 'projectListComponent',
                    source: 'show',
                    originalError: error
                });
            }
        } else if (!this.state.projects || this.state.projects.length === 0) {
            // If no projects, try to load them
            this._loadProjects();
        }

        this.notify.info('Project list is now visible.', { group: true, context: 'projectListComponent' });
    }

    /** Hide the list container */
    hide() {
        const docAPI = this.domAPI;
        if (this.gridElement) {
            this.gridElement.classList.add("hidden");
        }
        if (this.element) {
            this.element.classList.add("hidden");
        }
        const listViewContainer = docAPI?.getElementById("projectListView") || docAPI.getElementById("projectListView");
        // Ensure the main container #projectListView is also hidden
        if (listViewContainer) {
            listViewContainer.classList.add("hidden");
            listViewContainer.style.display = "none";
        }
        this.notify.info("Project list is now hidden.", { group: true, context: 'projectListComponent' });
    }

    /** Load projects via manager */
    async _loadProjects() {
        if (this.state.loading) return;
        if (!this.projectManager?.loadProjects) {
            this.notify.warn(
                "[ProjectListComponent] projectManager.loadProjects is missing.",
                { group: true, context: 'projectListComponent' }
            );
            return;
        }
        this._setState({ loading: true });
        this._showLoadingState();
        try {
            await this.projectManager.loadProjects(this.state.filter);
            this.notify.success("Projects loaded successfully.", { group: true, context: 'projectListComponent' });
        } catch (error) {
            this._captureError(error, '_loadProjects');
            this.errorReporter?.capture?.(error, {
              module : 'ProjectListComponent',
              source : '_loadProjects',
              context: MODULE_CONTEXT
            });
            // Enhanced error reporting with source, method, endpoint, and server details
            const status = error?.status || error?.response?.status;
            const detail = error?.detail || error?.response?.data?.detail || error?.response?.detail;
            const endpoint = this.projectManager?._CONFIG?.PROJECTS || '';
            let fullMsg = "[ProjectListComponent] _loadProjects error: " + (error?.message || error);
            if (endpoint || status || detail) {
                fullMsg += " |";
                if (endpoint) fullMsg += ` endpoint: ${endpoint};`;
                if (status) fullMsg += ` HTTP ${status};`;
                if (detail) fullMsg += ` detail: ${detail};`;
            }
            this.notify.error(fullMsg, {
                group: true,
                context: 'projectListComponent',
                source: 'ProjectListComponent',
                method: '_loadProjects',
                endpoint,
                status,
                detail,
                originalError: error
            });
            this._showErrorState("Failed to load projects");
            this.notify.error("Failed to load projects.", {
                group: true,
                context: 'projectListComponent',
                source: 'ProjectListComponent',
                method: '_loadProjects'
            });
        } finally {
            this._setState({ loading: false });
        }
    }

    /** Dispatch actions (view/edit/delete) */
    _handleAction(action, projectId) {
        const project = this.state.projects.find(
          (p) => String(this._getProjectId(p)) === projectId
        );
        if (!project) {
            this.notify.warn(`[ProjectListComponent] Project not found: ${projectId}`, {
                group: true, context: 'projectListComponent'
            });
            return;
        }
        switch (action) {
            case "view":
                // Always pass only the project ID to avoid URL coercion issues
                this.onViewProject(this._getProjectId(project));
                break;
            case "edit":
                this._openEditModal(project);
                break;
            case "delete":
                this._confirmDelete(project);
                break;
            default:
                this.notify.warn(`[ProjectListComponent] Unknown action: ${action}`, {
                    group: true, context: 'projectListComponent'
                });
        }
    }

    /** Handle click on project cards */
    _handleCardClick(e) {
        const projectCard = e.target.closest('.project-card');
        if (!projectCard) {
            // This click was not on or inside a project card.
            return;
        }

        const projectId = projectCard.dataset.projectId;
        if (!projectId) {
            this.notify.error("[ProjectListComponent] Clicked a card without a valid projectId.", { group: true, context: "projectListComponent" });
            return;
        }

        // Check if the click was on an action button within the card.
        // Action buttons now have their own direct listeners, so we only stop propagation here.
        const actionBtn = e.target.closest("[data-action]");
        if (actionBtn) {
            e.stopPropagation(); // Prevent card's own click (navigation) if an action button was clicked.
            this.notify.debug(`Action button '${actionBtn.dataset.action}' clicked for project ${projectId}. Handler attached directly to button.`, { group: true, context: 'projectListComponent' });
            return; // Let the button's own event listener handle the action.
        }

        // If the click was on the card itself (not an action button) and not a create button
        const isCreateButton = e.target.closest('#projectListCreateBtn, #sidebarNewProjectBtn, #emptyStateCreateBtn');
        if (isCreateButton) {
            return;
        }

        this.notify.info(`Project card (not an action button) clicked for project: ${projectId}. Navigating...`, { group: true, context: 'projectListComponent' });
        // const appState = this.app?.state; // OLD
        // if (appState?.isAuthenticated && appState?.currentUser) { // OLD
        //     this.onViewProject(projectId); // OLD
        // } else { // OLD
        //     this.notify.warn("[ProjectListComponent] Ignoring card click for navigation: user not authenticated or currentUser not loaded.", { group: true, context: "projectListComponent" }); // OLD
        // } // OLD

        // NEW: Use auth module directly via DependencySystem
        const auth = this.DependencySystem?.modules?.get?.('auth') ?? null;

        if (auth && auth.isAuthenticated()) {
            // Optionally, also check for auth.getCurrentUserObject() if needed for onViewProject
            this.onViewProject(projectId);
        } else {
            this.notify.warn("[ProjectListComponent] Ignoring card click for navigation: user not authenticated (checked via auth module).", { group: true, context: "projectListComponent" });
            // Optionally, dispatch 'requestLogin' or similar to trigger login modal
            this.eventBus.dispatchEvent(new CustomEvent("requestLogin"));
        }
    }

    _handleProjectCreated(project) {
        if (!project) return;
        this._setState({ projects: [project, ...this.state.projects] });
        this.renderProjects(this.state.projects);
    }

    _handleProjectUpdated(updatedProject) {
        if (!updatedProject) return;
        const idx = this.state.projects.findIndex(
            (p) => String(this._getProjectId(p)) === String(this._getProjectId(updatedProject))
        );
        if (idx >= 0) {
            const newProjects = [...this.state.projects];
            newProjects[idx] = updatedProject;
            this._setState({ projects: newProjects });
            this.renderProjects(this.state.projects);
        }
    }

    /** Bind New Project buttons */
    _bindCreateProjectButtons() {
        if (!this.modalManager) return;
        if (!this.eventHandlers?.trackListener) {
            this.notify.error(
                "[ProjectListComponent] eventHandlers.trackListener is required for button events.",
                { group: true, context: "projectListComponent" }
            );
            throw new Error(
                "[ProjectListComponent] eventHandlers.trackListener is required for button events."
            );
        }
        const docAPI = this.domAPI;
        const buttonIds = [
            "projectListCreateBtn",
            "sidebarNewProjectBtn",
            "emptyStateCreateBtn"
        ];
        buttonIds.forEach((id) => {
            const btn = docAPI.getElementById(id);
            if (!btn) return;
            const handler = () => this._openNewProjectModal();
            this.eventHandlers.trackListener(btn, "click", handler, {
                description: `Open New Project Modal (${id})`, context: MODULE_CONTEXT
            });
        });
    }

    _openNewProjectModal() {
        if (!this.modalManager?.show) {
            this.notify.error(
                "[ProjectListComponent] modalManager.show is unavailable for new project modal.",
                { group: true, context: "projectListComponent" }
            );
            return;
        }
        this.modalManager.show("project");
    }

    _openEditModal(project) {
        if (!this.modalManager?.show) {
            this.notify.error(
                "[ProjectListComponent] modalManager.show is unavailable for edit modal.",
                { group: true, context: "projectListComponent" }
            );
            return;
        }
        this.modalManager.show("project", {
            updateContent: (modalEl) => {
                const nameInput = modalEl.querySelector("#projectModalNameInput");
                if (nameInput) nameInput.value = project.name || "";
            }
        });
    }

    /**
     * Confirmation for destructive actions is handled strictly via DI modalManager.confirmAction.
     * If modalManager.confirmAction is not available, show an error and do not proceed.
     */
    async _confirmDelete(project) {
        if (this.modalManager?.confirmAction) {
            const ok = await new Promise(resolve => {
                this.modalManager.confirmAction({
                    title: `Delete "${project.name}"?`,
                    message: `This cannot be undone.`,
                    confirmText: "Delete",
                    confirmClass: "btn-error",
                    onConfirm: () => resolve(true),
                    onCancel: () => resolve(false)
                });
            });
            if (ok) this._executeDelete(project.id);
        } else {
            this.notify.error(
                "[ProjectListComponent] No DI modalManager.confirmAction available for confirmation. Delete action cancelled.",
                { group: true, context: 'projectListComponent' }
            );
        }
    }

    async _executeDelete(projectId) {
        if (!this.projectManager?.deleteProject) {
            this.notify.error(
                "[ProjectListComponent] projectManager.deleteProject is not available.",
                { group: true, context: 'projectListComponent' }
            );
            this.notify.error("Critical: Delete not available.", {
                group: true, context: 'projectListComponent'
            });
            return;
        }
        try {
            await this.projectManager.deleteProject(projectId);
            this.notify.success("Project deleted", { group: true, context: 'projectListComponent' });
            this._loadProjects();
        } catch (err) {
            this.errorReporter?.capture?.(err, {
              module : 'ProjectListComponent',
              source : '_executeDelete',
              context: MODULE_CONTEXT
            });
            this.notify.error("[ProjectListComponent] Failed to delete project: " + (err?.message || err), {
                group: true, context: 'projectListComponent'
            });
            this.notify.error("Failed to delete project", { group: true, context: 'projectListComponent' });
        }
    }

    /** Loading skeletons */
    _showLoadingState() {
        const docAPI = this.domAPI;
        if (!this.gridElement) return;
        this._clearElement(this.gridElement);

        // Use a responsive grid container for loading state
        this.gridElement.classList.add("grid", "project-list");
        for (let i = 0; i < 6; i++) {
            const skeleton = docAPI.createElement("div");
            skeleton.className = "bg-base-200 animate-pulse rounded-box p-4 mb-2 max-w-full w-full";
            const raw = `
              <div class="h-6 bg-base-300 rounded w-3/4 mb-3"></div>
              <div class="h-4 bg-base-300 rounded w-full mb-2"></div>
              <div class="h-4 bg-base-300 rounded w-2/3 mb-2"></div>
              <div class="h-3 bg-base-300 rounded w-1/3 mt-6"></div>
            `;
            this._safeSetInnerHTML(skeleton, raw);
            this.gridElement.appendChild(skeleton);
        }
    }

    /** Empty state UI */
    _showEmptyState() {
        const docAPI = this.domAPI;
        if (!this.gridElement) return;
        this._clearElement(this.gridElement);
        this.gridElement.classList.add("grid", "project-list");
        const emptyDiv = docAPI.createElement("div");
        emptyDiv.className = "project-list-empty";
        this._safeSetInnerHTML(emptyDiv, `
          <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p class="mt-4 text-lg text-base-content">No projects found</p>
          <p class="mt-1">Create a new project to get started</p>
          <button id="emptyStateCreateBtn" class="btn btn-primary mt-4">Create Project</button>
        `);
        this.gridElement.appendChild(emptyDiv);

        const createBtn = docAPI?.getElementById
            ? docAPI.getElementById("emptyStateCreateBtn")
            : docAPI.getElementById("emptyStateCreateBtn");
        if (createBtn) {
            this.eventHandlers.trackListener(
                createBtn,
                "click",
                () => this._openNewProjectModal(),
                { description: "EmptyState: Create Project", context: MODULE_CONTEXT }
            );
        }
    }

    /** Login required UI */
    _showLoginRequired() {
        const docAPI = this.domAPI;
        if (!this.element) return;
        this._clearElement(this.element);
        this.element.classList.add("grid", "project-list");
        const loginDiv = docAPI.createElement("div");
        loginDiv.className = "project-list-fallback";
        this._safeSetInnerHTML(loginDiv, `
          <p class="mt-4 text-lg">Please log in to view your projects</p>
          <button id="loginButton" class="btn btn-primary mt-4">Login</button>
        `);
        this.element.appendChild(loginDiv);

        const loginBtn = docAPI?.getElementById
            ? docAPI.getElementById("loginButton")
            : docAPI.getElementById("loginButton");
        if (loginBtn) {
            this.eventHandlers.trackListener(loginBtn, "click", (e) => {
                e.preventDefault();
                this.eventBus.dispatchEvent(new CustomEvent("requestLogin"));
            }, { description: "ProjectList: Login Button", context: MODULE_CONTEXT });
        }
    }

    /** Error UI */
    _showErrorState(message) {
        const docAPI = this.domAPI;
        this.notify.error("[ProjectListComponent] Error state shown with message: " + message, {
            group: true, context: "projectListComponent"
        });
        if (!this.element) {
            this.notify.error("[ProjectListComponent] Cannot show error state, this.element is null/undefined", {
                group: true, context: "projectListComponent"
            });
            return;
        }
        this._clearElement(this.element);
        this.element.classList.add("grid", "project-list");
        const msg = message || "An unknown error occurred.";
        const errorDiv = docAPI.createElement("div");
        errorDiv.className = "project-list-error";
        this._safeSetInnerHTML(errorDiv, `
          <svg class="w-16 h-16 mx-auto text-error/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="mt-4 text-lg text-error">${msg}</p>
          <button id="retryButton" class="btn btn-outline btn-error mt-4">Retry</button>
          <div class="mt-4 text-sm text-base-content/70">If the issue persists, check console logs for more details.</div>
        `);
        this.element.appendChild(errorDiv);
        const retryBtn = docAPI.getElementById("retryButton");
        if (retryBtn) {
            this.eventHandlers.trackListener(
                retryBtn,
                "click",
                () => this._loadProjects(),
                { description: "ProjectList: Retry Load Projects", context: MODULE_CONTEXT }
            );
        }
    }

    /**
     * Create a project card element (delegates to header/desc/footer helpers).
     * @param {Object} project
     * @returns {HTMLElement}
     */
    _createProjectCard(project) {
        const docAPI = this.domAPI;
        const card  = docAPI.createElement("div");
        card.className = this._computeCardClasses(project);
        // Robustly pick whichever field the API returned
        const projectId = this._getProjectId(project) ?? "";
        card.dataset.projectId = String(projectId);

        if (!card.dataset.projectId) {
          this.notify.error(
            `[ProjectListComponent] Missing project ID for card (${project.name ?? "unknown"})`,
            { group: true, context: "projectListComponent" }
          );
        }

        card.append(
            this._buildCardHeader(project),
            this._buildCardDescription(project),
            this._buildCardFooter(project)
        );
        return card;
    }

    /**
     * Compute the card's className string (theming, layout).
     * @param {Object} _project - Project object (unused but kept for consistency)
     * @returns {string}
     * @private
     */
    _computeCardClasses(_project) {
        const theme = this.state.customization.theme || "default";
        const themeBg = theme === "default" ? "bg-base-100" : `bg-${theme}`;
        const themeText = theme === "default" ? "text-base-content" : `text-${theme}-content`;
        return `project-card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-all border border-base-300 rounded-box p-4 flex flex-col h-full mb-3 max-w-full w-full overflow-x-auto`;
    }

    /**
     * Build the card header (title + action buttons).
     * @param {Object} project
     * @returns {HTMLElement}
     * @private
     */
    _buildCardHeader(project) {
        const docAPI = this.domAPI;
        const header = docAPI.createElement("div");
        header.className = "flex justify-between items-start";

        const titleEl = docAPI.createElement("h3");
        titleEl.className = "font-semibold text-lg sm:text-xl mb-2 project-name truncate";
        titleEl.textContent = project.name || "Unnamed Project";

        const actions = docAPI.createElement("div");
        actions.className = "flex gap-1";
        const projectId = this._getProjectId(project);

        [
            {
                action: "view",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          `,
                label: "View Project" // Using label as per user's snippet for description
            },
            {
                action: "edit",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          `,
                label: "Edit Project"
            },
            {
                action: "delete",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          `,
                label: "Delete Project",
                className: "text-error hover:bg-error/10"
            }
        ].forEach((btnDef) => {
            // Pass projectId and label to _createActionButton
            actions.appendChild(this._createActionButton({ ...btnDef, projectId }));
        });

        header.appendChild(titleEl);
        header.appendChild(actions);
        return header;
    }

    /**
     * Build the card description section (if enabled).
     * @param {Object} project
     * @returns {HTMLElement}
     * @private
     */
    _buildCardDescription(project) {
        const docAPI = this.domAPI;
        if (this.state.customization.showDescription && project.description) {
            const description = docAPI.createElement("p");
            description.className = "text-sm text-base-content/70 mb-3 line-clamp-2";
            description.textContent = project.description;
            return description;
        }
        // Return a fragment or empty span to keep structure
        return docAPI.createElement("span");
    }

    /**
     * Build the card footer (date + badges).
     * @param {Object} project
     * @returns {HTMLElement}
     * @private
     */
    _buildCardFooter(project) {
        const docAPI = this.domAPI;
        const footer = docAPI.createElement("div");
        footer.className = "mt-auto pt-2 flex justify-between text-xs text-base-content/70";

        if (this.state.customization.showDate && project.updated_at) {
            const dateEl = docAPI.createElement("span");
            dateEl.textContent = this._formatDate(project.updated_at);
            footer.appendChild(dateEl);
        }

        const badges = docAPI.createElement("div");
        badges.className = "flex gap-1";
        if (project.pinned) {
            const pinBadge = docAPI.createElement("span");
            pinBadge.textContent = "📌";
            pinBadge.classList.add("tooltip");
            pinBadge.dataset.tip = "Pinned";
            badges.appendChild(pinBadge);
        }
        if (project.archived) {
            const archiveBadge = docAPI.createElement("span");
            archiveBadge.textContent = "📦";
            archiveBadge.classList.add("tooltip");
            archiveBadge.dataset.tip = "Archived";
            badges.appendChild(archiveBadge);
        }

        footer.appendChild(badges);
        return footer;
    }

    /**
     * Create an action button for the card header.
     * @param {Object} btnDef
     * @returns {HTMLElement}
     * @private
     */
    _createActionButton(btnDef) { // btnDef now includes projectId and label
        const docAPI = this.domAPI;
        const button = docAPI.createElement("button");
        button.className = `btn btn-ghost btn-xs btn-square min-w-[44px] min-h-[44px] ${btnDef.className || ""}`;
        button.setAttribute("aria-label", btnDef.label); // Use label for aria-label
        button.dataset.action = btnDef.action;
        button.title = btnDef.label; // Use label for title

        let iconString = btnDef.icon;
        if (typeof iconString !== "string" || !iconString.trim()) {
            this.notify.error(
                `[ProjectListComponent] Missing or invalid icon for action "${btnDef.action}" project: ${btnDef.projectId}`,
                { group: true, context: "projectListComponent", source: "_createActionButton", btnDef }
            );
            // fallback: generic icon
            iconString = `<svg width="16" height="16" fill="currentColor"><rect width="16" height="16" fill="grey"/></svg>`;
        }
        this._safeSetInnerHTML(button, iconString);

        this.eventHandlers.trackListener(button, 'click', (e) => {
            e.stopPropagation(); // Prevent card click if the button itself is clicked
            this._handleAction(btnDef.action, btnDef.projectId);
        }, {
            description: `Project card action: ${btnDef.label} for ${btnDef.projectId}`,
            context: MODULE_CONTEXT // Use the module-level context
        });
        return button;
    }

    /** Format ISO date strings */
    _formatDate(dateString) {
        if (!dateString) return "";
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch {
            return dateString;
        }
    }

    /** Load card customization from storage */
    _loadCustomization() {
        try {
            const saved = this.storage.getItem("projectCardsCustomization");
            return saved
                ? JSON.parse(saved)
                : this._getDefaultCustomization();
        } catch (err) {
            this.errorReporter?.capture?.(err, {
              module : 'ProjectListComponent',
              source : '_loadCustomization',
              context: MODULE_CONTEXT
            });
            return this._getDefaultCustomization();
        }
    }

    /** Default card customization */
    _getDefaultCustomization() {
        return {
            theme: "default",
            showDescription: true,
            showDate: true
        };
    }

    destroy() {
        this.notify.info('[ProjectListComponent] destroy() called', { group: true, context: 'projectListComponent', module: 'ProjectListComponent', source: 'destroy' });
        if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
            this.eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
            this.notify.debug(`[ProjectListComponent] Called eventHandlers.cleanupListeners for context: ${MODULE_CONTEXT}`, { source: 'destroy' });
        } else {
            this.notify.warn('[ProjectListComponent] eventHandlers.cleanupListeners not available. Listeners may not be cleaned up.', { source: 'destroy' });
        }
        this._setState({ initialized: false });
        // Optionally, clear other state or DOM references if necessary
    }
}
/* eslint-disable no-undef */
// Expose helpers for unit tests if in test environment
if (typeof process !== "undefined" && process?.env?.NODE_ENV === 'test') {
    ProjectListComponent.prototype._testHelpers = {
        _buildCardHeader: ProjectListComponent.prototype._buildCardHeader,
        _buildCardDescription: ProjectListComponent.prototype._buildCardDescription,
        _buildCardFooter: ProjectListComponent.prototype._buildCardFooter,
        _createActionButton: ProjectListComponent.prototype._createActionButton,
        _computeCardClasses: ProjectListComponent.prototype._computeCardClasses,
        _bindSingleFilterTab: ProjectListComponent.prototype._bindSingleFilterTab,
        _bindFilterTablistKeyboardNav: ProjectListComponent.prototype._bindFilterTablistKeyboardNav
    };
}
/* eslint-enable no-undef */
