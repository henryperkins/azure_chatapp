/***********************************************************
 * auth.js
 * -------
 * Cookie-based authentication module with robust error
 * handling, token refresh, session monitoring, and UI hooks.
 ***********************************************************/

// Debug flag for verbose auth logging
const AUTH_DEBUG = true;  // Toggle as needed

// Track if session has expired to prevent repeated verification calls
let sessionExpiredFlag = false;

// ---------------------------------------------------------------------
// Auth Request Helper
// ---------------------------------------------------------------------
async function authRequest(endpoint, method, body = null) {
  try {
    const response = await fetch(endpoint, {
      method,
      credentials: 'include', // Important for cookie-based auth
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || 'Authentication failed');
    }
    return response.json();
  } catch (error) {
    console.error(`[Auth] Request to ${endpoint} failed:`, error);
    throw error;
  }
}

// ---------------------------------------------------------------------
// Caching mechanism for verification results
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

/**
 * Extracts a cookie value by name
 * @param {string} name - Cookie name 
 * @returns {string|null} Cookie value
 */
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

/**
 * Checks if a JWT token is expired
 * @param {string} token - JWT token
 * @returns {boolean} True if expired
 */
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Add a small buffer to account for clock skew
    return payload.exp * 1000 < (Date.now() - 10000);
  } catch (e) {
    console.warn('[Auth] Error parsing token for expiration check:', e);
    return true; // Assume expired if we can't parse it
  }
}

// ---------------------------------------------------------------------
// Main Verification Logic (with Refresh)
// ---------------------------------------------------------------------
/**
 * Verify auth state with server, handling token refresh when needed
 * @param {boolean} bypassCache - Force server verification 
 * @returns {Promise<boolean>} Authentication state
 */
async function verifyAuthState(bypassCache = false) {
  try {
    // Skip verification if we know session is expired (but allow retry after 1 minute)
    if (sessionExpiredFlag && (Date.now() - sessionExpiredFlag < 60000)) {
      if (AUTH_DEBUG) console.debug('[Auth] Skipping verification - session already expired');
      return false;
    }

    // Check cache if not bypassing
    if (!bypassCache && authVerificationCache.isValid()) {
      if (AUTH_DEBUG) console.debug('[Auth] Using cached verification result:', authVerificationCache.result);
      return authVerificationCache.result;
    }

    // Check for expired access token
    const accessToken = getCookie('access_token');
    const refreshToken = getCookie('refresh_token');

    // If access token is expired but refresh token exists, attempt refresh
    if (accessToken && isTokenExpired(accessToken) && refreshToken) {
      try {
        if (AUTH_DEBUG) console.debug('[Auth] Access token expired, attempting refresh');

        const apiCall = window.apiRequest ||
          ((url, method) => authRequest(url, method));

        // Increased timeout for token refresh operations
        const REFRESH_TIMEOUT = 10000; // 10 seconds

        const refreshPromise = apiCall('/api/auth/refresh', 'POST', null, {
          credentials: 'include',
          headers: { 'Cache-Control': 'no-cache' }
        });

        // Add timeout to refresh request
        await Promise.race([
          refreshPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Auth refresh timeout')), REFRESH_TIMEOUT)
          )
        ]);

        // Confirm new access token is set in cookies
        let retries = 3;
        let newAccessToken;
        while (retries-- > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
          newAccessToken = getCookie('access_token');
          if (newAccessToken) break;
        }

        if (!newAccessToken) {
          throw new Error('No access token received after refresh');
        }
      } catch (refreshError) {
        console.error('[Auth] Token refresh failed:', refreshError);

        if (typeof clearAuthState === 'function') {
          clearAuthState();
        }
        broadcastAuth(false);

        const errorMessage = refreshError.message || 'Session expired. Please login again.';
        const isTimeout = errorMessage.includes('timeout');
        throw new Error(isTimeout ? 'Authentication timed out. Please try again.' : 'Session expired. Please login again.');
      }
    } else if (!accessToken) {
      // No access token at all
      broadcastAuth(false);
      return false;
    }

    // Check with the server for auth status - with retry mechanism
    const apiCall = window.apiRequest ||
      ((url, method) => authRequest(url, method));

    // Progressive retry
    const MAX_VERIFY_ATTEMPTS = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt++) {
      try {
        const VERIFY_TIMEOUT = 5000 + (attempt * 1000); // Increase timeout with each attempt
        if (AUTH_DEBUG) {
          console.debug(`[Auth] Verification attempt ${attempt}/${MAX_VERIFY_ATTEMPTS} with timeout ${VERIFY_TIMEOUT}ms`);
        }

        // Add timeout to verify request
        const response = await Promise.race([
          apiCall('/api/auth/verify', 'GET', null, {
            credentials: 'include' // Ensure cookies are sent
          }),
          new Promise((_, reject) =>
            setTimeout(() =>
              reject(new Error(`Auth verification timeout (attempt ${attempt})`)),
              VERIFY_TIMEOUT
            )
          )
        ]);

        console.debug('[Auth] Verification successful:', response);
        authVerificationCache.set(response.authenticated);

        if (response.authenticated) {
          broadcastAuth(true, response.username);
        } else {
          broadcastAuth(false);
        }
        return response.authenticated;
      } catch (verifyError) {
        lastError = verifyError;
        console.warn(`[Auth] Verification attempt ${attempt} failed:`, verifyError);

        // If it's a 401, no need to retry
        if (verifyError.status === 401) {
          sessionExpiredFlag = Date.now(); // Store timestamp instead of boolean
          if (typeof clearAuthState === 'function') {
            clearAuthState();
          }
          broadcastAuth(false);

          // Show modal or redirect
          if (window.showSessionExpiredModal) {
            window.showSessionExpiredModal();
          } else {
            setTimeout(() => {
              window.location.href = '/?session_expired=true';
            }, 1000);
          }
          throw new Error('Session expired. Please login again.');
        }

        // Exponential backoff
        if (attempt < MAX_VERIFY_ATTEMPTS) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All verification attempts failed
    console.error('[Auth] All verification attempts failed');
    authVerificationCache.set(false);
    broadcastAuth(false);

    // Enhanced error message
    let errorMsg = 'Authentication verification failed';
    if (lastError) {
      if (lastError.message && lastError.message.includes('timeout')) {
        errorMsg = 'Authentication check timed out - please try again later';
      } else if (lastError.status === 401) {
        errorMsg = 'Session expired - please login again';
      } else if (lastError.message) {
        errorMsg = lastError.message;
      }
    }

    throw new Error(errorMsg);
  } catch (error) {
    console.warn('[Auth] Auth verification error:', error);
    authVerificationCache.set(false);
    return false;
  }
}

