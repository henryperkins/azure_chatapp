/**
 * sidebar.js – Unified single-factory replacement
 *      (merging sidebar, sidebar-auth, and sidebar-events)
 *
 * Usage:
 *    import { createSidebar } from './sidebar.js';
 *
 *    const sidebar = createSidebar({
 *      eventHandlers,
 *      DependencySystem,
 *      domAPI,
 *      uiRenderer,
 *      storageAPI,
 *      projectManager,
 *      app,
 *      projectDashboard,
 *      viewportAPI,
 *      accessibilityUtils,
 *      sanitizer, // optional - used for sanitizing user input if needed
 *      /* ... other dependencies as required
 *    });
 *
 *    // Initialize everything
 *    sidebar.init();
 *
 *    // Clean up
 *    sidebar.destroy();
 */

import { safeParseJSON, debounce as globalDebounce } from './utils/globalUtils.js';

// Factory function strictly enforces DI for logger and domReadinessService per guardrails.
/**
 * @param {object} deps - All dependencies must be injected; see .clinerules
 * @param {object} deps.eventHandlers
 * @param {object} deps.DependencySystem
 * @param {object} deps.domAPI
 * @param {object} deps.uiRenderer
 * @param {object} deps.storageAPI
 * @param {object} deps.projectManager
 * @param {object} deps.app
 * @param {object} deps.projectDashboard
 * @param {object} deps.viewportAPI
 * @param {object} deps.accessibilityUtils
 * @param {object} deps.sanitizer
 * @param {object} deps.domReadinessService - MANDATORY: Centralized DOM/app readiness via DI
 * @param {object} deps.logger - MANDATORY: Logger dependency via DI only
 * @param {function} deps.safeHandler - MANDATORY: Event handler error wrapper via DI
 * @returns {object} Sidebar API
 */
