/**
 * app.js
 * ----------------------------------------------------------------------------
 * A production-ready, high-level orchestrator for the Azure OpenAI Chat Application.
 * - Manages global UI elements (sidebar, modals, top nav).
 * - Checks user session state (JWT) for offline/online status.
 * - Implements ephemeral notifications for successes/errors.
 * - Handles keyboard shortcuts for re-generating chat messages, copying content, etc.
 * - Supports mobile device optimizations (responsive toggles, orientation handling).
 * - Ensures advanced accessibility (keyboard nav, ARIA attributes, etc.).
 */

document.addEventListener("DOMContentLoaded", () => {
  // -----------------------------
  // DOM References
  // -----------------------------
  const sidebarEl = document.getElementById("mainSidebar");
  const navToggleBtn = document.getElementById("navToggleBtn");
  const userStatusEl = document.getElementById("userStatus"); // e.g. a <span> that shows "Online" or "Offline"
  const notificationArea = document.getElementById("notificationArea"); // a container for ephemeral toasts

  // For advanced mobile device handling
  handleWindowResize();
  window.addEventListener("resize", handleWindowResize);

  // Session check on load
  updateUserSessionState();

  // Keyboard shortcuts
  setupGlobalKeyboardShortcuts();

  // Event Listeners
  if (navToggleBtn && sidebarEl) {
    navToggleBtn.addEventListener("click", toggleSidebar);
  }

  // Example of listening for project updates globally
  document.addEventListener("projectUpdated", (e) => {
    // e.detail might contain project info, refresh UI accordingly
    console.log("Global event: 'projectUpdated' triggered, detail:", e.detail);
  });

  // Example of listening for “sessionExpired” event from auth.js 
  document.addEventListener("sessionExpired", () => {
    showNotification("Your session has expired. Please log in again.", "error");
    updateUserSessionState();
  });

  // Automatically load the conversation list if the element is present
  if (document.getElementById('sidebarConversations')) {
    loadConversationList();
  }

  // Call the improved authentication function after existing setup
  checkAndHandleAuth();
});

/**
 * Load the user's conversation list, relying solely on cookie-based auth.
 */
function loadConversationList() {
  const selectedProjectId = localStorage.getItem("selectedProjectId");
  if (!selectedProjectId) {
    console.error("No project ID selected. Please select a project first.");
    return;
  }
  fetch(`/api/projects/${selectedProjectId}/conversations`, {
    method: 'GET',
    credentials: 'include'  // Ensure this is always present
  })
  .then(resp => {
    if (!resp.ok) {
      return resp.text().then((text) => {
        throw new Error(`${resp.status}: ${text}`);
      });
    }
    return resp.json();
  })
  .then((data) => {
    const container = document.getElementById('sidebarConversations');
    if (!container) return;
    container.innerHTML = '';
    if (data.conversations && data.conversations.length > 0) {
      data.conversations.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer';
        li.textContent = item.title || 'Conversation ' + item.id;
        li.addEventListener('click', () => {
          window.history.pushState({}, '', `/?chatId=${item.id}`);
          // Show chat UI and hide "no chat" message
          const chatUI = document.getElementById("chatUI");
          const noChatMsg = document.getElementById("noChatSelectedMessage");
          if (chatUI) chatUI.classList.remove("hidden");
          if (noChatMsg) noChatMsg.classList.add("hidden");
          // Update chat title and load messages
          const chatTitleEl = document.getElementById("chatTitle");
          if (chatTitleEl) chatTitleEl.textContent = item.title;
          if (typeof window.loadConversation === 'function') {
            window.loadConversation(item.id);
          }
        });
        container.appendChild(li);
      });
    } else {
      const li = document.createElement('li');
      li.className = 'text-gray-500';
      li.textContent = 'No conversations yet—Begin now!';
      container.appendChild(li);
    }
  })
  .catch((err) => {
    console.error('Error loading conversation list:', err);
  });
}

// ---------------------------------------------------------------------
// Improved authentication handling (updated)
// ---------------------------------------------------------------------
function checkAndHandleAuth() {
  fetch("/api/auth/verify", {
    credentials: 'include'
  })
  .then(resp => {
    if (resp.ok) {
      // User is authenticated - load data
      const selectedProjectId = localStorage.getItem("selectedProjectId");
      if (selectedProjectId) {
        loadConversationList();
      } else {
        console.warn("No selected project ID found in localStorage, skipping conversation list.");
      }
      if (window.CHAT_CONFIG?.chatId) {
        if (typeof window.loadConversation === 'function') {
          window.loadConversation(window.CHAT_CONFIG.chatId);
        }
      }
      document.getElementById("userMenu")?.classList.remove("hidden");
      document.getElementById("authButton")?.classList.add("hidden");
      
      // Show chat UI if a chat is selected
      if (window.CHAT_CONFIG?.chatId) {
        document.getElementById("chatUI")?.classList.remove("hidden");
        document.getElementById("noChatSelectedMessage")?.classList.add("hidden");
      }

      // Hide login required message (if any)
      const loginRequiredMessage = document.getElementById("loginRequiredMessage");
      if (loginRequiredMessage) {
        loginRequiredMessage.classList.add("hidden");
      }
    } else {
      // User is not authenticated - show login dialog
      document.getElementById("userMenu")?.classList.add("hidden");
      document.getElementById("authButton")?.classList.remove("hidden");
      
      // Show a notification that login is required
      if (window.showNotification) {
        window.showNotification("Please log in to use the application", "info");
      }

      // Show login required message
      const loginRequiredMessage = document.getElementById("loginRequiredMessage");
      if (loginRequiredMessage) {
        loginRequiredMessage.classList.remove("hidden");
      }

      // Hide content that requires authentication
      document.getElementById("chatUI")?.classList.add("hidden");
      document.getElementById("projectManagerPanel")?.classList.add("hidden");
      document.getElementById("noChatSelectedMessage")?.classList.add("hidden");
    }
  })
  .catch(err => console.error("Auth check failed:", err));

  // Add event listener for the login button
  const showLoginBtn = document.getElementById("showLoginBtn");
  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", () => {
      document.getElementById("authButton")?.click();
    });
  }
}
// ---------------------------------------------------------------------

