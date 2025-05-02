/**
 * ProjectListComponent
 *
 * Refactored to remove direct usage of:
 *   - window.location
 *   - localStorage
 *   - console.log
 *
 * All dependencies must be injected explicitly.
 *
 * Usage:
 *   import { ProjectListComponent } from './projectListComponent.js';
 *   const projectList = new ProjectListComponent({
 *     projectManager,
 *     eventHandlers,
 *     modalManager,
 *     loggerService,
 *     storageService,
 *     navigationService,
 *     app
 *   });
 *   projectList.initialize();
 */

export class ProjectListComponent {
    /**
     * ProjectListComponent constructor.
     * @param {Object} deps
     * @param {Object} deps.projectManager        - ProjectManager instance (required)
     * @param {Object} deps.eventHandlers         - EventHandlers instance (required, must have trackListener)
     * @param {Object} [deps.modalManager]        - ModalManager instance (optional)
     * @param {Object} [deps.storageService]      - Storage service for saving/loading customization, no localStorage fallback
     * @param {Object} [deps.loggerService]       - Logger or notification service (no direct console usage)
     * @param {Object} [deps.navigationService]   - For changing URL or handling project navigation
     * @param {Object} [deps.app]                 - Optional main app (for config or showNotification)
     */
    constructor({
        projectManager,
        eventHandlers,
        modalManager,
        storageService,
        loggerService,
        navigationService,
        app
    } = {}) {
        if (!projectManager || !eventHandlers) {
            throw new Error(
                "[ProjectListComponent] Missing required dependencies: 'projectManager' and 'eventHandlers'."
            );
        }
        this.projectManager = projectManager;
        this.eventHandlers = eventHandlers;
        this.modalManager = modalManager || null;
        this.storage = storageService || null;
        this.logger = loggerService || null;
        this.navigator = navigationService || null;
        this.app = app || null;

        /**
         * onViewProject callback:
         * Instead of using window.location, rely on an injected navigation function
         * or no-op if not provided.
         */
        this.onViewProject = (projectId) => {
            if (this.navigator?.goToProject) {
                this.navigator.goToProject(projectId);
            } else {
                this._logInfo(
                    `[ProjectListComponent] No navigationService.goToProject provided. Project ID: ${projectId}`
                );
            }
        };

        // Element ID is fixed
        this.elementId = "projectList";

        // State
        this.state = {
            projects: [],
            filter: "all",
            loading: false,
            customization: this._loadCustomization(),
            initialized: false,
        };

        // DOM element reference
        this.element = null;
    }

    /**
     * Call once the DOM is guaranteed to have #projectList in place.
     */
    initialize() {
        if (this.state.initialized) {
            this._logInfo("[ProjectListComponent] Already initialized.");
            return;
        }

        this.element = document.getElementById(this.elementId);
        if (!this.element) {
            throw new Error(`[ProjectListComponent] Element #${this.elementId} not found`);
        }

        // Bind event listeners
        this._bindEventListeners();

        // Bind "Create Project" buttons if they exist
        this._bindCreateProjectButtons();

        // Mark as initialized
        this.state.initialized = true;
        this._logInfo("[ProjectListComponent] Initialized successfully.");

        // Optionally auto-load projects
        this._loadProjects();
    }

    /**
     * Binds all relevant event listeners for filtering, project events, etc.
     */
    _bindEventListeners() {
        // (1) Listen for 'projectsLoaded'
        const projectsLoadedHandler = (e) => this.renderProjects(e.detail);
        this.eventHandlers.trackListener(document, "projectsLoaded", projectsLoadedHandler, {
            description: "ProjectList: projectsLoaded",
        });

        // (2) Handle clicks on project cards
        this.eventHandlers.trackListener(
            this.element,
            "click",
            (e) => this._handleCardClick(e),
            { description: "ProjectList: Card Click" }
        );

        // (3) Listen for "projectCreated" and "projectUpdated"
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

        // (4) Listen for auth state changes
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

        // (5) Bind filter tab events if present
        this._bindFilterEvents();
    }