// ---------------------------------------------------------------------
// Periodic & On-Focus Auth Monitoring
// ---------------------------------------------------------------------
function setupAuthStateMonitoring() {
  // Initial verification
  verifyAuthState(true).then(isAuthenticated => {
    broadcastAuth(isAuthenticated);
  }).catch(error => {
    console.error('[Auth] Initial verification error:', error);
    broadcastAuth(false);
  });

  // Set up periodic verification (every 5 minutes)
  const VERIFICATION_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const AUTH_CHECK = setInterval(() => {
    // Only verify if not already known to be expired
    if (!sessionExpiredFlag) {
      verifyAuthState(true).then(isAuthenticated => {
        // If verification fails but we still have tokens, try refreshing 
        if (!isAuthenticated && window.TokenManager?.hasTokens()) {
          if (window.TokenManager?.refresh) {
            window.TokenManager.refresh().catch(err => {
              console.warn('[Auth] Refresh during monitoring failed:', err);
              clearInterval(AUTH_CHECK);
              broadcastAuth(false);
            });
          }
        }
      }).catch(error => {
        console.warn('[Auth] Periodic verification error:', error);
        // Only broadcast logout if session is truly expired or 401
        if (error.message?.includes('expired') || error.status === 401) {
          broadcastAuth(false);
        }
      });
    }
  }, VERIFICATION_INTERVAL);

  // Also verify on window focus
  window.addEventListener('focus', () => {
    // Only verify if not already known to be expired and last check > 1 minute ago
    if (!sessionExpiredFlag &&
      (!authVerificationCache.lastVerified ||
        Date.now() - authVerificationCache.lastVerified > 60000)) {
      verifyAuthState(true).catch(error => {
        console.warn('[Auth] Focus verification error:', error);
      });
    }
  });

  // Clear interval on page unload
  window.addEventListener('beforeunload', () => {
    clearInterval(AUTH_CHECK);
  });
}

// ---------------------------------------------------------------------
// Broadcast & UI Updates
// ---------------------------------------------------------------------
/**
 * Broadcast authentication state changes and update UI
 * @param {boolean} authenticated
 * @param {string} username
 */
