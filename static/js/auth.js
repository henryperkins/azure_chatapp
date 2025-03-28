// auth.js - Updated to rely on app.js's apiRequest and a single refresh approach
// Rely on app.js's apiRequest implementation
if (!window.apiRequest) {
  console.error('apiRequest not available - app.js must be loaded first');
  throw new Error('Missing apiRequest implementation');
}

// -------------------------
// Token Management
// -------------------------
const TokenManager = {
  accessToken: null,
  refreshToken: null,

  setTokens(access, refresh) {
    if (!access) {
      console.warn('Attempted to set null/undefined access token');
      return;
    }

    console.log('TokenManager: Setting new access token');
    this.accessToken = access;
    this.refreshToken = refresh;

    // Also store tokens in session for reload persistence
    sessionStorage.setItem('auth_state', JSON.stringify({
      accessToken: access,
      refreshToken: refresh,
      timestamp: Date.now()
    }));

    // Optionally mark global config as authenticated
    if (window.API_CONFIG) {
      window.API_CONFIG.isAuthenticated = true;
    }
  },

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    sessionStorage.removeItem('auth_state');
  },

  getAuthHeader() {
    return this.accessToken
      ? { "Authorization": `Bearer ${this.accessToken}` }
      : {};
  },

  /**
   * The sole place for token refresh logic.
   * Uses concurrency guard via sessionStorage.getItem('refreshing')
   * to prevent parallel refresh calls.
   */
  async refreshTokens() {
    if (sessionStorage.getItem('refreshing')) {
      let attempts = 0;
      while (sessionStorage.getItem('refreshing') && attempts < 10) {
        await new Promise(r => setTimeout(r, 300));
        attempts++;
      }
      if (sessionStorage.getItem('refreshing')) {
        throw new Error('Token refresh timeout');
      }
      return; // Another process completed the refresh
    }

    try {
      sessionStorage.setItem('refreshing', 'true');
      console.log('TokenManager: Attempting token refresh...');
      // Use app.js's single fetch wrapper
      const data = await window.apiRequest('/api/auth/refresh', 'POST');

      if (!data.access_token) {
        throw new Error('No access token in refresh response');
      }
      this.setTokens(data.access_token, data.refresh_token);
      console.log('TokenManager: Token refresh successful');
      return true;
    } catch (error) {
      console.error('TokenManager: Token refresh failed:', error);
      throw error;
    } finally {
      sessionStorage.removeItem('refreshing');
    }
  }
};

// ---------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------
async function initAuth() {
  try {
    console.log("Initializing auth module");

    // If we have saved tokens in session, rehydrate them
    const authState = JSON.parse(sessionStorage.getItem('auth_state'));
    if (authState?.accessToken) {
      TokenManager.accessToken = authState.accessToken;
      TokenManager.refreshToken = authState.refreshToken;
      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = true;
      }

      // Get user info from session if available
      const userInfo = JSON.parse(sessionStorage.getItem('userInfo'));
      const username = userInfo?.username;

      // Always broadcast authenticated state when tokens exist
      broadcastAuth(true, username);

      // Optionally verify from server to ensure they're still valid
      await verifyAuthState();
    } else {
      // No tokens found, mark user as logged out
      clearSession();
      broadcastAuth(false);
    }

    setupUIListeners();
    console.log("Auth module initialized");
    return true;
  } catch (error) {
    console.error("Auth initialization failed:", error);
    clearSession();
    broadcastAuth(false);
    return false;
  }
}

// ---------------------------------------------------------------------
// Export to window for external usage
// ---------------------------------------------------------------------
window.auth = {
  init: initAuth,
  verify: verifyAuthState,
  updateStatus: updateAuthStatus,
  login: loginUser,
  logout: logout,
  manager: TokenManager
};


/**
 * UI Event Listeners: Toggle login/register forms, handle login submission, etc.
 * We do NOT do large-scale UI toggles like "authButton hidden" here.
 * app.js handles that in updateAuthUI().
 */
