/**
 * sidebar.js – Unified single-factory replacement
 *      (merging sidebar, sidebar-auth, and sidebar-events)
 *
 * (REFACTORED: All inline auth logic is now delegated to sidebarAuth.js)
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
  app,
  projectDashboard,
  viewportAPI,
  accessibilityUtils,
  sanitizer,
  domReadinessService,
  logger,
  safeHandler,
  APP_CONFIG,
  ..._rest
} = {}) {
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
  if (!viewportAPI) throw new Error('[Sidebar] viewportAPI is required.');
  if (!accessibilityUtils || typeof accessibilityUtils.announce !== 'function') {
    throw new Error('[Sidebar] accessibilityUtils is required for accessibility announcements.');
  }
  if (!logger) throw new Error('[Sidebar] DI logger is required.');
  if (!domReadinessService) throw new Error('[Sidebar] DI domReadinessService is required.');
  if (typeof safeHandler !== 'function') throw new Error('[Sidebar] DI safeHandler (function) is required.');
  if (!APP_CONFIG) throw new Error('[Sidebar] APP_CONFIG is required.');

  const MODULE = 'Sidebar';

  // -----------------------------------------------------------------
  // DOM root element reference – must exist before helpers use it
  // -----------------------------------------------------------------
  let el = null;                 //  ←  NEW (moved up)
  const SidebarBus = new EventTarget();   //  ←  MOVED UP

  /**
   * Global state exposed for E2E and other runtime checks.
   * Tests (e.g. bootstrap-order.e2e.spec.js) assert Sidebar module readiness
   * via `DependencySystem.modules.get('sidebar').state.initialized === true`.
   */
  const state = {
    initialized: false
  };

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
    safeHandler
  });

  let settingsPanelEl = null;
  function _ensureSettingsPanel() {
    if (el === null) {
      // DOM not cached yet – locate it now
      findDom();
    }
    if (!el) {
      throw new Error('[Sidebar] #mainSidebar not found when attaching settings panel');
    }
    settingsPanelEl = sidebarEnhancements.attachSettingsPanel(el);
    return settingsPanelEl;
  }

  function toggleSettingsPanel(force) {
    _ensureSettingsPanel();
    sidebarEnhancements.toggleSettingsPanel(force, maybeRenderModelConfig);
  }

  let btnToggle = null;
  let btnClose = null;
  let btnPin = null;
  let btnSettings = null;
  let chatSearchInputEl = null;
  let sidebarProjectSearchInputEl = null;
  let backdrop = null;

  let sidebarMobileDock = null;
  let visible = false;
  let pinned = false;

