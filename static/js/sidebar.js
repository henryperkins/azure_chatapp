/**
 * sidebar.js – Unified single-factory replacement
 * Merges original sidebar logic, fixes memory leaks, localStorage concurrency,
 * pinned state, and viewport breakpoints.
 */

import { safeParseJSON, debounce as globalDebounce } from './utils/globalUtils.js';
import { createSidebarEnhancements } from './sidebar-enhancements.js';
import { createSidebarAuth } from './sidebarAuth.js';
import { createSidebarMobileDock } from './sidebarMobileDock.js';

export function createSidebar({
  eventHandlers,
  DependencySystem,
  domAPI,
  uiRenderer,
  storageAPI,
  projectManager,
  modelConfig,
  app: appModule,
  projectDashboard,
  viewportAPI,
  accessibilityUtils,
  sanitizer,
  domReadinessService,
  logger,
  safeHandler,
  APP_CONFIG,

  // Phase-2.3 centralised UI flags
  uiStateService = null,

  // Phase-1 remediation – new explicit dependencies
  authenticationService = null,
  authBus = null,

  // Phase-3 event consolidation
  eventService = null,

  ..._rest
} = {}) {
  // ───────────────────────────────────────────────
  // Validate required dependencies
  // ───────────────────────────────────────────────
  if (!eventHandlers) throw new Error('[Sidebar] eventHandlers is required.');
  if (!DependencySystem) throw new Error('[Sidebar] DependencySystem is required.');
  if (!domAPI) throw new Error('[Sidebar] domAPI is required.');
  if (!uiRenderer ||
    typeof uiRenderer.renderConversations !== 'function' ||
    typeof uiRenderer.renderStarredConversations !== 'function' ||
    typeof uiRenderer.renderProjects !== 'function') {
    throw new Error('[Sidebar] uiRenderer with required methods is required.');
  }
  if (!storageAPI) throw new Error('[Sidebar] storageAPI is required.');
  if (!projectManager) throw new Error('[Sidebar] projectManager is required.');
  if (!viewportAPI) throw new Error('[Sidebar] viewportAPI is required.');
  if (!accessibilityUtils?.announce) {
    throw new Error('[Sidebar] accessibilityUtils is required for accessibility announcements.');
  }
  if (!logger) throw new Error('[Sidebar] logger is required.');
  if (!domReadinessService) throw new Error('[Sidebar] domReadinessService is required.');
  if (typeof safeHandler !== 'function') throw new Error('[Sidebar] safeHandler is required.');
  if (!APP_CONFIG) throw new Error('[Sidebar] APP_CONFIG is required.');
  if (!uiStateService) throw new Error('[Sidebar] uiStateService is required.');

  const MODULE = 'Sidebar';

  // Dependency fallback removal: all required deps MUST be passed by DI.
  // For backward-compatibility we still allow undefined optional deps, but we
  // never query DependencySystem at runtime anymore (Phase-1 compliance).

  if (!appModule) {
    logger.warn('[Sidebar] appModule not provided – some features may be disabled', { context: MODULE });
  }

  if (!authenticationService) {
    logger.warn('[Sidebar] authenticationService not provided – auth-dependent UI will use anonymous mode', { context: MODULE });
  }

  // Sub-factories
  const sidebarEnhancements = createSidebarEnhancements({
    eventHandlers,
    DependencySystem,
    domAPI,
    modelConfig,
    logger,
    safeHandler
  });
  const sidebarAuth = createSidebarAuth({
    domAPI,
    eventHandlers,
    DependencySystem,
    logger,
    sanitizer,
    safeHandler,
    domReadinessService
  });

  // DOM references
  let el = null;
  let btnToggle = null;
  let btnClose = null;
  let btnPin = null;
  let btnSettings = null;
  let chatSearchInputEl = null;
  let sidebarProjectSearchInputEl = null;
  let backdrop = null;
  let backdropClickRemover = null;
  let sidebarMobileDock = null;

  // ------------------------------------------------------------------
  // Centralised UI flags – synced with uiStateService
  // ------------------------------------------------------------------
  const STATE_COMPONENT = 'Sidebar';
  // UI state flags stored centrally
  let visible = uiStateService.getState(STATE_COMPONENT, 'visible') || false;
  let pinned = uiStateService.getState(STATE_COMPONENT, 'pinned') || false;
  let activeTab = uiStateService.getState(STATE_COMPONENT, 'activeTab') || 'recent';

  function setVisibleFlag(val) {
    visible = Boolean(val);
    uiStateService.setState(STATE_COMPONENT, 'visible', visible);
  }

  function setPinnedFlag(val) {
    pinned = Boolean(val);
    uiStateService.setState(STATE_COMPONENT, 'pinned', pinned);
  }

  //   -- Settings Panel
  let settingsPanelEl = null;
  function _ensureSettingsPanel() {
    if (!el) findDom();
    if (!settingsPanelEl) {
      settingsPanelEl = sidebarEnhancements.attachSettingsPanel(el);
    }
    return settingsPanelEl;
  }

  function toggleSettingsPanel(force) {
    _ensureSettingsPanel();
    sidebarEnhancements.toggleSettingsPanel(force, maybeRenderModelConfig);
  }

  //   -- Easy event dispatch
  function dispatch(name, detail) {
    if (eventService?.emit && typeof eventService.emit === 'function') {
      eventService.emit(`sidebar:${name}`, detail);
    } else if (typeof CustomEvent !== 'undefined') {
      // Fallback to document-level events if eventService not available
      domAPI.getDocument()?.dispatchEvent(new CustomEvent(`sidebar:${name}`, { detail }));
    }
  }

  // ───────────────────────────────────────────────
  // Starred Conversations (fixed concurrency)
  // ───────────────────────────────────────────────
  const starredStorageKey = 'starredConversations';
  const lockKey = 'starredConversations_lock';
  let starred = new Set();

  async function readStarred() {
    const startTime = Date.now();
    const lockId = `${Date.now()}_${Math.random()}`;
    while (storageAPI.getItem(lockKey)) {
      if (Date.now() - startTime > 1000) {
        // Force unlock if stuck
        storageAPI.removeItem(lockKey);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    storageAPI.setItem(lockKey, lockId);
    try {
      const json = storageAPI.getItem(starredStorageKey);
      const setData = (typeof json === 'string') ? safeParseJSON(json) : [];
      return new Set(setData);
    } finally {
      if (storageAPI.getItem(lockKey) === lockId) {
        storageAPI.removeItem(lockKey);
      }
    }
  }

  async function writeStarred(starredSet) {
    const startTime = Date.now();
    const lockId = `${Date.now()}_${Math.random()}`;
    while (storageAPI.getItem(lockKey)) {
      if (Date.now() - startTime > 1000) {
        storageAPI.removeItem(lockKey);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    storageAPI.setItem(lockKey, lockId);
    try {
      storageAPI.setItem(starredStorageKey, JSON.stringify(Array.from(starredSet)));
    } finally {
      if (storageAPI.getItem(lockKey) === lockId) {
        storageAPI.removeItem(lockKey);
      }
    }
  }

  async function syncStarredFromStorage() {
    starred = await readStarred();
  }

  function isConversationStarred(id) {
    return starred.has(id);
  }

  async function toggleStarConversation(id) {
    try {
      starred = await readStarred();
      if (starred.has(id)) {
        starred.delete(id);
      } else {
        starred.add(id);
      }
      await writeStarred(starred);
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      if (activeTab === 'starred') {
        maybeRenderStarredConversations();
      }
      dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
      return starred.has(id);
    } catch (err) {
      logger.error('[Sidebar] Failed to toggle star', err, { context: MODULE });
      return starred.has(id);
    }
  }


  // ───────────────────────────────────────────────
  // Model Config
  // ───────────────────────────────────────────────
  function maybeRenderModelConfig() {
    const panel = _ensureSettingsPanel();
    if (panel.dataset.mcBound === '1') return;
    panel.dataset.mcBound = '1';
    try {
      modelConfig?.renderQuickConfig(panel);
    } catch (err) {
      logger.error('[Sidebar] renderQuickConfig failed', err, { context: MODULE });
      domAPI.setTextContent(panel, 'Unable to load model configuration.');
    }
  }

  // ───────────────────────────────────────────────
  // DOM Lookup
  // ───────────────────────────────────────────────
  function findDom() {
    el = domAPI.getElementById('mainSidebar');
    btnToggle = domAPI.getElementById('navToggleBtn');
    btnClose = domAPI.getElementById('closeSidebarBtn');
    btnPin = domAPI.getElementById('pinSidebarBtn');
    btnSettings = domAPI.getElementById('sidebarSettingsBtn');
    chatSearchInputEl = domAPI.getElementById('chatSearchInput');
    sidebarProjectSearchInputEl = domAPI.getElementById('sidebarProjectSearch');

    if (!el) throw new Error('[Sidebar] #mainSidebar not found');
  }

  // ───────────────────────────────────────────────
  // Pin Handling
  // ───────────────────────────────────────────────
  function togglePin(force) {
    setPinnedFlag((typeof force === 'boolean') ? force : !pinned);
    storageAPI.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) {
      showSidebar();
    }
    dispatch('sidebarPinChanged', { pinned });
    if (visible) {
      dispatch('sidebarVisibilityChanged', { visible });
    }
  }

  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.classList.toggle('text-primary', pinned);
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
  }

  // ───────────────────────────────────────────────
  // Tab Renders
  // ───────────────────────────────────────────────
  function maybeRenderRecentConversations(searchTerm = '') {
    const projectId = projectManager?.getCurrentProject?.()?.id;
    if (!projectId) {
      const listEl = domAPI.getElementById('recentChatsSection')?.querySelector('ul');
      if (listEl) {
        domAPI.setInnerHTML(listEl, '');
        const li = domAPI.createElement('li');
        li.className = 'p-4 text-center text-gray-500';
        domAPI.setTextContent(li, 'Select a project to view conversations');
        listEl.appendChild(li);
      }
      return;
    }
    uiRenderer.renderConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  function maybeRenderStarredConversations(searchTerm = '') {
    const projectId = projectManager?.getCurrentProject?.()?.id;
    if (!projectId) {
      const listEl = domAPI.getElementById('starredChatsSection')?.querySelector('ul');
      if (listEl) {
        domAPI.setInnerHTML(listEl, '');
        const li = domAPI.createElement('li');
        li.className = 'p-4 text-center text-gray-500';
        domAPI.setTextContent(li, 'Select a project to view starred conversations');
        listEl.appendChild(li);
      }
      return;
    }
    uiRenderer.renderStarredConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  async function ensureProjectDashboard() {
    if (!projectDashboard?.initialize) {
      logger.warn('[Sidebar] ProjectDashboard not available', { context: MODULE });
      return;
    }
    const section = domAPI.getElementById('projectsSection');
    if (section && !section.dataset.initialised) {
      section.dataset.initialised = 'true';
    }
    // Also check authentication
    if (!authenticationService?.isAuthenticated?.()) {
      uiRenderer.renderProjects?.([]);
      return;
    }
    if (!projectManager) {
      logger.error('[Sidebar] projectManager not available', { context: MODULE });
      return;
    }
    let projects = projectManager.projects || [];
    if (typeof projectManager.loadProjects === 'function' && projects.length === 0) {
      try {
        projects = await projectManager.loadProjects() || [];
        // Auto-select first if none selected
        const currentProject = projectManager.getCurrentProject?.();
        if (!currentProject && projects.length > 0) {
          appModule?.setCurrentProject?.(projects[0]);
        }
      } catch (err) {
        logger.error('[Sidebar] Failed to load projects', err, { context: MODULE });
        const listEl = section?.querySelector('ul');
        if (listEl) {
          domAPI.setInnerHTML(listEl, '');
          const errorLi = domAPI.createElement('li');
          errorLi.className = 'p-4 text-center text-error';
          domAPI.setTextContent(errorLi, 'Failed to load projects. Please refresh.');
          listEl.appendChild(errorLi);
        }
        return;
      }
    }
    // Render
    uiRenderer.renderProjects?.(projects);
    // Possibly re-render the conversation lists
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'recent') maybeRenderRecentConversations();
    if (activeTab === 'starred') maybeRenderStarredConversations();
  }

  async function activateTab(name = 'recent') {
    const map = {
      recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
      starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
      projects: { btn: 'projectsTab', panel: 'projectsSection' }
    };
    if (!map[name]) {
      name = 'recent';
    }
    Object.entries(map).forEach(([key, ids]) => {
      const btn = domAPI.getElementById(ids.btn);
      const panel = domAPI.getElementById(ids.panel);
      const active = (key === name);
      btn?.classList.toggle('tab-active', active);
      btn?.setAttribute('aria-selected', String(active));
      btn && (btn.tabIndex = active ? 0 : -1);
      if (panel) {
        panel.classList.toggle('hidden', !active);
        if (active) panel.classList.add('flex');
        else panel.classList.remove('flex');
      }
    });
    storageAPI.setItem('sidebarActiveTab', name);
    dispatch('sidebarTabChanged', { tab: name });

    if (name === 'recent') {
      maybeRenderRecentConversations(chatSearchInputEl?.value?.trim().toLowerCase() || '');
    } else if (name === 'starred') {
      maybeRenderStarredConversations(chatSearchInputEl?.value?.trim().toLowerCase() || '');
    } else if (name === 'projects') {
      await ensureProjectDashboard();
      _handleProjectSearch();
    }
  }

  // ───────────────────────────────────────────────
  // Show/Close Sidebar
  // ───────────────────────────────────────────────
  function toggleSidebar(force) {
    const willShow = (typeof force === 'boolean') ? force : !visible;
    willShow ? showSidebar() : closeSidebar();
  }

  function showSidebar() {
    if (visible) return;
    setVisibleFlag(true);
    el.classList.add('open');
    el.classList.remove('-translate-x-full');
    el.inert = false;
    btnToggle?.setAttribute('aria-expanded', 'true');
    createBackdrop();
    domAPI.getDocument()?.body?.classList.add('with-sidebar-open');
    sidebarMobileDock?.updateDockVisibility(true);

    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard();
      domAPI.getElementById('sidebarProjectSearch')?.focus();
    }
    dispatch('sidebarVisibilityChanged', { visible });
  }

  function closeSidebar() {
    if (!visible || pinned) return;
    setVisibleFlag(false);
    el.classList.remove('open');
    el.classList.add('-translate-x-full');
    el.inert = true;
    btnToggle?.setAttribute('aria-expanded', 'false');
    domAPI.getDocument()?.body?.classList.remove('with-sidebar-open');
    removeBackdrop();
    sidebarMobileDock?.updateDockVisibility(false);
    toggleSettingsPanel(false);
    dispatch('sidebarVisibilityChanged', { visible });
  }

  function createBackdrop() {
    if (!domReadinessService?.documentReady) return;
    if (backdrop) removeBackdrop();
    if (viewportAPI.getInnerWidth() >= 1024) return;

    backdrop = domAPI.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '40',
      backgroundColor: 'rgba(0,0,0,0.5)',
      cursor: 'pointer'
    });
    backdropClickRemover = eventHandlers.trackListener(
      backdrop,
      'click',
      safeHandler(closeSidebar, '[Sidebar] backdrop-click'),
      { context: MODULE }
    );
    domAPI.getDocument()?.body?.appendChild(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) {
      if (backdropClickRemover) {
        backdropClickRemover();
        backdropClickRemover = null;
      } else {
        eventHandlers.cleanupListeners({ target: backdrop });
      }
      backdrop.remove();
      backdrop = null;
    }
  }

  function handleResize() {
    if (viewportAPI.getInnerWidth() >= 1024) {
      removeBackdrop();
    }
    sidebarMobileDock?.updateDockVisibility(visible);
  }

  // ───────────────────────────────────────────────
  // Debounced search handling
  // ───────────────────────────────────────────────
  const _debouncedChatSearch = globalDebounce(_handleChatSearch, 200);
  const _debouncedProjectSearch = globalDebounce(_handleProjectSearch, 200);

  function _handleChatSearch() {
    if (!chatSearchInputEl || !uiRenderer) return;
    try {
      const st = chatSearchInputEl.value.trim().toLowerCase();
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      const pid = projectManager?.getCurrentProject?.()?.id;

      if (activeTab === 'recent') {
        uiRenderer.renderConversations(pid, st, isConversationStarred, toggleStarConversation);
        accessibilityUtils.announce?.(`Recent conversations filtered: "${st || 'all'}"`);
      } else if (activeTab === 'starred') {
        uiRenderer.renderStarredConversations(pid, st, isConversationStarred, toggleStarConversation);
        accessibilityUtils.announce?.(`Starred conversations filtered: "${st || 'all'}"`);
      }
    } catch (err) {
      logger.error('[Sidebar] ChatSearch failed', err, { context: MODULE });
    }
  }

  function _handleProjectSearch() {
    if (!sidebarProjectSearchInputEl || !projectManager || !uiRenderer) return;
    try {
      const searchTerm = sidebarProjectSearchInputEl.value.trim().toLowerCase();
      const allProjects = projectManager.projects || [];
      const filtered = !searchTerm
        ? allProjects
        : allProjects.filter(p => p.name?.toLowerCase().includes(searchTerm));
      uiRenderer.renderProjects(filtered);
      accessibilityUtils.announce?.(
        `Projects filtered for "${searchTerm || 'all'}". Found ${filtered.length}.`
      );
    } catch (error) {
      logger.error('[Sidebar] ProjectSearch failed', error, { context: MODULE });
    }
  }

  // ───────────────────────────────────────────────
  // Main event binding
  // ───────────────────────────────────────────────
  function bindDomEvents() {
    // Cross-tab “starred” sync
    eventHandlers.trackListener(
      domAPI.getWindow(),
      'storage',
      safeHandler(async (e) => {
        if (e.key === starredStorageKey) {
          starred = await readStarred();
          if ((storageAPI.getItem('sidebarActiveTab') || 'recent') === 'starred') {
            maybeRenderStarredConversations();
          }
        }
      }, '[Sidebar] storage sync'),
      { context: MODULE }
    );

    // Window resize
    eventHandlers.trackListener(
      domAPI.getWindow(),
      'resize',
      safeHandler(handleResize, '[Sidebar] resize'),
      { context: MODULE }
    );

    // Chat search
    chatSearchInputEl && eventHandlers.trackListener(
      chatSearchInputEl,
      'input',
      safeHandler(_debouncedChatSearch, '[Sidebar] chatSearchInput'),
      { context: MODULE }
    );

    // Project search
    sidebarProjectSearchInputEl && eventHandlers.trackListener(
      sidebarProjectSearchInputEl,
      'input',
      safeHandler(_debouncedProjectSearch, '[Sidebar] projectSearchInput'),
      { context: MODULE }
    );

    // Watch new conversation
    eventHandlers.trackListener(
      domAPI.getDocument(),
      'chat:conversationCreated',
      safeHandler(() => {
        if ((storageAPI.getItem('sidebarActiveTab') || 'recent') === 'recent') {
          _handleChatSearch();
        }
      }, '[Sidebar] conversationCreated'),
      { context: MODULE }
    );

    // Project change (recent or starred re-render)
    eventHandlers.trackListener(
      domAPI.getDocument(),
      'projectChanged',
      safeHandler(() => {
        const tab = storageAPI.getItem('sidebarActiveTab') || 'recent';
        if (tab === 'recent') {
          maybeRenderRecentConversations();
        } else if (tab === 'starred') {
          maybeRenderStarredConversations();
        }
      }, '[Sidebar] projectChanged'),
      { context: MODULE }
    );
  }

  // Extra listeners for pinned and tab switching
  function bindTabButtonsAndPin() {
    // Pin
    btnPin && eventHandlers.trackListener(
      btnPin,
      'click',
      safeHandler(togglePin, '[Sidebar] togglePin'),
      { context: MODULE }
    );

    // Tabs
    [
      { id: 'recentChatsTab', tab: 'recent' },
      { id: 'starredChatsTab', tab: 'starred' },
      { id: 'projectsTab', tab: 'projects' }
    ].forEach(({ id, tab }) => {
      const elTab = domAPI.getElementById(id);
      if (elTab) {
        eventHandlers.trackListener(
          elTab,
          'click',
          safeHandler(async (e) => {
            e.preventDefault();
            await activateTab(tab);
            accessibilityUtils.announce?.(`Switched to ${tab} tab in sidebar`);
          }, `[Sidebar] activateTab:${tab}`),
          { context: MODULE }
        );
      }
    });

    // Toggle
    if (btnToggle) {
      eventHandlers.trackListener(
        btnToggle,
        'click',
        safeHandler(() => toggleSidebar(), '[Sidebar] toggleSidebar'),
        { context: MODULE }
      );
    }

    // Close
    if (btnClose) {
      eventHandlers.trackListener(
        btnClose,
        'click',
        safeHandler(closeSidebar, '[Sidebar] closeSidebar'),
        { context: MODULE }
      );
    }

    // Settings
    if (btnSettings) {
      eventHandlers.trackListener(
        btnSettings,
        'click',
        safeHandler(() => toggleSettingsPanel(), '[Sidebar] settingsPanel'),
        { context: MODULE }
      );
    }

    // Auto-close on mobile link click if not pinned
    eventHandlers.trackListener(
      el,
      'click',
      safeHandler((ev) => {
        const link = ev.target.closest('a');
        if (link && el.contains(link) && !pinned && viewportAPI.getInnerWidth() < 768) {
          closeSidebar();
        }
      }, '[Sidebar] auto-close'),
      { capture: true, context: MODULE }
    );
  }

  // ───────────────────────────────────────────────
  // Persistent State
  // ───────────────────────────────────────────────
  function restorePersistentState() {
    setPinnedFlag(storageAPI.getItem('sidebarPinned') === 'true');
    const isDesktop = (viewportAPI.getInnerWidth() >= 768);
    if (pinned || isDesktop) {
      el.classList.add('sidebar-pinned');
      el.classList.remove('-translate-x-full');
      el.classList.add('open');
      setVisibleFlag(true);
      el.inert = false;
      btnToggle?.setAttribute('aria-expanded', 'true');
    }
    updatePinButtonVisual();
  }

  // ───────────────────────────────────────────────
  // Initialization
  // ───────────────────────────────────────────────
  async function init() {
    await syncStarredFromStorage().catch(err =>
      logger.error('[Sidebar] Could not load starred from storage', err, { context: MODULE })
    );
    try {
      // Wait for critical DOM
      await domReadinessService.dependenciesAndElements({
        deps: ['eventHandlers', 'appModule'],
        domSelectors: [
          '#mainSidebar',
          '#recentChatsTab', '#starredChatsTab', '#projectsTab',
          '#recentChatsSection', '#starredChatsSection', '#projectsSection'
        ],
        timeout: 15000,
        context: `${MODULE}:init`
      });
      // Optional DOM
      await domReadinessService.dependenciesAndElements({
        domSelectors: [
          '#navToggleBtn',
          '#closeSidebarBtn',
          '#chatSearchInput',
          '#sidebarProjectSearch',
          '#sidebarAuthFormContainer'
        ],
        optional: true,
        timeout: 8000,
        context: `${MODULE}:initOptional`
      });
      findDom();
      // Mobile Dock instance is prepared here; actual init is deferred
      // Create mobile dock with handlers that ensure the sidebar becomes
      // visible before performing the requested action so that, on phone
      // screens, tapping the dock buttons actually navigates somewhere the
      // user can see.
      sidebarMobileDock = createSidebarMobileDock({
        domAPI, eventHandlers, viewportAPI, logger,
        domReadinessService, safeHandler,
        // Show sidebar and then activate desired tab
        onTabActivate: (name) => {
          showSidebar();
          activateTab(name);
        },
        // Show sidebar and open the settings panel containing the
        // quick-config UI for model selection / tokens etc.
        onOpenSettings: () => {
          showSidebar();
          toggleSettingsPanel(true);
        }
      });

      // Auth forms
      // Ensure sidebarAuth always initializes itself for state and event listeners
      sidebarAuth.init();
      sidebarAuth.setupInlineAuthForm();

      // Listen for authentication state changes and update sidebar UI
      // Prefer AuthBus if available, otherwise fall back to document
      const authEventTarget = authBus || domAPI.getDocument();
      eventHandlers.trackListener(
        authEventTarget,
        'authStateChanged',
        safeHandler((event) => {
          logger.info('[Sidebar] authStateChanged event received', event, { context: MODULE });
          sidebarAuth.handleGlobalAuthStateChange(event);
        }, '[Sidebar] authStateChanged'),
        { context: MODULE }
      );

      // Restore pinned state
      restorePersistentState();

      // Ensure the mobile dock visibility matches the initial sidebar state
      if (sidebarMobileDock?.updateDockVisibility) {
        try {
          sidebarMobileDock.updateDockVisibility(visible);
        } catch (dockErr) {
          logger.warn('[Sidebar] Failed to sync mobile dock visibility on init', dockErr, { context: MODULE });
        }
      }

      // Bind events
      bindDomEvents();
      bindTabButtonsAndPin();

      // Activate tab
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);

      return true;
    } catch (err) {
      logger.error('[Sidebar] init failed', err, { context: MODULE });
      throw err;
    }
  }

  // Cleanup
  function destroy() {
    if (DependencySystem?.cleanupModuleListeners) {
      DependencySystem.cleanupModuleListeners(MODULE);
    }
    eventHandlers.cleanupListeners({ context: MODULE });
    removeBackdrop();
    setPinnedFlag(false);
    setVisibleFlag(false);
    sidebarAuth.cleanup();
    sidebarMobileDock?.cleanup();
  }
  function cleanup() {
    eventHandlers.cleanupListeners({ context: 'Sidebar' });
    destroy();
  }

  // Debug
  function debugAuthState() {
    logger.info('[Sidebar] Manual auth state check', { context: MODULE });
    const isAuth = authenticationService?.isAuthenticated?.() ?? false;
    const user = authenticationService?.getCurrentUser?.();
    const modState = {
      isAuthenticated: isAuth,
      currentUser: user
    };
    const debugInfo = {
      fromAppModule: { isAuth, user },
      fromAuthModule: modState
    };
    logger.info('[Sidebar] Auth state debug info', debugInfo, { context: MODULE });
    sidebarAuth.handleGlobalAuthStateChange({
      detail: { authenticated: isAuth, user, source: 'debugAuthState' }
    });
    return debugInfo;
  }

  function forceAuthStateRefresh() {
    return debugAuthState();
  }

  function debugSidebarState() {
    const debugInfo = {
      visible,
      pinned,
      elementExists: !!el,
      pinnedClass: el?.classList?.contains('sidebar-pinned'),
      dockInitialized: !!sidebarMobileDock?.dockElement, // presence ≈ initialised
      context: `${MODULE}:debug`
    };
    logger.info('[Sidebar] Debug sidebar state', debugInfo, { context: MODULE });
    return debugInfo;
  }

  return {
    init,
    destroy,
    cleanup,
    eventService: eventService, // Expose unified eventService instead of SidebarBus
    toggleSidebar,
    closeSidebar,
    showSidebar,
    togglePin,
    activateTab,
    isConversationStarred,
    toggleStarConversation,
    debugAuthState,
    forceAuthStateRefresh,
    debugSidebarState,
    /* new: explicit accessor – orchestrator now owns dock initialisation */
    getMobileDock: () => sidebarMobileDock,
    /* new: explicit accessor – orchestrator now owns auth initialisation */
    getSidebarAuth: () => sidebarAuth
  };
}
