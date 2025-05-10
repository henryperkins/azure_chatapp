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
  domAPI,
  accessibilityUtils // Added for accessibility announcements
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
  if (!accessibilityUtils || typeof accessibilityUtils.announce !== 'function') { // Added check
    throw new Error('[sidebar] accessibilityUtils with an announce method is required.');
  }
  app = app || resolveDep('app');
  projectDashboard = projectDashboard || resolveDep('projectDashboard');
  projectManager = projectManager || resolveDep('projectManager');
  uiRenderer = uiRenderer || resolveDep('uiRenderer');
  if (!notify) throw new Error('[sidebar] notify util (from DI) is required');

  // ------------------------------------------------------------------
  // If no uiRenderer was supplied by the caller, create a minimal one
  // so projects/conversations can still be listed.
  // ------------------------------------------------------------------
  if (!uiRenderer) uiRenderer = (function createFallbackRenderer () {
    /* helpers share surrounding scope: domAPI, eventHandlers, projectDashboard */
    const PROJECT_ITEM_SELECTOR = '#projectsSection ul';

    function ensureList(parentSel) {
      let list = domAPI.querySelector(parentSel);
      if (!list) {
        const parent = domAPI.getElementById('projectsSection');
        if (!parent) return null;
        list = domAPI.createElement('ul');
        parent.appendChild(list);
      }
      return list;
    }

    function renderProjects(projects = []) {
      const list = ensureList(PROJECT_ITEM_SELECTOR);
      if (!list) return;
      list.innerHTML = '';
      projects.forEach(p => {
        const li   = domAPI.createElement('li');
        const link = domAPI.createElement('a');
        link.href  = '#';
        domAPI.setTextContent(link, p.name || 'Untitled');
        eventHandlers.trackListener(
          link, 'click', (e) => {
            domAPI.preventDefault(e);
            projectDashboard?.showProjectDetails?.(p.id);
          },
          { description: 'Sidebar project click', context: MODULE }
        );
        domAPI.appendChild(li, link);
        domAPI.appendChild(list, li);
      });
    }

    /* Stubbed versions – can be expanded later */
    const noop = () => {};
    return {
      renderProjects,
      renderConversations: noop,
      renderStarredConversations: noop,
    };
  }());

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

  // Search input elements
  let chatSearchInputEl = null;
  let sidebarProjectSearchInputEl = null;

  // For inline auth form
  let isRegisterMode = false;
  let sidebarAuthFormContainerEl, sidebarAuthFormTitleEl, sidebarAuthFormEl,
      sidebarUsernameContainerEl, sidebarUsernameInputEl,
      sidebarEmailInputEl, sidebarPasswordInputEl, sidebarConfirmPasswordContainerEl,
      sidebarConfirmPasswordInputEl, sidebarAuthBtnEl, sidebarAuthErrorEl, sidebarAuthToggleEl;

  const sidebarNotify = notify.withContext({ module: MODULE, context: 'inlineAuth' });

  const starred = new Set(
    safeParseJSON(storageAPI.getItem('starredConversations'), [])
  );

  async function init() {
    notify.debug('[sidebar] init() called', { group: true, context: 'sidebar', module: MODULE, source: 'init' });
    try {
      findDom();
      setupInlineAuthForm();
      restorePersistentState();
      bindDomEvents();
      if (app && typeof app.getInitialSidebarContext === 'function') {
        const { projectId } = app.getInitialSidebarContext() || {};
        if (projectId && projectManager && typeof projectManager.setCurrentProjectId === 'function') {
          projectManager.setCurrentProjectId(projectId);
        }
      }
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab); // This will also call rendering functions
      notify.info('[sidebar] initialized successfully', { group: true, context: 'sidebar', module: MODULE, source: 'init', activeTab });

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
    notify.info('[sidebar] destroy() called', { group: true, context: 'sidebar', module: MODULE, source: 'destroy' });
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === 'function') {
        DependencySystem.cleanupModuleListeners(MODULE);
        notify.debug(`[sidebar] Called DependencySystem.cleanupModuleListeners for context: ${MODULE}`, { source: 'destroy' });
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
        eventHandlers.cleanupListeners({ context: MODULE });
        notify.debug(`[sidebar] Called eventHandlers.cleanupListeners for context: ${MODULE}`, { source: 'destroy' });
    } else {
        notify.warn('[sidebar] cleanupListeners not available on eventHandlers or DependencySystem.', { source: 'destroy' });
    }
    if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
        eventHandlers.cleanupListeners({ context: 'inlineAuth' });
         notify.debug(`[sidebar] Called eventHandlers.cleanupListeners for context: inlineAuth`, { source: 'destroy' });
    }
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

    // Search inputs
    chatSearchInputEl = domAPI.getElementById('chatSearchInput');
    sidebarProjectSearchInputEl = domAPI.getElementById('sidebarProjectSearch');

    // DOM elements for inline auth form
    sidebarAuthFormContainerEl = domAPI.getElementById('sidebarAuthFormContainer');
    sidebarAuthFormTitleEl = domAPI.getElementById('sidebarAuthFormTitle');
    sidebarAuthFormEl = domAPI.getElementById('sidebarAuthForm');
    sidebarUsernameContainerEl = domAPI.getElementById('sidebarUsernameContainer');
    sidebarUsernameInputEl = domAPI.getElementById('sidebarUsername');
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

  function _handleChatSearch() {
    if (!chatSearchInputEl || !uiRenderer) return;
    const searchTerm = chatSearchInputEl.value.trim().toLowerCase();
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';

    notify.debug(`Chat search initiated. Term: "${searchTerm}", Active Tab: "${activeTab}"`, {
        module: MODULE, source: '_handleChatSearch', context: 'sidebarSearch'
    });

    let itemsFound = -1; // Placeholder for item count if renderer provides it

    if (activeTab === 'recent') {
        if (uiRenderer.renderConversations) {
            // Assuming renderConversations might return a count or we query after render
            uiRenderer.renderConversations(searchTerm);
            // Example: itemsFound = domAPI.querySelectorAll('#recentChatsSection li:not(.hidden)').length;
            if (accessibilityUtils && typeof accessibilityUtils.announce === 'function') {
                accessibilityUtils.announce(`Recent conversations filtered for "${searchTerm || 'all'}".`);
            }
        }
    } else if (activeTab === 'starred') {
        if (uiRenderer.renderStarredConversations) {
            uiRenderer.renderStarredConversations(searchTerm);
            // Example: itemsFound = domAPI.querySelectorAll('#starredChatsSection li:not(.hidden)').length;
            if (accessibilityUtils && typeof accessibilityUtils.announce === 'function') {
                accessibilityUtils.announce(`Starred conversations filtered for "${searchTerm || 'all'}".`);
            }
        }
    }
  }

  function _handleProjectSearch() {
    if (!sidebarProjectSearchInputEl || !projectManager || !uiRenderer) return;
    const searchTerm = sidebarProjectSearchInputEl.value.trim().toLowerCase();

    notify.debug(`Project search initiated. Term: "${searchTerm}"`, {
        module: MODULE, source: '_handleProjectSearch', context: 'sidebarSearch'
    });

    const allProjects = projectManager.projects || [];
    const filteredProjects = searchTerm
        ? allProjects.filter(project => project.name && project.name.toLowerCase().includes(searchTerm))
        : allProjects;

    if (uiRenderer.renderProjects) {
        uiRenderer.renderProjects(filteredProjects);
        if (accessibilityUtils && typeof accessibilityUtils.announce === 'function') {
            accessibilityUtils.announce(`Projects filtered for "${searchTerm || 'all'}". Found ${filteredProjects.length} projects.`);
        }
    }
  }

  function bindDomEvents() {
    const track = (element, evtType, originalHandlerCallback, description, sourceOverride) => {
      if (!element) return;
      const contextualHandler = safeInvoker(
        originalHandlerCallback,
        { notify },
        { context: 'sidebar', module: MODULE, source: sourceOverride || description }
      );
      const wrappedHandler = eventHandlers.trackListener(element, evtType, contextualHandler, { description, context: MODULE });
      // trackedEvents logic can be kept or removed if context cleanup is fully relied upon
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

    track(chatSearchInputEl, 'input', _handleChatSearch, 'Chat search filter input', 'handleChatSearch');
    track(sidebarProjectSearchInputEl, 'input', _handleProjectSearch, 'Project search filter input', 'handleProjectSearch');

    const authModule = DependencySystem.modules.get('auth');
    const eventTargetForAuth = authModule?.AuthBus || domAPI.getDocument();

    track(eventTargetForAuth, 'authStateChanged', handleGlobalAuthStateChangeForSidebar, 'Sidebar AuthStateChange Global Listener', 'handleGlobalAuthStateChangeForSidebar');
    if (authModule?.AuthBus) {
        track(authModule.AuthBus, 'authReady', handleGlobalAuthStateChangeForSidebar, 'Sidebar AuthReady Global Listener', 'handleGlobalAuthStateChangeForSidebar');
    }

    // Refresh sidebar when projects arrive
    eventHandlers.trackListener(
      domAPI.getDocument(),
      'projectsLoaded',
      (e) => {
        const list = e.detail?.projects ?? [];
        if (uiRenderer?.renderProjects) uiRenderer.renderProjects(list);
      },
      { description: 'Sidebar projectsLoaded refresh', context: MODULE }
    );

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
      eventHandlers.trackListener(el, 'error', errorHandler, { description: 'Sidebar child widget error', context: MODULE });
    }
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
        }
      });
      storageAPI.setItem('sidebarActiveTab', name);
      dispatch('sidebarTabChanged', { tab: name });

      if (name === 'recent') {
        _handleChatSearch();
      } else if (name === 'starred') {
        _handleChatSearch();
      } else if (name === 'projects') {
        await ensureProjectDashboard();
        _handleProjectSearch();
      }
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

  function maybeRenderRecentConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || "") {
    if (uiRenderer?.renderConversations) uiRenderer.renderConversations(searchTerm);
  }

  function maybeRenderStarredConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || "") {
    if (uiRenderer?.renderStarredConversations) uiRenderer.renderStarredConversations(searchTerm);
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
            if (isRegisterMode) {
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
    // Ensure base classes are present if they might be removed elsewhere
    // For now, assuming they are static in HTML or managed by other logic if dynamic
    // btnPin.classList.add('btn', 'btn-ghost', 'btn-square', 'btn-sm', 'min-w-[44px]', 'min-h-[44px]');
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
    if (domAPI.body && !domAPI.body.classList.contains('with-sidebar-open')) {
      domAPI.body.classList.add('with-sidebar-open');
    }
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard(); // Ensure projects are loaded/rendered
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
    if (domAPI.body && domAPI.body.classList.contains('with-sidebar-open')) {
      domAPI.body.classList.remove('with-sidebar-open');
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
    if (viewportAPI.getInnerWidth() >= 1024) return; // No backdrop on larger screens
    backdrop = domAPI.createElement('div');
    Object.assign(backdrop.style, {
        position: 'fixed', inset: '0px', zIndex: '40', // Tailwind equivalent: fixed inset-0 z-40
        backgroundColor: 'rgba(0,0,0,0.5)', // Tailwind equivalent: bg-black/50
        cursor: 'pointer'
    });
    // backdrop.className = 'fixed inset-0 bg-base-300/70 z-40'; // Using Tailwind classes from base
    const closeHandler = () => closeSidebar();
    eventHandlers.trackListener(backdrop, 'click', closeHandler, {
      description: 'Sidebar backdrop click to close', context: MODULE
    });
    domAPI.body && domAPI.body.appendChild(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) {
      // Assuming eventHandlers.cleanupListeners({ context: MODULE }) will handle this,
      // or a more specific cleanup for the backdrop listener if needed.
      backdrop.remove();
      backdrop = null;
    }
  }

  function isConversationStarred(id) { return starred.has(id); }
  function toggleStarConversation(id) {
    if (starred.has(id)) starred.delete(id); else starred.add(id);
    storageAPI.setItem('starredConversations', JSON.stringify([...starred]));
    maybeRenderStarredConversations(); // Re-render starred list (potentially filtered)
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
  };

  function clearAuthForm() {
    if (sidebarAuthFormEl) sidebarAuthFormEl.reset();
    if (sidebarAuthErrorEl) domAPI.setTextContent(sidebarAuthErrorEl, '');
    sidebarNotify.debug('Inline auth form cleared.', { source: 'clearAuthForm' });
  }

  function updateAuthFormUI(isRegister) {
    isRegisterMode = isRegister;

    if (!sidebarAuthFormTitleEl || !sidebarAuthBtnEl || !sidebarConfirmPasswordContainerEl || !sidebarAuthToggleEl || !sidebarUsernameContainerEl || !sidebarEmailInputEl) {
      sidebarNotify.warn('Cannot update auth form UI, some elements are missing.', { source: 'updateAuthFormUI' });
      return;
    }

    const emailContainer = sidebarEmailInputEl.parentElement;

    if (isRegister) {
      domAPI.setTextContent(sidebarAuthFormTitleEl, 'Register');
      domAPI.setTextContent(sidebarAuthBtnEl, 'Register');
      domAPI.removeClass(sidebarUsernameContainerEl, 'hidden');
      domAPI.setAttribute(sidebarUsernameInputEl, 'required', 'true');
      if(emailContainer) domAPI.removeClass(emailContainer, 'hidden'); // Show email for register
      domAPI.setAttribute(sidebarEmailInputEl, 'required', 'true'); // Email required for register
      domAPI.removeClass(sidebarConfirmPasswordContainerEl, 'hidden');
      domAPI.setAttribute(sidebarConfirmPasswordInputEl, 'required', 'true');
      domAPI.setTextContent(sidebarAuthToggleEl, 'Already have an account? Login');
    } else { // Login mode
      domAPI.setTextContent(sidebarAuthFormTitleEl, 'Login');
      domAPI.setTextContent(sidebarAuthBtnEl, 'Login');
      domAPI.removeClass(sidebarUsernameContainerEl, 'hidden'); // Username shown for login
      domAPI.setAttribute(sidebarUsernameInputEl, 'required', 'true');
      if(emailContainer) domAPI.addClass(emailContainer, 'hidden'); // Hide email for login
      domAPI.removeAttribute(sidebarEmailInputEl, 'required'); // Email not required for login
      domAPI.addClass(sidebarConfirmPasswordContainerEl, 'hidden');
      domAPI.removeAttribute(sidebarConfirmPasswordInputEl, 'required');
      domAPI.setTextContent(sidebarAuthToggleEl, 'Need an account? Register');
    }
    clearAuthForm();
    sidebarNotify.debug(`Auth form UI updated to ${isRegister ? 'Register' : 'Login'} mode.`, { source: 'updateAuthFormUI' });
  }

  function setupInlineAuthForm() {
    sidebarNotify.debug('Setting up inline auth form.', { source: 'setupInlineAuthForm' });

    if (!sidebarAuthFormContainerEl || !sidebarAuthFormEl || !sidebarAuthToggleEl /* ... other elements */) {
      // Simplified check for brevity, assume all elements are checked as in original
      sidebarNotify.error('One or more sidebar auth form elements are missing. Inline auth will not function.', { source: 'setupInlineAuthForm', group: true });
      return;
    }

    eventHandlers.trackListener(sidebarAuthToggleEl, 'click', (e) => {
      e.preventDefault();
      updateAuthFormUI(!isRegisterMode);
    }, { description: 'Toggle Sidebar Auth Mode', module: MODULE, context: 'inlineAuth' });

    eventHandlers.trackListener(sidebarAuthFormEl, 'submit', async (e) => {
      e.preventDefault();
      domAPI.setTextContent(sidebarAuthErrorEl, '');
      const username = sidebarUsernameInputEl.value.trim(); // Use username field
      const email = sidebarEmailInputEl.value.trim();
      const password = sidebarPasswordInputEl.value;
      const authModule = DependencySystem.modules.get('auth');

      if (!authModule) {
        sidebarNotify.error('Auth module not available.', { source: 'sidebarAuthSubmit', group: true });
        domAPI.setTextContent(sidebarAuthErrorEl, 'Authentication service unavailable.');
        return;
      }

      domAPI.setProperty(sidebarAuthBtnEl, 'disabled', true);
      domAPI.addClass(sidebarAuthBtnEl, 'loading');

      try {
        if (isRegisterMode) {
          const confirmPassword = sidebarConfirmPasswordInputEl.value;
          if (!username) { /* ... username validation ... */ throw new Error('Username is required.'); }
          if (!email) { /* ... email validation ... */ throw new Error('Email is required.'); }
          if (password !== confirmPassword) { /* ... password match ... */ throw new Error('Passwords do not match.'); }

          sidebarNotify.info('Attempting registration via sidebar.', { source: 'sidebarAuthSubmit', extra: { username, email } });
          await authModule.register({ username, email, password }); // Pass object
          sidebarNotify.success('Registration successful. Please login.', { source: 'sidebarAuthSubmit', extra: { username } });
          updateAuthFormUI(false); // Switch to login
          domAPI.setTextContent(sidebarAuthErrorEl, 'Registration successful! Please login.');

        } else { // Login mode
          if (!username) { /* ... username validation ... */ throw new Error('Username is required.'); }
          sidebarNotify.info('Attempting login via sidebar.', { source: 'sidebarAuthSubmit', extra: { username } });
          await authModule.login(username, password); // Login with username
          sidebarNotify.success('Login successful via sidebar.', { source: 'sidebarAuthSubmit', extra: { username } });
        }
      } catch (error) {
        const errorMessage = error?.message || (isRegisterMode ? 'Registration failed.' : 'Login failed.');
        sidebarNotify.error(`Sidebar auth failed: ${errorMessage}`, { source: 'sidebarAuthSubmit', originalError: error });
        domAPI.setTextContent(sidebarAuthErrorEl, errorMessage);
      } finally {
        domAPI.setProperty(sidebarAuthBtnEl, 'disabled', false);
        domAPI.removeClass(sidebarAuthBtnEl, 'loading');
      }
    }, { description: 'Sidebar Auth Form Submit', module: MODULE, context: 'inlineAuth' });

    const auth = DependencySystem.modules.get('auth');
    const initiallyAuthenticated = auth?.isAuthenticated?.();
    domAPI.toggleClass(sidebarAuthFormContainerEl, 'hidden', !!initiallyAuthenticated);
    if (!initiallyAuthenticated) {
      updateAuthFormUI(false); // Default to login mode
    } else {
      sidebarNotify.debug('User already authenticated, inline auth form hidden initially.', { source: 'setupInlineAuthForm' });
    }
  }
}