    /**
     * Binds events for filter tabs inside #projectFilterTabs.
     */
    _bindFilterEvents() {
        const container = document.getElementById("projectFilterTabs");
        if (!container) return;

        const tabs = container.querySelectorAll(".tab[data-filter]");
        tabs.forEach((tab) => {
            const filterValue = tab.dataset.filter;
            if (!filterValue) return;
            const clickHandler = () => this._setFilter(filterValue);
            this.eventHandlers.trackListener(tab, "click", clickHandler, {
                description: `ProjectList: Filter tab click (${filterValue})`,
            });
        });
    }

    _setFilter(filter) {
        this.state.filter = filter;
        this._updateActiveTab();
        this._updateUrl(filter);
        this._loadProjects();
    }

    _updateActiveTab() {
        const tabs = document.querySelectorAll("#projectFilterTabs .tab[data-filter]");
        tabs.forEach((tab) => {
            const isActive = tab.dataset.filter === this.state.filter;
            tab.classList.toggle("tab-active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });
    }

    /**
     * Instead of direct window.location usage,
     * we rely on an injected navigation service or just catch errors.
     */
    _updateUrl(filter) {
        if (!this.navigator?.updateUrl) {
            // fallback: log a warning or no-op
            this._logInfo("[ProjectListComponent] No navigator.updateUrl provided, cannot update URL with filter.");
            return;
        }
        try {
            this.navigator.updateUrl({ filter });
        } catch (err) {
            this._logWarn("[ProjectListComponent] Failed to update URL with filter:", err);
        }
    }

    /**
     * Renders projects using the data provided.
     * @param {Object|Array} data - The payload containing projects.
     */
    renderProjects(data) {
        const projects = this._extractProjects(data);
        this.state.projects = projects || [];
        if (!this.element) {
            this._logError(`[ProjectListComponent.renderProjects] #${this.elementId} is not in the DOM.`);
            return;
        }
        if (!projects?.length) {
            this._showEmptyState();
            return;
        }
        this.element.innerHTML = "";
        const fragment = document.createDocumentFragment();
        projects.forEach((project) => {
            if (project && typeof project === "object") {
                fragment.appendChild(this._createProjectCard(project));
            }
        });
        this.element.appendChild(fragment);
        this.show();
    }

    /**
     * Extract projects from the data payload.
     * @private
     */
    _extractProjects(data) {
        if (Array.isArray(data)) return data;

        // List possible paths
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
            if (valid && result?.id) return [result];
        }
        return [];
    }

    show() {
        if (!this.element) {
            this._logWarn("[ProjectListComponent.show] element is not found.");
            return;
        }
        this.element.classList.remove("hidden");
        this.element.style.display = "";

        const listView = document.getElementById("projectListView");
        if (listView) {
            listView.classList.remove("hidden", "opacity-0");
            listView.style.display = "";
        }
    }

    hide() {
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

    /**
     * Loads projects via projectManager.
     * @private
     */
    async _loadProjects() {
        if (this.state.loading) return;
        if (!this.projectManager?.loadProjects) {
            this._logWarn("[ProjectListComponent] projectManager.loadProjects is missing.");
            return;
        }
        this.state.loading = true;
        this._showLoadingState();
        try {
            // loadProjects will dispatch "projectsLoaded" or return data.
            await this.projectManager.loadProjects(this.state.filter);
        } catch (error) {
            this._logError("[ProjectListComponent] Error loading projects:", error);
            this._showErrorState("Failed to load projects");
        } finally {
            this.state.loading = false;
        }
    }

    _handleCardClick(e) {
        const projectCard = e.target.closest(".project-card");
        if (!projectCard) return;

        const actionBtn = e.target.closest("[data-action]");
        const projectId = projectCard.dataset.projectId;
        if (!projectId) return;

        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            this._handleAction(action, projectId);
        } else {
            this.onViewProject(projectId);
        }
    }

    _handleAction(action, projectId) {
        const project = this.state.projects.find((p) => p.id === projectId);
        if (!project) {
            this._logWarn(`[ProjectListComponent] Project not found: ${projectId}`);
            return;
        }
        switch (action) {
            case "view":
                this.onViewProject(projectId);
                break;
            case "edit":
                this._openEditModal(project);
                break;
            case "delete":
                this._confirmDelete(project);
                break;
            default:
                this._logWarn(`[ProjectListComponent] Unknown action: ${action}`);
        }
    }

    _handleProjectCreated(project) {
        if (!project) return;
        this.state.projects.unshift(project);
        this.renderProjects(this.state.projects);
    }

    _handleProjectUpdated(updatedProject) {
        if (!updatedProject) return;
        const idx = this.state.projects.findIndex((p) => p.id === updatedProject.id);
        if (idx >= 0) {
            this.state.projects[idx] = updatedProject;
            this.renderProjects(this.state.projects);
        }
    }

    /**
     * Binds "Create Project" buttons.
     */
    _bindCreateProjectButtons() {
        if (!this.modalManager) return;
        if (!this.eventHandlers?.trackListener) {
            throw new Error('[ProjectListComponent] eventHandlers.trackListener is required for button events.');
        }
        const buttonIds = [
            "projectListCreateBtn",
            "sidebarNewProjectBtn",
            "emptyStateCreateBtn",
        ];
        buttonIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            const handler = () => this._openNewProjectModal();
            this.eventHandlers.trackListener(btn, "click", handler, {
                description: `Open New Project Modal (${id})`,
            });
        });
    }

