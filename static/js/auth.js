/**
 * auth.js - Unified Authentication Module
 * -------
 * Single source of truth for all authentication-related functionality:
 * - Token management
 * - Session verification
 * - Login/logout/registration
 * - Authentication error handling
 */

// Debug flag for verbose auth logging
const AUTH_DEBUG = true;  // Toggle as needed

// Track if session has expired to prevent repeated verification calls
let sessionExpiredFlag = false;

// Token refresh state tracking
let tokenRefreshInProgress = false;
let lastRefreshAttempt = null;
let refreshFailCount = 0;
const MAX_REFRESH_RETRIES = 3;

// Central auth state
const authState = {
  isAuthenticated: false,
  username: null,
  lastVerified: 0,
  tokenVersion: null
};

// OAuth configuration constants
const AUTH_CONSTANTS = {
  VERIFICATION_INTERVAL: 5 * 60 * 1000, // 5 minutes
  VERIFICATION_CACHE_DURATION: 60000,    // 60 seconds
  REFRESH_TIMEOUT: 10000,                // 10 seconds for token refresh
  VERIFY_TIMEOUT: 5000,                  // 5 seconds for auth verification
  MAX_VERIFY_ATTEMPTS: 3                 // Maximum verification attempts
};

// ---------------------------------------------------------------------
// Token Management
// ---------------------------------------------------------------------

/**
 * Get a valid authentication token for API requests
 * @param {Object} options - Options for token retrieval 
 * @returns {Promise<string>} Valid token
 */
async function getAuthToken(options = {}) {
  const accessToken = getCookie('access_token');
  const refreshToken = getCookie('refresh_token');
  
  if (checkTokenValidity(accessToken)) {
    return accessToken;
  }

  if (refreshToken && checkTokenValidity(refreshToken, { allowRefresh: true })) {
    const { success } = await refreshTokens();
    if (success) {
      return getCookie('access_token');
    }
  }
  
  throw new Error('Not authenticated');
}

/**
 * Get a token specifically for WebSocket authentication
 * @returns {Promise<Object>} WebSocket auth token and metadata
 */
async function getWSAuthToken() {
  try {
    if (AUTH_DEBUG) console.debug('[Auth] Getting WebSocket auth token');

    // If not authenticated, fail fast
    const isAuthenticated = await verifyAuthState(false);
    if (!isAuthenticated) {
      throw new Error('Not authenticated for WebSocket connection');
    }

    // Request a specialized WebSocket token
    const response = await apiRequest('/api/auth/ws-token', 'GET');

    return {
      token: response.token,
      version: response.version || authState.tokenVersion
    };
  } catch (error) {
    console.error('[Auth] Failed to get WebSocket auth token:', error);

    // If it's a token expiry error, try to refresh once
    if (error.message?.includes('expired') || error.status === 401) {
      try {
        await refreshTokens();
        return getWSAuthToken(); // Retry after refresh
      } catch (refreshError) {
        console.error('[Auth] WebSocket token retry failed after refresh:', refreshError);
        throw refreshError;
      }
    }

    throw error;
  }
}

/**
 * Refresh authentication tokens
 * @returns {Promise<Object>} Refresh result
 */
