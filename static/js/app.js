/**
 * Updated application script
 * - Replaced separate browserAPI, apiClient, and storageService imports
 *   with a single import from globalUtils.js
 */

import { createEventHandlers } from './eventHandler.js';
import * as globalUtils from './utils/globalUtils.js';  // <-- The key import for all related utilities
import { createChatManager } from './chat.js';
import { createNotificationHandler } from './notification-handler.js';
import { createNotify } from './utils/notify.js';
import { createModalManager } from './modalManager.js';
import { createAuthModule } from './auth.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal } from './modalManager.js';
import { createChatExtensions } from './chatExtensions.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { ProjectListComponent } from './projectListComponent.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
// Removed unused imports: initAccessibilityEnhancements, destroyAccessibilityEnhancements
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import MODAL_MAPPINGS from './modalConstants.js';
import { FileUploadComponent } from './FileUploadComponent.js';

// ─────────────────────────────────────────────────────────────────────────────
// Removed these lines:
// import { createBrowserAPI } from './browserAPI.js';
// import { createApiClient } from './utils/apiClient.js';
// import { createStorageService } from './utils/storageService.js';
// ─────────────────────────────────────────────────────────────────────────────

// Replace them with calls to the versions exported by globalUtils.js:
const browserAPI = globalUtils.createBrowserAPI();
let DependencySystem = browserAPI.getDependencySystem();
// Always get DI-injected notify util from DependencySystem; use for all user-facing notifications/errors
const notify = DependencySystem.modules.get && DependencySystem.modules.get('notify');
if (!DependencySystem) {
    if (typeof notify?.error === "function") {
        notify.error("CRITICAL: DependencySystem not found. Application cannot start.", { group: true, context: "app" });
    }
    browserAPI.getDocument().body.innerHTML = `
    <div style="padding: 2em; text-align: center; color: red; font-family: sans-serif;">
      <strong>Application Critical Error:</strong> Core dependency system failed to load.
      Please contact support or refresh.
    </div>`;
    throw new Error("DependencySystem is required but not available.");
}
DependencySystem.register('browserAPI', browserAPI);
const waitFor = DependencySystem.waitFor.bind(DependencySystem);

// ---------------------------------------------------------------------
// Local app config & state
// ---------------------------------------------------------------------
const browserAPIFromDS = DependencySystem.modules?.get('browserAPI');
const _location = browserAPIFromDS?.getLocation ? browserAPIFromDS.getLocation() : browserAPI.getLocation();
const API_ENDPOINTS = {
    AUTH_LOGIN: '/api/auth/login',
    AUTH_REGISTER: '/api/auth/register',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_VERIFY: '/api/auth/verify',
    PROJECTS: '/api/projects',
    PROJECT_DETAILS: '/api/projects/{projectId}',
    PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations',
    PROJECT_FILES: '/api/projects/{projectId}/files',
    PROJECT_ARTIFACTS: '/api/projects/{projectId}/artifacts',
    PROJECT_KNOWLEDGE_BASE: '/api/projects/{projectId}/knowledge_base'
};
DependencySystem.register('apiEndpoints', API_ENDPOINTS);

const APP_CONFIG = {
    DEBUG: _location.hostname === 'localhost' || _location.search.includes('debug=1'),
    TIMEOUTS: {
        INITIALIZATION: 15000,
        AUTH_CHECK: 5000,
        API_REQUEST: 10000,
        COMPONENT_LOAD: 5000,
        DEPENDENCY_WAIT: 10000
    },
    SELECTORS: {
        MAIN_SIDEBAR: '#mainSidebar',
        NAV_TOGGLE_BTN: '#navToggleBtn',
        SIDEBAR_PROJECTS: '#sidebarProjects',
        AUTH_BUTTON: '#authButton',
        USER_MENU_BUTTON: '#userMenuButton',
        USER_MENU: '#userMenu',
        PROJECT_LIST_VIEW: '#projectListView',
        PROJECT_DETAILS_VIEW: '#projectDetailsView',
        LOGIN_REQUIRED_MESSAGE: '#loginRequiredMessage',
        APP_LOADING_SPINNER: '#appLoading',
        APP_FATAL_ERROR: '#appFatalError',
        AUTH_STATUS_SPAN: '#authStatus',
        USER_STATUS_SPAN: '#userStatus'
    }
};

const appState = {
    initialized: false,
    initializing: false,
    currentPhase: 'idle',
    isAuthenticated: false
};

// ---------------------------------------------------------------------
// PendingRequests map & Deduplicated API request
// ---------------------------------------------------------------------
let apiRequest;  // We'll set this after our notification handler is ready


import { fetchCurrentUser } from './auth.js';

const eventHandlers = createEventHandlers({ DependencySystem });
DependencySystem.register('eventHandlers', eventHandlers);

let notificationHandlerWithLog = null;
function createNotificationShim(h) {
    const safeFn = (fn, fallbackType) => (...args) => {
        try {
            return fn.apply(h, args);
        } catch (err) {
            notificationHandlerWithLog?.error?.(`Error in notification ${fallbackType}:`, err);
            try {
                const msg = args[0] || `[${fallbackType}] Notification failed`;
                showSimpleNotification(msg, fallbackType, document.body);
            } catch (e) {
                notificationHandlerWithLog?.error?.(`[${fallbackType}] ${args[0]}`, e);
            }
        }
    };

    return {
        ...h,
        log: safeFn(h.show || ((...args) => h(args[0], 'info')), 'info'),
        warn: safeFn(h.show || ((...args) => h(args[0], 'warning')), 'warning'),
        error: safeFn(h.show || ((...args) => h(args[0], 'error')), 'error'),
        confirm: safeFn(h.show || ((...args) => h(args[0], 'info')), 'info'),
        debug: safeFn(h.debug || ((...args) => notificationHandlerWithLog?.debug?.(...args)), 'debug')
    };
}
function showSimpleNotification(msg, type = 'error', container = null) {
    try {
        const targetContainer = container || document.getElementById('notificationArea') || document.body;
        const div = document.createElement('div');
        div.textContent = msg || 'Notification error';
        div.className = 'alert alert-' + (type || 'error');
        div.style.margin = '10px';
        div.style.padding = '10px';
        targetContainer.appendChild(div);
        setTimeout(() => div.remove(), 5000);
    } catch {
        notificationHandlerWithLog?.error?.('Critical notification error:', msg);
    }
}

