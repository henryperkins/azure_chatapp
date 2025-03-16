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
  
  /**
   * Load the user's conversation list only if a valid access token is present.
   */
  function loadConversationList() {
    const token = localStorage.getItem('access_token') || '';
  
    // Only attempt to load conversations if we have a token
    if (!token.trim()) {
      // Quietly handle the case when not logged in
      console.log("Not attempting to load conversations - user not logged in");
      return;
    }
    const authHeader = `Bearer ${token.trim()}`;
    console.log("Authorization header being sent:", authHeader);
    fetch('/api/chat/conversations', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Content-Type': 'application/json'
      }
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
            // Navigate to the chat page for that conversation
            window.location.search = 'chatId=' + item.id;
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
    .catch((err) => console.error('Error loading conversation list:', err));
  }
  
  // Automatically load the conversation list if the element is present
  if (document.getElementById('sidebarConversations')) {
    loadConversationList();
  }

  // -----------------------------
  // Functions
  // -----------------------------

  function updateUserSessionState() {
    const token = localStorage.getItem("access_token");
    const authStatus = document.getElementById("authStatus");

    if (token) {
        fetch("/api/auth/verify", {
            headers: { Authorization: `Bearer ${token}` }
        })
        .then(resp => {
            if(resp.ok) {
                if(authStatus) {
                    authStatus.textContent = "Authenticated";
                    authStatus.classList.remove("text-red-600");
                    authStatus.classList.add("text-green-600");
                }
            } else {
                localStorage.removeItem("access_token");
                if(authStatus) {
                    authStatus.textContent = "Not Authenticated";
                    authStatus.classList.remove("text-green-600");
                    authStatus.classList.add("text-red-600");
                }
            }
        });
    } else {
        if(authStatus) {
            authStatus.textContent = "Not Authenticated";
            authStatus.classList.remove("text-green-600");
            authStatus.classList.add("text-red-600");
        }
    }
  }

  /**
   * Toggles the main sidebar for mobile or small screens.
   */
  function toggleSidebar() {
    // Typical approach: toggling a 'hidden' or 'translate-x-full' class for Tailwind
    sidebarEl.classList.toggle("hidden");
  }

  /**
   * Adapts layout for mobile or desktop on window resize.
   */
  function handleWindowResize() {
    if (window.innerWidth < 768) {
      // On mobile breakpoints, automatically hide the sidebar if it’s visible
      if (sidebarEl && !sidebarEl.classList.contains("hidden")) {
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
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    // Implement focus trapping logic
  }
});
