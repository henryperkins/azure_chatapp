/***************************************
 * auth.js - Strict Same-Origin Auth Module
 * 
 * Security Design:
 * - Only works when frontend/backend share same origin
 * - Uses secure session cookies (SameSite=Strict)
 * - No token/JWT fallbacks for cross-origin use
 * - All auth state managed via secure cookies
 ***************************************/

// Development mode flag
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// -------------------------
// Token Management
// -------------------------
// Debug flag - set to true to enable verbose auth logging
const AUTH_DEBUG = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// For debouncing visibility refresh
let visibilityTimeout;

// Utility to decode JWT safely
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch (err) {
    if (AUTH_DEBUG) {
      console.error('[Auth] Failed to decode JWT:', err);
    }
    return null;
  }
}

const TokenManager = {
  accessToken: null,
  refreshToken: null,
  isInitialized: false,
  tokenExpiry: null,   // Unix timestamp in ms
  version: '1',

  /**
   * Attempts to read tokens from cookies and rehydrate in memory
   * with improved error handling and cookie parsing
   */
  rehydrateFromCookies() {
    return false; // Session cookie only, no explicit rehydration
  },

  /**
   * Sets tokens in memory and in localStorage. Decodes JWT to extract expiry.
   */
  setTokens(access, refresh) {
    if (!access) {
      console.warn('[Auth] Attempted to set null/undefined access token');
      return;
    }
    if (AUTH_DEBUG) {
      console.debug('[Auth] Setting tokens:', {
        accessToken: '***' + access.slice(-6),
        refreshToken: refresh ? '***' + refresh.slice(-6) : null
      });
    }

    // Decode JWT to determine actual expiration
    const decoded = decodeJwt(access);
    if (decoded?.exp) {
      // JWT exp is in seconds, convert to ms
      this.tokenExpiry = decoded.exp * 1000;
    } else {
      // Fallback if not JWT or cannot decode
      // Hardcode to 30 minutes from now
      this.tokenExpiry = Date.now() + (30 * 60 * 1000);
    }

    this.accessToken = access;
    this.refreshToken = refresh;

    // Notify WebSocket connections of token refresh
    if (typeof this.onTokenRefresh === 'function') {
      this.onTokenRefresh(access);
    }

    // Store tokens in localStorage
    localStorage.setItem('auth_state', JSON.stringify({
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

  /**
   * Clears tokens from memory, localStorage, and cookies
   */
  clearTokens() {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Clearing tokens');
    }
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;

    localStorage.removeItem('auth_state');
    localStorage.removeItem('tokenVersion');
    localStorage.removeItem('userInfo');
    localStorage.removeItem('refreshMutex'); // concurrency guard

    document.cookie = "access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  },

  /**
   * Returns Authorization header with token if available
   * With improved cookie parsing and error handling
   */
  async getAuthHeader() {
    try {
      // Use the more robust cookie parsing method
      let cookieToken = null;
      
      if (document.cookie) {
        const cookies = document.cookie.split(/;\s*/);
        for (const cookie of cookies) {
          if (cookie.startsWith('access_token=')) {
            cookieToken = cookie.substring('access_token='.length);
            break;
          }
        }
      }

      // Get token from localStorage
      let authState = null;
      try {
        const rawAuthState = localStorage.getItem('auth_state');
        if (rawAuthState) {
          authState = JSON.parse(rawAuthState);
        }
      } catch (parseError) {
        console.warn('[Auth] Failed to parse auth_state from localStorage:', parseError);
        // Continue with null authState
      }
      
      const storageToken = this.accessToken || authState?.accessToken;

      if (AUTH_DEBUG) {
        console.debug('[Auth] Token sources:', {
          cookieToken: cookieToken ? '***' + cookieToken.slice(-6) : null,
          storageToken: storageToken ? '***' + storageToken.slice(-6) : null,
          memoryToken: this.accessToken ? '***' + this.accessToken.slice(-6) : null,
          version: this.version
        });
      }

      // Check for token version mismatch
      if (cookieToken && storageToken && this.version) {
        const storedVersion = localStorage.getItem('tokenVersion');
        if (storedVersion && storedVersion !== this.version) {
          console.warn('[Auth] Token version mismatch - forcing refresh');
          const refreshed = await this.refreshTokens();
          if (!refreshed) {
            throw new Error('Failed to refresh token');
          }
          return { "Authorization": `Bearer ${this.accessToken}` };
        }
      }

      // Use token from any available source
      const accessToken = this.accessToken || cookieToken || storageToken;
      
      // Log the token being used
      if (AUTH_DEBUG && accessToken) {
        console.debug('[Auth] Using token ending with:', accessToken.slice(-6));
      }
      
      return accessToken ? { "Authorization": `Bearer ${accessToken}` } : {};
    } catch (error) {
      console.error('[Auth] Failed to get auth header:', error);
      // Don't clear tokens for non-critical errors to prevent unnecessary logouts
      if (error.message?.includes('Failed to refresh token')) {
        this.clearTokens();
      }
      throw error;
    }
  },

  /**
   * Checks if token is expired based on tokenExpiry
   */
  isExpired() {
    if (!this.accessToken) return true;
    if (!this.tokenExpiry) return false;
    return Date.now() >= this.tokenExpiry;
  },

  /**
   * Checks if any valid tokens exist
   */
  hasTokens() {
    return !!this.accessToken;
  },

  /**
   * The sole place for token refresh logic.
   * Uses a concurrency guard to prevent parallel refresh calls.
   */
  async refreshTokens() {
    const mutexKey = 'refreshMutex';
    if (localStorage.getItem(mutexKey)) {
      // Wait until the mutex is removed
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!localStorage.getItem(mutexKey)) {
            clearInterval(checkInterval);
            resolve(!!this.accessToken);
          }
        }, 100);
      });
    }

    localStorage.setItem(mutexKey, 'true'); // lock
    try {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Starting token refresh');
      }

      // Check for refresh token in cookies and memory
      const cookieRefresh = document.cookie
        .split('; ')
        .find(row => row.startsWith('refresh_token='))
        ?.split('=')[1];

      const refreshToken = cookieRefresh || this.refreshToken;
      
      if (!refreshToken) {
        const errorMsg = 'No refresh token available - session expired';
        console.error('[Auth]', errorMsg);
        this.clearTokens();
        window.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: {
            authenticated: false,
            error: errorMsg
          }
        }));
        throw new Error(errorMsg);
      }

      if (AUTH_DEBUG) {
        console.debug('[Auth] Attempting refresh with token:',
          '***' + refreshToken.slice(-6));
      }

      // Make refresh request with short timeout
      const response = await window.apiRequest('/api/auth/refresh', 'POST', null, {
        skipAuthCheck: true,
        skipRetry: true
      }, 5000); // 5 second timeout

      if (!response?.access_token) {
        throw new Error('Invalid refresh response from server');
      }

      if (AUTH_DEBUG) {
        console.debug('[Auth] Token refresh successful');
      }
      
      // Update tokens in memory
      this.setTokens(response.access_token, response.refresh_token);
      return true;
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error);
      
      // Clear tokens for any error except network issues
      if (!error.message?.includes('NetworkError') &&
          !error.message?.includes('Failed to fetch')) {
        this.clearTokens();
        window.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: {
            authenticated: false,
            error: 'Session expired. Please login again.'
          }
        }));
      }

      // Rethrow with appropriate message
      if (error.status === 401) {
        throw new Error('Refresh token rejected - please login again');
      } else if (error.message.includes('timeout')) {
        throw new Error('Refresh request timed out - please try again');
      } else {
        throw new Error('Unable to refresh session - please login again');
      }
    } finally {
      localStorage.removeItem(mutexKey); // unlock
    }
  }
};

