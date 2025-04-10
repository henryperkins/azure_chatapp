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
  MAX_VERIFY_ATTEMPTS: 3,                // Maximum verification attempts
  ACCESS_TOKEN_EXPIRE_MINUTES: 30,       // Default access token expiry in minutes
  REFRESH_TOKEN_EXPIRE_DAYS: 1           // Default refresh token expiry in days
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
    if (AUTH_DEBUG) {
      console.debug('[Auth] Getting WebSocket auth token');
    }

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
        return getWSAuthToken();
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
  // Handle concurrent refresh attempts with a 1-second buffer
  if (tokenRefreshInProgress) {
    const now = Date.now();
    if (now - lastRefreshAttempt < 1000) {
      console.debug('[Auth] Token refresh already in progress, returning existing promise');
      return window.__tokenRefreshPromise;
    }
    console.debug('[Auth] Allowing new refresh attempt after 1s buffer');
  }

  // New safeguard: Recent login check
  const timeSinceLastVerified = Date.now() - authState.lastVerified;
  if (timeSinceLastVerified < 5000) {
    console.debug('[Auth] Skipping refresh - recent login detected');
    return {
      success: true,
      version: authState.tokenVersion,
      token: getCookie('access_token')
    };
  }

  // Check for too many consecutive failed refresh attempts
  const now = Date.now();
  if (lastRefreshAttempt && (now - lastRefreshAttempt < 30000) && refreshFailCount >= MAX_REFRESH_RETRIES) {
    console.warn('[Auth] Too many failed refresh attempts - not forcing logout, just failing');
    return Promise.reject(new Error('Too many refresh attempts - please check your connection'));
  }

  tokenRefreshInProgress = true;
  lastRefreshAttempt = Date.now();
  window.__tokenRefreshPromise = new Promise(async (resolve, reject) => {
    try {
      console.debug('[Auth] Refreshing tokens...');

      const currentToken = getCookie('refresh_token');
      if (!currentToken) {
        throw new Error('No token available for refresh');
      }

      const expiry = getTokenExpiry(currentToken);
      if (expiry && expiry < Date.now()) {
        throw new Error('Token already expired');
      }

      let lastError;
      let response;

      // Exponential backoff attempts
      for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt++) {
        try {
          const fetchPromise = apiRequest('/api/auth/refresh', 'POST');
          const timeoutPromise = new Promise((_, rej) => {
            setTimeout(() => rej(new Error('Token refresh timeout')),
              AUTH_CONSTANTS.REFRESH_TIMEOUT * Math.pow(2, attempt - 1)
            );
          });

          response = await Promise.race([fetchPromise, timeoutPromise]);

          if (!response?.access_token) {
            throw new Error('Invalid refresh response');
          }

          if (response.token_version) {
            authState.tokenVersion = response.token_version;
          }

          break; // Success, break loop
        } catch (err) {
          lastError = err;
          if (attempt < MAX_REFRESH_RETRIES) {
            const delay = 300 * Math.pow(2, attempt - 1);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

      refreshFailCount = 0;
      authState.lastVerified = Date.now();
      console.debug('[Auth] Token refreshed successfully');

      document.dispatchEvent(new CustomEvent('tokenRefreshed', {
        detail: { success: true }
      }));

      if (response.token_version) {
        document.cookie = `token_version=${response.token_version}; path=/; ${
          location.protocol === 'https:' ? 'Secure; ' : ''
        }SameSite=Strict`;
      }

      resolve({
        success: true,
        version: response.token_version || authState.tokenVersion,
        token: response.access_token
      });
    } catch (err) {
      refreshFailCount++;
      console.error(`[Auth] Token refresh failed (attempt ${refreshFailCount}/${MAX_REFRESH_RETRIES}):`, err);

      let errorMessage = "Token refresh failed";
      let forceLogout = false;

      if (err.status === 401) {
        errorMessage = "Your session has expired. Please log in again.";
        forceLogout = true;
      } else if (err.message?.includes('version mismatch')) {
        errorMessage = "Session invalidated due to token version mismatch - please login again";
        forceLogout = true;
      } else if (err.message?.includes('revoked')) {
        errorMessage = "Your session has been revoked - please login again";
        forceLogout = true;
      } else if (err.message?.includes('timeout')) {
        errorMessage = "Token refresh timed out - please try again";
      } else if (err.message?.includes('NetworkError') || err.message?.includes('Failed to fetch')) {
        errorMessage = "Network error during token refresh - please check your connection";
      }

      if (forceLogout) {
        clearTokenState();
        broadcastAuth(false);
        setTimeout(() => logout(), 300);
      }

      document.dispatchEvent(new CustomEvent('tokenRefreshed', {
        detail: {
          success: false,
          error: err,
          message: errorMessage,
          attempts: refreshFailCount
        }
      }));

      reject(new Error(errorMessage));
    } finally {
      tokenRefreshInProgress = false;
    }
  });

  return window.__tokenRefreshPromise;
}

/**
 * Extract token expiry time
 * @param {string} token - JWT token
 */
function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000;
  } catch (e) {
    console.warn('[Auth] Error extracting token expiry:', e);
    return null;
  }
}