DependencySystem.register('modalMapping', MODAL_MAPPINGS);

function createErrorReporter({ notificationHandler }) {
    return {
        capture: (err, context = {}) => {
            if (APP_CONFIG.DEBUG && notify) {
                const moduleLabel = context.module || "app";
                const msg = `[${moduleLabel}] ${(context.method || 'error')}: ${err.message || err}`;
                notify.error(msg, { group: true, context: moduleLabel });
            }
        }
    };
}
const errorReporter = createErrorReporter({ notificationHandler: notificationHandlerWithLog });
DependencySystem.register('errorReporter', errorReporter);

const app = {
    apiRequest,
    validateUUID: globalUtils.isValidProjectId,
    get state() {
        return { ...appState };
    },
    getProjectId() {
        const browserAPI = DependencySystem.modules.get('browserAPI');
        const currentUser = browserAPI.getCurrentUser?.();
        if (currentUser && currentUser.preferences && currentUser.preferences.last_project_id) {
            return currentUser.preferences.last_project_id;
        }
        try {
            const urlParams = browserAPI.createURLSearchParams?.(browserAPI.getLocation()?.search || "");
            const urlProjectId = urlParams.get('project');
            if (
                urlProjectId &&
                globalUtils.isValidProjectId(urlProjectId) &&
                currentUser &&
                Array.isArray(currentUser.preferences?.projects) &&
                currentUser.preferences.projects.some(p => p.id === urlProjectId)
            ) {
                return urlProjectId;
            }
        } catch {
            // ignored
        }
        return null;
    },
    isValidProjectId: globalUtils.isValidProjectId,
    navigateToConversation: async (conversationId) => {
        try {
            const [chatManager] = await waitFor(['chatManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
            if (!chatManager) throw new Error('Chat Manager dependency not available.');
            const success = await chatManager.loadConversation(conversationId);
            if (!success && APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.warn(`[App] navigateToConversation: chatManager reported failure loading ${conversationId}`);
            }
            return success;
        } catch (err) {
            notify?.error?.('[App] navigateToConversation error: ' + (err?.message || err), { group: true, context: "app" });
            notify?.error?.(`Failed to load conversation: ${err.message}`, { group: true, context: "app" });
            return false;
        }
    },
    config: Object.freeze({
        timeouts: { ...APP_CONFIG.TIMEOUTS },
        selectors: { ...APP_CONFIG.SELECTORS },
        debug: APP_CONFIG.DEBUG
    }),
    toggleElement
};
DependencySystem.register('app', app);

// ---------------------------------------------------------------------
// Register sanitizer and storage services using globalUtils
// ---------------------------------------------------------------------
import DOMPurify from './vendor/dompurify.es.js';
DependencySystem.register('sanitizer', DOMPurify);
DependencySystem.register('DOMPurify', DOMPurify);

// Instead of import { createStorageService } from './utils/storageService.js';
// Use globalUtils.createStorageService
const storageService = globalUtils.createStorageService({
    browserAPI,
    APP_CONFIG,
    notificationHandler: notificationHandlerWithLog
});
DependencySystem.register('storage', storageService);

// Patch chatManager overwrites
(function patchDependencySystem(ds) {
    const originalRegister = ds.register.bind(ds);
    ds.register = function (key, value) {
        if (key === 'chatManager' && ds.modules.has('chatManager')) {
            const current = ds.modules.get('chatManager');
            if (current && typeof current.loadConversation === 'function') {
                if (APP_CONFIG.DEBUG) {
                    notificationHandlerWithLog.warn('[App] Prevented overwriting of valid chatManager instance.');
                }
                return current;
            }
        }
        return originalRegister(key, value);
    };
})(DependencySystem);

const chatBrowserAPI = DependencySystem.modules.get('browserAPI');
const chatManager = createChatManager({
    DependencySystem,
    apiRequest, // Will be assigned later, but we pass as reference
    auth: () => DependencySystem.modules.get('auth'),
    eventHandlers,
    app,
    domAPI: {
        querySelector: (selector) => chatBrowserAPI.getDocument().querySelector(selector),
        getElementById: (id) => chatBrowserAPI.getDocument().getElementById(id),
        querySelectorAll: (selector) => chatBrowserAPI.getDocument().querySelectorAll(selector),
        appendChild: (parent, child) => parent && child && parent.appendChild(child),
        replaceChildren: (parent, ...children) => parent && parent.replaceChildren(...children),
        createElement: (tag) => chatBrowserAPI.getDocument().createElement(tag),
        removeChild: (parent, child) => parent && child && parent.removeChild(child),
        setInnerHTML: (el, html) => { if (el) el.innerHTML = html; }
    },
    navAPI: {
        getSearch: () => chatBrowserAPI.getLocation().search,
        getHref: () => chatBrowserAPI.getLocation().href,
        pushState: (url) => chatBrowserAPI.getHistory().pushState({}, '', url),
        getPathname: () => chatBrowserAPI.getLocation().pathname
    },
    isValidProjectId: globalUtils.isValidProjectId,
    isAuthenticated: () => {
        try {
            const authModule = DependencySystem.modules.get('auth');
            return typeof authModule?.isAuthenticated === 'function'
                ? authModule.isAuthenticated()
                : false;
        } catch {
            return false;
        }
    },
    DOMPurify: DependencySystem.modules.get('sanitizer')
});
if (!chatManager || typeof chatManager.initialize !== 'function') {
    throw new Error('[App] createChatManager() did not return a valid ChatManager instance.');
}
DependencySystem.register('chatManager', chatManager);

let regChatManager = DependencySystem.modules.get('chatManager');
if (regChatManager === createChatManager || typeof regChatManager.loadConversation !== 'function') {
    notify?.error?.('[App] ERROR: chatManager registered incorrectly – fixing.', { group: true, context: "app" });
    DependencySystem.modules.delete('chatManager');
    DependencySystem.register('chatManager', chatManager);
}

let currentUser = null;

// ---------------------------------------------------------------------
// Bootstrap & application initialization
// ---------------------------------------------------------------------
async function bootstrap() {
    const docRef = browserAPI.getDocument();
    if (docRef.readyState === 'loading') {
        eventHandlers.trackListener(
            docRef,
            'DOMContentLoaded',
            () => {
                onReady();
            },
            { description: 'App DOMContentLoaded' }
        );
    } else {
        onReady();
    }
}
bootstrap();

function onReady() {
    if (APP_CONFIG.DEBUG && notificationHandlerWithLog) {
        notificationHandlerWithLog.debug(`[App] DOM ready. Starting init...`);
        if (window.currentUser) {
            notificationHandlerWithLog.debug("[App] Current user loaded from auth.js:", window.currentUser);
        }
    }
    init().catch(err => {
        if (notificationHandlerWithLog) {
            notificationHandlerWithLog.error("[App] Unhandled error during async init:", err);
        } else {
            notificationHandlerWithLog?.error?.("[App] Unhandled error during async init:", err);
        }
    });
}

async function init() {
    if (appState.initialized || appState.initializing) {
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog?.info?.('[App] Initialization attempt skipped (already done or in progress).');
        }
        return appState.initialized;
    }
    notificationHandlerWithLog = createNotificationShim(
        createNotificationHandler({
            eventHandlers,
            DependencySystem,
            domAPI: {
                getElementById: id => document.getElementById(id),
                createElement: tag => document.createElement(tag),
                createTemplate: html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t; },
                body: document.body
            },
            groupWindowMs: 7000
        })
    );
    DependencySystem.register('notificationHandler', notificationHandlerWithLog);
    DependencySystem.register('notify', createNotify({ notificationHandler: notificationHandlerWithLog }));

    // Instead of createApiClient from ./utils/apiClient.js, use our globalUtils version
    apiRequest = globalUtils.createApiClient({
        APP_CONFIG,
        globalUtils,
        notificationHandler: notificationHandlerWithLog,
        getAuthModule: () => DependencySystem.modules.get('auth'),
        browserAPI
    });
    DependencySystem.register('apiRequest', apiRequest);
    app.apiRequest = apiRequest;

    window.showNotification = notificationHandlerWithLog.show;

    document.addEventListener('locationchange', function () {
        const container = notificationHandlerWithLog.getContainer?.() || document.getElementById('notificationArea');
        if (container) {
            const notificationsToKeep = Array.from(container.children).filter(
                el => el.classList.contains('priority') || el.classList.contains('sticky')
            );
            notificationHandlerWithLog.clear();
            notificationsToKeep.forEach(el => container.appendChild(el));
        }
    });

    const originalShow = notificationHandlerWithLog.show;
    notificationHandlerWithLog.show = function (message, type, options) {
        try {
            return originalShow.call(this, message, type, options);
        } catch (err) {
            notificationHandlerWithLog?.error?.('Failed to show notification:', err);
            showSimpleNotification(message, type, notificationHandlerWithLog.getContainer?.());
            return null;
        }
    };

    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] Initializing application...');
    }
    appState.initializing = true;
    appState.currentPhase = 'starting';

    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, true);
    const initStartTime = performance.now();

    try {
        appState.currentPhase = 'init_core_systems';
        await initializeCoreSystems();
        appState.currentPhase = 'waiting_core_deps';
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug('[App] Waiting for essential dependencies...');
        }
        await waitFor(['auth', 'eventHandlers', 'notificationHandler', 'modalManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);

        appState.currentPhase = 'init_auth';
        await initializeAuthSystem();

        if (appState.isAuthenticated) {
            currentUser = await fetchCurrentUser();
            if (currentUser) {
                browserAPI.setCurrentUser(currentUser);
                DependencySystem.register('currentUser', currentUser);
            }
        }

        appState.currentPhase = 'init_ui';
        await initializeUIComponents();

        appState.currentPhase = 'registering_listeners';
        registerAppListeners();

        appState.currentPhase = 'finalizing';
        appState.initialized = true;

        try {
            const eh = DependencySystem.modules.get('eventHandlers');
            eh?.init?.();
            DependencySystem.modules.get('modelConfig')?.initializeUI?.();
        } catch (err) {
            notificationHandlerWithLog.warn('[App] Post-initialization safety net failed:', err);
        }

        handleNavigationChange();

        const initEndTime = performance.now();
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog?.info?.(
                `[App] Initialization complete in ${(initEndTime - initStartTime).toFixed(2)} ms.`
            );
        }
        document.dispatchEvent(new CustomEvent('appInitialized', { detail: { success: true } }));
        return true;

    } catch (err) {
        handleInitError(err);
        document.dispatchEvent(new CustomEvent('appInitialized', { detail: { success: false, error: err } }));
        return false;
    } finally {
        appState.initializing = false;
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
        appState.currentPhase = appState.initialized ? 'initialized' : 'failed';
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug(`[App] Final initialization state: ${appState.currentPhase}`);
        }
    }
}