function setupUIListeners() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");

  if (authBtn && authDropdown) {
    console.log("Setting up auth button click handler");
    console.log("Auth button element:", authBtn);
    console.log("Auth dropdown element:", authDropdown);
    
    authBtn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      console.group("Auth Button Click Debug");
      console.log("1. Auth button clicked");
      console.log("2. Current dropdown classes:", authDropdown.className);
      console.log("3. Dropdown computed display:", window.getComputedStyle(authDropdown).display);
      console.log("4. Dropdown computed visibility:", window.getComputedStyle(authDropdown).visibility);
      
      // Force correct z-index and positioning
      authDropdown.style.zIndex = "1000";
      authDropdown.style.position = "absolute";
      console.log("5. Set z-index and position");
      
      // Clean up animation classes
      authDropdown.classList.remove("animate-slide-in", "slide-in");
      console.log("6. Removed animation classes");
      
      if (authDropdown.classList.contains("hidden")) {
        console.log("7. Dropdown is hidden - showing it");
        authDropdown.classList.remove("hidden");
        console.log("8. Removed hidden class");
        
        setTimeout(() => {
          console.log("9. Adding animate-slide-in class");
          authDropdown.classList.add("animate-slide-in");
          console.log("10. Current classes after add:", authDropdown.className);
          console.log("11. Dropdown computed display:", window.getComputedStyle(authDropdown).display);
        }, 10);
      } else {
        console.log("7. Dropdown is visible - hiding it");
        setTimeout(() => {
          authDropdown.classList.add("hidden");
          console.log("8. Added hidden class");
        }, 200);
      }
      
      console.groupEnd();
      
      // Close any other open dropdowns
      document.querySelectorAll('.dropdown-content').forEach(dropdown => {
        if (dropdown !== authDropdown && !dropdown.classList.contains('hidden')) {
          dropdown.classList.add("hidden");
          dropdown.classList.remove("slide-in");
        }
      });
    });

    // Close dropdown if clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#authContainer") && !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
        authDropdown.classList.remove("slide-in");
      }
    });
  }

  // Switch between login/register forms
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  if (loginTab && registerTab && loginForm && registerForm) {
    loginTab.addEventListener("click", (e) => {
      e.preventDefault();
      switchForm(true);
    });
    registerTab.addEventListener("click", (e) => {
      e.preventDefault();
      switchForm(false);
    });
  }

  // Login form submission
  document.getElementById("loginForm")?.addEventListener("submit", async function(e) {
    e.preventDefault(); // Make sure this is working
    console.log("Login form submitted via JS handler"); // Add logging
    
    const formData = new FormData(e.target);
    const username = formData.get("username");
    const password = formData.get("password");
    if (!username || !password) {
      notify("Please enter both username and password", "error");
      return;
    }

    const submitBtn = this.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="animate-spin h-4 w-4 mx-auto text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962
               7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
        </path>
      </svg>
    `;

    try {
      console.log("Calling loginUser with:", username);
      await loginUser(username, password);
      console.log("Login successful");
      
      // Hide dropdown
      const authDropdown = document.getElementById("authDropdown");
      authDropdown?.classList.add("hidden");
      authDropdown?.classList.remove("slide-in");
      notify("Login successful", "success");
      
      // Instead of reloading page, which causes the blank page issue,
      // directly update the UI and load conversations
      if (typeof window.loadConversationList === 'function') {
        window.loadConversationList().catch(err => console.warn("Failed to load conversations:", err));
      }
      if (typeof window.loadSidebarProjects === 'function') {
        window.loadSidebarProjects().catch(err => console.warn("Failed to load sidebar projects:", err));
      }
      if (typeof window.createNewChat === 'function' && !window.CHAT_CONFIG?.chatId) {
        window.createNewChat().catch(err => console.warn("Failed to create chat:", err));
      }
    } catch (error) {
      console.error("Login failed:", error);
      notify(error.message || "Login failed", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  // Register form submission
  document.getElementById("registerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    await handleRegister(formData);
  });

  // Logout button
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

/**
 * Switch between Login and Register forms (tabs).
 */
function switchForm(isLogin) {
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  if (isLogin) {
    loginTab.classList.add("border-blue-500", "text-blue-600");
    loginTab.classList.remove("text-gray-500");
    registerTab.classList.remove("border-blue-500", "text-blue-600");
    registerTab.classList.add("text-gray-500");
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
  } else {
    loginTab.classList.remove("border-blue-500", "text-blue-600");
    loginTab.classList.add("text-gray-500");
    registerTab.classList.add("border-blue-500", "text-blue-600");
    registerTab.classList.remove("text-gray-500");
    loginForm.classList.add("hidden");
    registerForm.classList.remove("hidden");
  }
}

// ---------------------------------------------------------------------
// Authentication Handlers
// ---------------------------------------------------------------------

async function handleRegister(formData) {
  const username = formData.get("username");
  const password = formData.get("password");

  if (!username || !password) {
    notify("Please fill out all fields", "error");
    return;
  }
  if (password.length < 8) {
    notify("Password must be at least 8 characters", "error");
    return;
  }

  try {
    // Register
    await window.apiRequest('/api/auth/register', 'POST', { 
      username: username.trim(), 
      password 
    });
    // Immediately login
    await loginUser(username, password);
    document.getElementById("registerForm")?.reset();
    notify("Registration successful", "success");
  } catch (error) {
    notify(error.message || "Registration failed", "error");
    throw error;
  }
}

async function loginUser(username, password) {
  try {
    console.log("Making login API request");
    const data = await window.apiRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password
    });
    console.log("Login API response:", data);
    
    if (!data.access_token) {
      throw new Error("Invalid response from server");
    }

    TokenManager.setTokens(data.access_token, data.refresh_token);
    // If server returned user info, store it
    if (data.username) {
      sessionStorage.setItem('userInfo', JSON.stringify({
        username: data.username,
        roles: data.roles || [],
        lastLogin: Date.now()
      }));
    }

    // Let app.js handle UI toggles
    broadcastAuth(true, data.username || username);

    // Set up token refresh interval
    setupTokenRefresh();

    return data;
  } catch (error) {
    console.error("loginUser error details:", error);
    let message = "Login failed";
    if (error.status === 401) {
      message = "Invalid username or password";
    } else if (error.status === 429) {
      message = "Too many attempts. Please try again later.";
    } else if (error.message) {
      message = error.message;
    }
    throw new Error(message);
  }
}

async function logout(e) {
  e?.preventDefault();
  try {
    if (TokenManager.accessToken) {
      try {
        // Attempt to inform the server
        await window.apiRequest('/api/auth/logout', 'POST');
      } catch (apiErr) {
        console.warn("Logout API error:", apiErr);
      }
    }

    TokenManager.clearTokens();
    sessionStorage.clear();

    // Expire any cookies
    document.cookie = "access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

    broadcastAuth(false);

    if (e) {
      notify("Logged out", "success");
      window.location.href = '/';
    }
  } catch (error) {
    console.error("Logout error:", error);
    TokenManager.clearTokens();
    sessionStorage.clear();
    broadcastAuth(false);
    if (e) {
      window.location.href = '/';
    }
  }
}

// ---------------------------------------------------------------------
// Token Refresh Management
// ---------------------------------------------------------------------

let tokenRefreshTimer;

function setupTokenRefresh() {
  clearTokenTimers();
  // Refresh every 15 minutes
  tokenRefreshTimer = setInterval(() => {
    TokenManager.refreshTokens().catch(err => {
      console.error("Periodic token refresh failed:", err);
      // If refresh fails, force logout
      logout();
    });
  }, 15 * 60 * 1000);

  // Also refresh on visibility change if page is visible
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      TokenManager.refreshTokens().catch(err => {
        console.error("Visibility-based token refresh failed:", err);
        logout();
      });
    }
  });
}

function clearTokenTimers() {
  clearInterval(tokenRefreshTimer);
}

// ---------------------------------------------------------------------
// Auth Verification & Status Updates
// ---------------------------------------------------------------------

const authVerificationCache = {
  lastVerified: 0,
  cacheDuration: 5000, // 5 seconds
  result: null,
  isValid() {
    return this.result !== null &&
           Date.now() - this.lastVerified < this.cacheDuration;
  },
  set(result) {
    this.result = result;
    this.lastVerified = Date.now();
  }
};

async function verifyAuthState() {
  try {
    if (authVerificationCache.isValid()) {
      return authVerificationCache.result;
    }

    // If we have no tokens, definitely not authenticated
    const hasTokens = TokenManager.accessToken || sessionStorage.getItem('auth_state');
    if (!hasTokens) {
      authVerificationCache.set(false);
      return false;
    }

    // Check with server
    const response = await window.apiRequest('/api/auth/verify');
    // If server says we're authenticated
    if (response.authenticated && !TokenManager.accessToken) {
      // Possibly call updateAuthStatus to set tokens if they come back
      await updateAuthStatus();
      authVerificationCache.set(true);
      return true;
    }

    authVerificationCache.set(response.authenticated);
    return response.authenticated;
  } catch (error) {
    console.warn('Auth verification error:', error);
    // If it's a network error, we might still have local tokens
    if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
      const result = !!TokenManager.accessToken;
      authVerificationCache.set(result);
      return result;
    }
    authVerificationCache.set(false);
    return false;
  }
}

async function updateAuthStatus() {
  try {
    const data = await window.apiRequest('/api/auth/verify');
    if (data.access_token) {
      TokenManager.setTokens(data.access_token, data.refresh_token);
    }

    // If the server returns user info, store it
    sessionStorage.setItem('userInfo', JSON.stringify({
      username: data.username,
      roles: data.roles || [],
      lastVerified: Date.now()
    }));

    setupTokenRefresh();
    broadcastAuth(true, data.username);
    return true;
  } catch (error) {
    console.error('Auth status check failed:', error);
    TokenManager.clearTokens();
    clearSession();
    broadcastAuth(false);
    return false;
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function broadcastAuth(authenticated, username = null) {
  document.dispatchEvent(new CustomEvent("authStateChanged", {
    detail: { authenticated, username }
  }));
}

function clearSession() {
  sessionStorage.clear();
  clearTokenTimers();
}

// Use standard Notifications from app.js
function notify(message, type = "info") {
  if (window.Notifications) {
    switch(type) {
      case 'error':
        window.Notifications.apiError(message);
        break;
      case 'success':
        window.Notifications.apiSuccess?.(message) ||
          console.log(`[SUCCESS] ${message}`);
        break;
      default:
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

// Ensure initAuth runs on page load
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOMContentLoaded - Running initAuth");
  initAuth().catch(err => console.error("Failed to initialize auth on page load:", err));
});