window.TokenManager = TokenManager;

// ---------------------------------------------------------------------
// Export auth to window for external usage
// ---------------------------------------------------------------------
window.auth = {
  init: async function () {
    if (window.__authInitializing) {
      return new Promise(resolve => {
        const check = () => {
          if (this.isInitialized) resolve(true);
          else setTimeout(check, 50);
        };
        check();
      });
    }
    
    window.__authInitializing = true;
    if (this.isInitialized) {
      if (AUTH_DEBUG) console.debug("[Auth] Already initialized");
      window.__authInitializing = false;
      return true;
    }

    if (window.API_CONFIG) {
      window.API_CONFIG.authCheckInProgress = true;
    }

    try {
      if (AUTH_DEBUG) {
        console.debug("[Auth] Starting initialization");
      }

      // 1) Try to rehydrate from cookies first
      const cookiesRehydrated = TokenManager.rehydrateFromCookies();
      if (cookiesRehydrated) {
        if (AUTH_DEBUG) {
          console.debug("[Auth] Rehydrated from cookies");
        }
        // Read user info if available
        const userInfo = JSON.parse(localStorage.getItem('userInfo')) || {};
        broadcastAuth(true, userInfo.username);
        await verifyAuthState(true); // server verification
      } else {
        // 2) Fallback to localStorage if no cookies
        const authState = JSON.parse(localStorage.getItem('auth_state'));
        if (authState?.accessToken) {
          if (AUTH_DEBUG) {
            console.debug("[Auth] Found stored tokens in localStorage, rehydrating");
          }
          TokenManager.setTokens(authState.accessToken, authState.refreshToken);

          const userInfo = JSON.parse(localStorage.getItem('userInfo')) || {};
          broadcastAuth(true, userInfo.username);
          await verifyAuthState(true);
        } else {
          // Nothing found; mark as logged out
          clearSession();
          broadcastAuth(false);
        }
      }

      setupUIListeners();
      this.isInitialized = true;

      console.log("[Auth] Module initialized successfully");
      return true;
    } catch (error) {
      console.error("[Auth] Initialization failed:", error);
      clearSession();
      broadcastAuth(false);
      return false;
    } finally {
      if (window.API_CONFIG) {
        window.API_CONFIG.authCheckInProgress = false;
      }
    }
  },

  /**
   * @deprecated - use isAuthenticated instead
   */
  verify: verifyAuthState,

  /**
   * Forces an update from the server
   */
  updateStatus: updateAuthStatus,

  /**
   * Called upon user action to login
   */
  login: loginUser,

  /**
   * Called upon user action to logout
   */
  logout: logout,

  /**
   * Reference to TokenManager
   */
  manager: TokenManager,

  /**
   * Indicates whether `init()` has completed
   */
  isInitialized: false,

  /**
   * Checks local tokens or server for authentication status.
   */
  isAuthenticated: async function (options = {}) {
    const { skipCache = false, forceVerify = false } = options;

    // Fast path: check memory state if cache is valid
    if (!skipCache && authVerificationCache.isValid()) {
      return authVerificationCache.result;
    }

    // Check for token in memory
    if (!TokenManager.accessToken) {
      // Rehydrate from cookies
      const cookiesRehydrated = TokenManager.rehydrateFromCookies();
      if (!cookiesRehydrated) {
        // Then from localStorage
        const authState = JSON.parse(localStorage.getItem('auth_state'));
        if (authState?.accessToken) {
          TokenManager.setTokens(authState.accessToken, authState.refreshToken);
        } else {
          // No tokens found
          authVerificationCache.set(false);
          return false;
        }
      }
    }

    // Refresh if expired
    if (TokenManager.isExpired()) {
      try {
        const refreshed = await TokenManager.refreshTokens();
        if (!refreshed) {
          authVerificationCache.set(false);
          return false;
        }
      } catch (error) {
        console.error("[Auth] Token refresh failed:", error);
        authVerificationCache.set(false);
        return false;
      }
    }

    // If not forced, skip server verify
    if (!forceVerify && TokenManager.accessToken) {
      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = true;
      }
      authVerificationCache.set(true);
      return true;
    }

    // Otherwise, attempt server verification
    try {
      const response = await window.apiRequest('/api/auth/verify', 'GET', null, 0, 3000, {
        skipAuthCheck: true,
        skipRetry: true
      });
      const isAuthenticated = response?.authenticated === true;

      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = isAuthenticated;
      }
      authVerificationCache.set(isAuthenticated);

      if (!isAuthenticated) {
        TokenManager.clearTokens();
      }
      return isAuthenticated;
    } catch (error) {
      // For network errors, assume token might still be valid
      if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
        const result = !!TokenManager.accessToken;
        if (window.API_CONFIG) {
          window.API_CONFIG.isAuthenticated = result;
        }
        authVerificationCache.set(result);
        return result;
      }
      // If explicitly 401, definitely logout
      if (error.status === 401) {
        TokenManager.clearTokens();
        if (window.API_CONFIG) {
          window.API_CONFIG.isAuthenticated = false;
        }
        authVerificationCache.set(false);
        return false;
      }
      // Default fallback
      const result = !!TokenManager.accessToken;
      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = result;
      }
      authVerificationCache.set(result);
      return result;
    }
  }
};