/**
 * Checks if a JWT token is expired
 * @param {string} token - JWT token
 */
async function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    let serverTime;
    try {
      const { serverTimestamp } = await apiRequest('/api/auth/timestamp', 'GET');
      serverTime = serverTimestamp * 1000;
    } catch {
      serverTime = Date.now();
    }
    return payload.exp * 1000 < (serverTime - 10000);
  } catch (e) {
    console.warn('[Auth] Error parsing token for expiration check:', e);
    return true;
  }
}

/**
 * Extracts a cookie value by name with improved persistence
 * @param {string} name
 */
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  let cookieValue = null;

  if (parts.length === 2) {
    cookieValue = parts.pop().split(';').shift();
  }

  if (name === 'access_token' || name === 'refresh_token') {
    return cookieValue;
  }

  return cookieValue;
}

/**
 * Checks if token is still valid based on issue time and max age
 * @param {string} token - JWT token
 * @param {Object} options - { allowRefresh: boolean }
 */
async function fetchTokenExpirySettings() {
  try {
    const response = await fetch('/settings/token-expiry', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch token expiry settings');
    }
    return await response.json();
  } catch (error) {
    console.error('[Auth] Failed to fetch token expiry settings:', error);
    return {
      access_token_expire_minutes: 30,
      refresh_token_expire_days: 7
    };
  }
}

async function checkTokenValidity(token, { allowRefresh = false } = {}) {
  if (!token) {
    console.debug('[Auth] Token validity check failed: No token provided');
    return false;
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const settings = await fetchTokenExpirySettings();

    if (AUTH_DEBUG) {
      console.debug(`[Auth] Token debug: type=${payload.type}, version=${payload.version}, issued_at=${new Date(payload.iat * 1000).toISOString()}`);
    }

    const maxAge = allowRefresh
      ? settings.refresh_token_expire_days * 86400
      : settings.access_token_expire_minutes * 60;

    const tokenAge = Date.now() / 1000 - payload.iat;
    const isValid = tokenAge < maxAge;

    if (!isValid && AUTH_DEBUG) {
      console.debug(`[Auth] Token expired by age check: age=${tokenAge}s, max=${maxAge}s`);
    }
    return isValid;
  } catch (err) {
    console.warn('[Auth] Token validity check error:', err);
    return false;
  }
}

/**
 * Clear all authorization tokens and state
 */