async function refreshTokens() {
  // Prevent multiple simultaneous refresh attempts
  if (tokenRefreshInProgress) {
    console.debug('[Auth] Token refresh already in progress, waiting...');
    return new Promise((resolve, reject) => {
      const checkComplete = () => {
        if (!tokenRefreshInProgress) {
          if (getCookie('access_token')) {
            resolve({ success: true });
          } else {
            reject(new Error('Token refresh failed'));
          }
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      setTimeout(checkComplete, 100);
    });
  }

  // Check for too many consecutive failed refresh attempts
  const now = Date.now();
  if (lastRefreshAttempt && (now - lastRefreshAttempt < 5000) && refreshFailCount >= MAX_REFRESH_RETRIES) {
    console.error('[Auth] Too many failed refresh attempts, forcing logout');
    await logout();
    return Promise.reject(new Error('Too many refresh attempts failed - logged out'));
  }
tokenRefreshInProgress = true;
lastRefreshAttempt = now;

try {
  console.debug('[Auth] Refreshing tokens...');

  // Validate we have a token to refresh
  const currentToken = getCookie('refresh_token');
  if (!currentToken) {
    throw new Error('No token available for refresh');
  }

  // Check token expiry
  const expiry = getTokenExpiry(currentToken);
  if (expiry && expiry < Date.now()) {
    throw new Error('Token already expired');
  }

  // Implement retry with exponential backoff
  let lastError;
  let response;
  
  for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    try {
      const fetchPromise = apiRequest('/api/auth/refresh', 'POST');
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Token refresh timeout')),
          AUTH_CONSTANTS.REFRESH_TIMEOUT * Math.pow(2, attempt-1));
      });

      // Race the fetch against the timeout
      response = await Promise.race([fetchPromise, timeoutPromise]);

      // Validate response
      if (!response?.access_token) {
        throw new Error('Invalid refresh response');
      }

      // Store tokenVersion in auth state
      if (response.token_version) {
        authState.tokenVersion = response.token_version;
      }
      
      break; // Success - exit retry loop
    } catch (error) {
      lastError = error;
      if (attempt < MAX_REFRESH_RETRIES) {
        const delay = 300 * Math.pow(2, attempt-1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  // Reset failed attempt counter on success
  refreshFailCount = 0;

  // Refresh verification timestamp
  authState.lastVerified = Date.now();

  console.debug('[Auth] Token refreshed successfully');

  // Notify about token refresh
  document.dispatchEvent(new CustomEvent('tokenRefreshed', {
    detail: { success: true }
  }));

  // Store token version in cookie
  if (response.token_version) {
    document.cookie = `token_version=${response.token_version}; path=/; ${
      location.protocol === 'https:' ? 'Secure; ' : ''
    }SameSite=Strict`;
  }
  return {
    success: true,
    version: response.token_version || authState.tokenVersion,
    token: response.access_token
  };
  } catch (error) {
    // Increment failed attempt counter
    refreshFailCount++;

    console.error(`[Auth] Token refresh failed (attempt ${refreshFailCount}/${MAX_REFRESH_RETRIES}):`, error);

    // Provide more specific error message based on error type
    let errorMessage = "Token refresh failed";
    let forceLogout = false;

    if (error.status === 401) {
      errorMessage = "Your session has expired. Please log in again.";
      forceLogout = true;
    } else if (error.message?.includes('version mismatch')) {
      errorMessage = "Session invalidated due to token version mismatch - please login again";
      forceLogout = true;
    } else if (error.message?.includes('revoked')) {
      errorMessage = "Your session has been revoked - please login again";
      forceLogout = true;
    } else if (error.message?.includes('timeout')) {
      errorMessage = "Token refresh timed out - please try again";
    } else if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
      errorMessage = "Network error during token refresh - please check your connection";
    }

    // Force immediate logout for certain errors
    if (forceLogout) {
      clearTokenState();
      broadcastAuth(false);

      // Small delay to allow notification to appear before logout
      setTimeout(() => logout(), 300);
    }

    // Notify about token refresh failure
    document.dispatchEvent(new CustomEvent('tokenRefreshed', {
      detail: {
        success: false,
        error,
        message: errorMessage,
        attempts: refreshFailCount
      }
    }));

    throw new Error(errorMessage);
  } finally {
    tokenRefreshInProgress = false;
  }
}

/**
 * Extract token expiry time
 * @param {string} token - JWT token
 * @returns {number|null} Expiry timestamp or null if invalid
 */
function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000; // Convert to milliseconds
  } catch (e) {
    console.warn('[Auth] Error extracting token expiry:', e);
    return null;
  }
}

/**
 * Checks if a JWT token is expired
 * @param {string} token - JWT token
 * @returns {boolean} True if expired
 */