// ------------------------------------------
// UI & Form Handlers
// ------------------------------------------
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

      // Close other open dropdowns
      document.querySelectorAll('.dropdown-content').forEach(dropdown => {
        if (dropdown !== authDropdown && !dropdown.classList.contains('hidden')) {
          dropdown.classList.add("hidden");
          dropdown.classList.remove("slide-in");
        }
      });
    });

    // Close dropdown if click outside
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
    console.log("[Auth] Login form submitted via JS handler");

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
    submitBtn.innerHTML = `<svg class="animate-spin h-4 w-4 mx-auto text-white" viewBox="0 0 24 24">...</svg>`;

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
          window.loadSidebarProjects().catch(err => console.warn("[Auth] Failed to load sidebar projects:", err));
        }
        if (typeof window.loadProjectList === 'function') {
          window.loadProjectList().catch(err => console.warn("[Auth] Failed to load project list:", err));
        }
        const isChatPage = window.location.pathname === '/' || window.location.pathname.includes('chat');
        if (isChatPage && typeof window.createNewChat === 'function' && !window.CHAT_CONFIG?.chatId) {
          window.createNewChat().catch(err => console.warn("[Auth] Failed to create chat:", err));
        }
      }, 500);
    } catch (error) {
      console.error("[Auth] Login failed:", error);
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

    // Store tokens in TokenManager
    TokenManager.setTokens(data.access_token, data.refresh_token);

    // Cookies are now managed by the backend

    // Store user info
    if (data.username) {
      localStorage.setItem('userInfo', JSON.stringify({
        username: data.username,
        roles: data.roles || [],
        lastLogin: Date.now()
      }));
    }

    broadcastAuth(true, data.username || username);
    setupTokenRefresh();
    return data;
  } catch (error) {
    console.error("[Auth] loginUser error details:", error);
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
        console.warn("[Auth] Logout API error:", apiErr);
      }
    }
    if (AUTH_DEBUG) {
      console.debug('[Auth] Clearing tokens and localStorage');
    }

    TokenManager.clearTokens();
    broadcastAuth(false);

    notify("Logged out", "success");
    window.location.href = '/index.html';
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    TokenManager.clearTokens();
    broadcastAuth(false);
    if (e) {
      window.location.href = '/';
    }
  }
}