function clearTokenState() {
  authState.isAuthenticated = false;
  authState.username = null;
  authState.lastVerified = 0;
  sessionExpiredFlag = Date.now(); // Mark session as expired
  refreshFailCount = 0;

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
      credentials: 'include',
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
 */
async function apiRequest(url, method, data = null) {
  if (window.apiRequest) {
    return window.apiRequest(url, method, data);
  }
  return authRequest(url, method, data);
}

// ---------------------------------------------------------------------
// Main Verification Logic
// ---------------------------------------------------------------------
async function init() {
  if (window.__authInitializing) {
    return new Promise(resolve => {
      const checkInit = () => {
        if (window.auth.isInitialized) {
          resolve(true);
        } else {
          setTimeout(checkInit, 50);
        }
      };
      checkInit();
    });
  }

  window.__authInitializing = true;
  if (window.auth.isInitialized) {
    if (AUTH_DEBUG) {
      console.debug("[Auth] Already initialized");
    }
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

    setupUIListeners();
    setupTokenSync();

    await new Promise(resolve => setTimeout(resolve, 600));

    const isAuthenticated = await verifyAuthState(true);
    if (!isAuthenticated) {
      broadcastAuth(false);
    }

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
 * Verify auth state with server, handling token refresh
 * @param {boolean} bypassCache
 */
async function verifyAuthState(bypassCache = false) {
  try {
    if (sessionExpiredFlag && (Date.now() - sessionExpiredFlag < 10000)) {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Skipping verification - session recently expired');
      }
      return false;
    }

    if (sessionExpiredFlag && (Date.now() - sessionExpiredFlag >= 10000)) {
      sessionExpiredFlag = false;
    }

    if (!bypassCache &&
      authState.lastVerified &&
      (Date.now() - authState.lastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION)) {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Using cached verification result:', authState.isAuthenticated);
      }
      return authState.isAuthenticated;
    }

    let accessToken, refreshToken;
    let retries = 15; // Further increased retries: Wait longer for cookies to load (up to ~4.5 seconds total wait)
    let initialAccessToken = null;
    let initialRefreshToken = null;
    while (retries-- > 0) {
      accessToken = getCookie('access_token');
      refreshToken = getCookie('refresh_token');
      if (retries === 6) { // Log initial state once
          initialAccessToken = accessToken;
          initialRefreshToken = refreshToken;
          if (AUTH_DEBUG) console.debug(`[Auth] Initial cookie check: access=${initialAccessToken ? 'yes' : 'no'}, refresh=${initialRefreshToken ? 'yes' : 'no'}`);
      }

      if (accessToken && refreshToken) {
        if (AUTH_DEBUG) {
          console.debug(`[Auth] Both tokens found after ${7 - retries -1} retries, proceeding with verification`);
        }
        break;
      }

      if (AUTH_DEBUG) {
        console.debug(`[Auth] Waiting for cookies, retries left: ${retries}. Found: access=${accessToken ? 'yes' : 'no'}, refresh=${refreshToken ? 'yes' : 'no'}`);
      }
      await new Promise(resolve => setTimeout(resolve, 300)); // Slightly increased delay between checks

      // This direct access token check might be problematic on refresh, comment out for now to rely on cookies
      // if (accessToken === window.__directAccessToken && window.__recentLoginTimestamp && (Date.now() - window.__recentLoginTimestamp < 10000)) {
      //   if (AUTH_DEBUG) { console.debug('[Auth] Using direct access token bypass'); }
      //   return true;
      // }
      // Check for recent login with more flexible token matching
      if (window.__recentLoginTimestamp && (Date.now() - window.__recentLoginTimestamp < 30000)) {
        const currentToken = getCookie('access_token');
        if (currentToken) {
          if (AUTH_DEBUG) { console.debug('[Auth] Using recent login bypass with valid token'); }
          return true;
        }
        
        // If cookie is missing but we have a direct token in memory, use that as fallback
        if (window.__directAccessToken) {
          if (AUTH_DEBUG) { console.debug('[Auth] Using direct token fallback - cookies missing but recent login detected'); }
          // Try to set the cookie again as a recovery mechanism
          document.cookie = `access_token=${window.__directAccessToken}; path=/; max-age=1800; SameSite=Lax`;
          return true;
        }
      }
    }

    if (!accessToken && initialAccessToken && AUTH_DEBUG) {
        console.warn(`[Auth] Access token became null after initially being present. Retries: ${7 - retries -1}`);
    }
    if (accessToken && await isTokenExpired(accessToken) && refreshToken) { // Added await for isTokenExpired
      try {
        if (AUTH_DEBUG) {
          console.debug('[Auth] Access token expired, attempting refresh');
        }
        await refreshTokens();

        retries = 3;
        let newAccessToken;
        while (retries-- > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
          newAccessToken = getCookie('access_token');
          if (newAccessToken) {
            break;
          }
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
      if (AUTH_DEBUG) {
        console.debug('[Auth] No access token found after retries');
      }
      
      // Last resort: Check if we have a direct token from a recent login
      if (window.__directAccessToken && window.__recentLoginTimestamp &&
          (Date.now() - window.__recentLoginTimestamp < 60000)) { // Within 1 minute
        
        if (AUTH_DEBUG) {
          console.debug('[Auth] No cookie found but using direct token as last resort');
        }
        
        // Try to set the cookie again as a recovery mechanism
        document.cookie = `access_token=${window.__directAccessToken}; path=/; max-age=${60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES}; SameSite=Lax`;
        
        // Return authenticated since we have a valid direct token
        authState.isAuthenticated = true;
        authState.lastVerified = Date.now();
        broadcastAuth(true);
        return true;
      }
      
      broadcastAuth(false);
      return false;
    }

    const MAX_VERIFY = AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_VERIFY; attempt++) {
      try {
        const VERIFY_TIMEOUT = AUTH_CONSTANTS.VERIFY_TIMEOUT + (attempt * 1000);
        if (AUTH_DEBUG) {
          console.debug(`[Auth] Verification attempt ${attempt}/${MAX_VERIFY} with timeout ${VERIFY_TIMEOUT}ms`);
        }

        const response = await Promise.race([
          apiRequest('/api/auth/verify', 'GET'),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Auth verification timeout (attempt ${attempt})`)), VERIFY_TIMEOUT)
          )
        ]);

        console.debug('[Auth] Verification successful:', response);

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

        if (verifyError.status === 401) {
          sessionExpiredFlag = Date.now();
          clearTokenState();

          if (window.showSessionExpiredModal) {
            window.showSessionExpiredModal();
          }
          throw new Error('Session expired. Please login again.');
        }

        if (attempt < MAX_VERIFY) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    console.error('[Auth] All verification attempts failed. Access token present:',
      !!getCookie('access_token'), 'Refresh token present:', !!getCookie('refresh_token'));
    authState.isAuthenticated = false;
    authState.lastVerified = Date.now();
    broadcastAuth(false);

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
function setupTokenSync() {
  // Empty function for backward compatibility
}

function setupAuthStateMonitoring() {
  setTimeout(() => {
    verifyAuthState(true).then(isAuthenticated => {
      broadcastAuth(isAuthenticated);
    }).catch(error => {
      console.error('[Auth] Initial verification error:', error);
      broadcastAuth(false);
    });
  }, 300);

  const VERIFICATION_INTERVAL = AUTH_CONSTANTS.VERIFICATION_INTERVAL;
  const AUTH_CHECK = setInterval(() => {
    if (!sessionExpiredFlag) {
      verifyAuthState(true).catch(error => {
        console.warn('[Auth] Periodic verification error:', error);
      });
    }
  }, VERIFICATION_INTERVAL);

  window.addEventListener('focus', () => {
    if (!sessionExpiredFlag &&
      (!authState.lastVerified ||
        Date.now() - authState.lastVerified > 60000)) {
      setTimeout(() => {
        verifyAuthState(true).catch(error => {
          console.warn('[Auth] Focus verification error:', error);
        });
      }, 200);
    }
  });

  window.addEventListener('beforeunload', () => {
    clearInterval(AUTH_CHECK);
  });
}

// ---------------------------------------------------------------------
// Broadcast & UI Updates
// ---------------------------------------------------------------------
function broadcastAuth(authenticated, username = null) {
  authState.isAuthenticated = authenticated;
  authState.username = username;

  if (window.API_CONFIG) {
    window.API_CONFIG.isAuthenticated = authenticated;
  }

  document.dispatchEvent(new CustomEvent("authStateChanged", {
    detail: { authenticated, username }
  }));
  window.dispatchEvent(new CustomEvent("authStateChanged", {
    detail: { authenticated, username }
  }));

  updateAuthUI(authenticated, username);
}

function updateAuthUI(authenticated, username = null) {
  const userStatus = document.getElementById('userStatus');
  const authButton = document.getElementById('authButton');
  const userMenu = document.getElementById('userMenu');
  const authStatus = document.getElementById('authStatus');

  if (userStatus) {
    userStatus.textContent = authenticated ? (username || 'Online') : 'Offline';
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
async function loginUser(username, password) {
  try {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Starting login for user:', username);
    }

    const response = await apiRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password,
      ws_auth: true
    });

    if (AUTH_DEBUG) {
      console.debug('[Auth] Login response received', response);
    }
    if (!response.access_token) {
      throw new Error('No access token received');
    }

    if (response.token_version) {
      authState.tokenVersion = response.token_version;
    }

    // Set timestamp BEFORE updating auth state to ensure it's available for verification
    window.__recentLoginTimestamp = Date.now();
    window.__directAccessToken = response.access_token;
    
    // Force a much longer delay to ensure cookies are properly set before proceeding
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify cookies were actually set with retries
    let accessTokenCookie = null;
    let refreshTokenCookie = null;
    let cookieRetries = 5;
    
    while (cookieRetries-- > 0) {
      accessTokenCookie = getCookie('access_token');
      refreshTokenCookie = getCookie('refresh_token');
      
      if (accessTokenCookie && refreshTokenCookie) {
        break;
      }
      
      if (AUTH_DEBUG) {
        console.debug(`[Auth] Waiting for cookies after login, retries left: ${cookieRetries}`);
      }
      
      // Wait between retries
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (AUTH_DEBUG) {
      console.debug('[Auth] Post-login cookie check:', {
        accessToken: !!accessTokenCookie,
        refreshToken: !!refreshTokenCookie,
        retriesLeft: cookieRetries
      });
    }
    
    // If cookies still not set, use direct token as fallback
    if (!accessTokenCookie && response.access_token) {
      if (AUTH_DEBUG) {
        console.warn('[Auth] Cookies not set after login, using direct token as fallback');
      }
      // Store token in memory for this session
      window.__directAccessToken = response.access_token;
      window.__recentLoginTimestamp = Date.now();
    }
    
    // Update auth state
    authState.isAuthenticated = true;
    authState.username = response.username || username;
    authState.lastVerified = Date.now();
    sessionExpiredFlag = false;

    // Explicitly broadcast auth state AFTER all state is updated
    broadcastAuth(true, response.username || username);

    broadcastAuth(true, response.username || username);

    // If cookies still not set after retries, try to set them manually on the client side
    if (!accessTokenCookie && response.access_token) {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Attempting to set cookies manually on client side as fallback');
      }
      
      // Set cookies manually with maximum compatibility
      document.cookie = `access_token=${response.access_token}; path=/; max-age=${60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES}; SameSite=Lax`;
      
      if (response.refresh_token) {
        document.cookie = `refresh_token=${response.refresh_token}; path=/; max-age=${60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS}; SameSite=Lax`;
      }
    }
    
    if (AUTH_DEBUG) {
      console.debug('[Auth] Login successful, marking timestamp to prevent immediate refresh:', window.__recentLoginTimestamp);
    }

    return {
      ...response,
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
      const LOGOUT_TIMEOUT = 5000;
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
      // Continue client-side logout even if API fails
    }

    clearTokenState();
    notify("Logged out successfully", "success");

    // Redirect after logout
    window.location.href = '/index.html';
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    clearTokenState();
    window.location.href = '/';
  }
}

/**
 * Handle user registration (then auto-login)
 * @param {FormData} formData
 */
async function handleRegister(formData) {
  const username = formData.get("username");
  const password = formData.get("password");
  if (!username || !password) {
    notify("Please fill out all fields", "error");
    return;
  }

  if (password.length < 12) {
    notify("Password must be at least 12 characters", "error");
    return;
  }

  try {
    await apiRequest('/api/auth/register', 'POST', {
      username: username.trim(),
      password
    });

    const loginResult = await loginUser(username, password);
    authState.isAuthenticated = true;
    authState.username = username;
    authState.lastVerified = Date.now();
    sessionExpiredFlag = false;

    broadcastAuth(true, username);

    document.getElementById("registerForm")?.reset();
    notify("Registration successful", "success");
    return loginResult;
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
    authBtn.addEventListener("click", function(e) {
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
    loginTab.addEventListener("click", e => {
      e.preventDefault();
      switchForm(true);
    });
    registerTab.addEventListener("click", e => {
      e.preventDefault();
      switchForm(false);
    });
  }

  loginForm?.addEventListener("submit", async function(e) {
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
      authState.lastVerified = Date.now();
      authDropdown?.classList.add("hidden");
      authDropdown?.classList.remove("slide-in");
notify("Login successful", "success");

// Make sure the main panel is shown.
const projectManagerPanel = document.getElementById('projectManagerPanel');
if (projectManagerPanel) {
    projectManagerPanel.classList.remove('hidden');
}

// Redirect the user to the project list cards view.
if (window.projectManager && typeof window.projectManager.showProjectList === 'function') {
    window.projectManager.showProjectList();
} else {
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');
    if (projectListView) projectListView.classList.remove('hidden');
    if (projectDetailsView) projectDetailsView.classList.add('hidden');
}
window.history.pushState({}, '', '/?view=projectList');

if (window.sidebar?.updateAuthDependentUI) {
    window.sidebar.updateAuthDependentUI();
}

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
          results.forEach(r => {
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

  registerForm?.addEventListener("submit", async function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    await handleRegister(formData);
  });

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
// Expose to window
// ---------------------------------------------------------------------
window.auth = window.auth || {};

const standardizeErrorFn = window.auth.standardizeError || function(error, context) {
  let standardError = {
    status: error.status || 500,
    message: error.message || "Unknown error",
    context: context || "authentication",
    code: error.code || "UNKNOWN_ERROR",
    requiresLogin: false
  };

  if (error.status === 401 || error.message?.includes('expired') || error.message?.includes('Session')) {
    standardError.status = 401;
    standardError.message = "Your session has expired. Please log in again.";
    standardError.code = "SESSION_EXPIRED";
    standardError.requiresLogin = true;
  } else if (error.status === 403) {
    standardError.status = 403;
    standardError.message = "You don't have permission to access this resource.";
    standardError.code = "ACCESS_DENIED";
  }

  return standardError;
};

Object.assign(window.auth, {
  init,
  standardizeError: standardizeErrorFn,
  isAuthenticated: async function(options = {}) {
    const { forceVerify = false } = options;
    try {
      return await verifyAuthState(forceVerify);
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
  verifyAuthState,
  clear: clearTokenState,
  broadcastAuth,
  isInitialized: false,
  handleRegister
});

export default window.auth;

console.log("[Auth] Enhanced module loaded and exposed to window.auth");