async function initializeCoreSystems() {
    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] Initializing core systems...');
    }
    if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
        await new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
    }
    notificationHandlerWithLog.getContainer();

    const modalManager = createModalManager();
    DependencySystem.register('modalManager', modalManager);
    window.modalManager = modalManager;

    const [apiRequestMod, eventHandlersMod, notificationHandlerMod, modalManagerMod] =
        await DependencySystem.waitFor(['apiRequest', 'eventHandlers', 'notificationHandler', 'modalManager']);

    await new Promise((resolve) => {
        if (document.getElementById('loginModal')) return resolve();
        document.addEventListener('modalsLoaded', () => resolve(), { once: true });
    });

    const auth = createAuthModule({
        apiRequest: apiRequestMod,
        eventHandlers: eventHandlersMod,
        showNotification: notificationHandlerMod?.show,
        domAPI: { getElementById: (id) => document.getElementById(id), isDocumentHidden: () => document.hidden },
        sanitizer: DependencySystem.modules.get('sanitizer'),
        modalManager: modalManagerMod
    });
    DependencySystem.register('auth', auth);

    const chatMgrInstance = DependencySystem.modules.get('chatManager');
    if (!chatMgrInstance || typeof chatMgrInstance.initialize !== 'function') {
        throw new Error('[App] chatManager registration: not a valid instance with "initialize".');
    }

    const notify = DependencySystem.modules.get('notify');
    const projectManager = createProjectManager({
        DependencySystem,
        chatManager: chatMgrInstance,
        app,
        notify,
        storage: DependencySystem.modules.get('storage'),
        listenerTracker: {
            add: (target, event, handler, description) =>
                eventHandlers.trackListener(target, event, handler, {
                    description: description || `[ProjectManager] ${event} on ${target?.id || target}`
                }),
            remove: (target, event, handler) => {
                if (eventHandlers.cleanupListeners) {
                    eventHandlers.cleanupListeners(target, event, handler);
                }
            }
        }
    });
    DependencySystem.register('projectManager', projectManager);

    function validateModule(name, instance, requiredMethod) {
        if (typeof instance === 'function') {
            showNotification(`[App] ${name} registration error: got a function instead of an instance`, 'error', 5000, { group: true, context: name });
            throw new Error(`[App] ${name} registration: not a valid instance (got function)`);
        }
        if (!instance || typeof instance[requiredMethod] !== 'function') {
            showNotification(`[App] ${name} invalid: see developer console for details.`, 'error', 5000, { group: true, context: name });
            if (APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.error(`[App] ${name} invalid:`, instance);
            }
            throw new Error(`[App] ${name} registration: not a valid instance with "${requiredMethod}" method`);
        }
    }

    validateModule('projectManager', projectManager, 'initialize');

    const projectModal = createProjectModal();
    DependencySystem.register('projectModal', projectModal);

    async function injectAndVerifyHtml(url, containerId, requiredElementIds, maxTries = 10) {
        const doc = browserAPI.getDocument();
        let container = doc.getElementById(containerId);
        if (!container) {
            notificationHandlerWithLog.error(`[App] #${containerId} element not found in DOM`);
            container = doc.createElement('div');
            container.id = containerId;
            doc.body.appendChild(container);
            notificationHandlerWithLog.debug(`[App] Created missing #${containerId}`);
        }

        notificationHandlerWithLog.debug(`[App] Attempting to load and inject HTML from ${url}...`);

        try {
            const resp = await fetch(url, { cache: 'no-store' });
            notificationHandlerWithLog.debug(`[App] Fetch status for ${url}: ${resp.status}`);
            if (!resp.ok) {
                throw new Error(`HTTP error! status: ${resp.status}`);
            }

            const html = await resp.text();
            notificationHandlerWithLog.debug(`[App] HTML loaded from ${url}, length: ${html.length}`);

            if (html && html.length > 0) {
                container.innerHTML = html;
                notificationHandlerWithLog.debug(`[App] HTML injected into #${containerId}`);
                doc.dispatchEvent(new CustomEvent('modalsLoaded'));
            } else {
                throw new Error('Empty HTML response');
            }
        } catch (err) {
            notify?.error?.(`[App] HTML fetch/injection failed for ${url}: ${err?.message || err}`, { group: true, context: "app" });
            doc.dispatchEvent(new CustomEvent('modalsLoaded'));
        }

        for (let attempt = 0; attempt < maxTries; attempt++) {
            let allFound = true;
            for (const id of requiredElementIds) {
                if (!doc.getElementById(id)) {
                    allFound = false;
                    break;
                }
            }
            if (allFound) return true;
            await new Promise(r => setTimeout(r, 150));
        }
        return false;
    }

    const modalsReady = new Promise((resolve) => {
        const timeout = setTimeout(() => {
            notify?.error?.('[App] TIMEOUT: Modal HTML failed to load in 15 seconds', { group: true, context: "app" });
            resolve();
        }, 15000);

        const modalsLoadedRemover = eventHandlers.trackListener(
            document,
            'modalsLoaded',
            () => {
                clearTimeout(timeout);
                resolve();
                if (typeof modalsLoadedRemover?.remove === 'function') {
                    modalsLoadedRemover.remove();
                }

                setTimeout(() => {
                    const projectForm = document.getElementById('projectModalForm');
                    if (!projectForm) return;
                    projectForm.onsubmit = null;
                    projectForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const submitBtn = projectForm.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.disabled = true;
                            submitBtn.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
                        }
                        const formData = new FormData(projectForm);
                        const data = {};
                        for (let [key, value] of formData.entries()) {
                            if (key === 'projectId' && !value) continue;
                            if (key === 'maxTokens' || key === 'max_tokens') {
                                data.max_tokens = parseInt(value, 10);
                            } else {
                                data[key] = value;
                            }
                        }
                        if (!data.name) {
                            notify?.error?.('Project name is required', { group: true, context: 'projectModal' });
                            if (submitBtn) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = 'Save Project';
                            }
                            return;
                        }
                        try {
                            const pm = window.projectManager || (window.DependencySystem?.modules?.get?.('projectManager'));
                            if (pm?.createProject) {
                                await pm.createProject(data);
                            } else if (pm?.saveProject) {
                                await pm.saveProject(undefined, data);
                            } else {
                                throw new Error('ProjectManager unavailable in DI');
                            }
                            notify?.success?.('Project created', { group: true, context: 'projectModal' });
                            const mm = window.modalManager || (window.DependencySystem?.modules?.get?.('modalManager'));
                            if (mm?.hide) {
                                mm.hide('project');
                            }
                            if (pm?.loadProjects) {
                                pm.loadProjects('all');
                            }
                        } catch (err) {
                            notify?.error?.('Failed to create project: ' + (err?.message || err), { group: true, context: 'projectModal' });
                        } finally {
                            if (submitBtn) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = 'Save Project';
                            }
                        }
                    });
                }, 0);
            }
        );

        (async () => {
            await injectAndVerifyHtml('/static/html/modals.html', 'modalsContainer', Object.values(MODAL_MAPPINGS));
        })();
    });

    const modalsTimeout = setTimeout(() => {
        notificationHandlerWithLog.error('[App] TIMEOUT: Modal HTML failed to load in 10 seconds');
        browserAPI.getDocument().dispatchEvent(new CustomEvent('modalsLoaded'));
    }, 10000);

    const modalsLoadedRemover2 = eventHandlers.trackListener(
        document,
        'modalsLoaded',
        () => {
            clearTimeout(modalsTimeout);
            if (typeof modalsLoadedRemover2?.remove === 'function') {
                modalsLoadedRemover2.remove();
            }
        },
        { description: '[App] Modal HTML short-timeout handler' }
    );

    await modalsReady;
    notificationHandlerWithLog.debug('[App] Modal HTML load promise resolved. Proceeding with initialization.');

    const modalsOk = await injectAndVerifyHtml('/static/html/modals.html', 'modalsContainer', Object.values(MODAL_MAPPINGS));
    if (!modalsOk) {
        notify?.error?.('[App] One or more modal dialogs failed to appear after HTML injection.', { group: true, context: "app" });
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.error('[App] One or more modal dialogs failed to appear in DOM after modal HTML injection.');
        }
    }

    if (typeof modalManager.init === 'function') {
        modalManager.init();
    } else {
        notify?.error?.('[App] modalManager.init function not found!', { group: true, context: "app" });
    }

    if (typeof chatMgrInstance.initialize === 'function' && appState.isAuthenticated) {
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug('[App] Initializing ChatManager (user already authenticated)…');
        }
        await chatMgrInstance.initialize();
    }

    if (typeof projectModal.init === 'function') {
        projectModal.init();
    } else {
        notify?.error?.('[App] Project modal init function not found!', { group: true, context: "app" });
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.error('[App] projectModal.init function not found!');
        }
    }

    if (typeof projectManager.initialize === 'function') {
        await projectManager.initialize();
    }
    if (typeof eventHandlersMod?.init === 'function') {
        eventHandlersMod.init();
    }
    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] Core systems initialized.');
    }
}