    _openNewProjectModal() {
        if (!this.modalManager?.show) {
            this._logError("[ProjectListComponent] modalManager.show is unavailable");
            return;
        }
        this.modalManager.show("project");
    }

    _openEditModal(project) {
        if (!this.modalManager?.show) {
            this._logError("[ProjectListComponent] modalManager.show is unavailable");
            return;
        }
        this.modalManager.show("project", {
            updateContent: (modalEl) => {
                const nameInput = modalEl.querySelector("#projectModalNameInput");
                if (nameInput) {
                    nameInput.value = project.name ?? "";
                }
            },
        });
    }

    _confirmDelete(project) {
        if (!this.modalManager?.confirmAction) {
            // fallback: use built-in confirm
            if (typeof window !== 'undefined'
                && window.confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                this._executeDelete(project.id);
            }
            return;
        }
        this.modalManager.confirmAction({
            title: "Delete Project",
            message: `Are you sure you want to delete "${project.name}"? This cannot be undone.`,
            confirmText: "Delete",
            confirmClass: "btn-error",
            onConfirm: () => this._executeDelete(project.id),
        });
    }

    async _executeDelete(projectId) {
        if (!this.projectManager?.deleteProject) {
            this._logError("[ProjectListComponent] projectManager.deleteProject is not available.");
            return;
        }
        try {
            await this.projectManager.deleteProject(projectId);
            this.app?.showNotification?.("Project deleted", "success");
            this._loadProjects();
        } catch (err) {
            this._logError("[ProjectListComponent] Failed to delete project:", err);
            this.app?.showNotification?.("Failed to delete project", "error");
        }
    }

    _showLoadingState() {
        if (!this.element) return;
        this.element.innerHTML = "";
        for (let i = 0; i < 6; i++) {
            const skeleton = document.createElement("div");
            skeleton.className = "bg-base-200 animate-pulse rounded-box p-4 mb-2 max-w-full w-full";
            skeleton.innerHTML = `
            <div class="h-6 bg-base-300 rounded w-3/4 mb-3"></div>
            <div class="h-4 bg-base-300 rounded w-full mb-2"></div>
            <div class="h-4 bg-base-300 rounded w-2/3 mb-2"></div>
            <div class="h-3 bg-base-300 rounded w-1/3 mt-6"></div>
          `;
            this.element.appendChild(skeleton);
        }
    }

