/**
 * sidebar-events.js – Event binding and listener tracking for sidebar.
 * Exports a factory: createSidebarEvents({ eventHandlers, DependencySystem, domAPI, uiRenderer, notify, MODULE, ... }).
 * All dependencies strictly injected. No top-level logic.
 * All notifications use proper context/module tags.
 */

import { safeInvoker } from "./utils/notifications-helpers.js";

export function createSidebarEvents({
  eventHandlers,
  DependencySystem,
  domAPI,
  uiRenderer,
  notify,
  MODULE = "Sidebar",
  chatSearchInputEl,
  sidebarProjectSearchInputEl,
  _handleChatSearch,
  _handleProjectSearch,
  activateTab,
  handleResize,
  isConversationStarred,
  toggleStarConversation,
  storageAPI,
  accessibilityUtils,
  showSidebar,
  closeSidebar,
  ensureProjectDashboard,
  togglePin
}) {
  function bindDomEvents() {
    const track = (element, evtType, originalHandlerCallback, description, sourceOverride) => {
      if (!element) return;
      const contextualHandler = safeInvoker(
        originalHandlerCallback,
        { notify },
        { context: "sidebar", module: MODULE, source: sourceOverride || description }
      );
      eventHandlers.trackListener(element, evtType, contextualHandler, { description, context: MODULE });
    };

    // DOM lookups assumed passed in as arguments (no repeated lookups)
    const btnToggle = domAPI.getElementById("navToggleBtn");
    const btnClose = domAPI.getElementById("closeSidebarBtn");
    const btnPin = domAPI.getElementById("pinSidebarBtn");
    const viewportAPI = DependencySystem?.modules?.get("viewportAPI");

    track(btnToggle, "click", () => showSidebar(), "Sidebar toggle", "toggleSidebar");
    track(btnClose, "click", () => closeSidebar(), "Sidebar close", "closeSidebar");
    track(btnPin, "click", () => togglePin(), "Sidebar pin", "togglePin");

    if (viewportAPI && viewportAPI.onResize) {
      track(viewportAPI, "resize", handleResize, "Sidebar resize", "handleResize");
    }

    [
      { name: "recent", id: "recentChatsTab" },
      { name: "starred", id: "starredChatsTab" },
      { name: "projects", id: "projectsTab" }
    ].forEach(({ name, id }) => {
      const btn = domAPI.getElementById(id);
      track(btn, "click", () => activateTab(name), `Sidebar tab ${name}`, "activateTab");
    });

    track(chatSearchInputEl, "input", _handleChatSearch, "Chat search filter input", "handleChatSearch");
    track(sidebarProjectSearchInputEl, "input", _handleProjectSearch, "Project search filter input", "handleProjectSearch");

    const authModule = DependencySystem.modules.get("auth");
    const eventTargetForAuth = authModule?.AuthBus || domAPI.getDocument();

    // Consumer must supply appropriate auth state handler
    if (typeof arguments.handleGlobalAuthStateChangeForSidebar === "function") {
      track(eventTargetForAuth, "authStateChanged", arguments.handleGlobalAuthStateChangeForSidebar, "Sidebar AuthStateChange Global Listener", "handleGlobalAuthStateChangeForSidebar");
      if (authModule?.AuthBus) {
        track(authModule.AuthBus, "authReady", arguments.handleGlobalAuthStateChangeForSidebar, "Sidebar AuthReady Global Listener", "handleGlobalAuthStateChangeForSidebar");
      }
    }

    // Refresh sidebar when projects arrive
    eventHandlers.trackListener(
      domAPI.getDocument(),
      "projectsLoaded",
      (e) => {
        const list = e.detail?.projects ?? [];
        if (uiRenderer?.renderProjects) uiRenderer.renderProjects(list);
      },
      { description: "Sidebar projectsLoaded refresh", context: MODULE }
    );

    // Error handling on sidebar root DOM
    const el = domAPI.getElementById("mainSidebar");
    if (el) {
      const errorHandler = safeInvoker(
        (e) => {
          notify.error(
            "[sidebar] Widget error: " +
              (e && e.detail && e.detail.message ? e.detail.message : String(e)),
            {
              group: true,
              context: "sidebar",
              module: MODULE,
              source: "childWidgetError",
              originalError: e?.detail?.error || e?.error || e
            }
          );
        },
        { notify },
        { context: "sidebar", module: MODULE, source: "childWidgetError" }
      );
      eventHandlers.trackListener(el, "error", errorHandler, { description: "Sidebar child widget error", context: MODULE });
    }

    // Listen for new conversations being created
    const chatCreatedHandler = (e) => {
      notify.info("[sidebar] chat:conversationCreated event received", { detail: e.detail, module: MODULE, source: "bindDomEvents.chatCreatedHandler" });
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      if (activeTab === 'recent') {
        _handleChatSearch();
      }
      // ... (any other logic for this event)
    };
    eventHandlers.trackListener(
      domAPI.getDocument(),
      "chat:conversationCreated",
      safeInvoker(
        chatCreatedHandler,
        { notify },
        { context: MODULE, source: "onChatConversationCreatedInvoker" }
      ),
      { description: "Sidebar chat:conversationCreated listener", context: MODULE }
    );
  }

  // No top-level execution
  return { bindDomEvents };
}
