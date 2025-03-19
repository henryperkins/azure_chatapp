/**
 * auth.js
 * ------------------------
 * Production-ready user authentication logic for the Azure Chat Application.
 * - Registers new users (stores hashed passwords in DB).
 * - Logs in existing users (retrieves JWT).
 * - Optionally provides logout functionality.
 */

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
  
  /**
   * Sets up automatic token refresh
   * This ensures the user's session doesn't expire while they're active
   */
  function setupTokenRefresh() {
    // Clear any existing refresh interval
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
    }
    
    // Set up a new refresh interval - refresh every 45 minutes
    // (assuming 60 minute token expiry)
    tokenRefreshInterval = setInterval(() => {
      refreshToken();
    }, 45 * 60 * 1000); // 45 minutes
    
    // Also refresh when the user becomes active after being idle
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshToken();
      }
    });
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
        console.warn("Failed to refresh token, may need to re-login");
        // Wait for next auth check to update UI
      }
    } catch (err) {
      console.error("Token refresh error:", err);
    }
  }
  
  /**
   * Check auth status and update UI accordingly
   */
  async function updateAuthStatus() {
    try {
      const resp = await fetch("/api/auth/verify", {
        credentials: "include"  // Include cookies in the request
      });
      
      if (resp.ok) {
        // User is authenticated
        if (authButton && userMenu) {
          authButton.classList.add("hidden");
          userMenu.classList.remove("hidden");
        }
        
        document.dispatchEvent(new CustomEvent("authStateChanged", {
          detail: { authenticated: true }
        }));
        
        // Get user info and update UI
        const userData = await resp.json();
        if (authStatus && userData.username) {
          authStatus.textContent = userData.username;
        }
        
        // Setup token refresh mechanism
        setupTokenRefresh();
      } else if (resp.status === 401) {
        // Try token refresh on 401 - one last attempt to recover the session
        try {
          const refreshResp = await fetch("/api/auth/refresh", {
            method: "POST",
            credentials: "include"
          });
          
          if (refreshResp.ok) {
            // Token refreshed, retry auth verification
            updateAuthStatus();
            return;
          }
        } catch (refreshErr) {
          console.error("Token refresh during auth verification failed:", refreshErr);
        }
        
        // Not authenticated after refresh attempt
        handleUnauthenticated();
      } else {
        // Other error, handle as unauthenticated
        handleUnauthenticated();
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      handleUnauthenticated();
    }
  }
  
  /**
   * Handle unauthenticated state consistently
   */
  function handleUnauthenticated() {
    // Clear any token refresh interval
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
      tokenRefreshInterval = null;
    }
    
    // Update UI for unauthenticated state
    if (authButton && userMenu) {
      authButton.classList.remove("hidden");
      userMenu.classList.add("hidden");
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