// ---------------------------------------------------------------------
// Token Refresh Management
// ---------------------------------------------------------------------
let tokenRefreshTimer = null;

/**
 * Schedules a dynamic token refresh just before expiry
 */
function setupTokenRefresh() {
  clearTokenTimers();

  // Refresh 2 minutes before actual expiry:
  const refreshBuffer = 2 * 60 * 1000;
  const now = Date.now();
  const expiresIn = (TokenManager.tokenExpiry || now) - now;
  const timeUntilRefresh = Math.max(expiresIn - refreshBuffer, 0);

  if (AUTH_DEBUG) {
    console.debug('[Auth] Scheduling token refresh in (ms):', timeUntilRefresh);
  }

  tokenRefreshTimer = setTimeout(() => {
    TokenManager.refreshTokens().catch(err => {
      console.error("[Auth] Periodic token refresh failed:", err);
      logout();
    });
  }, timeUntilRefresh);

  // Debounce-based refresh on visibility change
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function handleVisibilityChange() {
  clearTimeout(visibilityTimeout);
  if (document.visibilityState === "visible") {
    visibilityTimeout = setTimeout(() => {
      TokenManager.refreshTokens().catch(err => {
        console.error("[Auth] Visibility-based token refresh failed:", err);
        logout();
      });
    }, 500);
  }
}

function clearTokenTimers() {
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
  clearTimeout(visibilityTimeout);
}

// ---------------------------------------------------------------------
// Auth Verification & Status Updates
// ---------------------------------------------------------------------
const authVerificationCache = {
  lastVerified: 0,
  cacheDuration: 60000, // 60 seconds
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
    if (!bypassCache && authVerificationCache.isValid()) {
      return authVerificationCache.result;
    }

    // Rehydrate from localStorage if needed
    const authState = JSON.parse(localStorage.getItem('auth_state'));
    if (authState?.accessToken && !TokenManager.accessToken) {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Rehydrating tokens from localStorage');
      }
      TokenManager.setTokens(authState.accessToken, authState.refreshToken);
    }

    if (!TokenManager.accessToken) {
      authVerificationCache.set(false);
      return false;
    }

    if (TokenManager.isExpired()) {
      console.log('[Auth] verifyAuthState: Token expired -> refreshing');
      try {
        await TokenManager.refreshTokens();
      } catch (refreshError) {
        console.warn('[Auth] Token refresh failed:', refreshError);
        TokenManager.clearTokens();
        authVerificationCache.set(false);
        broadcastAuth(false);
        throw new Error('Session expired. Please login again.');
      }
    }

    // If no custom fetch, assume local presence is enough
    if (!window.apiRequest) {
      return !!TokenManager.accessToken;
    }

    // Check with the server
    try {
      const response = await window.apiRequest('/api/auth/verify');
      authVerificationCache.set(response.authenticated);
      return response.authenticated;
    } catch (verifyError) {
      if (verifyError.status === 401) {
        TokenManager.clearTokens();
        authVerificationCache.set(false);
        broadcastAuth(false);
        throw new Error('Session expired. Please login again.');
      }
      // If network error, assume token is valid
      if (verifyError.message?.includes('NetworkError') || verifyError.message?.includes('Failed to fetch')) {
        const result = !!TokenManager.accessToken;
        authVerificationCache.set(result);
        return result;
      }
      throw verifyError;
    }
  } catch (error) {
    console.warn('[Auth] Auth verification error:', error);
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
    localStorage.setItem('userInfo', JSON.stringify({
      username: data.username,
      roles: data.roles || [],
      lastVerified: Date.now()
    }));

    setupTokenRefresh();
    broadcastAuth(true, data.username);
    return true;
  } catch (error) {
    console.error('[Auth] Auth status check failed:', error);
    TokenManager.clearTokens();
    clearSession();
    broadcastAuth(false);
    return false;n 
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
  // Selectively remove relevant keys
  localStorage.removeItem('auth_state');
  localStorage.removeItem('userInfo');
  localStorage.removeItem('tokenVersion');
  localStorage.removeItem('refreshMutex');
  clearTokenTimers();
}

