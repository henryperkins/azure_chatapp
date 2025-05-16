/**
 * sidebar-events.js – Event binding and listener tracking for sidebar.
 * Exports a factory: createSidebarEvents({ eventHandlers, DependencySystem, domAPI, uiRenderer, MODULE, ... }).
 * All dependencies strictly injected. No top-level logic.
 */

export function createSidebarEvents({
  eventHandlers,
  DependencySystem,
  domAPI,
  uiRenderer,
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
  // Flag interno de singleton
  let _bound = false;

  function bindDomEvents() {
    // Si ya se enlazó, salir inmediatamente
    if (_bound) return;
    _bound = true;

    const track = (element, evtType, originalHandlerCallback, description) => {
      if (!element) return;
      eventHandlers.trackListener(element, evtType, originalHandlerCallback, {
        description,
        context: MODULE
      });
    };

    // DOM lookups assumed passed in as arguments (no repeated lookups)
    const btnToggle = domAPI.getElementById("navToggleBtn");
    const btnClose = domAPI.getElementById("closeSidebarBtn");
    const btnPin = domAPI.getElementById("pinSidebarBtn");
    const viewportAPI = DependencySystem?.modules?.get("viewportAPI");

    track(btnToggle, "click", () => showSidebar(), "Sidebar toggle");
    track(btnClose, "click", () => closeSidebar(), "Sidebar close");
    track(btnPin, "click", () => togglePin(), "Sidebar pin");

    if (viewportAPI && viewportAPI.onResize) {
      track(viewportAPI, "resize", handleResize, "Sidebar resize");
    }

    [
      { name: "recent", id: "recentChatsTab" },
      { name: "starred", id: "starredChatsTab" },
      { name: "projects", id: "projectsTab" }
    ].forEach(({ name, id }) => {
      const btn = domAPI.getElementById(id);
      track(btn, "click", () => activateTab(name), `Sidebar tab ${name}`);
    });

    track(chatSearchInputEl, "input", _handleChatSearch, "Chat search filter input");
    track(sidebarProjectSearchInputEl, "input", _handleProjectSearch, "Project search filter input");

    const authModule = DependencySystem.modules.get("auth");
    const eventTargetForAuth = authModule?.AuthBus || domAPI.getDocument();

    // Consumer must supply appropriate auth state handler
    if (typeof arguments.handleGlobalAuthStateChangeForSidebar === "function") {
      track(
        eventTargetForAuth,
        "authStateChanged",
        arguments.handleGlobalAuthStateChangeForSidebar,
        "Sidebar AuthStateChange Global Listener"
      );
      if (authModule?.AuthBus) {
        track(
          authModule.AuthBus,
          "authReady",
          arguments.handleGlobalAuthStateChangeForSidebar,
          "Sidebar AuthReady Global Listener"
        );
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

    // Listen for new conversations being created
    const chatCreatedHandler = (e) => {
      const activeTab = storageAPI.getItem("sidebarActiveTab") || "recent";
      if (activeTab === "recent") {
        _handleChatSearch();
      }
    };
    eventHandlers.trackListener(
      domAPI.getDocument(),
      "chat:conversationCreated",
      chatCreatedHandler,
      { description: "Sidebar chat:conversationCreated listener", context: MODULE }
    );
  }

  // No top-level execution
  return { bindDomEvents };
}