async function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Get server time reference
    let serverTime;
    try {
      const { serverTimestamp } = await apiRequest('/api/auth/timestamp');
      serverTime = serverTimestamp * 1000;
    } catch {
      // Fallback to client time if server unavailable
      serverTime = Date.now();
    }
    // 10-second buffer for network delays
    return payload.exp * 1000 < (serverTime - 10000);
  } catch (e) {
    console.warn('[Auth] Error parsing token for expiration check:', e);
    return true; // Assume expired if we can't parse it
  }
}

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
 * Checks if token is still valid based on issue time and max age
 * @param {string} token - JWT token
 * @param {Object} options - { allowRefresh: boolean }
 * @returns {boolean} True if valid
 */
function checkTokenValidity(token, { allowRefresh = false } = {}) {
  if (!token) return false;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const maxAge = allowRefresh ? 
      settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400 : 
      settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60;
      
    return (Date.now() / 1000 - payload.iat) < maxAge;
  } catch {
    return false;
  }
}

/**
 * Clear all authorization tokens and state
 */
function clearTokenState() {
  // Reset auth state
  authState.isAuthenticated = false;
  authState.username = null;
  authState.lastVerified = 0;
  sessionExpiredFlag = Date.now(); // Mark session as expired with timestamp
  refreshFailCount = 0;

  // Reset local/session storage values related to auth
  try {
    localStorage.removeItem('authState');
    localStorage.removeItem('lastAuthCheck');
    sessionStorage.clear();
  } catch (e) {
    console.warn('[Auth] Failed to clear storage:', e);
  }

  // Dispatch event to inform components
  broadcastAuth(false);

  console.debug('[Auth] Auth state cleared');
}

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

/**
 * Unified API request wrapper for auth operations
 * @param {string} url - API endpoint
 * @param {string} method - HTTP method
 * @param {Object} data - Request body for POST/PUT
 * @returns {Promise<Object>} Response data
 */
async function apiRequest(url, method, data = null) {
  // Use global API request function if available
  if (window.apiRequest) {
    return window.apiRequest(url, method, data);
  }

  // Fallback to direct fetch with error handling
  return authRequest(url, method, data);
}

// ---------------------------------------------------------------------
// Main Verification Logic
// ---------------------------------------------------------------------

/**
 * Initialize auth module
 * @returns {Promise<boolean>} Success status
 */