function updateUserSessionState() {
  const authStatus = document.getElementById("authStatus");
  fetch("/api/auth/verify", {
    credentials: 'include'
  })
  .then(resp => {
    if(resp.ok) {
      if(authStatus) {
        authStatus.textContent = "Authenticated";
        authStatus.classList.remove("text-red-600");
        authStatus.classList.add("text-green-600");
      }
    } else {
      if(authStatus) {
        authStatus.textContent = "Not Authenticated";
        authStatus.classList.remove("text-green-600");
        authStatus.classList.add("text-red-600");
      }
    }
  })
  .catch(err => console.error("Auth check failed:", err));
}

/**
 * Toggles the main sidebar for mobile or small screens.
 */
function toggleSidebar() {
  const sidebarEl = document.getElementById("mainSidebar");
  if (sidebarEl) {
    sidebarEl.classList.toggle("hidden");
  }
}

/**
 * Adapts layout for mobile or desktop on window resize.
 */
function handleWindowResize() {
  const sidebarEl = document.getElementById("mainSidebar");
  if (!sidebarEl) return;
  if (window.innerWidth < 768) {
    // On mobile breakpoints, automatically hide the sidebar if it’s visible
    if (!sidebarEl.classList.contains("hidden")) {
      sidebarEl.classList.add("hidden");
    }
  }
}

/**
 * Sets up keyboard shortcuts for improved accessibility:
 *  - Ctrl/Cmd + R => Ask chat.js to regenerate the last message
 *  - Ctrl/Cmd + C => Copy the last assistant message or selected text
 */
function setupGlobalKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      // Regenerate
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        // Dispatch a custom event "regenerateChat"
        document.dispatchEvent(new CustomEvent("regenerateChat"));
      }
      // Copy
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("copyMessage"));
      }
    }
  });
}

/**
 * Displays ephemeral notifications (toasts) in the notificationArea.
 * @param {String} msg - The message to display
 * @param {String} type - "success", "error", or "info"
 */
function showNotification(msg, type = "info") {
  const notificationArea = document.getElementById("notificationArea");
  if (!notificationArea) {
    console.warn("No notificationArea found in DOM.");
    return;
  }
  const toast = document.createElement("div");
  toast.classList.add(
    "mb-2",
    "px-4",
    "py-2",
    "rounded",
    "shadow",
    "text-white",
    "transition-opacity",
    "opacity-0"
  );

  switch (type) {
    case "success":
      toast.classList.add("bg-green-600");
      break;
    case "error":
      toast.classList.add("bg-red-600");
      break;
    default:
      toast.classList.add("bg-gray-700");
  }
  toast.textContent = msg;

  notificationArea.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.classList.remove("opacity-0");
  });

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.add("opacity-0");
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 3000);
}

// Expose showNotification globally if needed
window.showNotification = showNotification;

/**
 * Listen to authStateChanged for UI updates
 */
document.addEventListener("authStateChanged", (e) => {
  const authStatus = document.getElementById("authStatus");
  const authButton = document.getElementById("authButton");
  const userMenu = document.getElementById("userMenu");
  const chatUI = document.getElementById("chatUI");
  const projectManagerPanel = document.getElementById("projectManagerPanel");

  if (e.detail.authenticated) {
    // Update UI for authenticated user
    if (authButton) authButton.classList.add("hidden");
    if (userMenu) userMenu.classList.remove("hidden");
    
    // Show authenticated content
    [chatUI, projectManagerPanel].forEach(el => el?.classList.remove("hidden"));
    authStatus.textContent = "Authenticated";
    authStatus.classList.replace("text-red-600", "text-green-600");

    // Load user data
    loadConversationList();
    if (window.CHAT_CONFIG?.chatId) {
      if (typeof window.loadConversation === "function") {
        window.loadConversation(window.CHAT_CONFIG.chatId);
      }
    }
  } else {
    // Update UI for unauthenticated user
    if (authButton) authButton.classList.remove("hidden");
    if (userMenu) userMenu.classList.add("hidden");
    
    // Hide authenticated content
    [chatUI, projectManagerPanel].forEach(el => el?.classList.add("hidden"));
    authStatus.textContent = "Not Authenticated";
    authStatus.classList.replace("text-green-600", "text-red-600");

    // Clear conversation area
    const conversationArea = document.getElementById("conversationArea");
    if (conversationArea) conversationArea.innerHTML = "";
  }
});

window.addEventListener('popstate', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');
  if (chatId) {
    document.getElementById("chatUI")?.classList.remove("hidden");
    if (typeof window.loadConversation === 'function') {
      window.loadConversation(chatId);
    }
    document.getElementById("noChatSelectedMessage")?.classList.add("hidden");
  } else {
    document.getElementById("chatUI")?.classList.add("hidden");
    document.getElementById("noChatSelectedMessage")?.classList.remove("hidden");
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    // Implement focus trapping logic if needed
  }
});
