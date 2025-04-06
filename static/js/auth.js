// Development mode flag
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// -------------------------
// Token Management
// -------------------------
// Debug flag - set to true to enable verbose auth logging
const AUTH_DEBUG = window.location.hostname === 'localhost' ||
                   window.location.hostname === '127.0.0.1';

const TokenManager = {
  accessToken: null,
  refreshToken: null,
  isInitialized: false,
  tokenExpiry: null,
  version: '1',

  setTokens(access, refresh) {
    if (!access) {
      console.warn('Attempted to set null/undefined access token');
      return;
    }
    if (AUTH_DEBUG) {
      console.debug('[Auth] Setting tokens:', {
        accessToken: access ? '***' + access.slice(-6) : null,
        refreshToken: refresh ? '***' + refresh.slice(-6) : null,
        expiry: new Date(Date.now() + (30 * 60 * 1000)).toISOString()
      });
    }
    this.accessToken = access;
    this.refreshToken = refresh;
    this.tokenExpiry = Date.now() + (30 * 60 * 1000); // Default 30 minute expiry

    // Notify WebSocket connections of token refresh
    if (typeof this.onTokenRefresh === 'function') {
      this.onTokenRefresh(access);
    }

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

    this.isInitialized = true;
  },

  clearTokens() {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Clearing tokens');
    }
    this.accessToken = null;
    this.refreshToken = null;
    sessionStorage.removeItem('auth_state');
    sessionStorage.removeItem('tokenVersion');
    // Clear cookies
    document.cookie = "access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  },

  getAuthHeader() {
    // First try to get token from cookie
    const cookieToken = document.cookie
      .split('; ')
      .find(row => row.startsWith('access_token='))
      ?.split('=')[1];
    
    // Then check session storage
    const storageToken = this.accessToken ||
      (JSON.parse(sessionStorage.getItem('auth_state'))?.accessToken);
    
    if (AUTH_DEBUG) {
      console.debug('[Auth] Token sources:', {
        cookieToken: cookieToken ? '***' + cookieToken.slice(-6) : null,
        storageToken: storageToken ? '***' + storageToken.slice(-6) : null,
        version: this.version
      });
    }
    
    // Validate versions match if available
    if (cookieToken && storageToken && this.version) {
      const storedVersion = sessionStorage.getItem('tokenVersion');
      if (storedVersion && storedVersion !== this.version) {
        console.warn('Token version mismatch - refreshing');
        this.refreshTokens().catch(err => {
          console.error('Token refresh failed:', err);
        });
      }
    }
    
    // Prefer cookie token but fallback to storage
    const accessToken = cookieToken || storageToken;
    return accessToken ? { "Authorization": `Bearer ${accessToken}` } : {};
  },

  isExpired() {
    if (!this.accessToken) return true;
    if (!this.tokenExpiry) return false;
    return Date.now() >= this.tokenExpiry;
  },

  /**
   * The sole place for token refresh logic.
   * Uses concurrency guard in sessionStorage to prevent parallel refresh calls.
   */
  async refreshTokens() {
    try {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Starting token refresh');
      }
      
      // First check if we have a refresh token available
      const refreshToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('refresh_token='))
        ?.split('=')[1] || this.refreshToken;

      if (!refreshToken) {
        if (AUTH_DEBUG) {
          console.debug('[Auth] Refresh token missing');
        }
        console.error('Refresh token missing - cannot refresh');
        this.clearTokens();
        window.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: { authenticated: false }
        }));
        throw new Error('Session expired. Please login again.');
      }

      if (AUTH_DEBUG) {
        console.debug('[Auth] Attempting refresh with token:',
          refreshToken ? '***' + refreshToken.slice(-6) : null);
      }

      const response = await window.apiRequest('/api/auth/refresh', 'POST', null, {
        skipAuthCheck: true,
        skipRetry: true
      });
      
      if (response?.access_token) {
        if (AUTH_DEBUG) {
          console.debug('[Auth] Token refresh successful');
        }
        // Update tokens directly without page reload
        this.setTokens(response.access_token, response.refresh_token);
        
        // Update cookies to match new tokens
        document.cookie = `access_token=${response.access_token}; path=/; ${
          window.location.protocol === 'https:' ? 'Secure; SameSite=None' : 'SameSite=Lax'
        }`;
        
        if (response.refresh_token) {
          document.cookie = `refresh_token=${response.refresh_token}; path=/; ${
            window.location.protocol === 'https:' ? 'Secure; SameSite=None' : 'SameSite=Lax'
          }`;
        }
        
        return true;
      }
    } catch (error) {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Token refresh failed:', {
          status: error.status,
          message: error.message
        });
      }
      console.error('Token refresh failed:', error);
      if (error.status === 401) {
        // Full re-authentication required
        this.clearTokens();
        window.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: { authenticated: false }
        }));
        throw new Error('Session expired. Please login again.');
      }
      throw error;
    }
    return false;
  }
};

