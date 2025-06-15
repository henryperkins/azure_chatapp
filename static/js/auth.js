/**
 * @file auth.js
 * @description Aligned version. This module orchestrates the authentication system,
 * delegating responsibilities to dedicated form, API, and state management services.
 */

const MODULE_CONTEXT = 'AuthModule';

export function createAuth(dependencies = {}) {
if (!dependencies.logger) {
        throw new Error("Missing logger dependency");
    }
    let {
        logger,
        eventService,
        modalManager,
        authFormHandler,
        authApiService,
        authStateManager,
        DependencySystem
    } = dependencies;

    // Allow lazy resolution from DI container to avoid early-boot failures.
    const resolveIfMissing = (name) => {
        if (!DependencySystem?.modules?.get) return undefined;
        return DependencySystem.modules.get(name);
    };

    logger           = logger           || resolveIfMissing('logger');
    eventService     = eventService     || resolveIfMissing('eventService');
    modalManager     = modalManager     || resolveIfMissing('modalManager');
    authFormHandler  = authFormHandler  || resolveIfMissing('authFormHandler');
    authApiService   = authApiService   || resolveIfMissing('authApiService');
    authStateManager = authStateManager || resolveIfMissing('authStateManager');

    // Provide safe fallbacks for test environments where UI pieces are not
    // injected.  These stubs implement the minimal surface used by AuthModule
    // so that unit tests focused on storage/API can run without DOM.
    const noop = () => {};

    if (!authFormHandler) {
        authFormHandler = {
            validate: noop,
            displayError: noop,
            showSuccess: noop,
            bindSubmissions: noop,
            cleanup: noop
        };
    }

    if (!authApiService) {
        const storageSvc = dependencies.storageService || resolveIfMissing('storageService') || {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        };
        authApiService = {
            login: async () => ({}),
            logout: async () => {},
            register: async () => ({}),
            verifySession: async () => ({}),
            getAccessToken: () => storageSvc.getItem('access_token')
        };
    }

    if (!authStateManager) {
        let _state = { isAuthenticated: false, currentUser: null };
        authStateManager = {
            setAuthenticated: (u) => { _state = { isAuthenticated: true, currentUser: u }; },
            setUnauthenticated: () => { _state = { isAuthenticated: false, currentUser: null }; },
            isAuthenticated: () => _state.isAuthenticated,
            getCurrentUser: () => _state.currentUser,
            initializeFromStorage: noop,
            updateLastVerification: noop,
            shouldVerifySession: () => false
        };
    }

    class AuthModule {
        constructor() {
            this.sessionCheckInterval = null;
        }

        async login(username, password) {
            logger.info('[AuthModule] Login attempt', { username, context: MODULE_CONTEXT });
            try {
                authFormHandler.validate(username, password);
                const response = await authApiService.login(username, password);
                authStateManager.setAuthenticated(response.user, response.token_version);
                modalManager.hide('login');
                logger.info('[AuthModule] Login successful', { user: response.user.username });
            } catch (err) {
                logger.error('[AuthModule] Login failed', err, { context: MODULE_CONTEXT });
                authFormHandler.displayError('login', err.message);
                throw err;
            }
        }

        async logout() {
            logger.info('[AuthModule] Logout attempt', { context: MODULE_CONTEXT });
            try {
                await authApiService.logout();
                authStateManager.setUnauthenticated();
                logger.info('[AuthModule] Logout successful');
            } catch (err) {
                logger.error('[AuthModule] Logout failed', err, { context: MODULE_CONTEXT });
                authStateManager.setUnauthenticated();
            }
        }

        async register({ username, email, password }) {
            logger.info('[AuthModule] Registration attempt', { username, context: MODULE_CONTEXT });
            try {
                authFormHandler.validate(username, password, email);
                await authApiService.register({ username, email, password });
                authFormHandler.showSuccess('register', 'Registration successful! Please log in.');
            } catch (err) {
                logger.error('[AuthModule] Registration failed', err, { context: MODULE_CONTEXT });
                authFormHandler.displayError('register', err.message);
                throw err;
            }
        }

        async verifySession() {
            if (!authStateManager.isAuthenticated()) return;
            logger.debug('[AuthModule] Verifying session', { context: MODULE_CONTEXT });
            try {
                await authApiService.verifySession();
                authStateManager.updateLastVerification();
            } catch (err) {
                logger.warn('[AuthModule] Session verification failed, logging out', { context: MODULE_CONTEXT });
                this.logout();
            }
        }

        async initialize() {
            logger.info('[AuthModule] Initializing', { context: MODULE_CONTEXT });
            authStateManager.initializeFromStorage();
            if (authStateManager.isAuthenticated()) {
                await this.verifySession();
            }
            this._startSessionMonitoring();
        }

        _startSessionMonitoring() {
            if (this.sessionCheckInterval) clearInterval(this.sessionCheckInterval);
            this.sessionCheckInterval = setInterval(() => {
                if (authStateManager.shouldVerifySession()) {
                    this.verifySession();
                }
            }, 60 * 1000); // Check every minute
        }

        cleanup() {
            logger.info('[AuthModule] Cleaning up', { context: MODULE_CONTEXT });
            if (this.sessionCheckInterval) clearInterval(this.sessionCheckInterval);
            authFormHandler.cleanup();
        }
    }

    const instance = new AuthModule();

    // Bind form submissions to the instance's methods
    authFormHandler.bindSubmissions({
        login: (data) => instance.login(data.username, data.password),
        register: (data) => instance.register(data),
    });

    return {
        initialize: () => instance.initialize(),
        init: () => instance.initialize(), // legacy alias for older callers
        logout: () => instance.logout(),
        isAuthenticated: () => authStateManager.isAuthenticated(),
        getCurrentUser: () => authStateManager.getCurrentUser(),
        getAccessToken: () => authApiService.getAccessToken(), // Delegate token access
        cleanup: () => instance.cleanup(),
    };
}
