/**
 * @file projectDetailsComponent.js
 * @description Aligned version (2025-06-11). This component now acts as a thin controller,
 * orchestrating the renderer, data coordinator, and other services. It adheres strictly
 * to the project's dependency injection and single-responsibility principles.
 */

const MODULE_CONTEXT = 'ProjectDetailsComponent';

export function createProjectDetailsComponent(dependencies) {
    const {
        DependencySystem,
        domAPI,
        eventHandlers,
        eventService,
        logger,
        navigationService,
        uiStateService,
        projectContextService,
        authenticationService,
        projectDetailsRenderer,
        projectDataCoordinator,
        chatManager,
        knowledgeBaseComponent,
    } = dependencies;

    // 1. Strict Dependency Validation
    const requiredDeps = [
        'DependencySystem', 'domAPI', 'eventHandlers', 'eventService', 'logger',
        'navigationService', 'uiStateService', 'projectContextService',
        'authenticationService', 'projectDetailsRenderer', 'projectDataCoordinator',
        'chatManager', 'knowledgeBaseComponent'
    ];

    for (const dep of requiredDeps) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    class ProjectDetailsComponent {
        constructor() {
            this.elements = {
                container: null,
                backBtn: null,
                tabBtns: [],
                tabs: {},
            };
            this._logInfo('Component instance created.');
        }

        get projectId() {
            return projectContextService.getCurrentProjectId();
        }

        async initialize() {
            this._logInfo('Initializing...');
            this.elements.container = domAPI.getElementById('projectDetailsView');
            if (!this.elements.container) {
                this._logError('Container #projectDetailsView not found. Initialization aborted.');
                return;
            }
            this._bindEventListeners();
            this._logInfo('Initialization complete.');
        }

        async show({ projectId, activeTab = 'details' }) {
            this._logInfo(`Showing for project: ${projectId}, tab: ${activeTab}`);
            if (!this.elements.container) await this.initialize();
            
            domAPI.removeClass(this.elements.container, 'hidden');
            uiStateService.setState(MODULE_CONTEXT, 'visible', true);

            // Set the project context centrally. This will trigger other listeners.
            projectContextService.setCurrentProject({ id: projectId });
            
            this.switchTab(activeTab);
        }

        hide() {
            this._logInfo('Hiding component.');
            if (this.elements.container) {
                domAPI.addClass(this.elements.container, 'hidden');
            }
            uiStateService.setState(MODULE_CONTEXT, 'visible', false);
        }

        switchTab(tabName) {
            if (!tabName) return;
            this._logInfo(`Switching to tab: ${tabName}`);
            uiStateService.setState(MODULE_CONTEXT, 'activeTab', tabName);

            projectDetailsRenderer.setActiveTab(tabName);
            this._loadTabContent(tabName);
        }

        _loadTabContent(tabName) {
            const pid = this.projectId;
            if (!pid) {
                this._logWarn('Cannot load tab content, no project ID is set.');
                return;
            }

            this._logInfo(`Loading content for tab: ${tabName}`);
            switch (tabName) {
                case 'details':
                    projectDataCoordinator.loadProjectData(pid);
                    break;
                case 'files':
                    projectDataCoordinator.loadProjectFiles(pid);
                    break;
                case 'chat':
                case 'conversations': // Handle legacy naming
                    chatManager.initialize({ projectId: pid });
                    projectDataCoordinator.loadProjectConversations(pid);
                    break;
                case 'knowledge':
                    knowledgeBaseComponent.initialize(true, null, pid);
                    break;
                case 'settings':
                    // Settings tab might not need an immediate data load.
                    break;
            }
        }

        _bindEventListeners() {
            eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });

            // Listen to data loading events from the coordinator
            eventService.on('project:dataLoaded', ({ detail }) => {
                if (detail.projectId === this.projectId) {
                    projectDetailsRenderer.renderProject(detail.projectData);
                }
            }, { context: MODULE_CONTEXT });

            eventService.on('project:filesLoaded', ({ detail }) => {
                if (detail.projectId === this.projectId) {
                    projectDetailsRenderer.renderFiles(detail.files);
                }
            }, { context: MODULE_CONTEXT });

            eventService.on('project:conversationsLoaded', ({ detail }) => {
                if (detail.projectId === this.projectId) {
                    projectDetailsRenderer.renderConversations(detail.conversations);
                }
            }, { context: MODULE_CONTEXT });
            
            // Listen for UI interaction eventsbubbled up from the renderer
            eventService.on('ui:projectDetails:backClicked', () => {
                navigationService.navigateToProjectList();
            }, { context: MODULE_CONTEXT });
            
            eventService.on('ui:projectDetails:tabClicked', ({ detail }) => {
                this.switchTab(detail.tabName);
            }, { context: MODULE_CONTEXT });

            eventService.on('ui:projectDetails:deleteFileClicked', ({ detail }) => {
                projectDataCoordinator.deleteFile(this.projectId, detail.fileId, detail.fileName);
            }, { context: MODULE_CONTEXT });

            eventService.on('ui:projectDetails:downloadFileClicked', ({ detail }) => {
                projectDataCoordinator.downloadFile(this.projectId, detail.fileId, detail.fileName);
            }, { context: MODULE_CONTEXT });
        }

        cleanup() {
            this._logInfo('Cleaning up listeners and state.');
            eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
            uiStateService.clearState(MODULE_CONTEXT);
        }

        _logInfo(msg, meta = {}) {
            logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
        }

        _logWarn(msg, meta = {}) {
            logger.warn(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
        }
        
        _logError(msg, err) {
            logger.error(`[${MODULE_CONTEXT}] ${msg}`, err, { context: MODULE_CONTEXT });
        }
    }

    const instance = new ProjectDetailsComponent();

    // The public API of the component.
    return {
        initialize: () => instance.initialize(),
        show: (options) => instance.show(options),
        hide: () => instance.hide(),
        cleanup: () => instance.cleanup(),
    };
}