// Make TokenManager directly available
window.TokenManager = TokenManager;

// ---------------------------------------------------------------------
// Export auth to window for external usage
// ---------------------------------------------------------------------
window.auth = {
  init: async function () {
  // Prevent double initialization
  if (this.isInitialized) {
    if (AUTH_DEBUG) {
      console.debug("[Auth] Already initialized, skipping");
    }
    return true;
  }

  if (window.API_CONFIG) {
    window.API_CONFIG.authCheckInProgress = true;
  }

  try {
    if (AUTH_DEBUG) {
      console.debug("[Auth] Starting initialization");
    }

    // If we have saved tokens in session, rehydrate them
    const authState = JSON.parse(sessionStorage.getItem('auth_state'));
    if (authState?.accessToken) {
      if (AUTH_DEBUG) {
        console.debug("[Auth] Found stored tokens, rehydrating");
      }
      TokenManager.setTokens(authState.accessToken, authState.refreshToken);

      // Get user info if available
      const userInfo = JSON.parse(sessionStorage.getItem('userInfo'));
      const username = userInfo?.username;

      broadcastAuth(true, username);

      // Verify from server but bypass cache during initialization
      await verifyAuthState(true);
    } else {
      // No tokens found, mark logged out
      clearSession();
      broadcastAuth(false);
    }

    setupUIListeners();

    this.isInitialized = true;
    console.log("Auth module initialized successfully");
    return true;
  } catch (error) {
    console.error("Auth initialization failed:", error);
    clearSession();
    broadcastAuth(false);
    return false;
  } finally {
    if (window.API_CONFIG) {
      window.API_CONFIG.authCheckInProgress = false;
    }
  }
},
  verify: verifyAuthState,
  updateStatus: updateAuthStatus,
  login: loginUser,
  logout: logout,
  manager: TokenManager,
  isInitialized: false
};