async function initializeAuthSystem() {
    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] Initializing authentication system...');
    }
    const auth = DependencySystem.modules.get('auth');
    if (!auth || typeof auth.init !== 'function') {
        throw new Error("[App] Auth module is missing or invalid in DependencySystem.");
    }
    try {
        await auth.init();
        if (!auth.isAuthenticated || typeof auth.isAuthenticated !== 'function') {
            throw new Error("[App] Auth module does not provide isAuthenticated().");
        }
        appState.isAuthenticated = auth.isAuthenticated();
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug(`[App] Initial authentication state: ${appState.isAuthenticated}`);
        }
        const bus = auth.AuthBus;
        if (bus && typeof eventHandlers.trackListener === 'function') {
            eventHandlers.trackListener(
                bus,
                'authStateChanged',
                () => {
                    appState.isAuthenticated = auth.isAuthenticated();
                    renderAuthHeader();
                },
                { description: '[App] AuthBus authStateChanged (DI event handler)' }
            );
        }
        renderAuthHeader();
    } catch (err) {
        notificationHandlerWithLog.error('[App] Auth system initialization/check failed:', err);
        appState.isAuthenticated = false;
        showNotification(`Authentication check failed: ${err.message}`, 'error', 5000, { group: true, context: "auth" });
        throw new Error(`[App] initializeAuthSystem failed: ${err.message}`);
    }
}

