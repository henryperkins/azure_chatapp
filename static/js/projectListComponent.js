/**
 * ProjectListComponent
 * Handles rendering and interaction with the project list UI.
 *
 * All dependencies must now be passed explicitly (NO globals/Modularity).
 *
 * Usage:
 *   import { ProjectListComponent } from './projectListComponent.js';
 *   const projectList = new ProjectListComponent({
 *     projectManager,
 *     eventHandlers,
 *     modalManager,
 *     app,
 *     router,
 *     notificationHandler,
 *     storage,
 *     sanitizer
 *   });
 *   projectList.initialize();
 */

export class ProjectListComponent {
    /**
     * @param {Object} deps
     * @param {Object} deps.projectManager       - ProjectManager instance (required)
     * @param {Object} deps.eventHandlers        - EventHandlers instance (required)
     * @param {Object} deps.modalManager         - ModalManager instance (optional)
     * @param {Object} deps.app                  - App instance (optional)
     * @param {Object} deps.router               - Router abstraction (required)
     * @param {Object} deps.notificationHandler  - Notification/logging abstraction (required)
     * @param {Object} deps.storage              - Storage abstraction (required)
     * @param {Object} deps.sanitizer            - HTML sanitizer abstraction (required)
     */
    constructor({
        projectManager,
        eventHandlers,
        modalManager,
        app,
        router,
        notificationHandler,
        storage,
        sanitizer
    } = {}) {
        // Assign DI fields before any usage
        this.projectManager = projectManager;
        this.eventHandlers = eventHandlers;
        this.modalManager = modalManager;
        this.app = app;
        this.router = router;
        this.notification = notificationHandler;
        this.storage = storage;
        this.sanitizer = sanitizer;

        // --- DEBUG LOG ---
        if (this.appConfig && this.appConfig.DEBUG) {
            this.notification.log(`[ProjectListComponent] CONSTRUCTOR called`, { stack: (new Error()).stack });
        } else {
            // fallback basic log
            this.notification.log(`[ProjectListComponent] CONSTRUCTOR called`);
        }
        if (
            !this.projectManager ||
            !this.eventHandlers ||
            !this.router ||
            !this.notification ||
            !this.storage ||
            !this.sanitizer
        ) {
            throw new Error(
                "[ProjectListComponent] Missing required dependencies: " +
                "projectManager, eventHandlers, router, notificationHandler, storage, sanitizer are required."
            );
        }

        // Default navigation callback - now prefers passing project object if possible
        this.onViewProject = (projectObjOrId) => {
            // Rewrite: set current project context (in SPA/global state) instead of URL
            const projectId = (typeof projectObjOrId === "object" && projectObjOrId.id) ? projectObjOrId.id : projectObjOrId;
            // Save to app/session/global state
            if (this.app && typeof this.app.setCurrentProjectId === "function") {
                this.app.setCurrentProjectId(projectId);
            } else {
                this.notification.warn("[ProjectListComponent] Cannot set current project; app.setCurrentProjectId not available.");
            }
            // (Optional) Persist to user preferences via API for cross-session behavior
            if (this.apiClient && typeof this.apiClient.patch === "function") {
                this.apiClient.patch('/api/user/preferences', { last_project_id: projectId }).catch(() => {});
            } else if (typeof fetch === "function") {
                this.notification.warn("[ProjectListComponent] Using direct fetch as apiClient is not available. Please inject apiClient.");
                fetch('/api/user/preferences', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ last_project_id: projectId })
                }).catch(() => {});
            }
            // Now navigate SPA without ?project= in the URL, e.g., to /project-details or "main view"
            if (this.router && typeof this.router.navigate === "function") {
                this.router.navigate(`/project-details-view?project=${projectId}`);
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

    /** Initialize component once DOM has #projectList */
    initialize() {
        // --- DEBUG LOG ---
        if (this.appConfig && this.appConfig.DEBUG) {
            this.notification.log(`[ProjectListComponent] INITIALIZE called`, { stack: (new Error()).stack });
        } else {
            // fallback basic log
            this.notification.log(`[ProjectListComponent] INITIALIZE called`);
        }
        if (this.state.initialized) {
            if (this.app?.config?.debug) {
                this.notification.log("[ProjectListComponent] Already initialized.");
            }
            return;
        }

        this.element = document.getElementById(this.elementId);
        if (!this.element) {
            throw new Error(
                `[ProjectListComponent] Element #${this.elementId} not found`
            );
        }

        // New: Use only the real project grid for cards, not the root
        this.gridElement = this.element.querySelector('.grid');
        if (!this.gridElement) {
            throw new Error(
                `[ProjectListComponent] '.grid' container not found inside #${this.elementId}`
            );
        }

        this._bindEventListeners();
        this._bindCreateProjectButtons();

        this.state.initialized = true;
        if (this.app?.config?.debug) {
            this.notification.log("[ProjectListComponent] Initialized successfully.");
        }

        this._loadProjects();
    }

    /** Private helper: sanitize and set HTML */
    _setElementHTML(element, rawHtml) {
        if (!this.sanitizer || typeof this.sanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] Missing sanitizer implementation");
        }
        element.innerHTML = this.sanitizer.sanitize(rawHtml);
    }

    /** Private helper: clear element content */
    _clearElement(element) {
        element.textContent = "";
    }

    /** Bind core event listeners */
    _bindEventListeners() {
        const projectsLoadedHandler = (e) => this.renderProjects(e.detail);
        this.eventHandlers.trackListener(
            document,
            "projectsLoaded",
            projectsLoadedHandler,
            { description: "ProjectList: projectsLoaded" }
        );

        // Fix: Attach the click handler to the grid, not #projectList root
        this.eventHandlers.trackListener(
            this.gridElement,
            "click",
            (e) => this._handleCardClick(e),
            { description: "ProjectList: Card Click" }
        );

        this.eventHandlers.trackListener(
            document,
            "projectCreated",
            (e) => this._handleProjectCreated(e.detail),
            { description: "ProjectList: projectCreated" }
        );
        this.eventHandlers.trackListener(
            document,
            "projectUpdated",
            (e) => this._handleProjectUpdated(e.detail),
            { description: "ProjectList: projectUpdated" }
        );

        this.eventHandlers.trackListener(
            document,
            "authStateChanged",
            (e) => {
                if (e.detail?.authenticated) {
                    this._loadProjects();
                }
            },
            { description: "ProjectList: authStateChanged" }
        );

        this._bindFilterEvents();
    }

    /** Bind filter tab clicks */
    _bindFilterEvents() {
        const container = document.getElementById("projectFilterTabs");
        if (!container) return;

        const tabs = container.querySelectorAll(".tab[data-filter]");
        tabs.forEach((tab) => {
            const filterValue = tab.dataset.filter;
            if (!filterValue) return;
            const clickHandler = () => this._setFilter(filterValue);
            this.eventHandlers.trackListener(tab, "click", clickHandler, {
                description: `ProjectList: Filter tab click (${filterValue})`
            });
        });
    }

    /** Apply a new filter */
    _setFilter(filter) {
        this.state.filter = filter;
        this._updateActiveTab();
        this._updateUrl(filter);
        this._loadProjects();
    }

    /** Visually highlight active tab */
    _updateActiveTab() {
        const tabs = document.querySelectorAll(
            "#projectFilterTabs .tab[data-filter]"
        );
        tabs.forEach((tab) => {
            const isActive = tab.dataset.filter === this.state.filter;
            tab.classList.toggle("tab-active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });
    }

    /** Update URL via router abstraction */
    _updateUrl(filter) {
        try {
            const current = this.router.getURL();
            const url = new URL(current);
            url.searchParams.set("filter", filter);
            this.router.navigate(url.toString());
        } catch (e) {
            this.notification.warn(
                "[ProjectListComponent] Failed to update URL with filter",
                e
            );
        }
    }

    /** Render list of projects */
    renderProjects(data) {
        // Handle unauthenticated: projectManager emits { error: true, reason: 'auth_required' }
        if (data && data.error && data.reason === 'auth_required') {
            this._showLoginRequired();
            return;
        }

        const projects = this._extractProjects(data);
        this.state.projects = projects || [];

        if (!this.gridElement) {
            this.notification.error(
                "[ProjectListComponent.renderProjects] Grid element not found."
            );
            return;
        }
        if (!projects?.length) {
            this._showEmptyState();
            return;
        }

        this._clearElement(this.gridElement);
        const fragment = document.createDocumentFragment();
        projects.forEach((project) => {
            if (project && typeof project === "object") {
                fragment.appendChild(this._createProjectCard(project));
            }
        });
        this.gridElement.appendChild(fragment);
        this.show();
    }

    /** Extract projects array/object */
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

    /** Show the list container */
    show() {
        if (!this.gridElement) {
            this.notification.warn("[ProjectListComponent.show] grid element not found.");
            return;
        }
        this.gridElement.classList.remove("hidden");
        this.gridElement.style.display = "";
        this.element.classList.remove("hidden");
        this.element.style.display = "";
        const listView = document.getElementById("projectListView");
        if (listView) {
            listView.classList.remove("hidden", "opacity-0");
            listView.style.display = "";
        }
    }

    /** Hide the list container */
    hide() {
        if (this.gridElement) {
            this.gridElement.classList.add("hidden");
            this.gridElement.style.display = "none";
        }
        if (this.element) {
            this.element.classList.add("hidden");
            this.element.style.display = "none";
        }
        const listView = document.getElementById("projectListView");
        if (listView) {
            listView.classList.add("hidden", "opacity-0");
            listView.style.display = "none";
        }
    }

    /** Load projects via manager */
    async _loadProjects() {
        if (this.state.loading) return;
        if (!this.projectManager?.loadProjects) {
            this.notification.warn(
                "[ProjectListComponent] projectManager.loadProjects is missing."
            );
            return;
        }
        this.state.loading = true;
        this._showLoadingState();
        try {
            await this.projectManager.loadProjects(this.state.filter);
        } catch (error) {
            this.notification.error(
                "[ProjectListComponent] Error loading projects:",
                error
            );
            this._showErrorState("Failed to load projects");
        } finally {
            this.state.loading = false;
        }
    }

    /** Handle click on project cards */
    _handleCardClick(e) {
        // Check if the click is on a create project button and ignore it
        const isCreateButton = e.target.closest('#projectListCreateBtn, #sidebarNewProjectBtn, #emptyStateCreateBtn');
        if (isCreateButton) {
            return; // Ignore clicks on create buttons
        }

        const projectCard = e.target.closest(".project-card");
        if (!projectCard) {
            this.notification.warn('[Debug] No .project-card ancestor on click event.');
            return;
        }

        const actionBtn = e.target.closest("[data-action]");
        const projectId = projectCard.dataset.projectId;
        if (!projectId) {
            this.notification.error('[Debug] Clicked card with missing data-project-id.');
            return;
        }

        // Try to find the full project object
        const projectObj = this.state.projects?.find((p) => p.id === projectId);

        // Debug log actual click
        this.notification.log(`[Debug] Project card clicked: projectId=${projectId}; isActionBtn=${!!actionBtn}`);

        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            this._handleAction(action, projectId);
        } else {
            // Debug before navigation
            this.notification.log(`[Debug] Navigating to project details for: ${projectId}...`);
            // Prefer passing the project object to the navigation callback
            this.onViewProject(projectObj || projectId);
        }
    }

    /** Dispatch actions (view/edit/delete) */
    _handleAction(action, projectId) {
        const project = this.state.projects.find((p) => p.id === projectId);
        if (!project) {
            this.notification.warn(
                `[ProjectListComponent] Project not found: ${projectId}`
            );
            return;
        }
        switch (action) {
            case "view":
                this.onViewProject(project);
                break;
            case "edit":
                this._openEditModal(project);
                break;
            case "delete":
                this._confirmDelete(project);
                break;
            default:
                this.notification.warn(
                    `[ProjectListComponent] Unknown action: ${action}`
                );
        }
    }

    _handleProjectCreated(project) {
        if (!project) return;
        this.state.projects.unshift(project);
        this.renderProjects(this.state.projects);
    }

    _handleProjectUpdated(updatedProject) {
        if (!updatedProject) return;
        const idx = this.state.projects.findIndex(
            (p) => p.id === updatedProject.id
        );
        if (idx >= 0) {
            this.state.projects[idx] = updatedProject;
            this.renderProjects(this.state.projects);
        }
    }

    /** Bind New Project buttons */
    _bindCreateProjectButtons() {
        if (!this.modalManager) return;
        if (!this.eventHandlers?.trackListener) {
            throw new Error(
                "[ProjectListComponent] eventHandlers.trackListener is required for button events."
            );
        }
        const buttonIds = [
            "projectListCreateBtn",
            "sidebarNewProjectBtn",
            "emptyStateCreateBtn"
        ];
        buttonIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            const handler = () => this._openNewProjectModal();
            this.eventHandlers.trackListener(btn, "click", handler, {
                description: `Open New Project Modal (${id})`
            });
        });
    }

    _openNewProjectModal() {
        if (!this.modalManager?.show) {
            this.notification.error(
                "[ProjectListComponent] modalManager.show is unavailable"
            );
            return;
        }
        this.modalManager.show("project");
    }

    _openEditModal(project) {
        if (!this.modalManager?.show) {
            this.notification.error(
                "[ProjectListComponent] modalManager.show is unavailable"
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

    /** Confirmation via notificationHandler */
    async _confirmDelete(project) {
        const ok = await this.notification.confirm(
            `Delete "${project.name}"? This cannot be undone.`
        );
        if (ok) this._executeDelete(project.id);
    }

    async _executeDelete(projectId) {
        if (!this.projectManager?.deleteProject) {
            this.notification.error(
                "[ProjectListComponent] projectManager.deleteProject is not available."
            );
            return;
        }
        try {
            await this.projectManager.deleteProject(projectId);
            this.app?.showNotification?.("Project deleted", "success");
            this._loadProjects();
        } catch (err) {
            this.notification.error(
                "[ProjectListComponent] Failed to delete project:",
                err
            );
            this.app?.showNotification?.("Failed to delete project", "error");
        }
    }

    /** Loading skeletons */
    _showLoadingState() {
        if (!this.gridElement) return;
        this._clearElement(this.gridElement);

        // Use a responsive grid container for loading state
        this.gridElement.classList.add("grid", "project-list");
        for (let i = 0; i < 6; i++) {
            const skeleton = document.createElement("div");
            skeleton.className = "bg-base-200 animate-pulse rounded-box p-4 mb-2 max-w-full w-full";
            const raw = `
              <div class="h-6 bg-base-300 rounded w-3/4 mb-3"></div>
              <div class="h-4 bg-base-300 rounded w-full mb-2"></div>
              <div class="h-4 bg-base-300 rounded w-2/3 mb-2"></div>
              <div class="h-3 bg-base-300 rounded w-1/3 mt-6"></div>
            `;
            this._setElementHTML(skeleton, raw);
            this.gridElement.appendChild(skeleton);
        }
    }

    /** Empty state UI */
    _showEmptyState() {
        if (!this.gridElement) return;
        this._clearElement(this.gridElement);
        this.gridElement.classList.add("grid", "project-list");
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "project-list-empty";
        if (!this.sanitizer || typeof this.sanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] Missing sanitizer implementation");
        }
        emptyDiv.innerHTML = this.sanitizer.sanitize(`
          <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p class="mt-4 text-lg text-base-content">No projects found</p>
          <p class="mt-1">Create a new project to get started</p>
          <button id="emptyStateCreateBtn" class="btn btn-primary mt-4">Create Project</button>
        `);
        this.gridElement.appendChild(emptyDiv);

        const createBtn = document.getElementById("emptyStateCreateBtn");
        if (createBtn) {
            this.eventHandlers.trackListener(
                createBtn,
                "click",
                () => this._openNewProjectModal(),
                { description: "EmptyState: Create Project" }
            );
        }
    }

    /** Login required UI */
    _showLoginRequired() {
        if (!this.element) return;
        this._clearElement(this.element);
        this.element.classList.add("grid", "project-list");
        const loginDiv = document.createElement("div");
        loginDiv.className = "project-list-fallback";
        if (!this.sanitizer || typeof this.sanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] Missing sanitizer implementation");
        }
        loginDiv.innerHTML = this.sanitizer.sanitize(`
          <p class="mt-4 text-lg">Please log in to view your projects</p>
          <button id="loginButton" class="btn btn-primary mt-4">Login</button>
        `);
        this.element.appendChild(loginDiv);

        const loginBtn = document.getElementById("loginButton");
        if (loginBtn) {
            this.eventHandlers.trackListener(loginBtn, "click", (e) => {
                e.preventDefault();
                document.dispatchEvent(new CustomEvent("requestLogin"));
            });
        }
    }

    /** Error UI */
    _showErrorState(message) {
        this.notification.error("[ProjectListComponent] Error state shown with message:", message);
        if (!this.element) {
            this.notification.error("[ProjectListComponent] Cannot show error state, this.element is null/undefined");
            return;
        }
        this._clearElement(this.element);
        this.element.classList.add("grid", "project-list");
        const msg = message || "An unknown error occurred.";
        const errorDiv = document.createElement("div");
        errorDiv.className = "project-list-error";
        if (!this.sanitizer || typeof this.sanitizer.sanitize !== "function") {
            throw new Error("[ProjectListComponent] Missing sanitizer implementation");
        }
        errorDiv.innerHTML = this.sanitizer.sanitize(`
          <svg class="w-16 h-16 mx-auto text-error/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="mt-4 text-lg text-error">${msg}</p>
          <button id="retryButton" class="btn btn-outline btn-error mt-4">Retry</button>
          <div class="mt-4 text-sm text-base-content/70">If the issue persists, check console logs for more details.</div>
        `);
        this.element.appendChild(errorDiv);
        const retryBtn = document.getElementById("retryButton");
        if (retryBtn) {
            this.eventHandlers.trackListener(
                retryBtn,
                "click",
                () => this._loadProjects(),
                { description: "ProjectList: Retry Load Projects" }
            );
        }
    }

    /** Create a project card element */
    _createProjectCard(project) {
        const theme = this.state.customization.theme || "default";
        const themeBg = theme === "default" ? "bg-base-100" : `bg-${theme}`;
        const themeText = theme === "default" ? "text-base-content" : `text-${theme}-content`;

        const card = document.createElement("div");
        card.className = `project-card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-all border border-base-300 rounded-box p-4 flex flex-col h-full mb-3 max-w-full w-full overflow-x-auto`;
        card.dataset.projectId = project.id;

        // Header
        const header = document.createElement("div");
        header.className = "flex justify-between items-start";

        const title = document.createElement("h3");
        title.className = "font-semibold text-lg sm:text-xl mb-2 project-name truncate";
        title.textContent = project.name || "Unnamed Project";

        // Action Buttons
        const actions = document.createElement("div");
        actions.className = "flex gap-1";
        [
            {
                action: "view",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          `,
                title: "View"
            },
            {
                action: "edit",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          `,
                title: "Edit"
            },
            {
                action: "delete",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          `,
                title: "Delete",
                className: "text-error hover:bg-error/10"
            }
        ].forEach((btnDef) => {
            const btn = document.createElement("button");
            btn.className = `btn btn-ghost btn-xs btn-square min-w-[44px] min-h-[44px] ${btnDef.className || ""}`;
            btn.setAttribute("aria-label", btnDef.title);
            btn.dataset.action = btnDef.action;
            btn.title = btnDef.title;
            this._setElementHTML(btn, btnDef.icon);
            actions.appendChild(btn);
        });

        header.appendChild(title);
        header.appendChild(actions);
        card.appendChild(header);

        // Description
        if (this.state.customization.showDescription && project.description) {
            const description = document.createElement("p");
            description.className = "text-sm text-base-content/70 mb-3 line-clamp-2";
            description.textContent = project.description;
            card.appendChild(description);
        }

        // Footer
        const footer = document.createElement("div");
        footer.className = "mt-auto pt-2 flex justify-between text-xs text-base-content/70";

        if (this.state.customization.showDate && project.updated_at) {
            const dateEl = document.createElement("span");
            dateEl.textContent = this._formatDate(project.updated_at);
            footer.appendChild(dateEl);
        }

        const badges = document.createElement("div");
        badges.className = "flex gap-1";
        if (project.pinned) {
            const pinBadge = document.createElement("span");
            pinBadge.textContent = "📌";
            pinBadge.classList.add("tooltip");
            pinBadge.dataset.tip = "Pinned";
            badges.appendChild(pinBadge);
        }
        if (project.archived) {
            const archiveBadge = document.createElement("span");
            archiveBadge.textContent = "📦";
            archiveBadge.classList.add("tooltip");
            archiveBadge.dataset.tip = "Archived";
            badges.appendChild(archiveBadge);
        }

        footer.appendChild(badges);
        card.appendChild(footer);

        return card;
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
        } catch {
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
}