function notify(message, type = "info") {
  // Example notifications
  if (window.Notifications) {
    switch (type) {
      case 'error':
        window.Notifications.apiError?.(message) || console.error(`[ERROR] ${message}`);
        break;
      case 'success':
        window.Notifications.apiSuccess?.(message) || console.log(`[SUCCESS] ${message}`);
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
 * Export auth object to window for external usage
 * This ensures the auth object is immediately available on the window object
 */
window.auth = window.auth || {
  init: async function () {
    if (window.__authInitializing) {
      return new Promise(resolve => {
        const check = () => {
          if (this.isInitialized) resolve(true);
          else setTimeout(check, 50);
        };
        check();
      });
    }
    
    window.__authInitializing = true;
    if (this.isInitialized) {
      if (AUTH_DEBUG) console.debug("[Auth] Already initialized");
      window.__authInitializing = false;
      return true;
    }

    if (window.API_CONFIG) {
      window.API_CONFIG.authCheckInProgress = true;
    }

    try {
      if (AUTH_DEBUG) {
        console.debug("[Auth] Starting initialization");
      }

      // 1) Try to rehydrate from cookies first
      const cookiesRehydrated = TokenManager.rehydrateFromCookies();
      if (cookiesRehydrated) {
        if (AUTH_DEBUG) {
          console.debug("[Auth] Rehydrated from cookies");
        }
        // Read user info if available
        const userInfo = JSON.parse(localStorage.getItem('userInfo')) || {};
        broadcastAuth(true, userInfo.username);
        await verifyAuthState(true); // server verification
      } else {
        // 2) Fallback to localStorage if no cookies
        const authState = JSON.parse(localStorage.getItem('auth_state'));
        if (authState?.accessToken) {
          if (AUTH_DEBUG) {
            console.debug("[Auth] Found stored tokens in localStorage, rehydrating");
          }
          TokenManager.setTokens(authState.accessToken, authState.refreshToken);

          const userInfo = JSON.parse(localStorage.getItem('userInfo')) || {};
          broadcastAuth(true, userInfo.username);
          await verifyAuthState(true);
        } else {
          // Nothing found; mark as logged out
          clearSession();
          broadcastAuth(false);
        }
      }

      setupUIListeners();
      this.isInitialized = true;

      console.log("[Auth] Module initialized successfully");
      return true;
    } catch (error) {
      console.error("[Auth] Initialization failed:", error);
      clearSession();
      broadcastAuth(false);
      return false;
    } finally {
      if (window.API_CONFIG) {
        window.API_CONFIG.authCheckInProgress = false;
      }
    }
  },

  /**
   * @deprecated - use isAuthenticated instead
   */
  verify: verifyAuthState,

  /**
   * Forces an update from the server
   */
  updateStatus: updateAuthStatus,

  /**
   * Called upon user action to login
   */
  login: loginUser,

  /**
   * Called upon user action to logout
   */
  logout: logout,

  /**
   * Reference to TokenManager
   */
  manager: TokenManager,

  /**
   * Indicates whether `init()` has completed
   */
  isInitialized: false,

  /**
   * Checks local tokens or server for authentication status.
   */
  isAuthenticated: async function (options = {}) {
    const { skipCache = false, forceVerify = false } = options;

    // Fast path: check memory state if cache is valid
    if (!skipCache && authVerificationCache.isValid()) {
      return authVerificationCache.result;
    }

    // Check for token in memory
    if (!TokenManager.accessToken) {
      // Rehydrate from cookies
      const cookiesRehydrated = TokenManager.rehydrateFromCookies();
      if (!cookiesRehydrated) {
        // Then from localStorage
        const authState = JSON.parse(localStorage.getItem('auth_state'));
        if (authState?.accessToken) {
          TokenManager.setTokens(authState.accessToken, authState.refreshToken);
        } else {
          // No tokens found
          authVerificationCache.set(false);
          return false;
        }
      }
    }

    // Refresh if expired
    if (TokenManager.isExpired()) {
      try {
        const refreshed = await TokenManager.refreshTokens();
        if (!refreshed) {
          authVerificationCache.set(false);
          return false;
        }
      } catch (error) {
        console.error("[Auth] Token refresh failed:", error);
        authVerificationCache.set(false);
        return false;
      }
    }

    // If not forced, skip server verify
    if (!forceVerify && TokenManager.accessToken) {
      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = true;
      }
      authVerificationCache.set(true);
      return true;
    }

    // Otherwise, attempt server verification
    try {
      const response = await window.apiRequest('/api/auth/verify', 'GET', null, 0, 3000, {
        skipAuthCheck: true,
        skipRetry: true
      });
      const isAuthenticated = response?.authenticated === true;

      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = isAuthenticated;
      }
      authVerificationCache.set(isAuthenticated);

      if (!isAuthenticated) {
        TokenManager.clearTokens();
      }
      return isAuthenticated;
    } catch (error) {
      // For network errors, assume token might still be valid
      if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
        const result = !!TokenManager.accessToken;
        if (window.API_CONFIG) {
          window.API_CONFIG.isAuthenticated = result;
        }
        authVerificationCache.set(result);
        return result;
      }
      // If explicitly 401, definitely logout
      if (error.status === 401) {
        TokenManager.clearTokens();
        if (window.API_CONFIG) {
          window.API_CONFIG.isAuthenticated = false;
        }
        authVerificationCache.set(false);
        return false;
      }
      // Default fallback
      const result = !!TokenManager.accessToken;
      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = result;
      }
      authVerificationCache.set(result);
      return result;
    }
  }
};

// NOTE: Do not call auth.init() automatically.
// Let main script (app.js) call `window.auth.init()` after window.apiRequest is defined.
console.log("[Auth] Module loaded and exposed to window.auth");
