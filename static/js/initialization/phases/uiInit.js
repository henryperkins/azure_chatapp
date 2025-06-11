// ========================================
// FILE: /initialization/phases/uiInit.js
// ========================================
/**
 * UI Components Initialization
 * Handles template loading, component creation, and navigation setup
 * ~250 lines
 */

// UI component imports
import { createAuthHeaderUI } from "../../components/authHeaderUI.js";
import { createAuthFormListenerFactory } from "../../authFormListenerFactory.js";
import { createProjectDashboardUtils } from "../../projectDashboardUtils.js";

export function createUIInit(deps) {
    const {
        DependencySystem, domAPI, browserService, eventHandlers,
        domReadinessService, logger, APP_CONFIG, safeHandler,
        sanitizer, createProjectDetailsEnhancements,
        createTokenStatsManager, createKnowledgeBaseComponent,
        createChatExtensions, uiUtils
    } = deps;

    if (!DependencySystem || !domAPI || !browserService || !eventHandlers ||
        !domReadinessService || !logger || !APP_CONFIG || !safeHandler ||
        !sanitizer || !createProjectDetailsEnhancements ||
        !createTokenStatsManager || !createKnowledgeBaseComponent ||
        !createChatExtensions || !domReadinessService || !uiUtils) {
        throw new Error('[uiInit] Missing required dependencies for UI initialization.');
    }

    let _uiInitialized = false;

    async function setupSidebarControls() {
        logger.log('[UIInit] setupSidebarControls: no-op (handled by Sidebar module)', {
            context: 'uiInit:setupSidebarControls'
        });
    }

    async function loadProjectTemplates() {
        const htmlLoader = DependencySystem.modules.get('htmlTemplateLoader');
        if (!htmlLoader?.loadTemplate) {
            logger.error('[UIInit] htmlTemplateLoader.loadTemplate unavailable', {
                context: 'uiInit:loadTemplates'
            });
            return;
        }

        try {
            logger.log('[UIInit] Loading project templates', {
                context: 'uiInit:loadTemplates'
            });

            await htmlLoader.loadTemplate({
                url: '/static/html/project_list.html',
                containerSelector: '#projectListView',
                eventName: 'projectListHtmlLoaded'
            });

            await htmlLoader.loadTemplate({
                url: '/static/html/project_details.html',
                containerSelector: '#projectDetailsView',
                eventName: 'projectDetailsHtmlLoaded'
            });

            await htmlLoader.loadTemplate({
                url: '/static/html/modals.html',
                containerSelector: '#modalsContainer',
                eventName: 'modalsHtmlLoaded'
            });

            // Unhide the modals container after templates are loaded
            const modalsContainer = domAPI.getElementById('modalsContainer');
            if (modalsContainer) {
                domAPI.removeClass(modalsContainer, 'hidden');
                logger.debug('[UIInit] Modals container unhidden', {
                    context: 'uiInit:loadTemplates'
                });
            }

            logger.log('[UIInit] Project templates loaded', {
                context: 'uiInit:loadTemplates'
            });
        } catch (err) {
            logger.error('[UIInit] Failed to load project templates', err, {
                context: 'uiInit:loadTemplates'
            });
            throw err;
        }
    }

    async function waitForModalReadiness() {
        const modalMgr = DependencySystem.modules.get('modalManager');
        if (!modalMgr?.isReadyPromise) {
            throw new Error('[uiInit] ModalManager or isReadyPromise not available.');
        }

        const timeoutMS = 8000;
        let timedOut = false;

        await Promise.race([
            modalMgr.isReadyPromise(),
            new Promise((_, reject) =>
                browserService.getWindow().setTimeout(() => {
                    timedOut = true;
                    reject(new Error(`[uiInit] Modal readiness timeout after ${timeoutMS}ms.`));
                }, timeoutMS)
            )
        ]);

        if (timedOut) {
            throw new Error('[uiInit] ModalManager not ready within timeout.');
        }
    }

    function ensureBaseProjectContainers() {
        logger.info('[uiInit] ensureBaseProjectContainers ENTER', { context: 'uiInit:ensureBaseProjectContainers' });

        try {
            const doc = domAPI.getDocument?.();
            if (!doc) {
                logger.error('[uiInit] No document available', { context: 'uiInit:ensureBaseProjectContainers' });
                return;
            }

            const panel = domAPI.querySelector('#projectManagerPanel') || doc.body;
            if (!panel) {
                logger.error('[uiInit] No target panel', { context: 'uiInit:ensureBaseProjectContainers' });
                return;
            }

            let listFound = !!domAPI.querySelector('#projectListView');
            let detailsFound = !!domAPI.querySelector('#projectDetailsView');

            if (!listFound) {
                const list = domAPI.createElement('div');
                list.id = 'projectListView';
                list.className = 'project-list-view';
                list.dataset.dynamic = 'true';
                domAPI.appendChild(panel, list);
                logger.info('[uiInit] #projectListView dynamically inserted', { context: 'uiInit:ensureBaseProjectContainers' });
            }

            if (!detailsFound) {
                const details = domAPI.createElement('div');
                details.id = 'projectDetailsView';
                details.className = 'project-details-view hidden';
                details.dataset.dynamic = 'true';
                domAPI.appendChild(panel, details);
                logger.info('[uiInit] #projectDetailsView dynamically inserted', { context: 'uiInit:ensureBaseProjectContainers' });
            }
        } catch (err) {
            logger.error('[uiInit] ensureBaseProjectContainers failed', err, {
                context: 'uiInit:ensureBaseProjectContainers'
            });
        }
    }

    async function createAndRegisterUIComponents() {
        logger.log('[UIInit] Creating late-stage UI components', {
            context: 'uiInit:createAndRegisterUIComponents'
        });

        // Project Details Enhancements
        if (createProjectDetailsEnhancements) {
            const inst = createProjectDetailsEnhancements({
                domAPI, browserService, eventHandlers,
                domReadinessService, logger, sanitizer,
                DependencySystem
            });
            DependencySystem.register('projectDetailsEnhancements', inst);

            if (inst.initialize) {
                await inst.initialize().catch(err =>
                    logger.error('[UIInit] ProjectDetailsEnhancements init failed', err, {
                        context: 'uiInit:projectDetailsEnhancements'
                    })
                );
            }
        }

        // Token Stats Manager
        if (createTokenStatsManager) {
            const inst = createTokenStatsManager({
                apiClient: DependencySystem.modules.get('apiRequest'),
                domAPI, eventHandlers, browserService,
                modalManager: DependencySystem.modules.get('modalManager'),
                sanitizer, logger,
                safeHandler: DependencySystem.modules.get('safeHandler'),
                projectManager: DependencySystem.modules.get('projectManager'),
                app: DependencySystem.modules.get('appModule'),
                chatManager: DependencySystem.modules.get('chatManager'),
                domReadinessService, DependencySystem
            });

            // Replace proxy with real instance
            const proxy = DependencySystem.modules.get('tokenStatsManagerProxy');
            if (proxy && proxy.__isProxy && typeof proxy.setRealManager === 'function') {
                proxy.setRealManager(inst);
                DependencySystem.modules.delete('tokenStatsManager');
                DependencySystem.register('tokenStatsManager', inst);
            } else {
                DependencySystem.register('tokenStatsManager', inst);
            }

            if (typeof inst.initialize === 'function') {
                await inst.initialize().catch(err =>
                    logger.error('[UIInit] TokenStatsManager init failed', err, {
                        context: 'uiInit:tokenStatsManager'
                    })
                );
            }
        }

        // Wire up ProjectDashboard dependencies
        const pdDashboard = DependencySystem.modules.get('projectDashboard');
        const pdc = DependencySystem.modules.get('projectDetailsComponent');
        const plc = DependencySystem.modules.get('projectListComponent');

        if (pdDashboard) {
            if (pdc && typeof pdDashboard.setProjectDetailsComponent === 'function') {
                pdDashboard.setProjectDetailsComponent(pdc);
            }
            if (plc && typeof pdDashboard.setProjectListComponent === 'function') {
                pdDashboard.setProjectListComponent(plc);
            }

            if (typeof pdDashboard.initialize === 'function' && !pdDashboard.__initialized) {
                try {
                    await domReadinessService.waitForEvent('authReady', { timeout: 30000 });
                    if (!pdDashboard.__initialized) {
                        await pdDashboard.initialize();
                        pdDashboard.__initialized = true;
                    }
                } catch (err) {
                    logger.error('[UIInit] ProjectDashboard.initialize failed', err, {
                        context: 'uiInit:projectDashboardInit'
                    });
                }
            }
        }

        // Auth Header UI Component
        try {
            const authHeaderUI = createAuthHeaderUI({
                domAPI,
                eventHandlers,
                safeHandler: DependencySystem.modules.get('safeHandler'),
                eventService: DependencySystem.modules.get('eventService'),
                logger
            });
            DependencySystem.register('authHeaderUI', authHeaderUI);
            
            if (typeof authHeaderUI.initialize === 'function') {
                await authHeaderUI.initialize().catch(err =>
                    logger.error('[UIInit] AuthHeaderUI init failed', err, {
                        context: 'uiInit:authHeaderUI'
                    })
                );
            }
        } catch (err) {
            logger.error('[UIInit] Failed to create AuthHeaderUI', err, {
                context: 'uiInit:authHeaderUI'
            });
        }

        // Auth Form Listener Factory
        try {
            const authFormListenerFactory = createAuthFormListenerFactory({
                eventHandlers,
                domAPI,
                domReadinessService: DependencySystem.modules.get('domReadinessService'),
                browserService: DependencySystem.modules.get('browserService'),
                safeHandler: DependencySystem.modules.get('safeHandler'),
                logger,
                modalManager: DependencySystem.modules.get('modalManager'),
                authApiService: DependencySystem.modules.get('authApiService')
            });
            DependencySystem.register('authFormListenerFactory', authFormListenerFactory);
        } catch (err) {
            logger.error('[UIInit] Failed to create AuthFormListenerFactory', err, {
                context: 'uiInit:authFormListenerFactory'
            });
        }

        // Project Dashboard Utils
        try {
            const projectDashboardUtils = createProjectDashboardUtils({
                DependencySystem,
                logger,
                domAPI,
                eventHandlers,
                sanitizer,
                globalUtils: DependencySystem.modules.get('globalUtils'),
                modalManager: DependencySystem.modules.get('modalManager'),
                projectManager: DependencySystem.modules.get('projectManager')
            });
            DependencySystem.register('projectDashboardUtils', projectDashboardUtils);
        } catch (err) {
            logger.error('[UIInit] Failed to create ProjectDashboardUtils', err, {
                context: 'uiInit:projectDashboardUtils'
            });
        }

        logger.log('[UIInit] Late-stage UI components registered', {
            context: 'uiInit:createAndRegisterUIComponents'
        });
    }

    async function registerNavigationViews() {
        const navSvc = DependencySystem.modules.get('navigationService');
        if (!navSvc || typeof navSvc.registerView !== 'function') {
            throw new Error('[uiInit] NavigationService missing registerView');
        }

        try {
            // Register project list view
            if (!navSvc.hasView('projectList')) {
                navSvc.registerView('projectList', {
                    show: async () => {
                        const dash = DependencySystem.modules.get('projectDashboard');
                        if (dash?.components?.projectList?.show) {
                            await dash.components.projectList.show();
                            return true;
                        }
                        const plc = DependencySystem.modules.get('projectListComponent');
                        if (plc?.show) {
                            await plc.show();
                            return true;
                        }
                        throw new Error('[uiInit] Cannot show projectList');
                    },
                    hide: async () => {
                        const dash = DependencySystem.modules.get('projectDashboard');
                        if (dash?.components?.projectList?.hide) {
                            await dash.components.projectList.hide();
                            return true;
                        }
                        const plc = DependencySystem.modules.get('projectListComponent');
                        if (plc?.hide) {
                            await plc.hide();
                            return true;
                        }
                        throw new Error('[uiInit] Cannot hide projectList');
                    }
                });
            }

            // Register project details view
            if (!navSvc.hasView('projectDetails')) {
                navSvc.registerView('projectDetails', {
                    show: async ({ projectId }) => {
                        await domReadinessService.dependenciesAndElements({
                            deps: ['projectDashboard', 'projectDetailsComponent'],
                            timeout: 10000,
                            context: 'uiInit:nav:projectDetails'
                        });

                        const dash = DependencySystem.modules.get('projectDashboard');
                        if (dash?.showProjectDetails) {
                            await dash.showProjectDetails(projectId);

                            // Initialize KnowledgeBaseComponent if needed
                            const kbComp = DependencySystem.modules.get('knowledgeBaseComponent');
                            if (kbComp && (!kbComp.isInitialized || kbComp.isInitialized() === false) && typeof kbComp.initialize === 'function') {
                                try {
                                    await kbComp.initialize(true, null, projectId);
                                    logger.debug('[uiInit] KnowledgeBaseComponent initialized', { context: 'uiInit' });
                                } catch (err) {
                                    logger.error('[uiInit] KnowledgeBaseComponent initialization failed', err, { context: 'uiInit' });
                                }
                            }
                            return true;
                        }
                        throw new Error('[uiInit] Cannot show projectDetails');
                    },
                    hide: async () => {
                        const dash = DependencySystem.modules.get('projectDashboard');
                        if (dash?.components?.projectDetails?.hideProjectDetails) {
                            await dash.components.projectDetails.hideProjectDetails();
                            return true;
                        }
                        const pdc = DependencySystem.modules.get('projectDetailsComponent');
                        if (pdc?.hideProjectDetails) {
                            await pdc.hideProjectDetails();
                            return true;
                        }
                        throw new Error('[uiInit] Cannot hide projectDetails');
                    }
                });
            }

            logger.log('[UIInit] Navigation views registered', { context: 'uiInit:navigation' });
        } catch (err) {
            logger.error('[uiInit] Failed to register navigation views', err, {
                context: 'uiInit:registerNavigationViews'
            });
        }
    }

    async function initializeUIComponents() {
        if (_uiInitialized) {
            logger.debug('[uiInit] UI already initialized; skipping', {
                context: 'uiInit:initializeUIComponents'
            });
            return;
        }

        try {
            logger.log('[uiInit] Starting UI initialization...', { context: 'uiInit' });

            // Create base containers first
            ensureBaseProjectContainers();

            // Load templates into containers
            await loadProjectTemplates();

            // Wait for DOM elements
            await domReadinessService.dependenciesAndElements({
                domSelectors: ['#projectListView', '#projectDetailsView'],
                timeout: 10000,
                context: 'uiInit:initializeUIComponents:baseDomCheck'
            });

            await domReadinessService.dependenciesAndElements({
                domSelectors: ['#projectCardsPanel', '#projectFilterTabs'],
                observeMutations: true,
                timeout: APP_CONFIG?.TIMEOUTS?.PROJECT_LIST_ELEMENTS ?? 15000,
                context: 'uiInit:initializeUIComponents:projectListInnerSelectors'
            });

            await setupSidebarControls();
            await waitForModalReadiness();

            // Initialize event handlers
            if (eventHandlers.init) {
                await eventHandlers.init();
                logger.log('[uiInit] eventHandlers init complete', { context: 'uiInit' });
            }

            // Emit early readiness events
            try {
                logger.info('[uiInit] About to emit early app:ready event', { 
                    context: 'uiInit:earlyAppReady',
                    timestamp: Date.now()
                });
                domReadinessService.emitReplayable('app:ready');
                logger.info('[uiInit] Early app:ready event emitted successfully', { 
                    context: 'uiInit:earlyAppReady',
                    timestamp: Date.now()
                });
                
                const appModule = DependencySystem.modules.get('appModule');
                appModule.setAppLifecycleState({ isReady: true, currentPhase: 'ui_ready_partial' });
                logger.info('[uiInit] App state set to ready', { 
                    context: 'uiInit:earlyAppReady',
                    isReady: true
                });
            } catch (earlyEmitErr) {
                logger.error('[uiInit] Early app:ready emit failed', earlyEmitErr, {
                    context: 'uiInit:earlyAppReady'
                });
            }

            domReadinessService.emitReplayable('ui:templates:ready');
            await createAndRegisterUIComponents();
            await registerNavigationViews();

            logger.log('[uiInit] UI initialization complete', {
                context: 'uiInit:initializeUIComponents'
            });

            // Initialize remaining components
            const plc = DependencySystem.modules.get('projectListComponent');
            if (plc?.initialize) {
                try {
                    await plc.initialize();
                } catch (e) {
                    logger.error('[uiInit] projectListComponent.initialize failed', e, { context: 'uiInit' });
                }
            }

            const sidebar = DependencySystem.modules.get('sidebar');
            if (sidebar?.init) {
                try {
                    await sidebar.init();
                    logger.info('[uiInit] sidebar.init completed', { context: 'uiInit' });

                    // Initialize mobile dock
                    const mobileDock = sidebar.getMobileDock?.();
                    if (mobileDock?.init) {
                        await mobileDock.init();
                        mobileDock.ensureMobileDock?.();
                        logger.debug('[uiInit] Mobile dock initialised', { context: 'uiInit' });
                    }

                    // Initialize sidebar auth
                    const sidebarAuth = sidebar.getSidebarAuth?.();
                    if (sidebarAuth?.init) {
                        await sidebarAuth.init();
                        sidebarAuth.setupInlineAuthForm?.();

                        if (typeof sidebarAuth.forceAuthStateSync === 'function') {
                            try {
                                sidebarAuth.forceAuthStateSync();
                            } catch (syncErr) {
                                logger.warn('[uiInit] sidebarAuth.forceAuthStateSync threw', syncErr, { context: 'uiInit' });
                            }
                        }

                        logger.debug('[uiInit] SidebarAuth initialised', { context: 'uiInit' });
                    }
                } catch (err) {
                    logger.error('[uiInit] sidebar.init failed', err, { context: 'uiInit' });
                }
            }

            const a11yUtils = DependencySystem.modules.get('accessibilityUtils');
            if (a11yUtils?.init) {
                try {
                    await a11yUtils.init();
                    logger.debug('[uiInit] AccessibilityUtils initialised', { context: 'uiInit' });
                } catch (err) {
                    logger.error('[uiInit] AccessibilityUtils.init failed', err, { context: 'uiInit' });
                }
            }

            // Initialize chat extensions if feature enabled
            try {
                const chatExtensions = createChatExtensions({
                    DependencySystem,
                    eventHandlers,
                    eventService: DependencySystem.modules.get('eventService'),
                    chatManager: DependencySystem.modules.get('chatManager'),
                    app: DependencySystem.modules.get('appModule'),
                    domAPI,
                    domReadinessService,
                    logger,
                    extChatEnabled: true // Enable by default, can be feature-flagged later
                });
                
                DependencySystem.register('chatExtensions', chatExtensions);
                
                if (chatExtensions.init) {
                    await chatExtensions.init();
                    logger.debug('[uiInit] ChatExtensions initialized', { context: 'uiInit' });
                }
            } catch (err) {
                // Don't fail the entire UI init if chat extensions fail
                logger.warn('[uiInit] ChatExtensions initialization failed', err, { context: 'uiInit' });
            }

            _uiInitialized = true;
        } catch (err) {
            logger.error('[uiInit] Critical error in UI init', err, {
                context: 'uiInit:initializeUIComponents'
            });
            throw err;
        }
    }

    function cleanup() {
        eventHandlers.cleanupListeners({ context: 'uiInit' });
        logger.debug('[uiInit] Cleanup completed', { context: 'uiInit:cleanup' });
    }

    return {
        initializeUIComponents,
        waitForModalReadinessWithTimeout: async (timeout = 8000, context = 'waitForModalReadiness') => {
            await waitForModalReadiness();
            return true;
        },
        registerNavigationViews,
        cleanup
    };
}