function broadcastAuth(authenticated, username = null) {
  // Keep global state in sync
  if (window.API_CONFIG) {
    window.API_CONFIG.isAuthenticated = authenticated;
  }

  // Broadcast events
  document.dispatchEvent(new CustomEvent("authStateChanged", {
    detail: { authenticated, username }
  }));
  window.dispatchEvent(new CustomEvent("authStateChanged", {
    detail: { authenticated, username }
  }));

  // Update any basic UI elements
  const userStatus = document.getElementById('userStatus');
  const authButton = document.getElementById('authButton');
  const userMenu = document.getElementById('userMenu');
  const authStatus = document.getElementById('authStatus');

  if (userStatus) {
    userStatus.textContent = authenticated ? username : 'Offline';
    userStatus.classList.toggle('text-green-600', authenticated);
    userStatus.classList.toggle('text-gray-600', !authenticated);
  }

  if (authButton && userMenu) {
    authButton.classList.toggle('hidden', authenticated);
    userMenu.classList.toggle('hidden', !authenticated);
  }

  if (authStatus) {
    authStatus.textContent = authenticated ? 'Authenticated' : 'Not Authenticated';
    authStatus.classList.toggle('text-green-600', authenticated);
    authStatus.classList.toggle('text-red-600', !authenticated);
  }
}

/**
 * Display notification to user
 * @param {string} message - Notification message
 * @param {string} type - Notification type (info, error, success, etc.)
 */
function notify(message, type = "info") {
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

// ---------------------------------------------------------------------
// Login, Logout, Register
// ---------------------------------------------------------------------
/**
 * Attempt login with username/password
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Object>} Login result with tokens
 */
async function loginUser(username, password) {
  try {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Starting login for user:', username);
    }
    const apiCall = window.apiRequest ||
      ((url, method, data) => authRequest(url, method, data));

    const response = await apiCall('/api/auth/login', 'POST', {
      username: username.trim(),
      password,
      ws_auth: true // Request WebSocket auth token
    });

    if (AUTH_DEBUG) {
      console.debug('[Auth] Login response received', response);
    }
    if (!response.access_token) {
      throw new Error('No access token received');
    }

    // Optional: track token version in a global manager
    if (response.token_version && window.TokenManager) {
      window.TokenManager.version = response.token_version;
    }

    broadcastAuth(true, response.username || username);

    return {
      ...response,
      // Provide a default WS URL if the server returns it
      ws_url: response.ws_url || `/api/chat/ws?token=${response.access_token}`
    };
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

/**
 * Logout user with improved sequencing and error handling
 * @param {Event} e - (optional) DOM Event
 * @returns {Promise<void>}
 */
async function logout(e) {
  e?.preventDefault();
  try {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Starting logout process');
    }
    // Disconnect any active WebSocket connections
    if (window.WebSocketService && typeof window.WebSocketService.disconnectAll === 'function') {
      window.WebSocketService.disconnectAll();
    }

    // Attempt server-side logout
    try {
      const apiCall = window.apiRequest || ((url, method) => authRequest(url, method));
      const LOGOUT_TIMEOUT = 5000; // 5 seconds
      const logoutPromise = apiCall('/api/auth/logout', 'POST');

      await Promise.race([
        logoutPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Logout request timed out')), LOGOUT_TIMEOUT)
        )
      ]);
      console.debug('[Auth] Server-side logout successful');
    } catch (apiErr) {
      console.warn("[Auth] Logout API error:", apiErr);
      // Continue with client-side logout even if API call fails
    }

    // Clear token manager if present
    if (window.TokenManager && typeof window.TokenManager.clear === 'function') {
      window.TokenManager.clear();
    }

    // Clear local auth state
    authVerificationCache.set(false);

    // Broadcast
    broadcastAuth(false);
    notify("Logged out successfully", "success");

    // For security, always reload after logout
    window.location.href = '/index.html';
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    // Force logout state even on error
    broadcastAuth(false);
    if (window.TokenManager) window.TokenManager.clear();
    window.location.href = '/';
  }
}

/**
 * Handle user registration (then auto-login)
 * @param {FormData} formData - registration form data
 */