async function init() {
  if (window.__authInitializing) {
    return new Promise(resolve => {
      const check = () => {
        if (window.auth.isInitialized) resolve(true);
        else setTimeout(check, 50);
      };
      check();
    });
  }

  window.__authInitializing = true;
  if (window.auth.isInitialized) {
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
    window.auth.isInitialized = true;

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
    if (!bypassCache &&
      authState.lastVerified &&
      (Date.now() - authState.lastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION)) {
      if (AUTH_DEBUG) console.debug('[Auth] Using cached verification result:', authState.isAuthenticated);
      return authState.isAuthenticated;
    }

    // Check for expired access token
    const accessToken = getCookie('access_token');
    const refreshToken = getCookie('refresh_token');

    // If access token is expired but refresh token exists, attempt refresh
    if (accessToken && isTokenExpired(accessToken) && refreshToken) {
      try {
        if (AUTH_DEBUG) console.debug('[Auth] Access token expired, attempting refresh');

        await refreshTokens();

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

        clearTokenState();
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
    const MAX_VERIFY_ATTEMPTS = AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt++) {
      try {
        const VERIFY_TIMEOUT = AUTH_CONSTANTS.VERIFY_TIMEOUT + (attempt * 1000); // Increase timeout with each attempt
        if (AUTH_DEBUG) {
          console.debug(`[Auth] Verification attempt ${attempt}/${MAX_VERIFY_ATTEMPTS} with timeout ${VERIFY_TIMEOUT}ms`);
        }

        // Add timeout to verify request
        const response = await Promise.race([
          apiRequest('/api/auth/verify', 'GET'),
          new Promise((_, reject) =>
            setTimeout(() =>
              reject(new Error(`Auth verification timeout (attempt ${attempt})`)),
              VERIFY_TIMEOUT
            )
          )
        ]);

        console.debug('[Auth] Verification successful:', response);

        // Update auth state with verification result
        authState.isAuthenticated = response.authenticated;
        authState.username = response.username || null;
        authState.lastVerified = Date.now();

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
          clearTokenState();

          // Show modal or redirect
          if (window.showSessionExpiredModal) {
            window.showSessionExpiredModal();
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
    authState.isAuthenticated = false;
    authState.lastVerified = Date.now();
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
    authState.isAuthenticated = false;
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
  const VERIFICATION_INTERVAL = AUTH_CONSTANTS.VERIFICATION_INTERVAL;
  const AUTH_CHECK = setInterval(() => {
    // Only verify if not already known to be expired
    if (!sessionExpiredFlag) {
      verifyAuthState(true).catch(error => {
        console.warn('[Auth] Periodic verification error:', error);
      });
    }
  }, VERIFICATION_INTERVAL);

  // Also verify on window focus
  window.addEventListener('focus', () => {
    // Only verify if not already known to be expired and last check > 1 minute ago
    if (!sessionExpiredFlag &&
      (!authState.lastVerified ||
        Date.now() - authState.lastVerified > 60000)) {
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
  // Update internal state
  authState.isAuthenticated = authenticated;
  authState.username = username;

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

  // Update UI elements
  updateAuthUI(authenticated, username);
}

/**
 * Update UI elements based on auth state
 * @param {boolean} authenticated
 * @param {string} username
 */
function updateAuthUI(authenticated, username = null) {
  const userStatus = document.getElementById('userStatus');
  const authButton = document.getElementById('authButton');
  const userMenu = document.getElementById('userMenu');
  const authStatus = document.getElementById('authStatus');

  if (userStatus) {
    userStatus.textContent = authenticated ? username || 'Online' : 'Offline';
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
  if (window.showNotification) {
    window.showNotification(message, type);
    return;
  }

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

    const response = await apiRequest('/api/auth/login', 'POST', {
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

    // Update token version from response
    if (response.token_version) {
      authState.tokenVersion = response.token_version;
    }

    // Update auth state
    authState.isAuthenticated = true;
    authState.username = response.username || username;
    authState.lastVerified = Date.now();

    // Clear any expired session flag
    sessionExpiredFlag = false;

    // Broadcast auth success
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
      const LOGOUT_TIMEOUT = 5000; // 5 seconds
      const logoutPromise = apiRequest('/api/auth/logout', 'POST');

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

    // Clear token state and broadcast logout
    clearTokenState();
    notify("Logged out successfully", "success");

    // Redirect after logout
    window.location.href = '/index.html';
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    // Force logout state even on error
    clearTokenState();
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
    // Server sets cookies on success
    await apiRequest('/api/auth/register', 'POST', {
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
// Error Handling
// ---------------------------------------------------------------------
/**
 * Standardized error handler for authentication failures
 * @param {Error} error - The authentication error
 * @param {string} context - Context description for logging
 * @returns {Object} Processed error info
 */
function handleAuthError(error, context = "authentication") {
  console.error(`[Auth] Error during ${context}:`, error);

  let message = "Authentication failed";
  let action = null;

  if (error.status === 401) {
    message = "Your session has expired. Please log in again.";
    action = "login";
    clearTokenState();
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

      // Trigger sidebar UI update
      if (window.sidebar?.updateAuthDependentUI) {
        window.sidebar.updateAuthDependentUI();
      }

      // Load any initial data
      setTimeout(() => {
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
// Expose to window
// ---------------------------------------------------------------------
window.auth = window.auth || {
  init,
  isAuthenticated: async function (options = {}) {
    const { skipCache = false, forceVerify = false } = options;
    try {
      const isAuthenticated = await verifyAuthState(forceVerify);
      return isAuthenticated;
    } catch (error) {
      console.error("[Auth] Authentication check failed:", error);
      return false;
    }
  },
  logout,
  login: loginUser,
  getAuthToken,
  getWSAuthToken,
  refreshTokens,
  handleAuthError,
  verify: verifyAuthState,
  verifyAuthState: verifyAuthState, // Added for compatibility with existing code
  updateStatus: verifyAuthState, // for backward compatibility
  clear: clearTokenState,
  broadcastAuth,
  isInitialized: false
};

console.log("[Auth] Enhanced module loaded and exposed to window.auth");
