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
        domReadinessService, APP_CONFIG
    } = deps;

    if (!DependencySystem || !domAPI || !eventHandlers ||
        !logger || !sanitizer || !safeHandler ||
        !domReadinessService || !APP_CONFIG) {
        throw new Error('[authInit] Missing required dependencies for auth initialization.');
    }

    async function initializeAuthSystem() {
        await domReadinessService.documentReady();
        await domReadinessService.dependenciesAndElements({
            deps: ['auth', 'eventHandlers'],
            domSelectors: ['#loginModalForm', '#authButton'],
            timeout: 8000,
            context: 'authInit.initializeAuthSystem'
        });

        const auth = DependencySystem.modules.get('auth');
        if (!auth?.init) {
            throw new Error('[authInit] Auth module is missing or invalid.');
        }

        // Register auth event listeners
        if (auth.AuthBus) {
            logger.info('[authInit] Registering AuthBus listeners', { context: 'authInit:init' });

            eventHandlers.trackListener(
                auth.AuthBus,
                'authStateChanged',
                safeHandler((event) => {
                    logger.info('[authInit][AuthBus] Received authStateChanged', event?.detail, { context: 'authInit:authStateChanged' });
                    handleAuthStateChange(event);
                }, 'AuthBus authStateChanged handler'),
                { description: '[authInit] AuthBus authStateChanged', context: 'authInit' }
            );

            eventHandlers.trackListener(
                auth.AuthBus,
                'authReady',
                safeHandler((event) => {
                    logger.info('[authInit][AuthBus] Received authReady', event?.detail, { context: 'authInit:authReady' });
                    handleAuthStateChange(event);
                }, 'AuthBus authReady handler'),
                { description: '[authInit] AuthBus authReady', context: 'authInit' }
            );
        } else {
            logger.warn('[authInit] No AuthBus instance for registration', { context: 'authInit:init' });
        }

        try {
            logger.info('[authInit] Calling auth.init()', { context: 'authInit:init' });
            await auth.init();
            eventHandlers.dispatch('authReady');
            renderAuthHeader();
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
        const projectManager = DependencySystem.modules.get('projectManager');

        logger.info('[authInit][handleAuthStateChange]', {
            eventDetail: event?.detail,
            appModuleState: JSON.stringify(appModuleLocal.state),
            context: 'authInit:handleAuthStateChange'
        });

        const isAuthenticated = appModuleLocal.state.isAuthenticated;
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

        renderAuthHeader();
    }

    function renderAuthHeader() {
        try {
            const appModuleLocal = DependencySystem.modules.get('appModule');
            if (!appModuleLocal) {
                logger.error('[authInit][renderAuthHeader] appModule not found.', {
                    context: 'authInit:renderAuthHeader'
                });
                return;
            }

            const isAuth = appModuleLocal.state.isAuthenticated;
            const user = appModuleLocal.state.currentUser;
            const displayName = user?.name || user?.username || 'User';

            logger.debug('[authInit][renderAuthHeader] Rendering auth header', {
                isAuth, user, context: 'authInit:renderAuthHeader'
            });

            // Update auth UI elements
            const authBtn = domAPI.getElementById('authButton');
            const userMenu = domAPI.getElementById('userMenu');
            const logoutBtn = domAPI.getElementById('logoutBtn');
            const userInitialsEl = domAPI.getElementById('userInitials');
            const authStatus = domAPI.getElementById('authStatus');
            const userStatus = domAPI.getElementById('userStatus');

            // Toggle visibility based on auth state
            if (authBtn) {
                if (isAuth) {
                    domAPI.addClass(authBtn, 'hidden');
                    domAPI.setStyle(authBtn, 'display', 'none');
                    domAPI.setAttribute(authBtn, 'hidden', 'hidden');
                } else {
                    domAPI.removeClass(authBtn, 'hidden');
                    domAPI.setStyle(authBtn, 'display', '');
                    domAPI.removeAttribute(authBtn, 'hidden');
                }
            }

            if (userMenu) {
                domAPI.toggleClass(userMenu, 'hidden', !isAuth);
                domAPI.setStyle(userMenu, 'display', isAuth ? '' : 'none');
                isAuth
                    ? domAPI.removeAttribute(userMenu, 'hidden')
                    : domAPI.setAttribute(userMenu, 'hidden', 'hidden');
            }

            // Update user initials
            if (userMenu && userInitialsEl) {
                let initials = 'U';
                if (isAuth) {
                    if (typeof user?.name === 'string' && user.name.trim().length > 0) {
                        initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
                    } else if (typeof user?.username === 'string' && user.username.trim().length > 0) {
                        initials = user.username.slice(0, 2).toUpperCase();
                    }
                }
                domAPI.setTextContent(userInitialsEl, initials);
            }

            // Update status texts
            if (authStatus) {
                domAPI.setTextContent(authStatus,
                    isAuth ? `Signed in as ${displayName}` : 'Not Authenticated'
                );
            }

            if (userStatus) {
                domAPI.setTextContent(userStatus,
                    isAuth ? `Hello, ${displayName}` : 'Offline'
                );
            }

            // Setup logout handler
            if (logoutBtn) {
                eventHandlers.trackListener(
                    logoutBtn,
                    'click',
                    safeHandler((e) => {
                        domAPI.preventDefault(e);
                        logger.debug('[authInit][renderAuthHeader] Logout clicked.', {
                            context: 'authInit:logout'
                        });
                        const authMod = DependencySystem.modules.get('auth');
                        authMod?.logout?.().catch(err => {
                            logger.error('[authInit] Error during logout:', err, {
                                context: 'authInit:logout'
                            });
                        });
                    }, 'Auth logout click'),
                    { description: 'Auth logout click', context: 'authInit' }
                );
            }
        } catch (err) {
            logger.error('[authInit][renderAuthHeader] Error during rendering', err, {
                context: 'authInit:renderAuthHeader'
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
        renderAuthHeader,
        forceShowLoginModal,
        cleanup
    };
}