let _uiComponentsInitialized = false;
async function initializeUIComponents() {
    const browserAPI = DependencySystem.modules.get('browserAPI');
    const doc = browserAPI.getDocument();

    if (_uiComponentsInitialized) {
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.warn('[App] initializeUIComponents called twice, skipping.');
        }
        return;
    }
    _uiComponentsInitialized = true;
    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] Initializing UI components...');
    }

    await globalUtils.waitForDepsAndDom({
        deps: ['projectManager', 'eventHandlers', 'modalManager'],
        domSelectors: ['body'],
        DependencySystem
    });

    let projectListView = doc.getElementById('projectListView');
    let projectDetailsView = doc.getElementById('projectDetailsView');
    if (!projectListView) {
        projectListView = doc.createElement('div');
        projectListView.id = 'projectListView';
        projectListView.className = 'w-full';
        doc.body.appendChild(projectListView);
    }
    if (!projectDetailsView) {
        projectDetailsView = doc.createElement('div');
        projectDetailsView.id = 'projectDetailsView';
        projectDetailsView.className = 'w-full hidden';
        doc.body.appendChild(projectDetailsView);
    }

    if (!doc.getElementById('projectList')) {
        try {
            const resp = await fetch('/static/html/project_list.html', { cache: 'reload' });
            if (!resp.ok) {
                throw new Error(`[UI] Failed to fetch project_list.html: HTTP ${resp.status}`);
            }
            const html = await resp.text();
            if (!html || !html.includes('id="projectList"')) {
                throw new Error('[UI] Fetched project_list.html missing required #projectList element.');
            }
            projectListView.innerHTML = html;
            if (!doc.getElementById('projectList')) {
                notify?.error?.('Static /static/html/project_list.html inject failed (missing #projectList)!', { group: true, context: "app", timeout: 10000 });
                throw new Error('Injected /static/html/project_list.html but #projectList is still missing!');
            }
        } catch (err) {
            notify?.error?.(`Failed to load project list UI: ${err.message}`, { group: true, context: "app", timeout: 10000 });
            throw err;
        }
    }

    if (!doc.getElementById('projectDetails')) {
        try {
            const resp = await fetch('/static/html/project_details.html', { cache: 'reload' });
            if (!resp.ok) {
                throw new Error(`[UI] Failed to fetch project_details.html: HTTP ${resp.status}`);
            }
            const html = await resp.text();
            if (!html || !html.includes('id="projectDetails"')) {
                throw new Error('[UI] Fetched project_details.html missing required #projectDetails element.');
            }
            projectDetailsView.innerHTML = html;
            if (!doc.getElementById('projectDetails')) {
                notify?.error?.('Static /static/html/project_details.html inject failed (missing #projectDetails)!', { group: true, context: "app", timeout: 10000 });
                throw new Error('Injected /static/html/project_details.html but #projectDetails is still missing!');
            }
        } catch (err) {
            notify?.error?.(`Failed to load project details UI: ${err.message}`, { group: true, context: "app", timeout: 10000 });
            throw err;
        }
    }

    const projectManager = DependencySystem.modules.get('projectManager');
    const modalManager = DependencySystem.modules.get('modalManager');

    setTimeout(() => {
        window.setupLoginButtonHandler?.(eventHandlers, modalManager);
    }, 0);

    if (FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', FileUploadComponent);
    }

    const chatExtensions = createChatExtensions({
        DependencySystem,
        eventHandlers,
        notificationHandler: notificationHandlerWithLog
    });
    DependencySystem.register('chatExtensions', chatExtensions);

    const modelConfig = createModelConfig();
    DependencySystem.register('modelConfig', modelConfig);

    const projectDashboardUtils = createProjectDashboardUtils({ DependencySystem });
    DependencySystem.register('projectDashboardUtils', projectDashboardUtils);

    const notifyForUi = DependencySystem.modules.get('notify');
    const projectListComponent = new ProjectListComponent({
        projectManager,
        eventHandlers,
        modalManager,
        app,
        router: {
            navigate: (url) => {
                window.history.pushState({}, '', url);
                window.dispatchEvent(new Event('locationchange'));
            },
            getURL: () => window.location.href
        },
        notify: notifyForUi,
        storage: DependencySystem.modules.get('storage'),
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('projectListComponent', projectListComponent);

    if (DependencySystem.modules.get('projectDashboard') === createProjectDashboard) {
        DependencySystem.modules.delete('projectDashboard');
    }
    const projectDashboard = createProjectDashboard(DependencySystem);
    DependencySystem.register('projectDashboard', projectDashboard);

    const projectDetailsComponent = createProjectDetailsComponent({
        onBack: async () => {
            try {
                const pd = await DependencySystem.waitFor('projectDashboard');
                pd?.showProjectList?.();
            } catch {
                // Error retrieving project ID
            }
            return null;
        },
        app,
        projectManager,
        eventHandlers,
        modalManager,
        FileUploadComponentClass: DependencySystem.modules.get('FileUploadComponent'),
        router: {
            navigate: (url) => {
                window.history.pushState({}, '', url);
                window.dispatchEvent(new Event('locationchange'));
            },
            getURL: () => window.location.href
        },
        notify: notifyForUi,
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponent);

    const sidebar = createSidebar({
        DependencySystem,
        eventHandlers,
        app,
        projectDashboard,
        projectManager,
        notify: notifyForUi,
        storageAPI: DependencySystem.modules.get('storage'),
        viewportAPI: {
            getInnerWidth: () => window.innerWidth
        },
        domAPI: {
            getElementById: (id) => document.getElementById(id),
            createElement: (tag) => document.createElement(tag),
            querySelector: (selector) => document.querySelector(selector),
            getActiveElement: () => document.activeElement,
            ownerDocument: document,
            body: document.body
        }
    });
    DependencySystem.register('sidebar', sidebar);

    DependencySystem.register('utils', globalUtils);

    const knowledgeBaseComponent = createKnowledgeBaseComponent({
        DependencySystem,
        apiRequest,
        auth: DependencySystem.modules.get('auth'),
        projectManager,
        showNotification,
        uiUtils: globalUtils,
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponent);

    if (typeof sidebar.init === 'function') {
        await sidebar.init();
    }
    chatExtensions.init();
    if (modelConfig?.initializeUI) {
        modelConfig.initializeUI();
    }
    if (typeof knowledgeBaseComponent.initialize === 'function') {
        await knowledgeBaseComponent.initialize();
    }
    if (typeof projectDashboard.initialize === 'function') {
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug('[App] Initializing ProjectDashboard instance...');
        }
        await projectDashboard.initialize();
    }
    const projectListComp = DependencySystem.modules.get('projectListComponent');
    if (projectListComp?.initialize) {
        await projectListComp.initialize();
    }
    const projectDetailsComp = DependencySystem.modules.get('projectDetailsComponent');
    if (projectDetailsComp?.initialize) {
        await projectDetailsComp.initialize();
    }

    if (appState.isAuthenticated) {
        if (projectManager?.loadProjects) {
            notificationHandlerWithLog.debug('[App] Calling projectManager.loadProjects from initializeUIComponents');
            projectManager.loadProjects('all').catch(err => {
                notificationHandlerWithLog.error('[App] Failed to load projects during initialization:', err);
                showNotification('Failed to load projects. Please try refreshing.', 'error', 5000, { group: true, context: "projectManager" });
            });
        } else {
            notificationHandlerWithLog.error('[App] projectManager or loadProjects method not available:', projectManager);
            notify?.error?.('Project manager initialization issue. Please try refreshing.', { group: true, context: "projectManager" });
        }
    } else {
        notificationHandlerWithLog.warn('[App] Not authenticated, skipping initial project load');
    }

    if (typeof window.initAccessibilityEnhancements === 'function') {
        window.initAccessibilityEnhancements();
    }
    if (typeof window.initSidebarEnhancements === 'function') {
        window.initSidebarEnhancements();
    }

    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] UI components initialized.');
    }
}

