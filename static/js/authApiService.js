/**
 * @file authApiService.js
 * @description Handles all authentication-related API communications.
 */

const MODULE_CONTEXT = 'AuthApiService';

export function createAuthApiService(dependencies = {}) {
    const {
        apiClient,
        apiEndpoints,
        logger,
        storageService: injectedStorage,
        DependencySystem
    } = dependencies;

    // Lazily resolve storageService if not directly supplied (early bootstrap)
    const globalDS = globalThis?.DependencySystem;
    const storageService = injectedStorage
        || DependencySystem?.modules?.get?.('storageService')
        || globalDS?.modules?.get?.('storageService');

    const requiredDeps = ['apiClient', 'apiEndpoints', 'logger'];
    for (const dep of requiredDeps) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    if (!storageService) {
        throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: storageService`);
    }

    /* ------------------- helpers ------------------- */
    function _persistTokens(resp) {
        if (resp?.access_token) {
            storageService.setItem('access_token', resp.access_token);
        }
        if (resp?.refresh_token) {
            storageService.setItem('refresh_token', resp.refresh_token);
        }
        return resp;
    }

    async function _post(url, body) {
        try {
            const resp = await apiClient.post(url, body);
            return _persistTokens(resp);
        } catch (err) {
            logger.error(`[${MODULE_CONTEXT}] POST ${url} failed`, err, { context: MODULE_CONTEXT });
            throw err;
        }
    }

    /* ------------------- public API ---------------- */
    return {
        async login(username, password) {
            return _post(apiEndpoints.AUTH_LOGIN, { username, password });
        },

        async logout() {
            try {
                await apiClient.post(apiEndpoints.AUTH_LOGOUT);
            } finally {
                storageService.removeItem('access_token');
                storageService.removeItem('refresh_token');
            }
        },

        async register({ username, email, password }) {
            return _post(apiEndpoints.AUTH_REGISTER, { username, email, password });
        },

        async verifySession() {
            try {
                return await apiClient.get(apiEndpoints.AUTH_VERIFY);
            } catch (err) {
                logger.warn(`[${MODULE_CONTEXT}] verifySession failed`, err, { context: MODULE_CONTEXT });
                throw err;
            }
        },

        getAccessToken() {
            return storageService.getItem('access_token');
        }
    };
}