async function handleRegister(formData) {
  const username = formData.get("username");
  const password = formData.get("password");
  if (!username || !password) {
    notify("Please fill out all fields", "error");
    return;
  }
  // Example password policy check
  if (password.length < 12) {
    notify("Password must be at least 12 characters", "error");
    return;
  }

  try {
    const apiCall = window.apiRequest || ((url, method, data) => authRequest(url, method, data));
    // Server sets cookies on success
    await apiCall('/api/auth/register', 'POST', {
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

// ---------------------------------------------------------------------
// UI: Setup form listeners, toggles, etc.
// ---------------------------------------------------------------------
function setupUIListeners() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");
  if (authBtn && authDropdown) {
    authBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Toggle dropdown
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
        // Example: load tasks in parallel
        const loadTasks = [];
        if (typeof window.loadSidebarProjects === 'function') {
          loadTasks.push(window.loadSidebarProjects());
        }
        if (typeof window.loadProjectList === 'function') {
          loadTasks.push(window.loadProjectList());
        }
        if (typeof window.initProjectDashboard === 'function') {
          loadTasks.push(window.initProjectDashboard());
        }
        if (typeof window.loadStarredConversations === 'function') {
          loadTasks.push(window.loadStarredConversations());
        }
        const isChatPage = window.location.pathname === '/' || window.location.pathname.includes('chat');
        if (isChatPage && typeof window.createNewChat === 'function' && !window.CHAT_CONFIG?.chatId) {
          loadTasks.push(window.createNewChat());
        }
        Promise.allSettled(loadTasks).then(results => {
          results.forEach((r) => {
            if (r.status === 'rejected') {
              console.warn("[Auth] Some post-login tasks failed:", r.reason);
            }
          });
        });
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

/**
 * Toggle between login & registration forms
 * @param {boolean} isLogin - True = show login form
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
// Error Handling & State Clearing
// ---------------------------------------------------------------------
function handleAuthError(error, context = "authentication") {
  console.error(`[Auth] Error during ${context}:`, error);

  let message = "Authentication failed";
  let action = null;

  if (error.status === 401) {
    message = "Your session has expired. Please log in again.";
    action = "login";
    clearAuthState();
  } else if (error.status === 429) {
    message = "Too many attempts. Please try again later.";
  } else if (error.message?.includes('timeout')) {
    message = "Connection timed out. Please check your network and try again.";
  } else if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
    message = "Network error. Please check your connection and try again.";
  } else if (error.message) {
    message = error.message;
  }

  notify(message, "error");
  if (action === "login") {
    const loginMsg = document.getElementById("loginRequiredMessage");
    if (loginMsg) loginMsg.classList.remove("hidden");
  }
  return { message, action };
}

/**
 * Clear all local auth state (verification cache, tokens, localStorage, etc.)
 */
function clearAuthState() {
  // Clear verification cache
  authVerificationCache.set(false);

  // Reset UI that depends on auth
  broadcastAuth(false);

  // Clear token manager state if available
  if (window.TokenManager && typeof window.TokenManager.clear === 'function') {
    window.TokenManager.clear();
  }

  // Clear localStorage items
  try {
    localStorage.removeItem('authState');
    localStorage.removeItem('lastAuthCheck');
  } catch (e) {
    console.warn('[Auth] Failed to clear localStorage:', e);
  }

  // Clear sessionStorage
  try {
    sessionStorage.clear();
  } catch (e) {
    console.warn('[Auth] Failed to clear sessionStorage:', e);
  }

  // Clear any pending API requests queue
  if (window.API_REQUEST_QUEUE) {
    window.API_REQUEST_QUEUE.clear();
  }

  console.debug('[Auth] Auth state cleared');
}

// ---------------------------------------------------------------------
// Initialization & Public API
// ---------------------------------------------------------------------
/**
 * Initialize auth module
 * @returns {Promise<boolean>} Success status
 */
async function init() {
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
    // Check auth state with server
    const isAuthenticated = await verifyAuthState(true);
    if (!isAuthenticated) {
      broadcastAuth(false);
    }

    setupUIListeners();
    setupAuthStateMonitoring();
    this.isInitialized = true;

    console.log("[Auth] Module initialized successfully");
    return true;
  } catch (error) {
    console.error("[Auth] Initialization failed:", error);
    broadcastAuth(false);
    return false;
  } finally {
    if (window.API_CONFIG) {
      window.API_CONFIG.authCheckInProgress = false;
    }
    window.__authInitializing = false;
  }
}

// ---------------------------------------------------------------------
// Expose to window
// ---------------------------------------------------------------------
window.auth = window.auth || {
  init,
  verify: verifyAuthState,
  updateStatus: verifyAuthState, // for backward compatibility
  login: loginUser,
  logout,
  isInitialized: false,
  handleAuthError,
  isAuthenticated: async function (options = {}) {
    const { skipCache = false, forceVerify = false } = options;
    // Fast path: cached
    if (!skipCache && !forceVerify && authVerificationCache.isValid()) {
      if (AUTH_DEBUG) console.debug('[Auth] Using cached authentication status');
      return authVerificationCache.result;
    }
    // Otherwise, verify with server
    try {
      const isAuthenticated = await verifyAuthState(forceVerify);
      return isAuthenticated;
    } catch (error) {
      console.error("[Auth] Authentication check failed:", error);
      authVerificationCache.set(false);
      broadcastAuth(false);
      return false;
    }
  }
};

console.log("[Auth] Module loaded and exposed to window.auth");