function renderAuthHeader() {
    try {
        const browserAPI = DependencySystem.modules.get('browserAPI');
        const doc = browserAPI.getDocument();
        const authMod = DependencySystem.modules.get('auth');
        const isAuth = typeof authMod?.isAuthenticated === 'function' && authMod.isAuthenticated();

        const btn = doc.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON) || doc.querySelector('#loginButton');
        if (btn) {
            btn.textContent = isAuth ? 'Logout' : 'Login';
            btn.onclick = null;
            if (DependencySystem?.modules?.get('eventHandlers')?.trackListener) {
                DependencySystem.modules.get('eventHandlers').trackListener(
                    btn,
                    'click',
                    function (e) {
                        e.preventDefault();
                        if (isAuth) {
                            authMod.logout();
                        } else {
                            const modal = DependencySystem.modules.get('modalManager');
                            if (modal?.show) modal.show('login');
                        }
                    },
                    { description: '[App] Auth login/logout button' }
                );
            }
        }
        const authStatus = doc.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = doc.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) authStatus.textContent = isAuth ? 'Signed in' : 'Not signed in';
        if (userStatus) userStatus.textContent = isAuth ? `Hello, ${authMod.getCurrentUser()}` : '';
    } catch {
        // renderAuthHeader error
    }
}

