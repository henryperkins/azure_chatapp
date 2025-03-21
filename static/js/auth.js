/**
 * auth.js
 * ------------------------
 * Production-ready user authentication logic for the Azure Chat Application.
 * - Registers new users (stores hashed passwords in DB).
 * - Logs in existing users (retrieves JWT).
 * - Optionally provides logout functionality.
 */

// Add this function to check auth status before critical operations
function ensureAuthenticated() {
  return new Promise((resolve) => {
    window.apiRequest('/api/auth/verify')
      .then(() => resolve(true))
      .catch(() => {
        window.showNotification('Please login to continue', 'error');
        window.location.href = '/login';
        resolve(false);
      });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const logoutBtn = document.getElementById("logoutBtn");
  const authStatus = document.getElementById("authStatus");
  const authButton = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");
  const userMenu = document.getElementById("userMenu");
  const authContainer = document.getElementById("authContainer");
  
  // Toggle between login and register forms in dropdown
  if (loginTab && registerTab) {
    loginTab.addEventListener("click", () => {
      loginTab.classList.add("border-b-2", "border-blue-500", "text-blue-600", "dark:text-blue-400");
      registerTab.classList.remove("border-b-2", "border-blue-500", "text-blue-600", "dark:text-blue-400");
      loginForm.classList.remove("hidden");
      registerForm.classList.add("hidden");
    });
    
    registerTab.addEventListener("click", () => {
      registerTab.classList.add("border-b-2", "border-blue-500", "text-blue-600", "dark:text-blue-400");
      loginTab.classList.remove("border-b-2", "border-blue-500", "text-blue-600", "dark:text-blue-400");
      registerForm.classList.remove("hidden");
      loginForm.classList.add("hidden");
    });
  }
  
  // Toggle auth dropdown visibility
  if (authButton && authDropdown) {
    authButton.addEventListener("click", () => {
      authDropdown.classList.toggle("hidden");
    });
    
    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (authContainer && !authContainer.contains(e.target) && !authDropdown.classList.contains("hidden")) {
        authDropdown.classList.add("hidden");
      }
    });
  }

  // Check if already logged in
  updateAuthStatus();

  // -----------------------------
  // Event Listeners
  // -----------------------------
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = e.target.username.value.trim();
      const password = e.target.password.value.trim();
      registerUser(username, password);
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = e.target.username.value.trim();
      const password = e.target.password.value.trim();
      loginUser(username, password);
    });
  }

  // Add logout button listener
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      logout();
    });
  }

  // -----------------------------
  // Functions
  // -----------------------------
  function registerUser(username, password) {
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include"
    })
    .then(checkResponse)
    .then((data) => {
      if (window.showNotification) {
        window.showNotification(data.message || "Registration successful!", "success");
      }
      // Auto-login immediately after registration
      loginUser(username, password);
    })
    .catch((err) => {
      console.error("Registration error:", err);
      if (window.showNotification) {
        window.showNotification(err.message || "Registration failed", "error");
      } else {
        alert("Failed to register: " + (err.message || "Unknown error"));
      }
    });
  }

  function loginUser(username, password) {
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include"  // Include cookies in the request
    })
    .then(checkResponse)
    .then(data => {
      console.log("Login successful:", data);
      
      // Hide the auth dropdown
      if (authDropdown) {
        authDropdown.classList.add("hidden");
      }
      
      // Update user status in the header
      const userStatusEl = document.getElementById("userStatus");
      if (userStatusEl) {
        userStatusEl.textContent = "Online";
      }
      
      // Show success notification
      if (window.showNotification) {
        window.showNotification("Login successful!", "success");
      }
      
      // Explicitly load project list
      if (typeof window.projectManager?.loadProjects === "function") {
        window.projectManager.loadProjects();
      }
      
      // Dispatch authStateChanged event so other components can react
      document.dispatchEvent(
        new CustomEvent("authStateChanged", { detail: { authenticated: true } })
      );
    })
    .catch((err) => {
      console.error("Login error:", err);
      if (window.showNotification) {
        window.showNotification(err.message || "Login failed", "error");
      } else {
        alert("Login failed: " + (err.message || "Unknown error"));
      }
    });
  }

  // Add logout function
  function logout() {
    fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include"
    })
    .then(checkResponse)
    .then(() => {
      // Clear localStorage token
      // Update UI
      document.dispatchEvent(new CustomEvent("authStateChanged", {
        detail: { authenticated: false }
      }));
      
      if (window.showNotification) {
        window.showNotification("Logged out successfully", "success");
      }
    })
    .catch(err => {
      console.error("Logout error:", err);
    });
  }
  // Token refresh mechanism
  let tokenRefreshInterval = null;
  let tokenRefreshTimeout = null;
  
  /**
   * Sets up automatic token refresh
   * This ensures the user's session doesn't expire while they're active
   */
  function setupTokenRefresh() {
    // Clear any existing refresh interval and timeout
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
      tokenRefreshInterval = null;
    }
    
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
      tokenRefreshTimeout = null;
    }
    
    // Set up a new refresh interval - refresh every 25 minutes
    // (assuming 30 minute token expiry - refresh 5 minutes before expiry)
    tokenRefreshInterval = setInterval(() => {
      refreshToken();
    }, 25 * 60 * 1000); // 25 minutes
    
    // Also set up a forced check after 2 minutes to ensure token is valid
    tokenRefreshTimeout = setTimeout(() => {
      checkAuthAndRefresh();
    }, 2 * 60 * 1000); // 2 minutes
    
    // Also refresh when the user becomes active after being idle
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkAuthAndRefresh();
      }
    });
  }
  
  /**
   * Verify authentication and refresh token if needed
   */
  async function checkAuthAndRefresh() {
    try {
      // First check if we're still authenticated before attempting refresh
      const resp = await fetch("/api/auth/verify", {
        credentials: "include"
      });
      
      if (resp.ok) {
        // We're still authenticated, refresh the token to extend session
        refreshToken();
      } else {
        // We're no longer authenticated, trigger auth state change
        console.warn("Session expired, user needs to re-login");
        handleUnauthenticated();
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      handleUnauthenticated();
    }
  }
  
  /**
   * Refreshes the authentication token
   */
  async function refreshToken() {
    try {
      const resp = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include"
      });
      
      if (resp.ok) {
        const data = await resp.json();
        console.log("Token refreshed successfully");
        // No need to manually store token since it's in the HttpOnly cookie
      } else {
        console.warn("Failed to refresh token, user needs to re-login");
        handleUnauthenticated();
      }
    } catch (err) {
      console.error("Token refresh error:", err);
      handleUnauthenticated();
    }
  }
  
  /**
   * Check auth status and update UI accordingly
   */
  async function updateAuthStatus() {
    try {
      const authStatus = getElement(SELECTORS.AUTH_STATUS);
      const resp = await fetch("/api/auth/verify", {
        credentials: "include"  // Include cookies in the request
      });
      
      if (resp.ok) {
        // User is authenticated
        const authButton = getElement(SELECTORS.AUTH_BUTTON);
        const userMenu = getElement(SELECTORS.USER_MENU);
        
        if (authButton) authButton.classList.add("hidden");
        if (userMenu) userMenu.classList.remove("hidden");
        
        if (authStatus) {
          authStatus.textContent = "Authenticated";
          authStatus.classList.remove("text-red-600");
          authStatus.classList.add("text-green-600");
        }
        
        // Get user info and update UI
        const userData = await resp.json();
        if (authStatus && userData.username) {
          authStatus.textContent = userData.username;
        }
        
        document.dispatchEvent(new CustomEvent("authStateChanged", {
          detail: { authenticated: true }
        }));
        
        // Setup token refresh mechanism
        setupTokenRefresh();
        
        return true;
      } else {
        handleUnauthenticated();
        return false;
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      handleUnauthenticated();
      return false;
    }
  }
  
  /**
   * Handle unauthenticated state consistently
   */
  function handleUnauthenticated() {
    // Clear any token refresh interval and timeout
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
      tokenRefreshInterval = null;
    }
    
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
      tokenRefreshTimeout = null;
    }
    
    // Get UI elements using SELECTORS
    const authButton = getElement(SELECTORS.AUTH_BUTTON);
    const userMenu = getElement(SELECTORS.USER_MENU);
    const authStatus = getElement(SELECTORS.AUTH_STATUS);
    
    // Update UI for unauthenticated state
    if (authButton) authButton.classList.remove("hidden");
    if (userMenu) userMenu.classList.add("hidden");
    
    if (authStatus) {
      authStatus.textContent = "Not Authenticated";
      authStatus.classList.remove("text-green-600");
      authStatus.classList.add("text-red-600");
    }
    
    // Show notification
    if (window.showNotification) {
      window.showNotification("Your session has expired. Please log in again.", "error");
    }
    
    // Dispatch event so other components know authentication state changed
    document.dispatchEvent(new CustomEvent("authStateChanged", {
      detail: { authenticated: false }
    }));
  }
  
  function checkResponse(resp) {
    if (!resp.ok) {
      return resp.text().then((text) => {
        try {
          const jsonError = JSON.parse(text);
          throw new Error(jsonError.detail || `Error ${resp.status}`);
        } catch (e) {
          throw new Error(`${resp.status} - ${text}`);
        }
      });
    }
    return resp.json();
  }
});