    _showEmptyState() {
        if (!this.element) return;
        this.element.innerHTML = `
        <div class="col-span-3 text-center py-10 text-base-content/60">
          <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor"
              viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2
                     0 01-2 2H5a2 2 0 01-2-2v-6a2 2
                     0 012-2m14 0V9a2 2 0
                     00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2
                     0 012-2h6a2 2 0 012 2v2M7 7h10"
            ></path>
          </svg>
          <p class="mt-4 text-lg text-base-content">No projects found</p>
          <p class="mt-1">Create a new project to get started</p>
          <button id="emptyStateCreateBtn" class="btn btn-primary mt-4">Create Project</button>
        </div>
      `;
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

    _showErrorState(message) {
        if (!this.element) return;
        const msg = message || "An unknown error occurred.";
        this.element.innerHTML = `
        <div class="col-span-3 text-center py-10">
          <svg class="w-16 h-16 mx-auto text-error/60" fill="none" stroke="currentColor"
              viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M12 8v4m0 4h.01M21 12a9 9 0
                     11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="mt-4 text-lg text-error">${msg}</p>
          <button id="retryButton" class="btn btn-outline btn-error mt-4">Retry</button>
        </div>
      `;
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
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0
                       8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7
                       -4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
          `,
                title: "View",
            },
            {
                action: "edit",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M11 5H6a2 2 0
                       00-2 2v11a2 2 0
                       002 2h11a2 2 0
                       002-2v-5m-1.414-9.414a2 2
                       0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          `,
                title: "Edit",
            },
            {
                action: "delete",
                icon: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0
                       0116.138 21H7.862a2 2 0
                       01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1
                       0 00-1-1h-4a1 1 0
                       00-1 1v3M4 7h16"/>
            </svg>
          `,
                title: "Delete",
                className: "text-error hover:bg-error/10",
            },
        ].forEach((btnDef) => {
            const btn = document.createElement("button");
            btn.className = `btn btn-ghost btn-xs btn-square min-w-[44px] min-h-[44px] ${btnDef.className || ""}`;
            btn.setAttribute('aria-label', btnDef.title);
            btn.dataset.action = btnDef.action;
            btn.title = btnDef.title;
            btn.innerHTML = btnDef.icon;
            actions.appendChild(btn);
        });

        header.appendChild(title);
        header.appendChild(actions);
        card.appendChild(header);

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

        // Optional badges for pinned/archived status
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

    _formatDate(dateString) {
        if (!dateString) return "";
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch {
            return dateString;
        }
    }

    /**
     * Loads customization from injected storageService (no direct localStorage).
     */
    _loadCustomization() {
        if (!this.storage?.getItem) {
            // fallback to defaults
            this._logWarn("[ProjectListComponent] No storageService provided, using default customization.");
            return this._getDefaultCustomization();
        }
        try {
            const saved = this.storage.getItem("projectCardsCustomization");
            return saved ? JSON.parse(saved) : this._getDefaultCustomization();
        } catch (err) {
            this._logError("[ProjectListComponent] Failed to load customization:", err);
            return this._getDefaultCustomization();
        }
    }

    _getDefaultCustomization() {
        return {
            theme: "default",
            showDescription: true,
            showDate: true,
        };
    }

    // -------------------------------------------------------------------------
    // Logging Helpers to replace direct console.*
    // -------------------------------------------------------------------------

    _logInfo(msg, ...args) {
        if (this.logger?.info) {
            this.logger.info(msg, ...args);
        }
    }

    _logWarn(msg, ...args) {
        if (this.logger?.warn) {
            this.logger.warn(msg, ...args);
        }
    }

    _logError(msg, ...args) {
        if (this.logger?.error) {
            this.logger.error(msg, ...args);
        }
    }
}