function registerAppListeners() {
    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] Registering global event listeners...');
    }

    waitFor(['auth', 'chatManager', 'projectManager'], () => {
        attachAuthBusListener('authStateChanged', handleAuthStateChange, '_globalAuthStateChangedAttached');
        setupChatInitializationTrigger();
        eventHandlers.trackListener(window, 'locationchange', handleNavigationChange, {
            description: 'Global locationchange event'
        });
    }).catch(err => notificationHandlerWithLog.error('[App] Failed to wait for dependencies:', err));

    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug('[App] Global event listeners registered.');
    }
}

function setupChatInitializationTrigger() {
    const requiredDeps = ['auth', 'chatManager', 'projectManager'];
    const debouncedInitChat = globalUtils.debounce((arg = null) => {
        const asyncProcess = (async () => {
            let forceProjectId = arg;
            if (
                arg &&
                typeof arg === 'object' &&
                arg.detail &&
                arg.detail.project &&
                arg.detail.project.id
            ) {
                forceProjectId = arg.detail.project.id;
            }

            try {
                const [authMod, chatMgr, pm] = await waitFor(requiredDeps, null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT / 2);
                if (!authMod || !chatMgr) {
                    if (APP_CONFIG.DEBUG) {
                        notificationHandlerWithLog.warn('[App] Chat init: Required dependency missing.', [authMod, chatMgr, pm]);
                    }
                    return;
                }
                if (typeof authMod.isAuthenticated !== "function") {
                    if (APP_CONFIG.DEBUG) {
                        notificationHandlerWithLog.warn('[App] Chat init: auth.isAuthenticated is not a function.', authMod);
                    }
                    return;
                }

                const projectId = app.getProjectId();
                const finalProjectId = forceProjectId ?? projectId ?? pm?.currentProject?.id ?? null;

                if (authMod.isAuthenticated() && typeof chatMgr.initialize === "function") {
                    if (APP_CONFIG.DEBUG) {
                        notificationHandlerWithLog.debug(`[App] Debounced chat init triggered. Project: ${finalProjectId}`);
                    }
                    await chatMgr.initialize({ projectId: finalProjectId });
                } else {
                    if (APP_CONFIG.DEBUG) {
                        notificationHandlerWithLog.debug(
                            `[App] Skipping debounced chat init. Auth: ${authMod.isAuthenticated?.() ?? 'N/A'}, ` +
                            `Project: ${finalProjectId}`
                        );
                    }
                    chatMgr?.clear?.();
                }
            } catch (err) {
                notificationHandlerWithLog.error('[App] Error during debounced chat initialization:', err);
            }
        })();

        asyncProcess.catch(err => {
            notificationHandlerWithLog.error('[App] Unhandled error in chat initialization:', err);
        });

        return false;
    }, 350);

    waitFor(requiredDeps, () => {
        attachAuthBusListener('authStateChanged', debouncedInitChat, '_globalChatInitAuthAttached');
        if (!document._chatInitProjListenerAttached) {
            eventHandlers.trackListener(
                document,
                'currentProjectChanged',
                () => {
                    debouncedInitChat();
                    return false;
                },
                { description: 'Current project changed -> reinit chat' }
            );
            document._chatInitProjListenerAttached = true;
            if (APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.warn('[App] Using eventHandlers for currentProjectChanged -> chat reinit listener.');
            }
        }
        eventHandlers.trackListener(
            document,
            'currentProjectReady',
            e => {
                debouncedInitChat(e.detail?.project?.id);
                return false;
            },
            { description: 'Project ready -> reinit chat' }
        );
        debouncedInitChat();
    }, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT * 2)
        .catch(err => {
            notificationHandlerWithLog.error('[App] Failed setup for chat init triggers:', err);
        });
}

let lastHandledProj = null;
let lastHandledChat = null;

async function handleNavigationChange() {
    if (!appState.initialized) {
        if (appState.initializing) {
            await new Promise(r => setTimeout(r, 150));
            if (!appState.initialized) {
                if (APP_CONFIG.DEBUG) {
                    notificationHandlerWithLog.warn("[App] handleNavigationChange: Aborted, initialization didn't complete.");
                }
                return;
            }
        } else {
            if (APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.warn("[App] handleNavigationChange: Aborted, application not initialized.");
            }
            return;
        }
    }

    const currentUrl = window.location.href;
    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug(`[App] Handling navigation change. URL: ${currentUrl}`);
    }
    let projectDashboard;
    try {
        [projectDashboard] = await waitFor(['projectDashboard'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
    } catch (e) {
        notificationHandlerWithLog.error('[App] Project Dashboard unavailable for navigation:', e);
        showNotification('UI Navigation Error.', 'error', 5000, { group: true, context: "app" });
        toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true);
        const errorEl = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (errorEl) errorEl.textContent = 'Core UI component failed to load. Please refresh.';
        return;
    }

    const url = new URL(currentUrl);
    const projectId = url.searchParams.get('project');
    const chatId = url.searchParams.get('chatId') || null;

    if (projectId === lastHandledProj && chatId === lastHandledChat) {
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug('[App] handleNavigationChange: Same project/chat; skipping re-load.');
        }
        return;
    }
    lastHandledProj = projectId;
    lastHandledChat = chatId;

    if (!appState.isAuthenticated) {
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug('[App] Navigation change: User not authenticated.');
        }
        projectDashboard.showLoginRequiredMessage?.();
        return;
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);

    try {
        const [projectManager] = await waitFor(['projectManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (projectId && globalUtils.isValidProjectId(projectId)) {
            if (APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.debug(`[App] Ensuring project ${projectId} details are loaded before UI...`);
            }
            await projectManager.loadProjectDetails(projectId);
            if (typeof projectDashboard.showProjectDetails === 'function') {
                if (APP_CONFIG.DEBUG) {
                    notificationHandlerWithLog.debug(`[App] Navigating to project details: ${projectId}, chatId=${chatId ?? 'none'}`);
                }
                await projectDashboard.showProjectDetails(projectId);
            }
        } else if (typeof projectDashboard.showProjectList === 'function') {
            if (APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.debug('[App] Navigating to project list view.');
            }
            await projectDashboard.showProjectList();
        } else {
            notificationHandlerWithLog.warn('[App] Unhandled navigation or missing dashboard methods.');
            globalUtils.toggleElement(APP_CONFIG.SELECTORS.PROJECT_DETAILS_VIEW, false);
            globalUtils.toggleElement(APP_CONFIG.SELECTORS.PROJECT_LIST_VIEW, true);
        }

        if (projectId && globalUtils.isValidProjectId(projectId) && chatId) {
            try {
                const success = await app.navigateToConversation(chatId);
                if (!success) {
                    notificationHandlerWithLog.warn("[App] Chat load failed for chatId:", chatId);
                }
            } catch (e) {
                notificationHandlerWithLog.warn("[App] Error loading chatId after project ready:", e);
            }
        }
    } catch (navError) {
        notificationHandlerWithLog.error('[App] Error during navigation handling:', navError);
        showNotification(`Navigation failed: ${navError.message}`, 'error', 5000, { group: true, context: "app" });
        projectDashboard.showProjectList?.().catch(fb => notificationHandlerWithLog.error('[App] Fallback failed:', fb));
    }
}

