/**
 * sidebar.js – Strict DI/DependencySystem, context-rich notifications (2025-05)
 *
 * All notify.* calls provide: group, context, module ("Sidebar"), source (function), dynamic detail, originalError as needed.
 * This enables rapid troubleshooting, Sentry correlation, and support for all user/system events.
 */

import { safeParseJSON } from './utils/globalUtils.js';
import { safeInvoker } from './utils/notifications-helpers.js';

const MODULE = "Sidebar";

export function createSidebar({
  eventHandlers,
  app,
  projectDashboard,
  projectManager,
  uiRenderer,
  DependencySystem,
  notify,
  storageAPI,
  viewportAPI,
  domAPI
} = {}) {
  if (!DependencySystem) throw new Error('[sidebar] DependencySystem is required.');
  if (!eventHandlers) throw new Error('[sidebar] eventHandlers is required.');
  if (!storageAPI) throw new Error('[sidebar] storageAPI (getItem/setItem) must be injected.');
  if (!viewportAPI) throw new Error('[sidebar] viewportAPI (getInnerWidth) must be injected.');
  if (!domAPI) throw new Error('[sidebar] domAPI (getElementById/createElement/querySelector/body/getActiveElement/ownerDocument) must be injected.');
  if (typeof domAPI.getActiveElement !== 'function') {
    throw new Error('[sidebar] domAPI.getActiveElement() must be provided to avoid using document.activeElement');
  }
  if (!domAPI.ownerDocument || typeof domAPI.ownerDocument.dispatchEvent !== 'function') {
    throw new Error('[sidebar] domAPI.ownerDocument with dispatchEvent() must be provided to avoid using window/document globals');
  }
  app = app || resolveDep('app');
  projectDashboard = projectDashboard || resolveDep('projectDashboard');
  projectManager = projectManager || resolveDep('projectManager');
  uiRenderer = uiRenderer || resolveDep('uiRenderer');
  if (!notify) throw new Error('[sidebar] notify util (from DI) is required');

  function resolveDep(name) {
    if (DependencySystem?.modules?.get) return DependencySystem.modules.get(name);
    if (DependencySystem?.get) return DependencySystem.get(name);
    return undefined;
  }

  let el = null;
  let btnToggle = null;
  let btnClose = null;
  let btnPin = null;
  let backdrop = null;
  let pinned = false;
  let visible = false;
  let trackedEvents = [];

  // For inline auth form
  let isRegisterMode = false;
  let sidebarAuthFormContainerEl, sidebarAuthFormTitleEl, sidebarAuthFormEl,
      sidebarUsernameContainerEl, sidebarUsernameInputEl, // Added for username
      sidebarEmailInputEl, sidebarPasswordInputEl, sidebarConfirmPasswordContainerEl,
      sidebarConfirmPasswordInputEl, sidebarAuthBtnEl, sidebarAuthErrorEl, sidebarAuthToggleEl;

  const sidebarNotify = notify.withContext({ module: MODULE, context: 'inlineAuth' });

  const starred = new Set(
    safeParseJSON(storageAPI.getItem('starredConversations'), [])
  );

  async function init() {
    notify.debug('[sidebar] init() called', { group: true, context: 'sidebar', module: MODULE, source: 'init' });
    try {
      findDom(); // This will now also find inline auth form elements
      setupInlineAuthForm(); // Setup listeners and initial state for the new form
      restorePersistentState();
      bindDomEvents(); // This will be updated to include auth state listeners for the form
      if (app && typeof app.getInitialSidebarContext === 'function') {
        const { projectId } = app.getInitialSidebarContext() || {};
        if (projectId && projectManager && typeof projectManager.setCurrentProjectId === 'function') {
          projectManager.setCurrentProjectId(projectId);
        }
      }
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);
      notify.info('[sidebar] initialized successfully', { group: true, context: 'sidebar', module: MODULE, source: 'init', activeTab });

      // --- Standardized "sidebar:initialized" event ---
      const doc = domAPI?.getDocument?.() || (typeof document !== "undefined" ? document : null);
      if (doc) {
        if (domAPI?.dispatchEvent) {
          domAPI.dispatchEvent(doc, new CustomEvent('sidebar:initialized',
            { detail: { success: true } }));
        } else {
          doc.dispatchEvent(new CustomEvent('sidebar:initialized',
            { detail: { success: true } }));
        }
      }

      return true;
    } catch (err) {
      notify.error('[sidebar] Initialization failed: ' + (err && err.message ? err.message : err), {
        group: true, context: 'sidebar', module: MODULE, source: 'init', originalError: err
      });
      return false;
    }
  }

  function destroy() {
    trackedEvents.forEach(evt => {
      eventHandlers.cleanupListeners?.(evt.element, evt.type, evt.description);
    });
    trackedEvents = [];
    if (backdrop) { backdrop.remove(); backdrop = null; }
    pinned = false; visible = false;
    notify.info('[sidebar] destroyed', { group: true, context: 'sidebar', module: MODULE, source: 'destroy' });
  }

  function findDom() {
    el = domAPI.getElementById('mainSidebar');
    btnToggle = domAPI.getElementById('navToggleBtn');
    btnClose = domAPI.getElementById('closeSidebarBtn');
    btnPin = domAPI.getElementById('pinSidebarBtn');

    // DOM elements for inline auth form
    sidebarAuthFormContainerEl = domAPI.getElementById('sidebarAuthFormContainer');
    sidebarAuthFormTitleEl = domAPI.getElementById('sidebarAuthFormTitle');
    sidebarAuthFormEl = domAPI.getElementById('sidebarAuthForm');
    sidebarUsernameContainerEl = domAPI.getElementById('sidebarUsernameContainer'); // Added
    sidebarUsernameInputEl = domAPI.getElementById('sidebarUsername'); // Added
    sidebarEmailInputEl = domAPI.getElementById('sidebarEmail');
    sidebarPasswordInputEl = domAPI.getElementById('sidebarPassword');
    sidebarConfirmPasswordContainerEl = domAPI.getElementById('sidebarConfirmPasswordContainer');
    sidebarConfirmPasswordInputEl = domAPI.getElementById('sidebarConfirmPassword');
    sidebarAuthBtnEl = domAPI.getElementById('sidebarAuthBtn');
    sidebarAuthErrorEl = domAPI.getElementById('sidebarAuthError');
    sidebarAuthToggleEl = domAPI.getElementById('sidebarAuthToggle');

    if (!el || !btnToggle) {
      notify.error('sidebar: critical DOM nodes missing (#mainSidebar or #navToggleBtn)', {
        group: true, context: 'sidebar', module: MODULE, source: 'findDom',
        detail: { elFound: !!el, btnToggleFound: !!btnToggle }
      });
      throw new Error('sidebar: critical DOM nodes missing (#mainSidebar or #navToggleBtn)');
    }
  }

  function restorePersistentState() {
    pinned = storageAPI.getItem('sidebarPinned') === 'true';
    if (pinned) {
      el.classList.add('sidebar-pinned', 'translate-x-0');
      visible = true;
    }
    updatePinButtonVisual();
  }

  function bindDomEvents() {
    const track = (element, evtType, handler, description, sourceOverride) => {
      if (!element) return;
      const contextualHandler = safeInvoker(
        handler,
        { notify },
        { context: 'sidebar', module: MODULE, source: sourceOverride || description }
      );
      const wrappedHandler = eventHandlers.trackListener(element, evtType, contextualHandler, { description });
      if (wrappedHandler) {
        trackedEvents.push({ element, type: evtType, description });
      }
    };
    track(btnToggle, 'click', () => toggleSidebar(), 'Sidebar toggle', 'toggleSidebar');
    track(btnClose, 'click', () => closeSidebar(), 'Sidebar close', 'closeSidebar');
    track(btnPin, 'click', () => togglePin(), 'Sidebar pin', 'togglePin');
    if (viewportAPI && viewportAPI.onResize) {
      track(viewportAPI, 'resize', handleResize, 'Sidebar resize', 'handleResize');
    }
    [
      { name: 'recent', id: 'recentChatsTab' },
      { name: 'starred', id: 'starredChatsTab' },
      { name: 'projects', id: 'projectsTab' },
    ].forEach(({ name, id }) => {
      const btn = domAPI.getElementById(id);
      track(btn, 'click', () => activateTab(name), `Sidebar tab ${name}`, 'activateTab');
    });

    // Listen for auth state changes to show/hide inline form
    const authModule = DependencySystem.modules.get('auth');
    const eventTargetForAuth = authModule?.AuthBus || domAPI.getDocument();

    track(eventTargetForAuth, 'authStateChanged', handleGlobalAuthStateChangeForSidebar, 'Sidebar AuthStateChange Global Listener', 'handleGlobalAuthStateChangeForSidebar');
    if (authModule?.AuthBus) { // Also listen to authReady if AuthBus exists
        track(authModule.AuthBus, 'authReady', handleGlobalAuthStateChangeForSidebar, 'Sidebar AuthReady Global Listener', 'handleGlobalAuthStateChangeForSidebar');
    }

    // Bind a generic "error" event handler for child widget error forward
    if (el) {
      const errorHandler = safeInvoker(
        (e) => {
          notify.error('[sidebar] Widget error: ' + (e && e.detail && e.detail.message ? e.detail.message : String(e)), {
            group: true,
            context: 'sidebar',
            module: MODULE,
            source: 'childWidgetError',
            originalError: e?.detail?.error || e?.error || e
          });
        },
        { notify },
        { context: 'sidebar', module: MODULE, source: 'childWidgetError' }
      );
      const handler = eventHandlers.trackListener(el, 'error', errorHandler, { description: 'Sidebar child widget error' });
      if (handler) {
        trackedEvents.push({ element: el, type: 'error', description: 'Sidebar child widget error' });
      }
    }
  }

  function handleGlobalAuthStateChangeForSidebar(event) {
    const authModule = DependencySystem.modules.get('auth');
    const isAuthenticated = event?.detail?.authenticated ?? authModule?.isAuthenticated?.();

    sidebarNotify.debug('Global authStateChanged/authReady detected in sidebar.', {
        source: 'handleGlobalAuthStateChangeForSidebar',
        isAuthenticated
    });

    if (sidebarAuthFormContainerEl) {
        domAPI.toggleClass(sidebarAuthFormContainerEl, 'hidden', !!isAuthenticated);
        if (!isAuthenticated) {
            // If user logs out or auth is not ready, reset form to login mode
            if (isRegisterMode) {
                // This will flip to login and update UI
                // We call it directly without event, as this is an internal state reset
                updateAuthFormUI(false);
            }
            clearAuthForm();
        }
    }
  }

  function togglePin(force) {
    pinned = (force !== undefined) ? !!force : !pinned;
    storageAPI.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) showSidebar();
    dispatch('sidebarPinChanged', { pinned });
    notify.info('[sidebar] pin status changed', {
      group: true,
      context: 'sidebar',
      module: MODULE,
      source: 'togglePin',
      detail: {
        pinned,
        viewportWidth: viewportAPI.getInnerWidth?.(),
        pinState: pinned
      }
    });
  }

  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    btnPin.classList.toggle('text-primary', pinned);
    btnPin.classList.add('btn', 'btn-ghost', 'btn-square', 'btn-sm', 'min-w-[44px]', 'min-h-[44px]');
  }

  function toggleSidebar(forceVisible) {
    const willShow = (forceVisible !== undefined) ? !!forceVisible : !visible;
    willShow ? showSidebar() : closeSidebar();
    notify.info('[sidebar] toggled', {
      group: true,
      context: 'sidebar',
      module: MODULE,
      source: 'toggleSidebar',
      detail: {
        willShow,
        viewportWidth: viewportAPI.getInnerWidth?.(),
        pinState: pinned
      }
    });
  }

  function showSidebar() {
    if (visible) return;
    visible = true;
    el.classList.remove('-translate-x-full');
    el.setAttribute('aria-hidden', 'false');
    btnToggle.setAttribute('aria-expanded', 'true');
    createBackdrop();
    if (typeof document !== 'undefined' && document.body && !document.body.classList.contains('with-sidebar-open')) {
      document.body.classList.add('with-sidebar-open');
    }
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard();
      const projSearch = domAPI.getElementById('sidebarProjectSearch');
      if (projSearch) projSearch.focus();
    }
    dispatch('sidebarVisibilityChanged', { visible });
    notify.info('[sidebar] shown', { group: true, context: 'sidebar', module: MODULE, source: 'showSidebar' });
  }

  function closeSidebar() {
    if (!visible || pinned) return;
    const activeEl = domAPI.getActiveElement();
    if (el.contains(activeEl)) activeEl.blur();
    visible = false;
    el.classList.add('-translate-x-full');
    el.setAttribute('aria-hidden', 'true');
    btnToggle.setAttribute('aria-expanded', 'false');
    removeBackdrop();
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('with-sidebar-open')) {
      document.body.classList.remove('with-sidebar-open');
    }
    dispatch('sidebarVisibilityChanged', { visible });
    notify.info('[sidebar] closed', {
      group: true, context: 'sidebar', module: MODULE, source: 'closeSidebar'
    });
  }

  function handleResize() {
    if (viewportAPI.getInnerWidth() >= 1024) removeBackdrop();
    notify.info('[sidebar] resize event', { group: true, context: 'sidebar', module: MODULE, source: 'handleResize', detail: { width: viewportAPI.getInnerWidth() } });
  }

  function createBackdrop() {
    if (backdrop) return;
    if (viewportAPI.getInnerWidth() >= 1024) return;
    backdrop = domAPI.createElement('div');
    Object.assign(backdrop, {
      className: 'fixed inset-0 bg-base-300/70 z-40',
      style: 'cursor:pointer',
    });
    const closeHandler = () => closeSidebar();
    const tracked = eventHandlers.trackListener(backdrop, 'click', closeHandler, {
      description: 'Sidebar backdrop'
    });
    if (tracked) {
      trackedEvents.push({ element: backdrop, type: 'click', description: 'Sidebar backdrop' });
    }
    domAPI.body && domAPI.body.appendChild(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) { backdrop.remove(); backdrop = null; }
  }

  async function activateTab(name = 'recent') {
    try {
      const map = {
        recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
        starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
        projects: { btn: 'projectsTab', panel: 'projectsSection' },
      };
      if (!map[name]) name = 'recent';
      Object.entries(map).forEach(([key, ids]) => {
        const btn = domAPI.getElementById(ids.btn);
        const panel = domAPI.getElementById(ids.panel);
        if (btn && panel) {
          const isActive = (key === name);
          btn.classList.toggle('tab-active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
          btn.tabIndex = isActive ? 0 : -1;
          panel.classList.toggle('hidden', !isActive);
          panel.classList.toggle('flex', isActive);
          if (isActive && name === 'projects' && el.getAttribute('aria-hidden') === 'false') {
            ensureProjectDashboard();
          }
        }
      });
      storageAPI.setItem('sidebarActiveTab', name);
      dispatch('sidebarTabChanged', { tab: name });
      if (name === 'recent') maybeRenderRecentConversations();
      else if (name === 'starred') maybeRenderStarredConversations();
      notify.info('[sidebar] tab activated', { group: true, context: 'sidebar', module: MODULE, source: 'activateTab', detail: { tab: name } });
    } catch (err) {
      notify.error('[sidebar] Failed to activate tab: ' + (err && err.message ? err.message : err), { group: true, context: 'sidebar', module: MODULE, source: 'activateTab', originalError: err });
    }
  }

  async function ensureProjectDashboard() {
    try {
      if (!projectDashboard || typeof projectDashboard.initialize !== 'function') return;
      const section = domAPI.getElementById('projectsSection');
      if (section && !section.dataset.initialised) {
        await projectDashboard.initialize();
        section.dataset.initialised = 'true';
      }
      if (projectManager?.projects && uiRenderer?.renderProjects) {
        uiRenderer.renderProjects(projectManager.projects);
      }
    } catch (err) {
      notify.error('[sidebar] Failed to ensure project dashboard: ' + (err && err.message ? err.message : err), {
        group: true, context: 'sidebar', module: MODULE, source: 'ensureProjectDashboard', originalError: err
      });
    }
  }

  function maybeRenderRecentConversations() {
    if (uiRenderer?.renderConversations) uiRenderer.renderConversations();
  }

  function maybeRenderStarredConversations() {
    if (uiRenderer?.renderStarredConversations) uiRenderer.renderStarredConversations();
  }

  function isConversationStarred(id) { return starred.has(id); }
  function toggleStarConversation(id) {
    if (starred.has(id)) starred.delete(id); else starred.add(id);
    storageAPI.setItem('starredConversations', JSON.stringify([...starred]));
    maybeRenderStarredConversations();
    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    notify.info('[sidebar] star toggled', { group: true, context: 'sidebar', module: MODULE, source: 'toggleStarConversation', detail: { id, starred: starred.has(id) } });
    return starred.has(id);
  }

  function dispatch(name, detail) {
    if (domAPI && domAPI.ownerDocument && typeof CustomEvent !== 'undefined') {
      domAPI.dispatchEvent(domAPI.ownerDocument, new CustomEvent(name, { detail }));
    }
  }

  return {
    init,
    destroy,
    toggleSidebar,
    closeSidebar,
    showSidebar,
    togglePin,
    activateTab,
    isConversationStarred,
    toggleStarConversation,
    maybeRenderRecentConversations,
    maybeRenderStarredConversations,
  };

  // --- Helper functions for inline auth form ---

  function clearAuthForm() {
    if (sidebarAuthFormEl) sidebarAuthFormEl.reset(); // This clears all fields including the new username
    if (sidebarAuthErrorEl) domAPI.setTextContent(sidebarAuthErrorEl, '');
    sidebarNotify.debug('Inline auth form cleared.', { source: 'clearAuthForm' });
  }

  function updateAuthFormUI(isRegister) {
    isRegisterMode = isRegister; // Update the mode state

    if (!sidebarAuthFormTitleEl || !sidebarAuthBtnEl || !sidebarConfirmPasswordContainerEl || !sidebarAuthToggleEl || !sidebarUsernameContainerEl || !sidebarUsernameInputEl) {
      sidebarNotify.warn('Cannot update auth form UI, some elements are missing.', {
        source: 'updateAuthFormUI',
        detail: {
          titleExists: !!sidebarAuthFormTitleEl,
          btnExists: !!sidebarAuthBtnEl,
          confirmContainerExists: !!sidebarConfirmPasswordContainerEl,
          toggleLinkExists: !!sidebarAuthToggleEl,
          usernameContainerExists: !!sidebarUsernameContainerEl,
          usernameInputExists: !!sidebarUsernameInputEl,
        }
      });
      return;
    }

    if (isRegister) {
      domAPI.setTextContent(sidebarAuthFormTitleEl, 'Register');
      domAPI.setTextContent(sidebarAuthBtnEl, 'Register');
      domAPI.removeClass(sidebarUsernameContainerEl, 'hidden'); // Show username
      domAPI.setAttribute(sidebarUsernameInputEl, 'required', 'true');
      domAPI.removeClass(sidebarConfirmPasswordContainerEl, 'hidden');
      domAPI.setAttribute(sidebarConfirmPasswordInputEl, 'required', 'true');
      domAPI.setTextContent(sidebarAuthToggleEl, 'Already have an account? Login');
    } else {
      domAPI.setTextContent(sidebarAuthFormTitleEl, 'Login');
      domAPI.setTextContent(sidebarAuthBtnEl, 'Login');
      domAPI.addClass(sidebarUsernameContainerEl, 'hidden'); // Hide username
      domAPI.removeAttribute(sidebarUsernameInputEl, 'required');
      domAPI.addClass(sidebarConfirmPasswordContainerEl, 'hidden');
      domAPI.removeAttribute(sidebarConfirmPasswordInputEl, 'required');
      domAPI.setTextContent(sidebarAuthToggleEl, 'Need an account? Register');
    }
    clearAuthForm(); // Clear errors and inputs when mode changes
    sidebarNotify.debug(`Auth form UI updated to ${isRegister ? 'Register' : 'Login'} mode.`, { source: 'updateAuthFormUI' });
  }

  function setupInlineAuthForm() {
    sidebarNotify.debug('Setting up inline auth form.', { source: 'setupInlineAuthForm' });

    if (!sidebarAuthFormContainerEl || !sidebarAuthFormEl || !sidebarAuthToggleEl || !sidebarAuthBtnEl || !sidebarAuthErrorEl || !sidebarEmailInputEl || !sidebarPasswordInputEl || !sidebarConfirmPasswordContainerEl || !sidebarConfirmPasswordInputEl || !sidebarAuthFormTitleEl || !sidebarUsernameContainerEl || !sidebarUsernameInputEl) {
      sidebarNotify.error('One or more sidebar auth form elements are missing. Inline auth will not function.', {
        source: 'setupInlineAuthForm',
        group: true,
        detail: {
            container: !!sidebarAuthFormContainerEl,
            form: !!sidebarAuthFormEl,
            toggle: !!sidebarAuthToggleEl,
            button: !!sidebarAuthBtnEl,
            error: !!sidebarAuthErrorEl,
            usernameContainer: !!sidebarUsernameContainerEl,
            usernameInput: !!sidebarUsernameInputEl,
            email: !!sidebarEmailInputEl,
            password: !!sidebarPasswordInputEl,
            confirmContainer: !!sidebarConfirmPasswordContainerEl,
            confirmInput: !!sidebarConfirmPasswordInputEl,
            title: !!sidebarAuthFormTitleEl,
        }
      });
      return;
    }

    eventHandlers.trackListener(sidebarAuthToggleEl, 'click', (e) => {
      e.preventDefault();
      updateAuthFormUI(!isRegisterMode); // Toggle mode and update UI
    }, { description: 'Toggle Sidebar Auth Mode', module: MODULE, context: 'inlineAuth' });

    eventHandlers.trackListener(sidebarAuthFormEl, 'submit', async (e) => {
      e.preventDefault();
      domAPI.setTextContent(sidebarAuthErrorEl, ''); // Clear previous errors
      const email = sidebarEmailInputEl.value;
      const password = sidebarPasswordInputEl.value;
      const authModule = DependencySystem.modules.get('auth');

      if (!authModule) {
        sidebarNotify.error('Auth module not available for sidebar login/register.', { source: 'sidebarAuthSubmit', group: true });
        domAPI.setTextContent(sidebarAuthErrorEl, 'Authentication service unavailable. Please try again later.');
        return;
      }

      domAPI.setProperty(sidebarAuthBtnEl, 'disabled', true);
      domAPI.addClass(sidebarAuthBtnEl, 'loading'); // DaisyUI loading state

      try {
        if (isRegisterMode) {
          const username = sidebarUsernameInputEl.value; // Get username
          const confirmPassword = sidebarConfirmPasswordInputEl.value;

          if (!username) { // Basic validation for username
            sidebarNotify.warn('Username is required for registration.', { source: 'sidebarAuthSubmit' });
            domAPI.setTextContent(sidebarAuthErrorEl, 'Username is required.');
            throw new Error('Username is required.');
          }

          if (password !== confirmPassword) {
            sidebarNotify.warn('Passwords do not match during sidebar registration.', { source: 'sidebarAuthSubmit' });
            domAPI.setTextContent(sidebarAuthErrorEl, 'Passwords do not match.');
            throw new Error('Passwords do not match.');
          }
          sidebarNotify.info('Attempting registration via sidebar.', { source: 'sidebarAuthSubmit', extra: { username, email } });
          // Pass userData as an object
          await authModule.register({ username: username, email: email, password: password });
          sidebarNotify.success('Registration successful via sidebar. Please login.', { source: 'sidebarAuthSubmit', extra: { username, email } });
          updateAuthFormUI(false);
          domAPI.setTextContent(sidebarAuthErrorEl, 'Registration successful! Please login.');
        } else {
          sidebarNotify.info('Attempting login via sidebar.', { source: 'sidebarAuthSubmit', extra: { email } });
          // For login, authModule.login likely expects separate arguments or an object with email/username and password
          // Assuming authModule.login(email, password) is the correct signature based on previous context.
          await authModule.login(email, password);
          sidebarNotify.success('Login successful via sidebar.', { source: 'sidebarAuthSubmit', extra: { email } });
          // On successful login, the authStateChanged listener will hide the form.
        }
      } catch (error) {
        const errorMessage = error?.message || (isRegisterMode ? 'Registration failed.' : 'Login failed.');
        sidebarNotify.error(`Sidebar auth failed: ${errorMessage}`, {
          source: 'sidebarAuthSubmit',
          originalError: error,
          extra: { email, mode: isRegisterMode ? 'register' : 'login' }
        });
        domAPI.setTextContent(sidebarAuthErrorEl, errorMessage);
      } finally {
        domAPI.setProperty(sidebarAuthBtnEl, 'disabled', false);
        domAPI.removeClass(sidebarAuthBtnEl, 'loading');
      }
    }, { description: 'Sidebar Auth Form Submit', module: MODULE, context: 'inlineAuth' });

    // Initial UI setup
    const auth = DependencySystem.modules.get('auth');
    const initiallyAuthenticated = auth?.isAuthenticated?.();
    domAPI.toggleClass(sidebarAuthFormContainerEl, 'hidden', !!initiallyAuthenticated);
    if (!initiallyAuthenticated) {
      updateAuthFormUI(false); // Start in login mode
    } else {
      sidebarNotify.debug('User already authenticated, inline auth form hidden initially.', { source: 'setupInlineAuthForm' });
    }
  }
}