export function createSidebar({
  eventHandlers,
  DependencySystem,
  domAPI,
  uiRenderer,
  storageAPI,
  projectManager,
  modelConfig, // DI: REQUIRED for model settings UI per frontend guardrails
  app,
  projectDashboard,
  viewportAPI,
  accessibilityUtils,
  sanitizer, // optional, e.g. sanitizer.sanitize()
  domReadinessService,
  logger,
  safeHandler, // required for event handler wrapping
  APP_CONFIG,
  ...rest
} = {}) {
  /* ------------------------------------------------------------------ */
  /* 1) Validation & Setup (Strict DI)                                  */
  /* ------------------------------------------------------------------ */
  if (!eventHandlers) throw new Error('[Sidebar] eventHandlers is required.');
  if (!DependencySystem) throw new Error('[Sidebar] DependencySystem is required.');
  if (!domAPI) throw new Error('[Sidebar] domAPI is required.');
  if (!uiRenderer ||
      typeof uiRenderer.renderConversations !== 'function' ||
      typeof uiRenderer.renderStarredConversations !== 'function' ||
      typeof uiRenderer.renderProjects !== 'function') {
    throw new Error('[Sidebar] uiRenderer with the necessary render methods is required.');
  }
  if (!storageAPI) throw new Error('[Sidebar] storageAPI is required.');
  if (!projectManager) throw new Error('[Sidebar] projectManager is required.');
  if (!modelConfig) throw new Error('[Sidebar] modelConfig (DI) is required for model settings UI.');
  if (!viewportAPI) throw new Error('[Sidebar] viewportAPI is required.');
  if (!accessibilityUtils || typeof accessibilityUtils.announce !== 'function') {
    throw new Error('[Sidebar] accessibilityUtils is required for accessibility announcements.');
  }
  if (!logger) throw new Error('[Sidebar] DI logger is required.');
  if (!domReadinessService) throw new Error('[Sidebar] DI domReadinessService is required.');
  if (typeof safeHandler !== 'function') throw new Error('[Sidebar] DI safeHandler (function) is required.');
  if (!APP_CONFIG) throw new Error('[Sidebar] APP_CONFIG is required.');

  const MODULE = 'Sidebar';
  const CONTEXT = 'Sidebar';   // literal required by guardrails

  // Gently resolve optional dependencies from the DependencySystem if not explicitly provided
  app = app || tryResolve('app');
  projectDashboard = projectDashboard || tryResolve('projectDashboard');

  function tryResolve(depName) {
    if (DependencySystem?.modules?.get) {
      return DependencySystem.modules.get(depName);
    }
    if (DependencySystem?.get) {
      return DependencySystem.get(depName);
    }
    return undefined;
  }


  /* ------------------------------------------------------------------ */
  /*   Sidebar Settings panel (gear-icon toggles vertical slide-out)    */
  /* ------------------------------------------------------------------ */
  let settingsPanelEl = null;
  function _ensureSettingsPanel() {
    if (settingsPanelEl) return settingsPanelEl;
    settingsPanelEl = domAPI.getElementById('sidebarSettingsPanel');

    if (!settingsPanelEl) {
      settingsPanelEl = domAPI.createElement('div');
      settingsPanelEl.id = 'sidebarSettingsPanel';
      settingsPanelEl.className =
        'hidden flex flex-col gap-2 p-3 overflow-y-auto border-t border-base-300';

      // Insert after projectsSection to keep natural flow
      const projectsSection = domAPI.getElementById('projectsSection');
      domAPI.appendChild(projectsSection?.parentElement || el, settingsPanelEl);
    }
    return settingsPanelEl;
  }

  function toggleSettingsPanel(force) {
    const panel = _ensureSettingsPanel();
    const show  = force !== undefined ? !!force : panel.classList.contains('hidden');
    domAPI.toggleClass(panel, 'hidden', !show);
    if (show) maybeRenderModelConfig();
  }

  /* ────────────────────────────────────────────────────────────
     Mobile bottom dock (tab shortcuts + settings gear)
     ──────────────────────────────────────────────────────────── */
  function _ensureMobileDock() {
    if (mobileDockEl || viewportAPI.getInnerWidth() >= 640) return mobileDockEl;

    mobileDockEl = domAPI.getElementById('sidebarDock');
    if (!mobileDockEl) {
      mobileDockEl           = domAPI.createElement('div');
      mobileDockEl.id        = 'sidebarDock';
      mobileDockEl.className = 'sidebar-dock hidden';
      domAPI.appendChild(el, mobileDockEl);
    }

    /* util to lazily create a dock button */
    const mkBtn = (id, label, icon, onClick) => {
      let b = domAPI.getElementById(id);
      if (!b) {
        b           = domAPI.createElement('button');
        b.id        = id;
        b.className = 'btn btn-ghost btn-square flex-1';
        domAPI.setInnerHTML(b, `${icon}<span class="sr-only">${label}</span>`);
        eventHandlers.trackListener(
          b, 'click',
          safeHandler(onClick, `dock:${id}`),
          { context: MODULE, description: `Dock btn ${id}` }
        );
        domAPI.appendChild(mobileDockEl, b);
      }
    };

    mkBtn('dockRecentBtn',   'Recent',   '🕑', () => activateTab('recent'));
    mkBtn('dockStarredBtn',  'Starred',  '⭐', () => activateTab('starred'));
    mkBtn('dockProjectsBtn', 'Projects', '📁', () => activateTab('projects'));
    mkBtn('dockSettingsBtn', 'Settings', '⚙️', () => toggleSettingsPanel());

    return mobileDockEl;
  }

  /* ------------------------------------------------------------------ */
  /* 3) Internal State                                                  */
  /* ------------------------------------------------------------------ */
  let el = null;
  let btnToggle     = null;
  let btnClose      = null;
  let btnPin        = null;
  let btnSettings   = null;      // NEW
  let mobileDockEl  = null;      // NEW bottom dock on mobile
  let chatSearchInputEl = null;
  let sidebarProjectSearchInputEl = null;
  let backdrop = null;

  let visible = false;
  let pinned = false;

  // Save starred conversations in a Set
  const starred = new Set(
    safeParseJSON(storageAPI.getItem('starredConversations'), [])
  );

  function maybeRenderModelConfig() {
    const panel = _ensureSettingsPanel();
    if (panel.dataset.mcBound === '1') return;

    panel.dataset.mcBound = '1';
    try {
      modelConfig.renderQuickConfig(panel);
    } catch (err) {
      logger.error('[Sidebar] renderQuickConfig failed', err, { context: 'Sidebar' });
      domAPI.setTextContent(panel, 'Unable to load model configuration.');
    }
  }

  // Inline auth fields
  let isRegisterMode = false;
  let sidebarAuthFormContainerEl,
      sidebarAuthFormTitleEl,
      sidebarAuthFormEl,
      sidebarUsernameContainerEl,
      sidebarUsernameInputEl,
      sidebarEmailInputEl,
      sidebarPasswordInputEl,
      sidebarConfirmPasswordContainerEl,
      sidebarConfirmPasswordInputEl,
      sidebarAuthBtnEl,
      sidebarAuthErrorEl,
      sidebarAuthToggleEl;

  /* ------------------------------------------------------------------ */
  /* 4) Inline Auth Logic (merged from sidebar-auth)                    */
  /* ------------------------------------------------------------------ */
  function initAuthDom() {
    sidebarAuthFormContainerEl       = domAPI.getElementById('sidebarAuthFormContainer');
    sidebarAuthFormTitleEl           = domAPI.getElementById('sidebarAuthFormTitle');
    sidebarAuthFormEl                = domAPI.getElementById('sidebarAuthForm');
    sidebarUsernameContainerEl       = domAPI.getElementById('sidebarUsernameContainer');
    sidebarUsernameInputEl           = domAPI.getElementById('sidebarUsername');
    sidebarEmailInputEl              = domAPI.getElementById('sidebarEmail');
    sidebarPasswordInputEl           = domAPI.getElementById('sidebarPassword');
    sidebarConfirmPasswordContainerEl= domAPI.getElementById('sidebarConfirmPasswordContainer');
    sidebarConfirmPasswordInputEl    = domAPI.getElementById('sidebarConfirmPassword');
    sidebarAuthBtnEl                 = domAPI.getElementById('sidebarAuthBtn');
    sidebarAuthErrorEl               = domAPI.getElementById('sidebarAuthError');
    sidebarAuthToggleEl              = domAPI.getElementById('sidebarAuthToggle');
  }

  function clearAuthForm() {
    if (sidebarAuthFormEl) {
      sidebarAuthFormEl.reset();
    }
    if (sidebarAuthErrorEl) {
      domAPI.setTextContent(sidebarAuthErrorEl, '');
    }
  }

  function updateAuthFormUI(registerMode) {
    isRegisterMode = registerMode;
    if (!sidebarAuthFormTitleEl || !sidebarAuthBtnEl || !sidebarConfirmPasswordContainerEl) {
      return;
    }
    domAPI.setTextContent(sidebarAuthFormTitleEl, registerMode ? 'Register' : 'Login');
    domAPI.setTextContent(sidebarAuthBtnEl, registerMode ? 'Create account' : 'Sign in');
    domAPI.toggleClass(sidebarConfirmPasswordContainerEl, 'hidden', !registerMode);
    domAPI.toggleClass(sidebarUsernameContainerEl, 'hidden', !registerMode);
  }

  async function _handleAuthSubmit(authModule) {
    const username = sidebarUsernameInputEl.value.trim();
    const email    = sidebarEmailInputEl.value.trim();
    const password = sidebarPasswordInputEl.value;

    // Optionally sanitize if desired
    // e.g. const cleanEmail = sanitizer?.sanitize(email) || email;

    if (sidebarAuthBtnEl) {
      domAPI.setProperty(sidebarAuthBtnEl, 'disabled', true);
    }

    try {
      if (isRegisterMode) {
        const confirm = sidebarConfirmPasswordInputEl.value;
        if (password !== confirm) {
          throw new Error('Passwords do not match.');
        }
        await authModule.register({ username, email, password });
        updateAuthFormUI(false);
        domAPI.setTextContent(sidebarAuthErrorEl, 'Registration successful. Please sign in.');
      } else {
        await authModule.login(username, password);
      }
    } catch (err) {
      logger.error('[Sidebar][authSubmit]', err && err.stack ? err.stack : err, { context: 'Sidebar' });
      domAPI.setTextContent(
        sidebarAuthErrorEl,
        err?.message || (isRegisterMode ? 'Registration failed.' : 'Login failed.')
      );
    } finally {
      if (sidebarAuthBtnEl) {
        domAPI.setProperty(sidebarAuthBtnEl, 'disabled', false);
      }
    }
  }

  function setupInlineAuthForm() {
    const authModule = DependencySystem.modules?.get('auth') || DependencySystem.get?.('auth');
    if (!authModule) return;

    // Toggle between "Register" and "Login"
    eventHandlers.trackListener(
      sidebarAuthToggleEl,
      'click',
      safeHandler(() => {
        updateAuthFormUI(!isRegisterMode);
        clearAuthForm();
      }, '[Sidebar] toggle auth mode'),
      { description: 'Sidebar toggle auth mode', context: MODULE }
    );

    // Auth form submit
    eventHandlers.trackListener(
      sidebarAuthFormEl,
      'submit',
      safeHandler((e) => {
        e.preventDefault();
        _handleAuthSubmit(authModule);
      }, '[Sidebar] auth form submit'),
      { description: 'Sidebar auth submit', context: MODULE }
    );
  }

  async function handleGlobalAuthStateChange(event) {
    const authModule = DependencySystem.modules?.get('auth') || DependencySystem.get?.('auth');
    const authenticated = event?.detail?.authenticated ?? authModule?.isAuthenticated?.();

    domAPI.toggleClass(sidebarAuthFormContainerEl, 'hidden', !!authenticated);
    // Ensure the sidebar itself is always visible, independent of auth state
    domAPI.toggleClass(el, 'hidden', false);

    if (authenticated) {
      // On login: ensure projects are loaded and UI is updated
      try {
        if (logger && logger.info) logger.info(`[Sidebar][auth:stateChanged] Logged in, loading projects and refreshing Projects tab`, { context: 'Sidebar' });
        if (projectManager?.loadProjects) {
          await projectManager.loadProjects('all');
        }
        // Switch to projects tab or re-render it
        await activateTab('projects');
      } catch (err) {
        if (logger && logger.error) logger.error(`[Sidebar][auth:stateChanged] Failed to load projects`, err && err.stack ? err.stack : err, { context: 'Sidebar' });
      }
    } else {
      // If logged out, revert to login mode
      if (isRegisterMode) {
        updateAuthFormUI(false);
      }
      clearAuthForm();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 5) Original Sidebar Logic: DOM, States, Searching, Pinning, etc.   */
  /* ------------------------------------------------------------------ */

  function findDom() {
    el                       = domAPI.getElementById('mainSidebar');
    btnToggle               = domAPI.getElementById('navToggleBtn');
    btnClose                = domAPI.getElementById('closeSidebarBtn');
    btnPin                  = domAPI.getElementById('pinSidebarBtn');
    btnSettings             = domAPI.getElementById('sidebarSettingsBtn'); // NEW (gear-icon)
    chatSearchInputEl       = domAPI.getElementById('chatSearchInput');
    sidebarProjectSearchInputEl = domAPI.getElementById('sidebarProjectSearch');

    if (!el) {
      logger.error('[Sidebar] Required element #mainSidebar missing', { context: 'Sidebar' });
      throw new Error('[Sidebar] Required element #mainSidebar missing');
    }
    if (!btnToggle) {
      logger.warn('[Sidebar] #navToggleBtn not found – toggle feature disabled', { context: 'Sidebar' });
    }
  }

  function togglePin(force) {
    pinned = force !== undefined ? !!force : !pinned;
    storageAPI.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) {
      showSidebar();
    }
    dispatch('sidebarPinChanged', { pinned });
  }

  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    btnPin.classList.toggle('text-primary', pinned);
  }

  function isConversationStarred(id) {
    return starred.has(id);
  }

  function toggleStarConversation(id) {
    if (starred.has(id)) {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    storageAPI.setItem('starredConversations', JSON.stringify([...starred]));

    // If we're on the "starred" tab, re-render so user sees updated
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'starred') {
      maybeRenderStarredConversations();
    }

    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    return starred.has(id);
  }

  function dispatch(name, detail) {
    const doc = domAPI.getDocument();
    if (doc && typeof doc.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      doc.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  // Basic chat search logic
  function _handleChatSearch() {
    if (!chatSearchInputEl || !uiRenderer) return;
    let searchTerm = chatSearchInputEl.value.trim().toLowerCase();
    // Optionally sanitize user input
    searchTerm = sanitizer?.sanitize(searchTerm) || searchTerm;

    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    const currentProject = projectManager.getCurrentProject?.();
    const projectId = currentProject?.id;

    if (activeTab === 'recent') {
      uiRenderer.renderConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
      accessibilityUtils.announce?.(`Recent conversations filtered: "${searchTerm || 'all'}"`);
    } else if (activeTab === 'starred') {
      uiRenderer.renderStarredConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
      accessibilityUtils.announce?.(`Starred conversations filtered: "${searchTerm || 'all'}"`);
    }
  }

  // Basic project search logic
  function _handleProjectSearch() {
    if (!sidebarProjectSearchInputEl || !projectManager || !uiRenderer) return;
    let searchTerm = sidebarProjectSearchInputEl.value.trim().toLowerCase();
    // Optionally sanitize user input
    searchTerm = sanitizer?.sanitize(searchTerm) || searchTerm;

    const allProjects = projectManager.projects || [];
    const filteredProjects = searchTerm
      ? allProjects.filter((p) => p.name?.toLowerCase().includes(searchTerm))
      : allProjects;

    try {
      uiRenderer.renderProjects(filteredProjects);
      accessibilityUtils.announce?.(
        `Projects filtered for "${searchTerm || 'all'}". Found ${filteredProjects.length} projects.`
      );
    } catch (error) {
      logger.error('[Sidebar][_handleProjectSearch]', error && error.stack ? error.stack : error, { context: 'Sidebar' });
    }
  }

  function maybeRenderRecentConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || '') {
    const projectId = projectManager.getCurrentProject?.()?.id;
    if (!projectId) {
      // Show global or empty if no project
      if (searchTerm) {
        uiRenderer.renderConversations(null, searchTerm, isConversationStarred, toggleStarConversation);
      }
      return;
    }
    uiRenderer.renderConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  function maybeRenderStarredConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || '') {
    const projectId = projectManager.getCurrentProject?.()?.id;
    if (!projectId) {
      if (searchTerm) {
        uiRenderer.renderStarredConversations(null, searchTerm, isConversationStarred, toggleStarConversation);
      }
      return;
    }
    uiRenderer.renderStarredConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  async function activateTab(name = 'recent') {
    try {
      const map = {
        recent:   { btn: 'recentChatsTab',  panel: 'recentChatsSection'   },
        starred:  { btn: 'starredChatsTab', panel: 'starredChatsSection' },
        projects: { btn: 'projectsTab',     panel: 'projectsSection'      }
      };
      if (!map[name]) {
        name = 'recent';
      }
      // Toggle all tabs
      Object.entries(map).forEach(([key, ids]) => {
        const btn   = domAPI.getElementById(ids.btn);
        const panel = domAPI.getElementById(ids.panel);
        if (btn && panel) {
          const isActive = key === name;
          btn.classList.toggle('tab-active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
          btn.tabIndex = isActive ? 0 : -1;
          panel.classList.toggle('hidden', !isActive);
          if (isActive) panel.classList.add('flex');
          else          panel.classList.remove('flex');
        }
      });
      storageAPI.setItem('sidebarActiveTab', name);
      dispatch('sidebarTabChanged', { tab: name });

      // Possibly re-render
      const currentProject = projectManager.getCurrentProject?.();
      const projectId = currentProject?.id;

      if (name === 'recent') {
        maybeRenderRecentConversations();
      } else if (name === 'starred') {
        maybeRenderStarredConversations();
      } else if (name === 'projects') {
        await ensureProjectDashboard();
        _handleProjectSearch();
      }
    } catch (error) {
      // Silent or optional console.warn
    }
  }

  async function ensureProjectDashboard() {
    try {
      if (!projectDashboard?.initialize) return;

      const section = domAPI.getElementById('projectsSection');
      if (section && !section.dataset.initialised) {
        section.dataset.initialised = 'true';
      }
      if (projectManager?.projects?.length && uiRenderer.renderProjects) {
        uiRenderer.renderProjects(projectManager.projects);
      }
    } catch (err) {
      logger.error('[Sidebar][ensureProjectDashboard]', err && err.stack ? err.stack : err, { context: 'Sidebar' });
      // intentionally ignored: failed project dashboard init. Safe to proceed as fallback.
    }
  }

  function toggleSidebar(forceVisible) {
    const willShow = forceVisible !== undefined ? !!forceVisible : !visible;
    willShow ? showSidebar() : closeSidebar();
  }

  function showSidebar() {
    if (visible) return;
    visible = true;

    el.classList.remove('-translate-x-full');
    el.classList.add('translate-x-0');

    // Show mobile dock if applicable
    const dock = _ensureMobileDock();
    if (dock) domAPI.removeClass(dock, 'hidden');

    el.inert = false;
    el.setAttribute('aria-hidden', 'false');
    if (btnToggle) {
      btnToggle.setAttribute('aria-expanded', 'true');
    }
    createBackdrop();
    domAPI.body?.classList.add('with-sidebar-open');

    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard();
      const projSearch = domAPI.getElementById('sidebarProjectSearch');
      if (projSearch) {
        projSearch.focus();
      }
    }
    dispatch('sidebarVisibilityChanged', { visible });
  }

  function closeSidebar() {
    if (!visible || pinned) return;
    const activeEl = domAPI.getActiveElement();
    let focusMoved = false;

    // If focus is inside sidebar, try shifting it
    if (el.contains(activeEl)) {
      if (
        btnToggle &&
        typeof btnToggle.focus === 'function' &&
        btnToggle.offsetParent !== null
      ) {
        btnToggle.focus();
        focusMoved = (domAPI.getActiveElement() === btnToggle);
      }
      // Defensive fallback: forcibly move focus outside sidebar to document.body,
      // or blur activeEl; ARIA requires no focused element inside aria-hidden.
      if (!focusMoved) {
        if (domAPI.body && typeof domAPI.body.focus === 'function') {
          domAPI.body.focus();
          if (el.contains(domAPI.getActiveElement()) && typeof activeEl.blur === 'function') {
            activeEl.blur();
          }
        } else if (typeof activeEl.blur === 'function') {
          activeEl.blur();
        }
      }
    }

    visible = false;
    el.classList.add('-translate-x-full');

    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    if (btnToggle) {
      btnToggle.setAttribute('aria-expanded', 'false');
    }
    removeBackdrop();
    domAPI.body?.classList.remove('with-sidebar-open');
    if (mobileDockEl) domAPI.addClass(mobileDockEl, 'hidden');
    toggleSettingsPanel(false);        // ensure hidden when sidebar closes
    dispatch('sidebarVisibilityChanged', { visible });
  }

  function createBackdrop() {
    if (!domReadinessService) return;  // DI-safety
    if (!domReadinessService?.documentReady) return;
    if (backdrop) return;
    if (viewportAPI.getInnerWidth() >= 1024) {
      return;
    }
    backdrop = domAPI.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '40',
      backgroundColor: 'rgba(0,0,0,0.5)',
      cursor: 'pointer'
    });
    eventHandlers.trackListener(
      backdrop,
      'click',
      safeHandler(closeSidebar, 'Sidebar:[Sidebar] backdrop click'),
      {
        context: 'Sidebar',
        description: 'Sidebar backdrop click => close'
      }
    );
    domAPI.body?.appendChild(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) {
      eventHandlers?.cleanupListeners?.({ target: backdrop });
      backdrop.remove();
      backdrop = null;
    }
  }

  function handleResize() {
    if (viewportAPI.getInnerWidth() >= 1024) {
      removeBackdrop();
    }
    if (mobileDockEl) {
      const isMobile = viewportAPI.getInnerWidth() < 640;
      domAPI.toggleClass(mobileDockEl, 'hidden', !isMobile || !visible);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 6) Debounced Search Wrappers                                       */
  /* ------------------------------------------------------------------ */
  // We replace direct calls with wrapped versions in bindDomEvents
  const _debouncedChatSearch    = globalDebounce(_handleChatSearch, 200);
  const _debouncedProjectSearch = globalDebounce(_handleProjectSearch, 200);

  /* ------------------------------------------------------------------ */
  /* 7) bindDomEvents() – merges sidebar-events + inline auth events    */
  /* ------------------------------------------------------------------ */
  function bindDomEvents() {
    // Wrap a handler so errors are reported via DI logger per frontend guardrails

    // Resize
    eventHandlers.trackListener(domAPI.getWindow(), 'resize', safeHandler(handleResize, 'Sidebar:resize'), {
      context: 'Sidebar',
      description: 'Sidebar resize => remove backdrop on large screens'
    });

    // Chat search
    if (chatSearchInputEl) {
      eventHandlers.trackListener(
        chatSearchInputEl, 'input',
        safeHandler(_debouncedChatSearch, 'Sidebar:chatSearchInput'),
        { context: 'Sidebar', description: 'Debounced chat search' }
      );
    }

    // Project search
    if (sidebarProjectSearchInputEl) {
      eventHandlers.trackListener(
        sidebarProjectSearchInputEl, 'input',
        safeHandler(_debouncedProjectSearch, 'Sidebar:projectSearchInput'),
        { context: 'Sidebar', description: 'Debounced project search' }
      );
    }

    // Conversation created
    eventHandlers.trackListener(
      domAPI.getDocument(), 'chat:conversationCreated',
      safeHandler(() => {
        const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
        if (activeTab === 'recent') _handleChatSearch();
      }, 'Sidebar:chat:conversationCreated'),
      { context: 'Sidebar', description: 'Sidebar conversation created => refresh if on "recent" tab' }
    );

    // Auth state changed  (el AuthModule emite "authStateChanged")
    eventHandlers.trackListener(
      domAPI.getDocument(),
      'authStateChanged',
      safeHandler(handleGlobalAuthStateChange, 'Sidebar:authStateChanged'),
      { context: 'Sidebar', description: 'Sidebar reacts to auth state changes' }
    );

    // Pin button
    if (btnPin) {
      eventHandlers.trackListener(
        btnPin, 'click',
        safeHandler(togglePin, 'Sidebar:btnPin click'),
        { context: 'Sidebar', description: 'Toggle sidebar pin' }
      );
    }

    // Tab menu handlers: Register click handlers for tab buttons (Recent, Starred, Projects)
    const tabs = [
      { id: 'recentChatsTab',   tab: 'recent',   desc: 'Tab: Recent Chats' },
      { id: 'starredChatsTab',  tab: 'starred',  desc: 'Tab: Starred Chats' },
      { id: 'projectsTab',      tab: 'projects', desc: 'Tab: Projects' },
    ];
    tabs.forEach(({ id, tab, desc }) => {
      const element = domAPI.getElementById(id);
      if (element) {
        eventHandlers.trackListener(
          element,
          'click',
          safeHandler(
            async (e) => {
              if (e.preventDefault) e.preventDefault();
              if (logger && logger.debug) logger.debug(`[Sidebar][TabMenu] ${desc} clicked, activating '${tab}'`, { context: 'Sidebar' });
              try {
                await activateTab(tab);
                if (accessibilityUtils?.announce)
                  accessibilityUtils.announce(`Switched to ${tab} tab in sidebar`);
              } catch (error) {
                if (logger && logger.error) logger.error(`[Sidebar][TabMenu] Failed to activate '${tab}'`, error && error.stack ? error.stack : error, { context: 'Sidebar' });
              }
            },
            `Sidebar:tabmenu:${id}`
          ),
          { context: 'Sidebar', description: `Sidebar tab button click => activateTab('${tab}')` }
        );
      }
    });

    // Show/Close
    if (btnToggle) {
      eventHandlers.trackListener(
        btnToggle, 'click',
        safeHandler(showSidebar, 'Sidebar:navToggleBtn click'),
        { context: 'Sidebar', description: 'Sidebar open' }
      );
    }
    if (btnClose) {
      eventHandlers.trackListener(
        btnClose, 'click',
        safeHandler(closeSidebar, 'Sidebar:closeSidebarBtn click'),
        { context: 'Sidebar', description: 'Sidebar close' }
      );
    }

    // Gear-icon → toggle settings panel
    if (btnSettings) {
      eventHandlers.trackListener(
        btnSettings, 'click',
        safeHandler(() => toggleSettingsPanel(), 'Sidebar:settingsBtn click'),
        { context: 'Sidebar', description: 'Toggle sidebar settings panel' }
      );
    }

    /* ──────────────────────────────────────────────────────────────
       Mobile UX: auto-close the sidebar after any in-sidebar link
       is activated when screen < 768 px and sidebar isn’t pinned.
       ────────────────────────────────────────────────────────────── */
    function maybeAutoCloseMobile() {
      if (!pinned && viewportAPI.getInnerWidth() < 768) {
        closeSidebar();
      }
    }

    // Delegate clicks on any anchor inside the sidebar
    eventHandlers.trackListener(
      el,
      'click',
      safeHandler((e) => {
        const link = e.target.closest('a');
        if (link && el.contains(link)) {
          maybeAutoCloseMobile();
        }
      }, 'Sidebar:sidebarAnchor click auto-close'),
      {
        capture: true,                       // early catch before default
        context: 'Sidebar',
        description: 'Auto-close sidebar on mobile after link click'
      }
    );
  }

  /* ------------------------------------------------------------------ */
  /* 8) restorePersistentState()                                        */
  /* ------------------------------------------------------------------ */
  function restorePersistentState() {
    pinned = (storageAPI.getItem('sidebarPinned') === 'true');
    const isDesktop = viewportAPI.getInnerWidth() >= 768;
    if (pinned || isDesktop) {
      el.classList.add('sidebar-pinned');
      el.classList.remove('-translate-x-full');
      el.classList.add('translate-x-0');
      visible = true;
      el.inert = false;
      el.setAttribute('aria-hidden', 'false');
      if (btnToggle) {
        btnToggle.setAttribute('aria-expanded', 'true');
      }
    }
    updatePinButtonVisual();
  }

  /* ------------------------------------------------------------------ */
  /* 9) init() – Main Initialization                                   */
  /* ------------------------------------------------------------------ */
  async function init() {
    // Use domReadinessService for robust, centralized readiness
    if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: Starting...", { context: 'Sidebar' });

    await domReadinessService.dependenciesAndElements({
      deps: ['eventHandlers', 'auth'],
      // El Sidebar puede funcionar sin los botones si se muestran más tarde.
      domSelectors: ['#mainSidebar'],
      context: 'Sidebar'
    });

    try {
      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: findDom", { context: 'Sidebar' });
      findDom();
      _ensureMobileDock();          // create dock if mobile

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: initAuthDom", { context: 'Sidebar' });
      initAuthDom();

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: setupInlineAuthForm", { context: 'Sidebar' });
      setupInlineAuthForm();

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: restorePersistentState", { context: 'Sidebar' });
      restorePersistentState();

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: bindDomEvents", { context: 'Sidebar' });
      bindDomEvents();

      // Possibly set current project from the app context
      if (app && typeof app.getInitialSidebarContext === 'function') {
        const { projectId } = app.getInitialSidebarContext() || {};
        if (projectId && typeof app.setCurrentProject === 'function') {
          app.setCurrentProject({ id: projectId });
        }
      }

      // Activate previous or default tab
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);

      /* Asegura que la barra lateral refleja el estado de autenticación
         incluso si authStateChanged se disparó antes de que existiera el
         listener. */
      try {
        const authMod = DependencySystem.modules?.get?.('auth');
        handleGlobalAuthStateChange({
          detail: { authenticated: authMod?.isAuthenticated?.() }
        });
      } catch (syncErr) {
        logger.error('[Sidebar] Auth state sync failed during init', syncErr && syncErr.stack ? syncErr.stack : syncErr, { context: 'Sidebar' });
      }

      // Validate doc can dispatch events
      const doc = domAPI.getDocument();
      if (!doc || typeof doc.dispatchEvent !== 'function') {
        throw new Error('[Sidebar] Document from domAPI must support dispatchEvent');
      }
      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: completed successfully", { context: 'Sidebar' });
      return true;
    } catch (err) {
      if (logger && logger.error) {
        logger.error('[Sidebar] init failed', err && err.stack ? err.stack : err, { context: 'Sidebar' });
      }
      // Surface errors to callers, do not swallow -- recovery plan step 3a
      throw err;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 10) destroy() – Cleanup                                           */
  /* ------------------------------------------------------------------ */
  function destroy() {
    // Remove event listeners for this module
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === 'function') {
      DependencySystem.cleanupModuleListeners(MODULE);
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
    // Remove leftover backdrop node & listener
    if (backdrop) {
      eventHandlers?.cleanupListeners?.({ target: backdrop });
      backdrop.remove();
      backdrop = null;
    }
    // Clean up domReadinessService listeners/observers if auto-created here
    if (domReadinessService && domReadinessService.destroy) {
      try {
        domReadinessService.destroy();
      } catch (err) {
        logger.error('[Sidebar] domReadinessService.destroy failed', err && err.stack ? err.stack : err, { context: 'Sidebar' });
      }
    }

    pinned = false;
    visible = false;
  }

  /* ------------------------------------------------------------------ */
  /* 11) Public API – Matches existing consumers’ expectations          */
  /* ------------------------------------------------------------------ */
  // Dedicated EventTarget bus for sidebar events (per module event bus guardrail)
  const SidebarBus = new EventTarget();

  function cleanup() {
    destroy();
    // Remove all listeners on the bus. No standard clear, so replace with new instance if needed elsewhere
    // (or mark as cleaned if bus is published)
    // Here, just a placeholder for explicit cleanup as EventTarget has no removeAll.
  }

  return {
    init,
    destroy,
    cleanup, // per guardrail: factory must expose cleanup API
    eventBus: SidebarBus,
    toggleSidebar,
    closeSidebar,
    showSidebar,
    togglePin,
    activateTab,
    isConversationStarred,
    toggleStarConversation
  };
}