// -------------------------------------------------------------
// UI & Form Handlers
// -------------------------------------------------------------
function setupUIListeners() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");

  if (authBtn && authDropdown) {
    authBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (authDropdown.classList.contains("hidden")) {
        authDropdown.classList.remove("hidden");
        setTimeout(() => {
          authDropdown.classList.add("animate-slide-in");
        }, 10);
      } else {
        setTimeout(() => {
          authDropdown.classList.add("hidden");
        }, 200);
      }

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
  loginForm?.addEventListener("submit", async function (e) {
    e.preventDefault();
    console.log("Login form submitted via JS handler");

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
    submitBtn.innerHTML = `<svg class="animate-spin h-4 w-4 mx-auto text-white" ...>...</svg>`;

    try {
      await loginUser(username, password);
      // Hide dropdown
      authDropdown?.classList.add("hidden");
      authDropdown?.classList.remove("slide-in");
      notify("Login successful", "success");

      // Example post-login UI refresh
      const projectListView = document.getElementById('projectListView');
      const projectDetailsView = document.getElementById('projectDetailsView');
      if (projectListView) projectListView.classList.remove('hidden');
      if (projectDetailsView) projectDetailsView.classList.add('hidden');

      // Load any initial data
      setTimeout(() => {
        if (typeof window.loadSidebarProjects === 'function') {
          window.loadSidebarProjects().catch(err => console.warn("Failed to load sidebar projects:", err));
        }
        if (typeof window.loadProjectList === 'function') {
          window.loadProjectList().catch(err => console.warn("Failed to load project list:", err));
        }
        const isChatPage = window.location.pathname === '/' || window.location.pathname.includes('chat');
        if (isChatPage && typeof window.createNewChat === 'function' && !window.CHAT_CONFIG?.chatId) {
          window.createNewChat().catch(err => console.warn("Failed to create chat:", err));
        }
      }, 500);
    } catch (error) {
      console.error("Login failed:", error);
      notify(error.message || "Login failed", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  // Register form submission
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    await handleRegister(formData);
  });

  // Logout button
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

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
    if (AUTH_DEBUG) {
      console.debug('[Auth] Starting login for user:', username);
    }
    
    if (!window.apiRequest) {
      throw new Error('Cannot login - apiRequest not available');
    }
    const data = await window.apiRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password
    });
    
    if (AUTH_DEBUG) {
      console.debug('[Auth] Login response:', {
        hasToken: !!data?.access_token,
        username: data?.username || username
      });
    }
    
    if (!data.access_token) {
      throw new Error("Invalid response from server");
    }
    
    // Store tokens in TokenManager AND cookies
    TokenManager.setTokens(data.access_token, data.refresh_token);
    
    // Force cookie refresh by first clearing then setting
    document.cookie = `access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    document.cookie = `access_token=${data.access_token}; path=/; ${
      window.location.protocol === 'https:' ? 'Secure; SameSite=None' : 'SameSite=Lax'
    }`;
    document.cookie = `refresh_token=${data.refresh_token}; path=/; ${
      window.location.protocol === 'https:' ? 'Secure; SameSite=None' : 'SameSite=Lax'
    }`;

    // Store user info
    if (data.username) {
      sessionStorage.setItem('userInfo', JSON.stringify({
        username: data.username,
        roles: data.roles || [],
        lastLogin: Date.now()
      }));
    }

    broadcastAuth(true, data.username || username);
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
    if (AUTH_DEBUG) {
      console.debug('[Auth] Starting logout');
    }
    
    if (TokenManager.accessToken) {
      try {
        // Attempt to inform the server
        if (window.apiRequest) {
          await window.apiRequest('/api/auth/logout', 'POST');
        }
      } catch (apiErr) {
        if (AUTH_DEBUG) {
          console.debug('[Auth] Logout API error:', apiErr.message);
        }
        console.warn("Logout API error:", apiErr);
      }
    }
    
    if (AUTH_DEBUG) {
      console.debug('[Auth] Clearing tokens and session');
    }
    TokenManager.clearTokens();
    sessionStorage.clear();

    // Expire any cookies
    document.cookie = "access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

    broadcastAuth(false);
    if (e) {
      notify("Logged out", "success");
      window.location.href = '/index.html';
    }
  } catch (error) {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Logout failed:', error.message);
    }
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
    return this.result !== null && (Date.now() - this.lastVerified < this.cacheDuration);
  },
  set(result) {
    this.result = result;
    this.lastVerified = Date.now();
  }
};

async function verifyAuthState(bypassCache = false) {
  if (isDevelopment) {
    console.log('[DEV MODE] Skipping auth check');
    return true;
  }

  try {
    // Skip cache check if bypassing (e.g. during initialization)
    if (!bypassCache && authVerificationCache.isValid()) {
      return authVerificationCache.result;
    }

    // First rehydrate from sessionStorage if needed
    const authState = JSON.parse(sessionStorage.getItem('auth_state'));
    if (authState?.accessToken && !TokenManager.accessToken) {
      console.debug('[Auth] Rehydrating tokens from sessionStorage');
      TokenManager.setTokens(authState.accessToken, authState.refreshToken);
    }

    // If we have no tokens, not authenticated
    const hasTokens = TokenManager.accessToken || sessionStorage.getItem('auth_state');
    if (!hasTokens) {
      authVerificationCache.set(false);
      return false;
    }

    // Handle expired tokens
    if (TokenManager.isExpired()) {
      console.log('verifyAuthState: Token expired -> refreshing');
      try {
        await TokenManager.refreshTokens();
      } catch (refreshError) {
        console.warn('Token refresh failed:', refreshError);
        TokenManager.clearTokens();
        authVerificationCache.set(false);
        broadcastAuth(false);
        throw new Error('Session expired. Please login again.');
      }
    }

    // Check with server
    if (!window.apiRequest) {
      return !!TokenManager.accessToken;
    }

    try {
      const response = await window.apiRequest('/api/auth/verify');
      // If server says we're authenticated
      authVerificationCache.set(response.authenticated);
      return response.authenticated;
    } catch (verifyError) {
      if (verifyError.status === 401) {
        console.warn('Auth verification failed - token invalid');
        TokenManager.clearTokens();
        authVerificationCache.set(false);
        broadcastAuth(false);
        throw new Error('Session expired. Please login again.');
      }
      throw verifyError;
    }
  } catch (error) {
    console.warn('Auth verification error:', error);
    // For network errors, fallback to local token presence
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
    if (!window.apiRequest) return false;

    const data = await window.apiRequest('/api/auth/verify');
    if (data.access_token) {
      TokenManager.setTokens(data.access_token, data.refresh_token);
    }
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

function notify(message, type = "info") {
  if (window.Notifications) {
    switch (type) {
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

function waitForApiRequest() {
  return new Promise((resolve) => {
    if (window.apiRequest) {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (window.apiRequest) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    }
  });
}

// Initialize WebSocket token refresh handler
TokenManager.onTokenRefresh = (newToken) => {
  const wsServices = [
    window.chatInterface?.wsService,
    window.projectChatInterface?.wsService
  ].filter(Boolean);

  wsServices.forEach(ws => {
    if (ws?.socket?.readyState === WebSocket.OPEN) {
      ws.socket.send(JSON.stringify({
        type: 'token_refresh',
        token: newToken
      }));
    }
  });
};

/**
 * NOTE: We intentionally do NOT attach a second DOMContentLoaded listener here
 * to avoid double initialization. Let app.js (or your main script) call
 * `window.auth.init()` exactly once, after `apiRequest` is defined.
 */
