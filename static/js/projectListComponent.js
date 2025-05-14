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
        storage,
        sanitizer,
        apiClient,
        domAPI,
        browserService,
        globalUtils
    } = {}) {
        // Assign DI fields
        this.projectManager = projectManager;
        this.eventHandlers = eventHandlers;
        this.modalManager = modalManager;
        this.app = app;
        this.router = router;
        this.browserService = browserService;
        this.globalUtils = globalUtils;
        this.eventBus = new EventTarget(); // dedicated intra-module bus

        if (!domAPI) {
            throw new Error("[ProjectListComponent] domAPI injection is mandatory.");
        }
        this.domAPI = domAPI;
        this._doc = null;

        this.DependencySystem = app?.DependencySystem || eventHandlers?.DependencySystem;
        this.navigationService = this.DependencySystem?.modules?.get('navigationService');
        this.apiClient = apiClient;
        this.storage = storage;
        this.htmlSanitizer = sanitizer;
        if (
            !this.projectManager ||
            !this.eventHandlers ||
            !this.router ||
            !this.storage ||
            !this.htmlSanitizer
        ) {
            throw new Error(
                "[ProjectListComponent] Missing required dependencies: projectManager, eventHandlers, router, storage, sanitizer are required."
            );
        }
        if (typeof this.htmlSanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] htmlSanitizer must provide a .sanitize(html) method.");
        }

        // Default navigation callback
        this.onViewProject = (projectObjOrId) => {
            const projectId = (typeof projectObjOrId === "object" && projectObjOrId.id) ? projectObjOrId.id : projectObjOrId;
            if (this.navigationService && typeof this.navigationService.navigateToProject === "function") {
                this.navigationService.navigateToProject(projectId);
            } else {
                // Fallback/no-op if missing
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

    _setState(partial){
      this.state = { ...this.state, ...partial };
    }

    _getProjectId(p) {
      return p?.uuid ?? p?.id ?? p?.project_id ?? p?.ID ?? null;
    }

    async initialize() {
        try {
            if (this.DependencySystem?.waitFor) {
                await this.DependencySystem.waitFor(['app:ready']);
            }
        } catch (err) {
            // Continue if app readiness wait fails
        }

        this._doc = this.domAPI.getDocument?.();
        if (this.state.initialized) {
            return;
        }

        const docAPI = this.domAPI;
        this._doc = docAPI.getDocument?.();
        this.element = docAPI?.getElementById
            ? docAPI.getElementById(this.elementId)
            : this._doc.getElementById(this.elementId);

        if (!this.element) {
            throw new Error(
                `[ProjectListComponent] Element #${this.elementId} not found. Cannot initialize.`
            );
        }

        if (this.element.classList.contains('grid')) {
            this.gridElement = this.element;
        } else if (docAPI?.querySelector) {
            this.gridElement = docAPI.querySelector('.grid', this.element);
        } else {
            this.gridElement = this.element.querySelector('.grid');
        }

        if (!this.gridElement) {
            throw new Error(`'.grid' container not found within #${this.elementId}.`);
        }

        try {
            await this.globalUtils.waitForDepsAndDom({
                DependencySystem: this.app?.DependencySystem || this.eventHandlers?.DependencySystem,
                domSelectors: [
                  '#projectList', '#projectListView', '#projectDetailsView',
                  '#projectTitle', '#projectDescription', '#backToProjectsBtn',
                  '#projectFilterTabs'
                ],
                timeout: 10000,
                domAPI: docAPI,
                source: 'ProjectListComponent_InternalDOMWait'
            });
        } catch (err) {
            throw err;
        }

        this._bindEventListeners();
        this._bindCreateProjectButtons();

        this._setState({ initialized: true });

        this.eventBus.dispatchEvent(new CustomEvent('initialized', {
            detail: {
                success: true
            }
        }));

        try {
            const doc = this.domAPI.getDocument();
            if (doc) {
                this.domAPI.dispatchEvent(doc, new CustomEvent('projectListComponentInitialized', {
                    detail: {
                        success: true
                    }
                }));
            }
        } catch (err) {
            // Ignore if dispatch fails
        }

        // Load projects
        this._loadProjects();
    }

    _safeSetInnerHTML(element, rawHtml) {
        if (!this.htmlSanitizer || typeof this.htmlSanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] Missing htmlSanitizer implementation");
        }
        if (typeof rawHtml !== "string" || !rawHtml.trim()) {
            throw new Error("[ProjectListComponent] _safeSetInnerHTML expected non-empty string");
        }
        try {
            element.innerHTML = this.htmlSanitizer.sanitize(rawHtml);
        } catch (err) {
            try {
                const plain = typeof rawHtml === "string"
                    ? rawHtml.replace(/<[^>]*>/g, "")
                    : String(rawHtml);
                element.textContent = plain;
            } catch (innerErr) {
                element.textContent = "";
            }
        }
    }

    _clearElement(element) {
        element.textContent = "";
    }

    _bindEventListeners() {
        const docAPI = this.domAPI;
        const doc = docAPI?.getDocument?.();
        const projectsLoadedHandler = (e) => this.renderProjects(e.detail);

        this.eventHandlers.trackListener(
            doc,
            "projectsLoaded",
            projectsLoadedHandler
        );

        this.eventHandlers.trackListener(
            this.gridElement,
            "click",
            (e) => this._handleCardClick(e)
        );

        this.eventHandlers.trackListener(
            doc,
            "projectCreated",
            (e) => this._handleProjectCreated(e.detail)
        );
        this.eventHandlers.trackListener(
            doc,
            "projectUpdated",
            (e) => this._handleProjectUpdated(e.detail)
        );

        this.eventHandlers.trackListener(
            doc,
            "authStateChanged",
            (e) => {
                const { authenticated, user } = e.detail || {};

                if (authenticated) {
                    if (!this.state.initialized) {
                        try {
                            this.initialize().then(() => {
                                this.show();
                                this._loadProjects();
                            }).catch(() => {});
                        } catch (err) {
                            // Ignore initialization error here
                        }
                    } else {
                        this.show();
                        setTimeout(() => {
                            this._loadProjects();
                        }, 100);
                    }
                } else {
                    this._showLoginRequired();
                }
            }
        );

        this._bindFilterEvents();
    }

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

    _bindSingleFilterTab(tab, filterValue) {
        if (!filterValue) return;
        const clickHandler = () => this._setFilter(filterValue);
        this.eventHandlers.trackListener(tab, "click", clickHandler);

        this.eventHandlers.trackListener(tab, "keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this._setFilter(filterValue);
                tab.focus();
            }
        });
    }

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
        });
    }

    _setFilter(filter) {
        this._setState({ filter });
        this._updateActiveTab();
        this._updateUrl(filter);
        this._loadProjects();
    }

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

        const projectCardsPanel = docAPI?.getElementById
            ? docAPI.getElementById("projectCardsPanel")
            : docAPI.getElementById("projectCardsPanel");
        if (projectCardsPanel && activeTabId) {
            projectCardsPanel.setAttribute("aria-labelledby", activeTabId);
        }
    }

    _updateUrl(filter) {
        try {
            if (this.navigationService && typeof this.navigationService.updateUrlParams === 'function') {
                this.navigationService.updateUrlParams({ filter }, true);
            } else {
                // No-op if not available
            }
        } catch (e) {
            // Ignore URL param update failure
        }
    }

    renderProjects(data) {
        if (this._isRendering) {
            return;
        }
        this._isRendering = true;

        try {
            if (data && data.error && data.reason === 'auth_required') {
                this._showLoginRequired();
                return;
            }

            if (data && data.error && typeof data.error === 'string') {
                this._showErrorState(data.error || "Failed to load projects.");
                return;
            }

            const projects = this._extractProjects(data);
            this._setState({ projects: projects || [] });

            if (!this.gridElement) {
                return;
            }
            if (!projects?.length) {
                this._showEmptyState();
                return;
            }

            this._clearElement(this.gridElement);
            const fragment = (this._doc || this.domAPI.getDocument()).createDocumentFragment();
            projects.forEach((_project) => {
                if (_project && typeof _project === "object") {
                    fragment.appendChild(this._createProjectCard(_project));
                }
            });
            this.gridElement.appendChild(fragment);

            this._makeVisible();
        } finally {
            this._isRendering = false;
        }
    }

    _makeVisible() {
        if (this.gridElement) {
            this.gridElement.classList.remove("hidden");
            this.gridElement.style.display = "";
        }

        if (this.element) {
            this.element.classList.remove("hidden", "opacity-0");
            this.element.style.opacity = '1';
            this.element.style.display = "";
        }

        const docAPI = this.domAPI;
        const listViewContainer = docAPI?.getElementById("projectListView");
        if (listViewContainer) {
            listViewContainer.classList.remove("hidden", "opacity-0");
            listViewContainer.style.display = "";
            listViewContainer.style.visibility = "visible";
            listViewContainer.style.opacity = "1";

            const projectManagerPanel = docAPI?.getElementById("projectManagerPanel");
            if (projectManagerPanel) {
                projectManagerPanel.classList.remove("hidden");
                projectManagerPanel.style.display = "";
            }

            const projectDetailsView = docAPI?.getElementById("projectDetailsView");
            if (projectDetailsView) {
                projectDetailsView.classList.add("hidden");
                projectDetailsView.style.display = "none";
            }

            const loginMessage = docAPI?.getElementById("loginRequiredMessage");
            if (loginMessage) {
                loginMessage.classList.add("hidden");
            }

            const mainContent = docAPI?.getElementById("mainContent");
            if (mainContent) {
                mainContent.classList.remove("hidden");
            }

            void listViewContainer.offsetHeight; // force reflow
        }
    }

    _extractProjects(data) {
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

    async show() {
        if (this._isRendering) {
            return;
        }

        if (!this.state.initialized) {
            try {
                await this.initialize();
            } catch (err) {
                // Ignore initialization error
            }
        }

        const docAPI = this.domAPI;
        if (!this.gridElement) {
            const parentElement = this.element || docAPI?.getElementById(this.elementId) || docAPI.getElementById(this.elementId);
            if (parentElement) {
                this.gridElement = parentElement.querySelector('.grid');
                if (!this.gridElement) {
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
                return;
            }
        }

        this._makeVisible();

        const projectListView = docAPI?.getElementById("projectListView");
        if (projectListView) {
            projectListView.classList.remove("hidden", "opacity-0");
            projectListView.style.display = "";
            projectListView.style.visibility = "visible";
            projectListView.style.opacity = "1";
        }

        if (this.state.projects && this.state.projects.length > 0 && !this._isRendering) {
            try {
                this.renderProjects(this.state.projects);
            } catch {
                // Ignore render error
            }
        } else if (!this.state.projects || this.state.projects.length === 0) {
            this._loadProjects();
        }

        setTimeout(() => {
            const finalListView = docAPI?.getElementById("projectListView");
            const finalElement = this.element || docAPI?.getElementById(this.elementId);
            const finalGridElement = this.gridElement;

            if (finalListView && (finalListView.classList.contains("hidden") || finalListView.style.display === "none")) {
                finalListView.classList.remove("hidden", "opacity-0");
                finalListView.style.display = "";
                finalListView.style.visibility = "visible";
                finalListView.style.opacity = "1";
            }

            if (finalElement && (finalElement.classList.contains("hidden") || finalElement.style.display === "none")) {
                finalElement.classList.remove("hidden", "opacity-0");
                finalElement.style.display = "";
            }

            if (finalGridElement && (finalGridElement.classList.contains("hidden") || finalGridElement.style.display === "none")) {
                finalGridElement.classList.remove("hidden");
                finalGridElement.style.display = "";
            }
        }, 150);
    }

    hide() {
        const docAPI = this.domAPI;
        if (this.gridElement) {
            this.gridElement.classList.add("hidden");
        }
        if (this.element) {
            this.element.classList.add("hidden");
        }
        const listViewContainer = docAPI?.getElementById("projectListView") || docAPI.getElementById("projectListView");
        if (listViewContainer) {
            listViewContainer.classList.add("hidden");
            listViewContainer.style.display = "none";
        }
    }

    async _loadProjects() {
        if (this.state.loading) return;
        if (!this.projectManager?.loadProjects) {
            return;
        }
        this._setState({ loading: true });
        this._showLoadingState();
        try {
            await this.projectManager.loadProjects(this.state.filter);
        } catch (error) {
            this._showErrorState("Failed to load projects");
        } finally {
            this._setState({ loading: false });
        }
    }

    _handleAction(action, projectId) {
        const project = this.state.projects.find(
            (p) => String(this._getProjectId(p)) === projectId
        );
        if (!project) {
            return;
        }
        switch (action) {
            case "view":
                this.onViewProject(this._getProjectId(project));
                break;
            case "edit":
                this._openEditModal(project);
                break;
            case "delete":
                this._confirmDelete(project);
                break;
            default:
        }
    }

    _handleCardClick(e) {
        const projectCard = e.target.closest('.project-card');
        if (!projectCard) {
            return;
        }

        const projectId = projectCard.dataset.projectId;
        if (!projectId) {
            return;
        }

        const actionBtn = e.target.closest("[data-action]");
        if (actionBtn) {
            e.stopPropagation();
            return;
        }

        const isCreateButton = e.target.closest('#projectListCreateBtn, #sidebarNewProjectBtn, #emptyStateCreateBtn');
        if (isCreateButton) {
            return;
        }

        const auth = this.DependencySystem?.modules?.get?.('auth') ?? null;
        if (auth && auth.isAuthenticated()) {
            this.onViewProject(projectId);
        } else {
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

    _bindCreateProjectButtons() {
        if (!this.modalManager) return;
        if (!this.eventHandlers?.trackListener) {
            throw new Error(
                "[ProjectListComponent] eventHandlers.trackListener is required for button events."
            );
        }
        const docAPI = this.domAPI;
        this.eventHandlers.delegate(
            docAPI.getDocument(),
            'click',
            '#projectListCreateBtn, #sidebarNewProjectBtn, #emptyStateCreateBtn',
            () => this._openNewProjectModal()
        );
    }

    _openNewProjectModal() {
        if (!this.modalManager?.show) {
            return;
        }
        this.modalManager.show("project");
    }

    _openEditModal(project) {
        if (!this.modalManager?.show) {
            return;
        }
        this.modalManager.show("project", {
            updateContent: (modalEl) => {
                const nameInput = modalEl.querySelector("#projectModalNameInput");
                if (nameInput) nameInput.value = project.name || "";
            }
        });
    }

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
        }
    }

    async _executeDelete(projectId) {
        if (!this.projectManager?.deleteProject) {
            return;
        }
        try {
            await this.projectManager.deleteProject(projectId);
            this._loadProjects();
        } catch {
            // ignore
        }
    }

    _showLoadingState() {
        const docAPI = this.domAPI;
        if (!this.gridElement) return;
        this._clearElement(this.gridElement);

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
                () => this._openNewProjectModal()
            );
        }
    }

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
            });
        }
    }

    _showErrorState(message) {
        const docAPI = this.domAPI;
        if (!this.element)
            return;
        this._clearElement(this.element);
        this.element.classList.add("grid", "project-list");
        const msg = message || "An unknown error occurred.";
        const errorDiv = docAPI.createElement("div");
        errorDiv.className = "project-list-error";
        this._safeSetInnerHTML(errorDiv, `
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
        this.element.appendChild(errorDiv);
        const retryBtn = docAPI.getElementById("retryButton");
        if (retryBtn) {
            this.eventHandlers.trackListener(
                retryBtn,
                "click",
                () => this._loadProjects()
            );
        }
    }

    _createProjectCard(project) {
        const docAPI = this.domAPI;
        const card  = docAPI.createElement("div");
        card.className = this._computeCardClasses(project);
        const projectId = this._getProjectId(project) ?? "";
        card.dataset.projectId = String(projectId);

        card.append(
            this._buildCardHeader(project),
            this._buildCardDescription(project),
            this._buildCardFooter(project)
        );
        return card;
    }

    _computeCardClasses(_project) {
        const theme = this.state.customization.theme || "default";
        const themeBg = theme === "default" ? "bg-base-100" : `bg-${theme}`;
        const themeText = theme === "default" ? "text-base-content" : `text-${theme}-content`;
        return `project-card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-all border border-base-300 rounded-box p-4 flex flex-col h-full mb-3 max-w-full w-full overflow-x-auto`;
    }

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
            actions.appendChild(this._createActionButton({ ...btnDef, projectId }));
        });

        header.appendChild(titleEl);
        header.appendChild(actions);
        return header;
    }

    _buildCardDescription(project) {
        const docAPI = this.domAPI;
        if (this.state.customization.showDescription && project.description) {
            const description = docAPI.createElement("p");
            description.className = "text-sm text-base-content/70 mb-3 line-clamp-2";
            description.textContent = project.description;
            return description;
        }
        return docAPI.createElement("span");
    }

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

    _createActionButton(btnDef) {
        const docAPI = this.domAPI;
        const button = docAPI.createElement("button");
        button.className = `btn btn-ghost btn-xs btn-square min-w-[44px] min-h-[44px] ${btnDef.className || ""}`;
        button.setAttribute("aria-label", btnDef.label);
        button.dataset.action = btnDef.action;
        button.title = btnDef.label;

        let iconString = btnDef.icon;
        if (typeof iconString !== "string" || !iconString.trim()) {
            // fallback to a simple block if missing
            iconString = `<svg width="16" height="16" fill="currentColor"><rect width="16" height="16" fill="grey"/></svg>`;
        }
        this._safeSetInnerHTML(button, iconString);

        this.eventHandlers.trackListener(button, 'click', (e) => {
            e.stopPropagation();
            this._handleAction(btnDef.action, btnDef.projectId);
        });
        return button;
    }

    _formatDate(dateString) {
        if (!dateString) return "";
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch {
            return dateString;
        }
    }

    _loadCustomization() {
        try {
            const saved = this.storage.getItem("projectCardsCustomization");
            return saved
                ? JSON.parse(saved)
                : this._getDefaultCustomization();
        } catch {
            return this._getDefaultCustomization();
        }
    }

    _getDefaultCustomization() {
        return {
            theme: "default",
            showDescription: true,
            showDate: true
        };
    }

    destroy() {
        if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
            this.eventHandlers.cleanupListeners();
        }
        this._setState({ initialized: false });
    }
}

/* eslint-disable no-undef */
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