function attachAuthBusListener(event, handler, markerGlobalName) {
    const bus = getAuthBus();
    if (!bus || typeof eventHandlers.trackListener !== "function") {
        notificationHandlerWithLog.error('[App] Cannot attach listener: AuthBus missing or invalid.', bus);
        return false;
    }
    if (!window[markerGlobalName] || window[markerGlobalName] !== bus) {
        eventHandlers.trackListener(
            bus,
            event,
            handler,
            { description: `[App] AuthBus ${event} listener (via attachAuthBusListener)` }
        );
        window[markerGlobalName] = bus;
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.debug(`[App] Attached ${event} listener to AuthBus (global marker ${markerGlobalName}).`);
        }
        return true;
    }
    return false;
}

function getAuthBus() {
    const auth = DependencySystem?.modules?.get('auth');
    return auth?.AuthBus;
}

function handleAuthStateChange(event) {
    const { authenticated, username } = event?.detail || {};
    const newAuthState = !!authenticated;
    if (newAuthState === appState.isAuthenticated) return false;

    const previousAuthState = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    if (APP_CONFIG.DEBUG) {
        notificationHandlerWithLog.debug(`[App] Auth state changed. Authenticated: ${appState.isAuthenticated}, User: ${username || 'N/A'}`);
    }

    requestAnimationFrame(() => {
        toggleElement(APP_CONFIG.SELECTORS.AUTH_BUTTON, !appState.isAuthenticated);
        toggleElement(APP_CONFIG.SELECTORS.USER_MENU, appState.isAuthenticated);
        const authStatus = document.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = document.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) {
            authStatus.textContent = appState.isAuthenticated ? (username ?? 'Authenticated') : 'Not Authenticated';
        }
        if (userStatus) {
            userStatus.textContent = appState.isAuthenticated ? (username ?? '') : '';
        }
        setTimeout(() => {
            window.setupLoginButtonHandler?.(DependencySystem.modules.get('eventHandlers'), DependencySystem.modules.get('modalManager'));
        }, 0);
    });

    (async function updateAuthStateUI() {
        let projectManager, projectDashboard, sidebar, chatManager, storage;
        try {
            [projectManager, projectDashboard, sidebar, chatManager, storage] = await Promise.all([
                waitFor('projectManager'),
                waitFor('projectDashboard'),
                waitFor('sidebar'),
                waitFor('chatManager'),
                waitFor('storage')
            ]);
        } catch (e) {
            notificationHandlerWithLog.error('[App] Failed to get modules during auth state change:', e);
            showNotification('Failed to update UI after auth change.', 'error', 5000, { group: true, context: "app" });
            return;
        }

        if (appState.isAuthenticated && !previousAuthState) {
            if (APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.debug('[App] User logged in. Refreshing data/UI.');
            }
            globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);

            try {
                projectDashboard.showProjectList?.();
                if (projectManager.loadProjects) {
                    try {
                        const projects = await projectManager.loadProjects('all');
                        if (APP_CONFIG.DEBUG) {
                            notificationHandlerWithLog.debug(`[App] Projects loaded after login: ${projects.length}`);
                        }
                        sidebar.renderProjects?.(projects);
                    } catch (err) {
                        notificationHandlerWithLog.error('[App] Failed to load projects after login:', err);
                        showNotification('Failed to load projects.', 'error', 5000, { group: true, context: "projectManager" });
                    }
                }
            } catch (err) {
                notificationHandlerWithLog.error('[App] Error refreshing UI after login:', err);
            }
        } else if (!appState.isAuthenticated && previousAuthState) {
            if (APP_CONFIG.DEBUG) {
                notificationHandlerWithLog.debug('[App] User logged out. Clearing data/UI.');
            }
            try {
                globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, true);
                projectManager.currentProject = null;
                storage.removeItem('selectedProjectId');
                projectDashboard.showLoginRequiredMessage?.();
                sidebar.clear?.();
                chatManager.clear?.();
                try {
                    handleNavigationChange();
                } catch (navError) {
                    notificationHandlerWithLog.error('[App] Navigation error after logout:', navError);
                }
            } catch (err) {
                notificationHandlerWithLog.error('[App] Error updating UI after logout:', err);
            }
        }
    })().catch(err => {
        notificationHandlerWithLog.error('[App] Unhandled error in auth state change handler:', err);
    });

    return false;
}

function handleInitError(error) {
    try {
        const errorReporter = DependencySystem?.modules?.get('errorReporter');
        errorReporter?.capture?.(error, {
            module: 'app',
            method: 'handleInitError',
            phase: appState.currentPhase
        });
    } catch (err) {
        if (APP_CONFIG.DEBUG) {
            notificationHandlerWithLog.error('[App] Error in errorReporter.capture:', err);
        }
    }
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'failed';

    try {
        notify?.error?.(`Application failed to start: ${error.message}. Please refresh.`, { group: true, context: "app", timeout: 15000 });
    } catch {
        // ignored
    }

    try {
        const container = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (container) {
            container.textContent = `Application Error: ${error.message}. Please refresh.`;
            container.classList.remove('hidden');
        } else {
            notify?.error?.(`Application Critical Error: ${error.message}. Please refresh.`, { group: true, context: "app", timeout: 30000 });
        }
    } catch {
        // ignored
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
}