const starredJson = storageAPI.getItem('starredConversations');
const starred = new Set(
  typeof starredJson === 'string' ? safeParseJSON(starredJson) : []
);

  function maybeRenderModelConfig() {
    const panel = _ensureSettingsPanel();
    if (panel.dataset.mcBound === '1') return;

    panel.dataset.mcBound = '1';
    try {
      modelConfig && modelConfig.renderQuickConfig(panel);
    } catch (err) {
      logger.error('[Sidebar] renderQuickConfig failed', err, { context: 'Sidebar' });
      domAPI.setTextContent(panel, 'Unable to load model configuration.');
    }
  }

  function findDom() {
    el = domAPI.getElementById('mainSidebar');
    btnToggle = domAPI.getElementById('navToggleBtn');
    btnClose = domAPI.getElementById('closeSidebarBtn');
    btnPin = domAPI.getElementById('pinSidebarBtn');
    btnSettings = domAPI.getElementById('sidebarSettingsBtn');
    chatSearchInputEl = domAPI.getElementById('chatSearchInput');
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
    if (visible) dispatch('sidebarVisibilityChanged', { visible });
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
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'starred') {
      maybeRenderStarredConversations();
    }
    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    return starred.has(id);
  }

  function dispatch(name, detail) {
    if (typeof CustomEvent !== 'undefined' && SidebarBus && typeof SidebarBus.dispatchEvent === 'function') {
      SidebarBus.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  function _handleChatSearch() {
    if (!chatSearchInputEl || !uiRenderer) return;

    try {
      const searchTerm = chatSearchInputEl.value.trim().toLowerCase();   // raw text only

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
    } catch (err) {
      logger.error('[Sidebar][_handleChatSearch] failed', err, { context: 'Sidebar' });
      logger.warn('[Sidebar][ensureProjectDashboard] continuing after error', { context: 'Sidebar' });
    }
  }

  function _handleProjectSearch() {
    if (!sidebarProjectSearchInputEl || !projectManager || !uiRenderer) return;

    try {
      const searchTerm = sidebarProjectSearchInputEl.value.trim().toLowerCase();   // raw text only

      const allProjects = projectManager.projects || [];
      const filteredProjects = searchTerm
        ? allProjects.filter((p) => p.name?.toLowerCase().includes(searchTerm))
        : allProjects;

      uiRenderer.renderProjects(filteredProjects);
      accessibilityUtils.announce?.(
        `Projects filtered for "${searchTerm || 'all'}". Found ${filteredProjects.length} projects.`
      );
    } catch (error) {
      logger.error('[Sidebar][_handleProjectSearch] failed', error, { context: 'Sidebar' });
    }
  }

  function maybeRenderRecentConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || '') {
    const projectId = projectManager.getCurrentProject?.()?.id;
    if (!projectId) {
      logger.debug('[Sidebar][maybeRenderRecentConversations] No current project selected', {
        searchTerm,
        context: 'Sidebar'
      });
      // Clear the list and show a message instead of trying to load without project ID
      const listElement = domAPI.getElementById('recentChatsSection')?.querySelector('ul');
      if (listElement) {
        domAPI.setInnerHTML(listElement, sanitizer.sanitize(''));
        const li = domAPI.createElement('li');
        li.className = 'p-4 text-center text-gray-500';
        domAPI.setTextContent(li, 'Select a project to view conversations');
        listElement.appendChild(li);
      }
      return;
    }
    logger.debug('[Sidebar][maybeRenderRecentConversations] Rendering conversations for project', {
      projectId,
      searchTerm,
      context: 'Sidebar'
    });
    uiRenderer.renderConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  function maybeRenderStarredConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || '') {
    const projectId = projectManager.getCurrentProject?.()?.id;
    if (!projectId) {
      logger.debug('[Sidebar][maybeRenderStarredConversations] No current project selected', {
        searchTerm,
        context: 'Sidebar'
      });
      logger.error('[Sidebar][maybeRenderStarredConversations] failed', new Error('No current project selected'), { context: 'Sidebar' });
      // Clear the list and show a message instead of trying to load without project ID
      const listElement = domAPI.getElementById('starredChatsSection')?.querySelector('ul');
      if (listElement) {
        domAPI.setInnerHTML(listElement, sanitizer.sanitize(''));
        const li = domAPI.createElement('li');
        li.className = 'p-4 text-center text-gray-500';
        domAPI.setTextContent(li, 'Select a project to view starred conversations');
        listElement.appendChild(li);
      }
      return;
    }
    logger.debug('[Sidebar][maybeRenderStarredConversations] Rendering starred conversations for project', {
      projectId,
      searchTerm,
      context: 'Sidebar'
    });
    uiRenderer.renderStarredConversations(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  async function activateTab(name = 'recent') {
    try {
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
        if (btn && panel) {
          const isActive = key === name;
          btn.classList.toggle('tab-active', isActive);
          btn.setAttribute('aria-selected', isActive ? "true" : "false");
          btn.tabIndex = isActive ? 0 : -1;
          panel.classList.toggle('hidden', !isActive);
          if (isActive) panel.classList.add('flex');
          else panel.classList.remove('flex');
        }
      });
      storageAPI.setItem('sidebarActiveTab', name);
      dispatch('sidebarTabChanged', { tab: name });

      if (name === 'recent') {
        maybeRenderRecentConversations();
      } else if (name === 'starred') {
        maybeRenderStarredConversations();
      } else if (name === 'projects') {
        await ensureProjectDashboard();
        _handleProjectSearch();
      }
    } catch (error) {
      logger.error('[Sidebar][activateTab] failed', error, { context: 'Sidebar' });
    }
  }

  async function ensureProjectDashboard() {
    try {
      if (!projectDashboard?.initialize) return;

      const section = domAPI.getElementById('projectsSection');
      if (section && !section.dataset.initialised) {
        section.dataset.initialised = 'true';
      }

      // CRITICAL FIX: Load projects if not already loaded
      if (projectManager?.loadProjects && (!projectManager.projects || projectManager.projects.length === 0)) {
        logger.debug('[Sidebar][ensureProjectDashboard] Loading projects...', { context: 'Sidebar' });
        try {
          await projectManager.loadProjects();
          logger.debug('[Sidebar][ensureProjectDashboard] Projects loaded successfully', {
            count: projectManager.projects?.length || 0,
            context: 'Sidebar'
          });

          // ENHANCED: Auto-select first project if no current project is set
          const currentProject = projectManager.getCurrentProject?.();
          if (!currentProject && projectManager.projects?.length > 0 && app?.setCurrentProject) {
            const firstProject = projectManager.projects[0];
            logger.debug('[Sidebar][ensureProjectDashboard] Auto-selecting first project', {
              projectId: firstProject.id,
              projectName: firstProject.name,
              context: 'Sidebar'
            });
            app.setCurrentProject(firstProject);
          }
        } catch (loadErr) {
          logger.error('[Sidebar][ensureProjectDashboard] Failed to load projects',
                       loadErr,
                       { context: 'Sidebar:ensureProjectDashboard' });
        }
      }

      if (projectManager?.projects?.length && uiRenderer.renderProjects) {
        uiRenderer.renderProjects(projectManager.projects);

        // ── ensure conversation lists show once a project exists ──
        const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
        if (activeTab === 'recent') maybeRenderRecentConversations();
        if (activeTab === 'starred') maybeRenderStarredConversations();
      }
    } catch (err) {
      logger.error('[Sidebar][ensureProjectDashboard] failed',
                   err,
                   { context: 'Sidebar:ensureProjectDashboard' });
    }
  }

  function toggleSidebar(forceVisible) {
    const willShow = forceVisible !== undefined ? !!forceVisible : !visible;
    logger.info('[Sidebar] toggleSidebar called', {
      forceVisible,
      currentVisible: visible,
      willShow,
      context: 'Sidebar'
    });
    willShow ? showSidebar() : closeSidebar();
  }

  function showSidebar() {
    if (visible) {
      logger.info('[Sidebar] showSidebar called but already visible', { context: 'Sidebar' });
      return;
    }
    logger.info('[Sidebar] showSidebar - making sidebar visible', { context: 'Sidebar' });
    visible = true;

    el.classList.add('open');               // rely on CSS .sidebar.open to slide in
    el.classList.remove('-translate-x-full');  // safety: strip the hidden class

    if (sidebarMobileDock && typeof sidebarMobileDock.updateDockVisibility === 'function') {
      sidebarMobileDock.updateDockVisibility(true);
    }

    el.inert = false;
    // aria-hidden removed; inert alone blocks AT and focus
    if (btnToggle) {
      btnToggle.setAttribute('aria-expanded', 'true');
    }
    createBackdrop();
    const _body = domAPI.getDocument()?.body;
    _body?.classList.add('with-sidebar-open');

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
    if (el.contains(activeEl)) {
      // Accessibility fix: Never let a hidden region keep focus inside
      // Step 1: Blur the current element, if possible (most robust guard)
      if (typeof activeEl.blur === 'function') {
        activeEl.blur();
      }
      // Step 2: Move focus to an outside logical element
      if (
        btnToggle &&
        typeof btnToggle.focus === 'function' &&
        btnToggle.offsetParent !== null
      ) {
        btnToggle.focus();
        focusMoved = (domAPI.getActiveElement() === btnToggle);
      }
      // Step 3: Fallback - focus body and forcibly blur again as a last resort
      if (!focusMoved) {
        if (domAPI.body && typeof domAPI.body.focus === 'function') {
          domAPI.body.focus();
        }
      }
      // Step 4: If STILL focused in sidebar, blur again (robust against stubborn fields)
      const newActive = domAPI.getActiveElement();
      if (el.contains(newActive) && typeof newActive.blur === 'function') {
        newActive.blur();
      }
    }

    visible = false;
    el.classList.remove('open');            // CSS fallback slides sidebar out
    el.classList.add('-translate-x-full');  // ensure it is hidden when not “open”

    el.inert = true;
    // aria-hidden removed; inert alone blocks AT and focus
    if (btnToggle) {
      btnToggle.setAttribute('aria-expanded', 'false');
    }
    removeBackdrop();
    const _body = domAPI.getDocument()?.body;
    _body?.classList.remove('with-sidebar-open');
    if (sidebarMobileDock && typeof sidebarMobileDock.updateDockVisibility === 'function') {
      sidebarMobileDock.updateDockVisibility(false);
    }
    toggleSettingsPanel(false);
    dispatch('sidebarVisibilityChanged', { visible });
  }

  function createBackdrop() {
    if (!domReadinessService) return;
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
    const _body = domAPI.getDocument()?.body;
    _body?.appendChild(backdrop);
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
    if (sidebarMobileDock && typeof sidebarMobileDock.updateDockVisibility === 'function') {
      sidebarMobileDock.updateDockVisibility(visible);
    }
  }

  const _debouncedChatSearch = globalDebounce(_handleChatSearch, 200);
  const _debouncedProjectSearch = globalDebounce(_handleProjectSearch, 200);

  function bindDomEvents() {
    eventHandlers.trackListener(domAPI.getWindow(), 'resize', safeHandler(handleResize, 'Sidebar:resize'), {
      context: 'Sidebar',
      description: 'Sidebar resize => remove backdrop on large screens'
    });

    if (chatSearchInputEl) {
      eventHandlers.trackListener(
        chatSearchInputEl, 'input',
        safeHandler(_debouncedChatSearch, 'Sidebar:chatSearchInput'),
        { context: 'Sidebar', description: 'Debounced chat search' }
      );
    }

    if (sidebarProjectSearchInputEl) {
      eventHandlers.trackListener(
        sidebarProjectSearchInputEl, 'input',
        safeHandler(_debouncedProjectSearch, 'Sidebar:projectSearchInput'),
        { context: 'Sidebar', description: 'Debounced project search' }
      );
    }

    eventHandlers.trackListener(
      domAPI.getDocument(), 'chat:conversationCreated',
      safeHandler(() => {
        const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
        if (activeTab === 'recent') _handleChatSearch();
      }, 'Sidebar:chat:conversationCreated'),
      { context: 'Sidebar', description: 'Sidebar conversation created => refresh if on "recent" tab' }
    );

    // ENHANCED: Listen for project changes to refresh conversations
    eventHandlers.trackListener(
      domAPI.getDocument(), 'projectChanged',
      safeHandler(() => {
        const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
        logger.debug('[Sidebar] Project changed, refreshing conversations', { activeTab, context: 'Sidebar' });
        if (activeTab === 'recent') {
          maybeRenderRecentConversations();
        } else if (activeTab === 'starred') {
          maybeRenderStarredConversations();
        }
      }, 'Sidebar:projectChanged'),
      { context: 'Sidebar', description: 'Sidebar project changed => refresh conversations' }
    );

    // also react to the canonical “currentProjectChanged” event (AppBus)
    eventHandlers.trackListener(
      domAPI.getDocument(), 'currentProjectChanged',
      safeHandler(() => {
        const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
        logger.debug('[Sidebar] currentProjectChanged → refresh', { activeTab, context: 'Sidebar' });
        if (activeTab === 'recent') maybeRenderRecentConversations();
        if (activeTab === 'starred') maybeRenderStarredConversations();
      }, 'Sidebar:currentProjectChanged'),
      { context: 'Sidebar', description: 'Refresh conversations on project switch' }
    );

    // ENHANCED: Also listen to AuthBus directly for more reliable auth state updates
    const auth = DependencySystem.modules?.get('auth');
    if (auth?.AuthBus) {
      eventHandlers.trackListener(
        auth.AuthBus,
        'authStateChanged',
        safeHandler(sidebarAuth.handleGlobalAuthStateChange, 'Sidebar:AuthBus:authStateChanged'),
        { context: 'Sidebar', description: 'Sidebar reacts to AuthBus auth state changes' }
      );
      eventHandlers.trackListener(
        auth.AuthBus,
        'authReady',
        safeHandler(sidebarAuth.handleGlobalAuthStateChange, 'Sidebar:AuthBus:authReady'),
        { context: 'Sidebar', description: 'Sidebar reacts to AuthBus auth ready events' }
      );
      logger.debug('[Sidebar] Subscribed to AuthBus events for auth state changes', { context: 'Sidebar' });
    } else {
      logger.warn('[Sidebar] AuthBus not available, relying only on document events', { context: 'Sidebar' });
    }

    if (btnPin) {
      eventHandlers.trackListener(
        btnPin, 'click',
        safeHandler(togglePin, 'Sidebar:btnPin click'),
        { context: 'Sidebar', description: 'Toggle sidebar pin' }
      );
    }

    const tabs = [
      { id: 'recentChatsTab', tab: 'recent', desc: 'Tab: Recent Chats' },
      { id: 'starredChatsTab', tab: 'starred', desc: 'Tab: Starred Chats' },
      { id: 'projectsTab', tab: 'projects', desc: 'Tab: Projects' },
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
                if (logger && logger.error) logger.error(`[Sidebar][TabMenu] Failed to activate '${tab}'`,
                                                          error,
                                                          { context: 'Sidebar:tabmenu' });
              }
            },
            `Sidebar:tabmenu:${id}`
          ),
          { context: 'Sidebar', description: `Sidebar tab button click => activateTab('${tab}')` }
        );
      }
    });

    if (btnToggle) {
      eventHandlers.trackListener(
        btnToggle, 'click',
        safeHandler(() => toggleSidebar(), 'Sidebar:navToggleBtn click'),   // ← use toggle, not always-open
        { context: 'Sidebar', description: 'Sidebar toggle' }
      );
    }
    if (btnClose) {
      eventHandlers.trackListener(
        btnClose, 'click',
        safeHandler(closeSidebar, 'Sidebar:closeSidebarBtn click'),
        { context: 'Sidebar', description: 'Sidebar close' }
      );
    }

    if (btnSettings) {
      eventHandlers.trackListener(
        btnSettings, 'click',
        safeHandler(() => toggleSettingsPanel(), 'Sidebar:settingsBtn click'),
        { context: 'Sidebar', description: 'Toggle sidebar settings panel' }
      );
    }

    function maybeAutoCloseMobile() {
      if (!pinned && viewportAPI.getInnerWidth() < 768) {
        closeSidebar();
      }
    }

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
        capture: true,
        context: 'Sidebar',
        description: 'Auto-close sidebar on mobile after link click'
      }
    );

  }

  function restorePersistentState() {
    pinned = (storageAPI.getItem('sidebarPinned') === 'true');
    const isDesktop = viewportAPI.getInnerWidth() >= 768;

    logger.info('[Sidebar] restorePersistentState', {
      pinned,
      isDesktop,
      viewportWidth: viewportAPI.getInnerWidth(),
      elementExists: !!el,
      context: 'Sidebar'
    });

    if (pinned || isDesktop) {
      el.classList.add('sidebar-pinned');
      el.classList.remove('-translate-x-full');
      el.classList.add('open');
      visible = true;
      el.inert = false;
      // aria-hidden removed; inert alone blocks AT and focus
      if (btnToggle) {
        btnToggle.setAttribute('aria-expanded', 'true');
      }
      logger.info('[Sidebar] Sidebar made visible', { context: 'Sidebar' });
    } else {
      logger.info('[Sidebar] Sidebar kept hidden', { context: 'Sidebar' });
    }
    updatePinButtonVisual();
  }

  async function init() {
    if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: Starting...", { context: 'Sidebar' });

    try {
      await domReadinessService.dependenciesAndElements({
        deps: ['eventHandlers', 'appModule'], // Ensure appModule is ready
        domSelectors: ['#mainSidebar'],
        timeout: 15000, // Increased timeout for critical dependencies
        context: 'Sidebar'
      });

      // Wait for authentication to be ready or fallback quickly if delayed
      try {
        await domReadinessService.waitForEvent('authReady', {
          timeout: 15000,
          context: 'Sidebar.init:waitForAuthReady'
        });
      } catch (timeoutErr) {
        logger.error('[Sidebar] authReady wait timed-out',
                     timeoutErr,
                     { context: 'Sidebar:init:authReadyFallback' });
        logger.warn('[Sidebar] authReady timeout, proceeding with fallback', { context: 'Sidebar:init:authReadyFallback' });
        // Fallback: manually sync with current auth state
        const appModule = DependencySystem.modules.get('appModule');
        if (appModule?.state) {
          sidebarAuth.handleGlobalAuthStateChange({
            detail: {
              authenticated: appModule.state.isAuthenticated,
              user: appModule.state.currentUser,
              source: 'sidebar_init_fallback_sync'
            }
          });
        }
      }

      const appModule = DependencySystem.modules.get('appModule');
      if (!appModule || !appModule.state) {
        throw new Error('[Sidebar] appModule or appModule.state not available after authReady.');
      }

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: findDom", { context: 'Sidebar' });
      findDom();

      // Verify critical elements exist
      if (!el) {
        throw new Error('[Sidebar] Critical element #mainSidebar not found after DOM readiness');
      }

      sidebarMobileDock = createSidebarMobileDock({
        domAPI,
        eventHandlers,
        viewportAPI,
        logger,
        domReadinessService,
        safeHandler,
        onTabActivate: activateTab
      });
      await sidebarMobileDock.init();

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: sidebarAuth.init", { context: 'Sidebar' });
      try {
        sidebarAuth.init(); // sidebarAuth will now use appModule.state
        logger.info("[Sidebar] sidebarAuth.init completed", { context: 'Sidebar' });
      } catch (err) {
        logger.error("[Sidebar] sidebarAuth.init failed", err, { context: 'Sidebar' });
        // Don't throw - continue with sidebar initialization
      }

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: sidebarAuth.setupInlineAuthForm", { context: 'Sidebar' });
      try {
        sidebarAuth.setupInlineAuthForm();
        logger.info("[Sidebar] sidebarAuth.setupInlineAuthForm completed", { context: 'Sidebar' });
      } catch (err) {
        logger.error("[Sidebar] sidebarAuth.setupInlineAuthForm failed", err, { context: 'Sidebar' });
        // Don't throw - continue with sidebar initialization
      }

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: restorePersistentState", { context: 'Sidebar' });
      try {
        restorePersistentState();
        logger.info("[Sidebar] restorePersistentState completed", { context: 'Sidebar' });
      } catch (err) {
        logger.error("[Sidebar] restorePersistentState failed", err, { context: 'Sidebar' });
        // Fallback: Force sidebar visible on desktop
        if (viewportAPI.getInnerWidth() >= 768 && el) {
          logger.warn("[Sidebar] Forcing sidebar visible as fallback", { context: 'Sidebar' });
          el.classList.remove('-translate-x-full');
          el.classList.add('translate-x-0');
          visible = true;
        }
      }

      // Initial auth state sync using the now guaranteed ready appModule.state
      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: initial auth state sync", { context: 'Sidebar' });
      sidebarAuth.handleGlobalAuthStateChange({
        detail: {
          authenticated: appModule.state.isAuthenticated,
          user: appModule.state.currentUser,
          source: 'sidebar_init_sync_after_authReady'
        }
      });

      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: bindDomEvents", { context: 'Sidebar' });
      bindDomEvents();

      if (app && typeof app.getInitialSidebarContext === 'function') {
        const { projectId } = app.getInitialSidebarContext() || {};
        if (projectId && typeof app.setCurrentProject === 'function') {
          app.setCurrentProject({ id: projectId });
        }
      }

      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);

      eventHandlers.trackListener(
        domAPI.getDocument(),
        'app:ready',
        safeHandler(() => {
          logger.debug('[Sidebar] App ready event received, re-syncing auth state if necessary', { context: 'Sidebar:appReadyListener' });
          const currentAppModule = DependencySystem.modules?.get?.('appModule');
          if (currentAppModule?.state) {
            sidebarAuth.handleGlobalAuthStateChange({
              detail: { authenticated: currentAppModule.state.isAuthenticated, user: currentAppModule.state.currentUser, source: 'sidebar_app_ready_sync' }
            });
          }
        }, 'Sidebar:app:ready'),
        { context: 'Sidebar:appReadyListener', description: 'Re-sync auth state after app ready', once: true }
      );

      const doc = domAPI.getDocument();
      if (!doc || typeof doc.dispatchEvent !== 'function') {
        throw new Error('[Sidebar] Document from domAPI must support dispatchEvent');
      }
       // Mark module as fully initialized so E2E tests can verify readiness
       state.initialized = true;
      if (logger && logger.info && (typeof APP_CONFIG === "undefined" || APP_CONFIG.DEBUG)) logger.info("[Sidebar] init: completed successfully", { context: 'Sidebar' });
      return true;
    } catch (err) {
      if (logger && logger.error) {
        logger.error('[Sidebar] init failed',
                     err,
                     { context: 'Sidebar:init' });
      }
      throw err;
    }
  }

  function destroy() {
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === 'function') {
      DependencySystem.cleanupModuleListeners(MODULE);
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
    if (backdrop) {
      eventHandlers?.cleanupListeners?.({ target: backdrop });
      backdrop.remove();
      backdrop = null;
    }
    // DO NOT destroy the shared domReadinessService; just remove Sidebar’s listeners

    pinned = false;
    visible = false;
    sidebarAuth.cleanup();
  }

  function cleanup() {
    destroy();
  }

  function debugAuthState() {
    logger.info('[Sidebar] Manual auth state check triggered', { context: 'Sidebar:debug' });
    const appModule = DependencySystem.modules?.get?.('appModule');
    const isAuthenticated = appModule?.state?.isAuthenticated ?? false;
    const currentUser = appModule?.state?.currentUser ?? null;

    // ENHANCED: Also check auth module state for comparison
    const auth = DependencySystem.modules?.get?.('auth');
    const authModuleState = auth ? {
      isAuthenticated: auth.isAuthenticated?.(),
      currentUser: auth.getCurrentUserObject?.()
    } : null;

    const debugInfo = {
      appModuleAuth: isAuthenticated,
      authModuleAuth: authModuleState?.isAuthenticated,
      finalAuth: isAuthenticated,
      currentUser: currentUser ? { id: currentUser.id, username: currentUser.username } : null,
      authModuleUser: authModuleState?.currentUser ? { id: authModuleState.currentUser.id, username: authModuleState.currentUser.username } : null,
      formContainerExists: !!domAPI.getElementById('sidebarAuthFormContainer'),
      formContainerHidden: domAPI.hasClass(domAPI.getElementById('sidebarAuthFormContainer'), 'hidden'),
      context: 'Sidebar:debug'
    };
    logger.info('[Sidebar] Current auth state debug info', debugInfo);

    // Force auth state sync
    sidebarAuth.handleGlobalAuthStateChange({
      detail: {
        authenticated: isAuthenticated,
        user: currentUser,
        source: 'manual_debug_refresh'
      }
    });
    return { isAuthenticated, currentUser, debugInfo };
  }

  function forceAuthStateRefresh() {
    logger.info('[Sidebar] Force auth state refresh triggered', { context: 'Sidebar:forceRefresh' });
    return debugAuthState();
  }

  return {
    init,
    destroy,
    cleanup,
    eventBus: SidebarBus,

    // Expose state for external observers/tests
    state,
    toggleSidebar,
    closeSidebar,
    showSidebar,
    togglePin,
    activateTab,
    isConversationStarred,
    toggleStarConversation,
    debugAuthState,
    forceAuthStateRefresh
  };
}
