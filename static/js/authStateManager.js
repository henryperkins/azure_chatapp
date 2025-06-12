/**
 * @file authStateManager.js
 * @description Manages the application's authentication state. Single source of truth.
 */

const MODULE_CONTEXT = 'AuthStateManager';

export function createAuthStateManager(dependencies = {}) {
    let {
        appModule,
        eventService,
        logger,
        storageService,
        DependencySystem
    } = dependencies;

    // Allow lazy resolution of appModule via DependencySystem for early-boot
    const globalDS = globalThis?.DependencySystem;
    if (!appModule && (DependencySystem?.modules?.get || globalDS?.modules?.get)) {
        appModule = DependencySystem?.modules?.get?.('appModule') || globalDS?.modules?.get?.('appModule');
    }

    if (!appModule) {
        // Create minimal placeholder that will be replaced once DI is ready
        appModule = {
            state: { isAuthenticated: false, currentUser: null },
            setAuthState: (s) => {
                appModule.state = { ...appModule.state, ...s };
            }
        };
        logger?.warn?.(`[${MODULE_CONTEXT}] appModule not available yet – using temporary stub`);
    }
    const requiredDeps = ['eventService', 'logger', 'storageService'];
    for (const dep of requiredDeps) {
        if (!dependencies[dep] && !DependencySystem?.modules?.get?.(dep)) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    /* --------------------------------------------------------------------- */
    /*  Internal state                                                       */
    /* --------------------------------------------------------------------- */
    let lastVerificationTime = 0;

    function _broadcastStateChange(previousState) {
        eventService.emit('authStateChanged', {
            isAuthenticated: appModule.state.isAuthenticated,
            currentUser: appModule.state.currentUser,
            previousState
        });
    }

    /* --------------------------------------------------------------------- */
    /*  Public API                                                           */
    /* --------------------------------------------------------------------- */
    return {
        initializeFromStorage() {
            const raw = storageService.getItem('lastUser');
            if (raw) {
                try {
                    const user = JSON.parse(raw);
                    logger.info(`[${MODULE_CONTEXT}] Found last user in storage`, {
                        user: user?.username,
                        context: MODULE_CONTEXT
                    });
                    // Do not mark authenticated yet; wait for token verification.
                } catch {
                    storageService.removeItem('lastUser');
                }
            }
        },

        setAuthenticated(user, tokenVersion) {
            const prev = { ...appModule.state };
            appModule.setAuthState({
                isAuthenticated: true,
                currentUser: user,
                tokenVersion
            });
            storageService.setItem('lastUser', JSON.stringify(user));
            lastVerificationTime = Date.now();
            _broadcastStateChange(prev);
        },

        setUnauthenticated() {
            const prev = { ...appModule.state };
            appModule.setAuthState({
                isAuthenticated: false,
                currentUser: null,
                tokenVersion: null
            });
            storageService.removeItem('lastUser');
            _broadcastStateChange(prev);
        },

        isAuthenticated() {
            return appModule.state.isAuthenticated;
        },

        getCurrentUser() {
            return appModule.state.currentUser;
        },

        updateLastVerification() {
            lastVerificationTime = Date.now();
        },

        shouldVerifySession(thresholdMs = 5 * 60 * 1000) {
            if (!this.isAuthenticated()) return false;
            return Date.now() - lastVerificationTime > thresholdMs;
        }
    };
}
