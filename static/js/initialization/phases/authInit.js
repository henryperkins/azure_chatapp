// ========================================
// FILE: /initialization/phases/authInit.js
// ========================================
/**
 * Authentication System Initialization
 * Handles auth setup, state changes, and UI updates
 * ~180 lines
 */

export function createAuthInit(deps) {
    const {
        DependencySystem, domAPI, eventHandlers,
        logger, sanitizer, safeHandler,
        domReadinessService, APP_CONFIG,
        authenticationService,
        eventService
    } = deps;

    // Lazy resolver for authenticationService in case it was not provided yet
    function _getAuthService() {
        return authenticationService || DependencySystem.modules.get('authenticationService');
    }

    if (!DependencySystem || !domAPI || !eventHandlers ||
        !logger || !sanitizer || !safeHandler ||
        !domReadinessService || !APP_CONFIG || !eventService) {
        throw new Error('[authInit] Missing required dependencies for auth initialization.');
    }

    async function initializeAuthSystem() {
        await domReadinessService.documentReady();
        await domReadinessService.dependenciesAndElements({
            deps: ['auth', 'eventHandlers'],
            // Wait only for elements that are guaranteed to be present in base.html.
            // `#loginModalForm` is injected later by uiInit via htmlTemplateLoader
            // and therefore must not block early auth initialization.
            domSelectors: ['#authButton'],
            timeout: 8000,
            context: 'authInit.initializeAuthSystem'
        });

        const auth = DependencySystem.modules.get('auth');
        if (!auth?.init) {
            throw new Error('[authInit] Auth module is missing or invalid.');
        }

        // Register auth event listeners via unified eventService
        logger.info('[authInit] Registering eventService auth listeners', { context: 'authInit:init' });

        eventService.on(
            'authStateChanged',
            safeHandler((event) => {
                logger.info('[authInit] Received authStateChanged', event?.detail, { context: 'authInit:authStateChanged' });
                handleAuthStateChange(event);
            }, 'eventService authStateChanged handler'),
            { context: 'authInit' }
        );

        // legacy 'authReady' alias emitted by auth.init()
        eventService.on(
            'authReady',
            safeHandler((event) => {
                logger.info('[authInit] Received authReady', event?.detail, { context: 'authInit:authReady' });
                handleAuthStateChange(event);
            }, 'eventService authReady handler'),
            { context: 'authInit' }
        );

        try {
            logger.info('[authInit] Calling auth.init()', { context: 'authInit:init' });
            await auth.init();
            
            // Force immediate auth state sync after initialization
            const isAuthenticated = auth.isAuthenticated();
            const currentUser = auth.getCurrentUser();
            
            logger.info('[authInit] Auth state after init', { 
                isAuthenticated, 
                currentUser: currentUser ? { id: currentUser.id, username: currentUser.username } : null,
                context: 'authInit:init' 
            });
            
            // Dispatch auth state to the app module and UI
            const appModule = DependencySystem.modules.get('appModule');
            if (appModule && typeof appModule.setAuthState === 'function') {
                appModule.setAuthState({
                    isAuthenticated,
                    currentUser
                });
            }
            
            // Emit events for other components to react
            eventHandlers.dispatch('authReady');
            eventHandlers.dispatch('authStateChanged', { 
                authenticated: isAuthenticated, 
                user: currentUser, 
                source: 'authInit' 
            });
            
            // Use the new authHeaderUI component instead of legacy renderAuthHeader
            updateAuthHeaderUI();
            return true;
        } catch (err) {
            logger.error('[authInit] Auth system initialization failed', err, {
                context: 'authInit:init'
            });
            throw err;
        }
    }

    function handleAuthStateChange(event) {
        const appModuleLocal = DependencySystem.modules.get('appModule');
        const projectManager  = DependencySystem.modules.get('projectManager');

        const isAuthenticated = _getAuthService()?.isAuthenticated?.() ?? false;

        logger.info('[authInit][handleAuthStateChange]', {
            eventDetail: event?.detail,
            isAuthenticated,
            context: 'authInit:handleAuthStateChange'
        });
        const navService = DependencySystem.modules.get('navigationService');
        const appReadyDispatched = DependencySystem.modules.get('appModule')?._appReadyDispatched;
        const readyNow = appReadyDispatched || appModuleLocal.state.isReady;

        const proceed = () => {
            if (navService?.navigateToProjectList) {
                navService.navigateToProjectList().catch(() => {});
            } else if (projectManager?.loadProjects) {
                projectManager.loadProjects('all').catch(() => {});
            }

            // Ensure auth modals are closed after successful authentication
            if (isAuthenticated) {
                try {
                    const modalManager = DependencySystem.modules.get?.('modalManager');
                    if (modalManager && typeof modalManager.hide === 'function') {
                        ['login', 'register'].forEach((modalName) => {
                            try { modalManager.hide(modalName); } catch { /* ignore */ }
                        });
                    }
                } catch (modalErr) {
                    logger.warn('[authInit][handleAuthStateChange] Unable to hide auth modals after login', modalErr, { context: 'authInit:handleAuthStateChange' });
                }
            }
        };

        if (isAuthenticated) {
            if (readyNow) {
                proceed();
            } else {
                domReadinessService.waitForEvent('app:ready', {
                    timeout: APP_CONFIG.TIMEOUTS?.APP_READY_WAIT ?? 30000,
                    context: 'authInit:handleAuthStateChange'
                }).then(proceed).catch(() => {});
            }
        }

        // Use the new authHeaderUI component instead of legacy renderAuthHeader
        updateAuthHeaderUI();
    }

    function updateAuthHeaderUI() {
        try {
            const authSvc = _getAuthService();
            const isAuthenticated = authSvc?.isAuthenticated?.() ?? false;
            const currentUser = authSvc?.getCurrentUser?.() || null;

            logger.debug('[authInit][updateAuthHeaderUI] Updating auth header via authHeaderUI component', {
                isAuthenticated, currentUser, context: 'authInit:updateAuthHeaderUI'
            });

            // Get the authHeaderUI component and trigger render with current state
            const authHeaderUI = DependencySystem.modules.get('authHeaderUI');
            if (authHeaderUI && typeof authHeaderUI.render === 'function') {
                authHeaderUI.render({ isAuthenticated, currentUser });
                
                // Setup logout handler if not already done
                if (isAuthenticated && typeof authHeaderUI.attachLogoutHandler === 'function') {
                    authHeaderUI.attachLogoutHandler(() => {
                        logger.debug('[authInit][updateAuthHeaderUI] Logout clicked via authHeaderUI.', {
                            context: 'authInit:logout'
                        });
                        const authMod = DependencySystem.modules.get('auth');
                        authMod?.logout?.().catch(err => {
                            logger.error('[authInit] Error during logout:', err, {
                                context: 'authInit:logout'
                            });
                        });
                    });
                }
            } else {
                logger.warn('[authInit][updateAuthHeaderUI] authHeaderUI component not available', {
                    context: 'authInit:updateAuthHeaderUI'
                });
            }

            // Also emit the event for other listeners
            eventService?.emit?.('authStateChanged', {
                isAuthenticated,
                currentUser,
                source: 'updateAuthHeaderUI'
            });
        } catch (err) {
            logger.error('[authInit][updateAuthHeaderUI] Error during auth header update', err, {
                context: 'authInit:updateAuthHeaderUI'
            });
        }
    }

    function forceShowLoginModal() {
        const appModuleLocal = DependencySystem.modules.get?.('appModule');
        if (appModuleLocal && !appModuleLocal.state?.isAuthenticated) {
            const modalManager = DependencySystem.modules.get?.('modalManager');
            if (modalManager && typeof modalManager.show === 'function') {
                modalManager.show('login');
            } else {
                throw new Error('[authInit][forceShowLoginModal] modalManager missing.');
            }
        }
    }

    function cleanup() {
        eventHandlers.cleanupListeners({ context: 'authInit' });
        logger.debug('[authInit] Cleanup completed', { context: 'authInit:cleanup' });
    }

    return {
        initializeAuthSystem,
        handleAuthStateChange,
        updateAuthHeaderUI,
        forceShowLoginModal,
        cleanup
    };
}
