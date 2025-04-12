/**
 * Authentication module for handling user sessions, tokens, and auth state
 */
const AUTH_DEBUG = true;
let sessionExpiredFlag = false;
let tokenRefreshInProgress = false;
let lastRefreshAttempt = null;
let refreshFailCount = 0;
const MAX_REFRESH_RETRIES = 3;

const authState = {
  isAuthenticated: false,
  username: null,
  lastVerified: 0,
  tokenVersion: null
};

const AUTH_CONSTANTS = {
  VERIFICATION_INTERVAL: 5 * 60 * 1000,
  VERIFICATION_CACHE_DURATION: 60000,
  REFRESH_TIMEOUT: 10000,
  VERIFY_TIMEOUT: 5000,
  MAX_VERIFY_ATTEMPTS: 3,
  ACCESS_TOKEN_EXPIRE_MINUTES: 30,
  REFRESH_TOKEN_EXPIRE_DAYS: 1
};

async function getAuthToken(options = {}) {
  const accessToken = getCookie('access_token');
  const refreshToken = getCookie('refresh_token');
  if (await checkTokenValidity(accessToken)) return accessToken;
  if (refreshToken && (await checkTokenValidity(refreshToken, { allowRefresh: true }))) {
    const { success } = await refreshTokens();
    if (success) return getCookie('access_token');
  }
  throw new Error('Not authenticated');
}



async function refreshTokens() {
  const refreshStartTime = AUTH_DEBUG ? Date.now() : null;
  const refreshId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

  if (AUTH_DEBUG) {
    console.debug(`[Auth][${refreshId}] Token refresh initiated:`, {
      tokenRefreshInProgress: tokenRefreshInProgress,
      lastRefreshAttempt: lastRefreshAttempt ? new Date(lastRefreshAttempt).toISOString() : null,
      refreshCount: refreshFailCount,
      authState: {
        isAuthenticated: authState.isAuthenticated,
        lastVerified: authState.lastVerified ? new Date(authState.lastVerified).toISOString() : null
      },
      timestamp: new Date().toISOString()
    });
  }

  // Check if a refresh is already in progress
  if (tokenRefreshInProgress) {
    const now = Date.now();
    if (now - lastRefreshAttempt < 1000) {
      if (AUTH_DEBUG) console.debug(`[Auth][${refreshId}] Token refresh already in progress, returning existing promise (started ${now - lastRefreshAttempt}ms ago)`);
      return window.__tokenRefreshPromise;
    }
    if (AUTH_DEBUG) console.debug(`[Auth][${refreshId}] Previous refresh attempt timed out, allowing new attempt`);
  }

  // Check if we recently verified auth state (avoid excessive refreshes)
  const timeSinceLastVerified = Date.now() - authState.lastVerified;
  if (timeSinceLastVerified < 5000) {
    if (AUTH_DEBUG) console.debug(`[Auth][${refreshId}] Skipping refresh - recent auth verification detected (${timeSinceLastVerified}ms ago)`);
    return { success: true, version: authState.tokenVersion, token: getCookie('access_token') };
  }

  // Rate limiting for repeated refresh failures
  const now = Date.now();
  if (lastRefreshAttempt && now - lastRefreshAttempt < 30000 && refreshFailCount >= MAX_REFRESH_RETRIES) {
    const errorMsg = 'Too many refresh attempts - please check your connection';
    if (AUTH_DEBUG) {
      console.warn(`[Auth][${refreshId}] Rate limiting token refresh:`, {
        timeSinceLastAttempt: now - lastRefreshAttempt,
        failCount: refreshFailCount,
        maxRetries: MAX_REFRESH_RETRIES
      });
    }
    return Promise.reject(new Error(errorMsg));
  }

  // Begin refresh process
  tokenRefreshInProgress = true;
  lastRefreshAttempt = Date.now();

  if (AUTH_DEBUG) console.debug(`[Auth][${refreshId}] Starting token refresh operation`);

  window.__tokenRefreshPromise = new Promise(async (resolve, reject) => {
    try {
      // Validate refresh token
      const currentToken = getCookie('refresh_token');

      if (AUTH_DEBUG) {
        console.debug(`[Auth][${refreshId}] Validating refresh token:`, {
          hasRefreshToken: !!currentToken,
          cookieLength: currentToken?.length || 0
        });
      }

      if (!currentToken) {
        throw new Error('No refresh token available');
      }

      // Check token expiration
      const expiry = getTokenExpiry(currentToken);
      if (AUTH_DEBUG && expiry) {
        console.debug(`[Auth][${refreshId}] Token expiry check:`, {
          expiryTime: new Date(expiry).toISOString(),
          currentTime: new Date().toISOString(),
          isExpired: expiry < Date.now(),
          timeRemaining: expiry - Date.now()
        });
      }

      if (expiry && expiry < Date.now()) {
        throw new Error('Refresh token already expired');
      }
      // Try multiple refresh attempts with exponential backoff
      let lastError, response;
      for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt++) {
        try {
          if (AUTH_DEBUG) {
            console.debug(`[Auth][${refreshId}] Refresh attempt ${attempt}/${MAX_REFRESH_RETRIES}`, {
              timestamp: new Date().toISOString(),
              timeout: AUTH_CONSTANTS.REFRESH_TIMEOUT * Math.pow(2, attempt - 1)
            });
          }

          // Attach an AbortController to the refresh request for real cancellation
          const controller = new AbortController();
          const timeoutMs = AUTH_CONSTANTS.REFRESH_TIMEOUT * Math.pow(2, attempt - 1);

          // Create fetch promise with the abort signal
          const fetchPromise = apiRequest('/api/auth/refresh', 'POST', null, { signal: controller.signal });

          // Also set a timer to abort after timeoutMs
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, timeoutMs);

          // Race fetch against automatic abort
          const attemptStartTime = Date.now();
          response = await fetchPromise.catch(err => {
            if (err.name === 'AbortError') {
              throw new Error(`Token refresh timeout (${timeoutMs}ms)`);
            }
            throw err;
          });

          // Cleanup the timer once we have a result
          clearTimeout(timeoutId);

          const attemptDuration = Date.now() - attemptStartTime;

          if (AUTH_DEBUG) {
            console.debug(`[Auth][${refreshId}] Refresh attempt ${attempt} response received in ${attemptDuration}ms`);
          }

          // Validate response
          if (!response?.access_token) {
            if (AUTH_DEBUG) {
              console.warn(`[Auth][${refreshId}] Invalid refresh response:`, response);
            }
            throw new Error('Invalid refresh response - missing access token');
          }

          // Update token version if provided
          if (response.token_version) {
            authState.tokenVersion = response.token_version;
            if (AUTH_DEBUG) {
              console.debug(`[Auth][${refreshId}] Token version updated to: ${response.token_version}`);
            }
          }

          // Success - exit retry loop
          break;
        } catch (err) {
          lastError = err;
          if (AUTH_DEBUG) {
            console.warn(`[Auth][${refreshId}] Refresh attempt ${attempt} failed:`, {
              error: err.message,
              status: err.status,
              timestamp: new Date().toISOString()
            });
          }

          // Apply backoff delay before next attempt
          if (attempt < MAX_REFRESH_RETRIES) {
            const delay = 300 * Math.pow(2, attempt - 1);
            if (AUTH_DEBUG) {
              console.debug(`[Auth][${refreshId}] Retrying after backoff delay of ${delay}ms`);
            }
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      // If all attempts failed, throw the last error
      if (lastError && !response?.access_token) {
        throw lastError;
      }

      // Success - reset failure count and update state
      refreshFailCount = 0;
      authState.lastVerified = Date.now();

      if (AUTH_DEBUG) {
        const totalDuration = Date.now() - refreshStartTime;
        console.debug(`[Auth][${refreshId}] Token refresh successful:`, {
          duration: totalDuration,
          newTokenPresent: !!response.access_token,
          timestamp: new Date().toISOString()
        });
      }

      // Notify listeners of successful refresh
      document.dispatchEvent(new CustomEvent('tokenRefreshed', {
        detail: {
          success: true,
          duration: Date.now() - refreshStartTime
        }
      }));

      // Store token version in cookie if provided
      if (response.token_version) {
        document.cookie = `token_version=${response.token_version}; path=/; ${
          location.protocol === 'https:' ? 'Secure; ' : ''
        }SameSite=Strict`;
      }

      // Resolve promise with success
      resolve({
        success: true,
        version: response.token_version || authState.tokenVersion,
        token: response.access_token
      });
    } catch (err) {
      refreshFailCount++;

      const totalDuration = Date.now() - refreshStartTime;
      let errorMessage = "Token refresh failed";
      let forceLogout = false;

      // Classify error type and determine appropriate action
      if (err.status === 401) {
        errorMessage = "Your session has expired. Please log in again.";
        forceLogout = true;
      } else if (err.message?.includes('version mismatch')) {
        errorMessage = "Session invalidated due to token version mismatch - please login again";
        forceLogout = true;
      } else if (err.message?.includes('revoked')) {
        errorMessage = "Your session has been revoked - please login again";
        forceLogout = true;
      } else if (err.message?.includes('expired')) {
        errorMessage = "Token has expired - please login again";
        forceLogout = true;
      } else if (err.message?.includes('timeout')) {
        errorMessage = "Token refresh timed out - please try again";
      } else if (err.message?.includes('NetworkError') || err.message?.includes('Failed to fetch')) {
        errorMessage = "Network error during token refresh - please check your connection";
      }

      if (AUTH_DEBUG) {
        console.error(`[Auth][${refreshId}] Token refresh failed:`, {
          message: errorMessage,
          originalError: err.message,
          status: err.status,
          duration: totalDuration,
          attemptCount: refreshFailCount,
          maxRetries: MAX_REFRESH_RETRIES,
          forceLogout: forceLogout,
          timestamp: new Date().toISOString(),
          stack: err.stack
        });
      }

      // If error requires logout, clear auth state
      if (forceLogout) {
        if (AUTH_DEBUG) console.debug(`[Auth][${refreshId}] Error requires logout, clearing auth state`);
        clearTokenState();
        broadcastAuth(false);
        setTimeout(() => logout(), 300);
      }

      // Notify listeners of refresh failure
      document.dispatchEvent(new CustomEvent('tokenRefreshed', {
        detail: {
          success: false,
          error: err,
          message: errorMessage,
          attempts: refreshFailCount,
          duration: totalDuration
        }
      }));

      reject(new Error(errorMessage));
    } finally {
      tokenRefreshInProgress = false;

      if (AUTH_DEBUG) {
        const totalDuration = Date.now() - refreshStartTime;
        console.debug(`[Auth][${refreshId}] Token refresh operation completed in ${totalDuration}ms`);
      }
    }
  });

  return window.__tokenRefreshPromise;
} // End refreshTokens

function getTokenExpiry(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000;
  } catch (e) {
    console.warn('[Auth] Error extracting token expiry:', e);
    return null;
  }
}

async function isTokenExpired(token) {
  if (!token) return true;
  const expiry = getTokenExpiry(token);
  if (!expiry) return true;

  let serverTime;
  try {
    const { serverTimestamp } = await apiRequest('/api/auth/timestamp', 'GET');
    serverTime = serverTimestamp * 1000;
  } catch {
    serverTime = Date.now();
  }
  return expiry < (serverTime - 10000);
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}
let __cachedExpirySettings = null;

async function fetchTokenExpirySettings() {
  if (__cachedExpirySettings) {
    return __cachedExpirySettings;
  }

  // Provide a direct fallback instead of making API request
  const fallback = {
    access_token_expire_minutes: 30,
    refresh_token_expire_days: 7
  };

  __cachedExpirySettings = fallback;
  return fallback;
}

async function checkTokenValidity(token, { allowRefresh = false } = {}) {
  if (!token) {
    if (AUTH_DEBUG) console.debug('[Auth] Token validity check failed: No token provided');
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
    if (!isValid && AUTH_DEBUG) console.debug(`[Auth] Token expired by age check: age=${tokenAge}s, max=${maxAge}s`);
    return isValid;
  } catch (err) {
    console.warn('[Auth] Token validity check error:', err);
    return false;
  }
}

function clearTokenState() {
  authState.isAuthenticated = false;
  authState.username = null;
  authState.lastVerified = 0;
  sessionExpiredFlag = Date.now();
  refreshFailCount = 0;
  broadcastAuth(false);
  if (AUTH_DEBUG) console.debug('[Auth] Auth state cleared');
}

async function authRequest(endpoint, method, body = null) {
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const requestContext = {
    endpoint,
    method,
    requestId,
    timestamp: Date.now()
  };

  try {
    if (AUTH_DEBUG) {
      console.debug(`[Auth][${requestId}] Request initiated:`, {
        endpoint,
        method,
        hasBody: !!body
      });
    }

    // Check for CSRF token if needed for this endpoint
    let headers = { 'Content-Type': 'application/json' };
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (csrfToken && (method !== 'GET')) {
      headers['X-CSRF-Token'] = csrfToken;
      if (AUTH_DEBUG) {
        console.debug(`[Auth][${requestId}] Adding CSRF token to request`);
      }
    }

    const response = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));

      // Log validation issues specifically for form token issues
      if (error.message?.includes('token') || error.message?.includes('validation') ||
          error.message?.includes('CSRF') || response.status === 403) {
        logFormIssue('CSRF_VALIDATION_ISSUE', {
          requestId,
          endpoint,
          status: response.status,
          message: error.message || 'Validation error',
          timestamp: Date.now(),
          duration: Date.now() - requestContext.timestamp
        });
      }

      throw new Error(error.message || 'Authentication failed');
    }

    if (AUTH_DEBUG) {
      console.debug(`[Auth][${requestId}] Request completed successfully:`, {
        endpoint,
        status: response.status,
        duration: Date.now() - requestContext.timestamp
      });
    }

    return response.json();
  } catch (error) {
    // Enhance error with request context
    const enhancedError = {
      ...error,
      requestId,
      endpoint,
      timestamp: new Date().toISOString()
    };

    console.error(`[Auth][${requestId}] Request to ${endpoint} failed:`, enhancedError);

    // Log network or connectivity issues
    if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
      logFormIssue('NETWORK_ERROR', {
        requestId,
        endpoint,
        message: error.message,
        timestamp: Date.now(),
        duration: Date.now() - requestContext.timestamp
      });
    }

    throw error;
  }
}

async function apiRequest(url, method, data = null, options = {}) {
  if (window.apiRequest) return window.apiRequest(url, method, data, options);
  return authRequest(url, method, data);
}

async function init() {
  if (window.__authInitializing) {
    return new Promise(resolve => {
      const checkInit = () => {
        if (window.auth.isInitialized) resolve(true);
        else setTimeout(checkInit, 50);
      };
      checkInit();
    });
  }
  window.__authInitializing = true;
  if (window.auth.isInitialized) {
    window.__authInitializing = false;
    return true;
  }
  if (window.API_CONFIG) window.API_CONFIG.authCheckInProgress = true;
  try {
    if (AUTH_DEBUG) console.debug("[Auth] Starting initialization");

    // First try to restore tokens from sessionStorage
    let restoredFromStorage = false;
    try {
      const token = sessionStorage.getItem('_auth_token_backup');
      const refresh = sessionStorage.getItem('_auth_refresh_backup');
      const timestamp = sessionStorage.getItem('_auth_timestamp');
      const username = sessionStorage.getItem('_auth_username');

      if (token && timestamp) {
        window.__directAccessToken = token;
        window.__directRefreshToken = refresh || null;
        window.__recentLoginTimestamp = parseInt(timestamp, 10) || Date.now();
        window.__lastUsername = username || null;

        // Ensure tokens are immediately available as cookies
        document.cookie = `access_token=${token}; path=/; max-age=${60 * 30}; SameSite=Lax`;
        if (refresh) {
          document.cookie = `refresh_token=${refresh}; path=/; max-age=${60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS}; SameSite=Lax`;
        }

        // Mark as authenticated immediately based on storage
        authState.isAuthenticated = true;
        authState.username = username;
        authState.lastVerified = Date.now();

        if (AUTH_DEBUG) console.debug('[Auth] Successfully restored auth state from sessionStorage');
        restoredFromStorage = true;

        // Broadcast authentication state
        broadcastAuth(true, username);
      }
    } catch (e) {
      console.warn('[Auth] Failed to restore auth from sessionStorage:', e);
    }

    setupUIListeners();
    setupTokenSync();

    // Setup auth monitoring regardless of current state
    setupAuthStateMonitoring();

    // Only do a full verification if we haven't restored from storage
    if (!restoredFromStorage) {
      await new Promise(r => setTimeout(r, 600));

      try {
        // Use non-forcing verification to avoid unnecessary server calls
        const isAuthenticated = await verifyAuthState(false);
        if (!isAuthenticated) broadcastAuth(false);
      } catch (verifyError) {
        console.warn('[Auth] Initial verification error (non-critical):', verifyError);
        // Don't necessarily broadcast false here, let the monitoring handle it
      }
    }

    window.auth.isInitialized = true;
    console.log("[Auth] Module initialized successfully");
    return true;
  } catch (error) {
    console.error("[Auth] Initialization failed:", error);
    // Only broadcast false if we're not already authenticated from storage
    if (!authState.isAuthenticated) {
      broadcastAuth(false);
    }
    return false;
  } finally {
    if (window.API_CONFIG) window.API_CONFIG.authCheckInProgress = false;
    window.__authInitializing = false;
  }
}

async function verifyAuthState(bypassCache = false) {
  try {
    if (sessionExpiredFlag && Date.now() - sessionExpiredFlag < 10000) {
      if (AUTH_DEBUG) console.debug('[Auth] Skipping verification - session recently expired');
      return false;
    }
    if (sessionExpiredFlag && Date.now() - sessionExpiredFlag >= 10000) {
      sessionExpiredFlag = false;
    }

    // Check for direct token from previous login that can be reused
    if (window.__directAccessToken && window.__recentLoginTimestamp) {
      const tokenAge = Date.now() - window.__recentLoginTimestamp;
      // If we have a direct token and it's recent (less than 20 minutes old)
      if (tokenAge < 1000 * 60 * 20) {
        if (AUTH_DEBUG) console.debug('[Auth] Using direct token from memory that is still valid');

        // Ensure the token is also set as a cookie
        const existingCookie = getCookie('access_token');
        if (!existingCookie) {
          if (AUTH_DEBUG) console.debug('[Auth] Setting access_token cookie from memory');

          // Set max-age to 25 minutes (longer than the check interval)
          const maxAge = 60 * 25; // 25 minutes in seconds
          document.cookie = `access_token=${window.__directAccessToken}; path=/; max-age=${maxAge}; SameSite=Lax`;

          // If we also have a refresh token, set it as well
          if (window.__directRefreshToken) {
            document.cookie = `refresh_token=${window.__directRefreshToken}; path=/; max-age=${60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS}; SameSite=Lax`;
          }
        }

        // Update auth state
        authState.isAuthenticated = true;
        if (window.__lastUsername) authState.username = window.__lastUsername;
        authState.lastVerified = Date.now();
        broadcastAuth(true, authState.username);
        return true;
      }
    }

    // Use cache if available and not bypassing
    if (
      !bypassCache &&
      authState.lastVerified &&
      Date.now() - authState.lastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION
    ) {
      if (AUTH_DEBUG) console.debug('[Auth] Using cached verification result:', authState.isAuthenticated);
      return authState.isAuthenticated;
    }

    // Look for cookies - check both standard and fallback cookies
    let accessToken = getCookie('access_token') || getCookie('access_token_fallback');
    let refreshToken = getCookie('refresh_token') || getCookie('refresh_token_fallback');

    // If no cookies found, but we have the tokens in memory, restore them
    if (!accessToken && window.__directAccessToken) {
      if (AUTH_DEBUG) console.debug('[Auth] No access_token cookie found but using direct token from memory');
      const maxAge = 60 * 25; // 25 minutes
      document.cookie = `access_token=${window.__directAccessToken}; path=/; max-age=${maxAge}; SameSite=Lax`;

      // Try to get the cookie again
      accessToken = window.__directAccessToken;

      // If we also have a refresh token in memory, set that too
      if (!refreshToken && window.__directRefreshToken) {
        document.cookie = `refresh_token=${window.__directRefreshToken}; path=/; max-age=${60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS}; SameSite=Lax`;
        refreshToken = window.__directRefreshToken;
      }
    }

    // No tokens available at all - not authenticated
    if (!accessToken && !refreshToken) {
      if (AUTH_DEBUG) console.debug('[Auth] No tokens found - user is not authenticated');
      broadcastAuth(false);
      return false;
    }

    // If access token is expired but we have a refresh token, try refreshing
    if ((!accessToken || (await isTokenExpired(accessToken))) && refreshToken) {
      try {
        if (AUTH_DEBUG) console.debug('[Auth] Access token expired or missing, attempting refresh with refresh token');
        const refreshResult = await refreshTokens();

        if (refreshResult.success) {
          if (AUTH_DEBUG) console.debug('[Auth] Token refresh successful');

          // Store the new token in memory for future use
          window.__directAccessToken = refreshResult.token;
          window.__recentLoginTimestamp = Date.now();

          // Update auth state
          authState.isAuthenticated = true;
          authState.lastVerified = Date.now();
          broadcastAuth(true);
          return true;
        } else {
          throw new Error('Token refresh failed');
        }
      } catch (refreshError) {
        console.error('[Auth] Token refresh failed:', refreshError);
        clearTokenState();
        broadcastAuth(false);
        return false;
      }
    }
    const MAX_VERIFY = AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_VERIFY; attempt++) {
      try {
        const VERIFY_TIMEOUT = AUTH_CONSTANTS.VERIFY_TIMEOUT + attempt * 1000;
        if (AUTH_DEBUG) console.debug(`[Auth] Verification attempt ${attempt}/${MAX_VERIFY} with timeout ${VERIFY_TIMEOUT}ms`);
        const response = await Promise.race([
          apiRequest('/api/auth/verify', 'GET'),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Auth verification timeout (attempt ${attempt})`)), VERIFY_TIMEOUT))
        ]);
        console.debug('[Auth] Verification successful:', response);
        authState.isAuthenticated = response.authenticated;
        authState.username = response.username || null;
        authState.lastVerified = Date.now();
        if (response.authenticated) broadcastAuth(true, response.username);
        else broadcastAuth(false);
        return response.authenticated;
      } catch (verifyError) {
        lastError = verifyError;
        console.warn(`[Auth] Verification attempt ${attempt} failed:`, verifyError);
        if (verifyError.status === 401) {
          sessionExpiredFlag = Date.now();
          clearTokenState();
          if (window.showSessionExpiredModal) window.showSessionExpiredModal();
          throw new Error('Session expired. Please login again.');
        }
        if (attempt < MAX_VERIFY) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }
    console.error('[Auth] All verification attempts failed. Access token present:', !!getCookie('access_token'), 'Refresh token present:', !!getCookie('refresh_token'));
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

function setupTokenSync() {
  // Empty function - placeholder for future implementation
}

function setupAuthStateMonitoring() {
  // Don't force verification on initial page load - rely more on in-memory state
  setTimeout(() => {
    verifyAuthState(false).then(isAuthenticated => {
      broadcastAuth(isAuthenticated);
    }).catch(error => {
      console.error('[Auth] Initial verification error:', error);
      // Don't broadcast false if we've already set a memory token
      if (!window.__directAccessToken) {
        broadcastAuth(false);
      }
    });
  }, 300);

  // Use a longer interval for periodic checks
  // Extend the verification interval further to reduce server load
  const VERIFICATION_INTERVAL = AUTH_CONSTANTS.VERIFICATION_INTERVAL * 3; // Triple the normal interval
  const AUTH_CHECK = setInterval(() => {
    if (!sessionExpiredFlag) {
      // Use non-forced verification to avoid excessive server calls
      verifyAuthState(false).catch(error => {
        console.warn('[Auth] Periodic verification error:', error);
        // Only clear auth if it's a clear 401 unauthorized response
        if (error.status === 401) {
          clearTokenState();
        }
      });
    }
  }, VERIFICATION_INTERVAL);

  // Be very selective about focus verification - don't trigger it unnecessarily
  window.addEventListener('focus', () => {
    // Only verify on focus if it's been a very long time since last verification
    if (!sessionExpiredFlag &&
        !window.__verifyingOnFocus &&
        (!authState.lastVerified || Date.now() - authState.lastVerified > 300000)) { // 5 minutes
      window.__verifyingOnFocus = true;
      setTimeout(() => {
        verifyAuthState(false).catch(error => {
          console.warn('[Auth] Focus verification error:', error);
        }).finally(() => {
          window.__verifyingOnFocus = false;
        });
      }, 1000); // Longer delay to avoid race conditions
    }
  });

  // Add a special handler for page refresh to ensure tokens are preserved
  // Store tokens in sessionStorage as an additional backup
  const storeTokenBackup = () => {
    if (window.__directAccessToken) {
      try {
        // We're storing tokens in sessionStorage as a backup - they won't persist across browser restarts
        // but will persist across page refreshes
        sessionStorage.setItem('_auth_token_backup', window.__directAccessToken);
        sessionStorage.setItem('_auth_refresh_backup', window.__directRefreshToken || '');
        sessionStorage.setItem('_auth_timestamp', window.__recentLoginTimestamp?.toString() || '');
        sessionStorage.setItem('_auth_username', window.__lastUsername || '');
      } catch (e) {
        console.warn('[Auth] Failed to backup tokens to sessionStorage:', e);
      }
    }
  };

  // Restore tokens from sessionStorage if they exist - reuses logic from init()
  const restoreTokenBackup = () => {
    try {
      const token = sessionStorage.getItem('_auth_token_backup');
      if (token && sessionStorage.getItem('_auth_timestamp')) {
        return true;
      }
    } catch (e) {
      console.warn('[Auth] Failed to restore tokens from sessionStorage:', e);
    }
    return false;
  };

  // Try to restore tokens from backup if they exist
  if (!window.__directAccessToken) {
    const restored = restoreTokenBackup();
    if (restored && window.__directAccessToken) {
      if (AUTH_DEBUG) console.debug('[Auth] Using restored tokens from sessionStorage');
    }
  }

  // Keep the tokens backed up
  window.setInterval(storeTokenBackup, 30000);

  // Backup tokens before unload
  window.addEventListener('beforeunload', () => {
    storeTokenBackup();
    clearInterval(AUTH_CHECK);
  });
}

function broadcastAuth(authenticated, username = null) {
  authState.isAuthenticated = authenticated;
  authState.username = username;
  if (window.API_CONFIG) window.API_CONFIG.isAuthenticated = authenticated;
  document.dispatchEvent(new CustomEvent("authStateChanged", { detail: { authenticated, username } }));
  window.dispatchEvent(new CustomEvent("authStateChanged", { detail: { authenticated, username } }));
  updateAuthUI(authenticated, username);
}

function updateAuthUI(authenticated, username = null) {
  if (AUTH_DEBUG) {
    console.debug("[Auth] Updating UI with authentication state:", {
      authenticated: authenticated,
      username: username,
      timestamp: new Date().toISOString()
    });
  }

  const userStatus = document.getElementById('userStatus');
  const authButton = document.getElementById('authButton');
  const userMenu = document.getElementById('userMenu');
  const authStatus = document.getElementById('authStatus');

  // Track UI elements found/missing for debugging
  const elementsFound = {
    userStatus: !!userStatus,
    authButton: !!authButton,
    userMenu: !!userMenu,
    authStatus: !!authStatus
  };

  // Check if any UI elements are missing and log once
  if (AUTH_DEBUG && (!userStatus || !authButton || !userMenu || !authStatus)) {
    console.debug("[Auth] Some UI elements not found:", elementsFound);
  }

  // Update user status text and classes
  if (userStatus) {
    const newText = authenticated ? (username || 'Online') : 'Offline';
    userStatus.textContent = newText;
    userStatus.classList.toggle('text-green-600', authenticated);
    userStatus.classList.toggle('text-gray-600', !authenticated);
  }

  if (authButton && userMenu) {
    const authButtonWasHidden = authButton.classList.contains('hidden');
    const userMenuWasHidden = userMenu.classList.contains('hidden');

    authButton.classList.toggle('hidden', authenticated);
    userMenu.classList.toggle('hidden', !authenticated);

    if (AUTH_DEBUG) {
      if (authButtonWasHidden !== authenticated) {
        console.debug(`[Auth] Auth button visibility changed: ${authButtonWasHidden ? 'hidden' : 'visible'} → ${authenticated ? 'hidden' : 'visible'}`);
      }
      if (userMenuWasHidden === !authenticated) {
        console.debug(`[Auth] User menu visibility changed: ${userMenuWasHidden ? 'hidden' : 'visible'} → ${!authenticated ? 'hidden' : 'visible'}`);
      }
    }
  }

  if (authStatus) {
    const oldStatus = authStatus.textContent;
    const newStatus = authenticated ? 'Authenticated' : 'Not Authenticated';
    authStatus.textContent = newStatus;
    authStatus.classList.toggle('text-green-600', authenticated);
    authStatus.classList.toggle('text-red-600', !authenticated);

    if (AUTH_DEBUG && oldStatus !== newStatus) {
      console.debug(`[Auth] Auth status text changed: "${oldStatus}" → "${newStatus}"`);
    }
  }

  if (AUTH_DEBUG) {
    console.debug("[Auth] UI update completed");
  }
}

/**
 * Logs form submission issues with appropriate security measures
 * @param {string} type - The type/category of issue
 * @param {Object} details - Details about the issue (will be sanitized)
 */
function logFormIssue(type, details) {
  const safeDetails = {
    ...details,
    password: details.password ? '[REDACTED]' : undefined,
    token: details.token ? `${details.token.substring(0,5)}...` : undefined,
    ip: window.clientIP || 'unknown',
    timestamp: details.timestamp || Date.now()
  };

  console.groupCollapsed(`[Auth] ${type}`);
  console.table(safeDetails);
  console.trace('Submission trace');
  console.groupEnd();

  // Server-side logging for critical issues
  if (type.includes('SECURITY') || type === 'RATE_LIMIT' || type === 'AUTHENTICATION_FAILURE') {
    if (window.telemetry?.logSecurityEvent) {
      window.telemetry.logSecurityEvent(type, safeDetails);
    }
  }
}

function notify(message, type = "info") {
  if (window.showNotification) {
    window.showNotification(message, type);
    return;
  }

  const notifyFn = window.Notifications &&
    (type === 'error' ? window.Notifications.apiError :
     type === 'success' ? window.Notifications.apiSuccess : null);

  if (notifyFn) {
    notifyFn(message);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

async function loginUser(username, password) {
  // Prevent any ongoing login attempts from blocking a new one
  if (window.__loginInProgress) {
    console.warn('[Auth] Cancelling previous login attempt');
    if (window.__loginAbortController) {
      try {
        window.__loginAbortController.abort();
      } catch (e) {
        console.error('[Auth] Error aborting previous login:', e);
      }
    }
  }

  // Create new abort controller for this login attempt
  const loginId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  window.__loginAbortController = new AbortController();
  window.__loginInProgress = true;

  // Create log context for this login attempt
  const loginLogContext = {
    username: username?.trim(),
    timestamp: Date.now(),
    loginId: loginId,
    hasUsername: !!username?.trim(),
    hasPassword: !!password,
    userAgent: navigator.userAgent?.substring(0, 100) // Truncate user agent for readability
  };

  // Setup a safety timeout to avoid freezing
  const loginTimeout = setTimeout(() => {
    logFormIssue('LOGIN_TIMEOUT', {
      ...loginLogContext,
      duration: Date.now() - loginLogContext.timestamp,
      message: 'Login safety timeout exceeded'
    });

    if (window.__loginAbortController) {
      window.__loginAbortController.abort();
    }
    window.__loginInProgress = false;
    throw new Error('Login request timed out. Please try again.');
  }, 15000);

  try {
    if (AUTH_DEBUG) {
      console.debug("[Auth] Attempting login for user:", username.trim());
      console.debug("[Auth] Input validation:", {
        usernameLength: username?.trim()?.length || 0,
        passwordProvided: !!password,
        timestamp: new Date().toISOString()
      });
    }

    // Request login token from server
    if (AUTH_DEBUG) console.debug('[Auth] Sending login request to server...');
    const requestStartTime = Date.now();

    const response = await apiRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password,
    });

    if (AUTH_DEBUG) {
      const requestDuration = Date.now() - requestStartTime;
      console.debug(`[Auth] Login API response received in ${requestDuration}ms`);
      console.debug("[Auth] Response structure:", {
        hasAccessToken: !!response.access_token,
        hasRefreshToken: !!response.refresh_token,
        hasUsername: !!response.username,
        tokenVersion: response.token_version || 'not provided'
      });
    }

    if (!response.access_token) {
      console.error("[Auth] No access token received. Server response:", response);
      throw new Error('No access token received');
    }
    if (response.token_version) authState.tokenVersion = response.token_version;

    // Store tokens in memory immediately
    window.__recentLoginTimestamp = Date.now();
    window.__directAccessToken = response.access_token;
    window.__directRefreshToken = response.refresh_token;
    window.__lastUsername = username;

    if (AUTH_DEBUG) console.debug('[Auth] Tokens stored in memory successfully');

    // Show loading state before expensive operations
    document.dispatchEvent(new CustomEvent('authLoading', { detail: true }));

    // Move storage operations to microtasks to prevent blocking
    await new Promise(resolve => {
      setTimeout(() => {
        try {
          // Set cookies in a way that minimizes layout thrashing
          requestAnimationFrame(() => {
            const hostname = window.location.hostname;
            const isSecure = (window.location.protocol === 'https:');
            const sameSite = isSecure ? 'None' : 'Lax';
            const secureFlag = isSecure ? 'Secure; ' : '';

            document.cookie = `access_token=${response.access_token}; path=/; max-age=${60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES}; ${secureFlag}SameSite=${sameSite}`;
            if (response.refresh_token) {
              document.cookie = `refresh_token=${response.refresh_token}; path=/; max-age=${60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS}; ${secureFlag}SameSite=${sameSite}`;
            }

            // Batch state updates
            requestAnimationFrame(() => {
              authState.isAuthenticated = true;
              authState.username = response.username || username;
              authState.lastVerified = Date.now();
              sessionExpiredFlag = false;

              // Throttle the broadcast
              setTimeout(() => {
                broadcastAuth(true, response.username || username);
                resolve();
              }, 50);
            });
          });
        } catch (e) {
          console.warn('[Auth] Storage operations failed:', e);
          resolve();
        }
      }, 0);
    });

    // Backup tokens in idle time
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        try {
          sessionStorage.setItem('_auth_token_backup', response.access_token);
          if (response.refresh_token) {
            sessionStorage.setItem('_auth_refresh_backup', response.refresh_token);
          }
          sessionStorage.setItem('_auth_timestamp', Date.now().toString());
          sessionStorage.setItem('_auth_username', username);
        } catch (e) {
          console.warn('[Auth] Failed to backup tokens:', e);
        }
      });
    }

    // Let the redirect handle loading the project list
    return {
      ...response,
      success: true
    };
  } catch (error) {
    console.error("[Auth] Login request failed:", error);

    // Enhanced error logging
    const standardError = window.auth.standardizeError(error, 'login_api');

    logFormIssue(
      error.status === 401 ? 'AUTHENTICATION_FAILURE' :
      error.status === 429 ? 'RATE_LIMIT' :
      error.message?.includes('Network') ? 'NETWORK_ERROR' : 'LOGIN_ERROR',
      {
        ...loginLogContext,
        status: error.status,
        message: error.message,
        code: standardError.code,
        duration: Date.now() - loginLogContext.timestamp,
        networkError: error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')
      }
    );

    let message = "Login failed";
    if (error.status === 401) message = "Invalid username or password";
    else if (error.status === 429) message = "Too many attempts. Please try again later.";
    else if (error.message && error.message !== "Login request timed out. Please try again.") {
      message = error.message;
    }
    throw new Error(message);
  } finally {
    // Always clean up regardless of outcome
    clearTimeout(loginTimeout);
    window.__loginInProgress = false;
    window.__loginAbortController = null;
  }
}

async function logout(e) {
  e?.preventDefault();
  try {
    if (AUTH_DEBUG) console.debug('[Auth] Starting logout process');
    try {
      const LOGOUT_TIMEOUT = 5000;
      const logoutPromise = apiRequest('/api/auth/logout', 'POST');
      await Promise.race([
        logoutPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Logout request timed out')), LOGOUT_TIMEOUT))
      ]);
      if (AUTH_DEBUG) console.debug('[Auth] Server-side logout successful');
    } catch (apiErr) {
      console.warn("[Auth] Logout API error:", apiErr);
    }
    clearTokenState();
    notify("Logged out successfully", "success");
    window.location.href = '/index.html';
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    clearTokenState();
    window.location.href = '/';
  }
}

async function handleRegister(formData) {
  const username = formData.get("username");
  const password = formData.get("password");

  // Create logging context
  const registerContext = {
    username: username,
    timestamp: Date.now(),
    userAgent: navigator.userAgent,
    operationType: 'registration'
  };

  if (!username || !password) {
    logFormIssue('REGISTER_VALIDATION_ERROR', {
      ...registerContext,
      missingFields: !username ? 'username' : 'password'
    });
    notify("Please fill out all fields", "error");
    return;
  }

  if (password.length < 12) {
    logFormIssue('REGISTER_PASSWORD_POLICY', {
      ...registerContext,
      passwordLength: password.length,
      policyViolation: 'minimum_length'
    });
    notify("Password must be at least 12 characters", "error");
    return;
  }

  try {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Making registration API request', {
        ...registerContext,
        validationPassed: true
      });
    }

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

    if (AUTH_DEBUG) {
      console.debug('[Auth] Registration and auto-login successful', {
        ...registerContext,
        duration: Date.now() - registerContext.timestamp
      });
    }

    notify("Registration successful", "success");
    return loginResult;
  } catch (error) {
    const standardError = window.auth.standardizeError(error, 'registration');

    logFormIssue('REGISTER_API_ERROR', {
      ...registerContext,
      status: error.status,
      message: error.message,
      code: standardError.code,
      duration: Date.now() - registerContext.timestamp
    });

    notify(error.message || "Registration failed", "error");
    throw error;
  }
}

function setupUIListeners() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");
  if (authBtn && authDropdown) {
    authBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (authDropdown.classList.contains("hidden")) {
        authDropdown.classList.remove("hidden");
        setTimeout(() => authDropdown.classList.add("animate-slide-in"), 10);
      } else {
        setTimeout(() => authDropdown.classList.add("hidden"), 200);
      }
      document.querySelectorAll('.dropdown-content').forEach(dd => {
        if (dd !== authDropdown && !dd.classList.contains('hidden')) {
          dd.classList.add("hidden");
          dd.classList.remove("slide-in");
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
    const formData = new FormData(e.target);

    // Create logging context with safe user information
    const logContext = {
      username: formData.get("username"),
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      formId: 'loginForm',
      requestId: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    };

    // Get submit button state
    const submitBtn = this.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<svg class="animate-spin h-4 w-4 mx-auto text-white" viewBox="0 0 24 24">...</svg>`;

    // Validate input fields
    if (!formData.get("username") || !formData.get("password")) {
      logFormIssue('EMPTY_CREDENTIALS', logContext);
      notify("Username and password are required", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }

    if (AUTH_DEBUG) {
      console.debug('[Auth] Form submission started', {
        ...logContext,
        inputValid: true
      });
    }

    // Set a safety timeout to re-enable the form if something goes wrong
    const safetyTimeout = setTimeout(() => {
      logFormIssue('TIMEOUT', {
        ...logContext,
        duration: Date.now() - logContext.timestamp,
        message: "Login request timed out - no response received"
      });
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }, 10000);  // 10 second safety timeout

    try {
      if (window.__loginInProgress) {
        logFormIssue('CONCURRENT_LOGIN', {
          ...logContext,
          message: "Another login attempt already in progress"
        });
      }

      // First authenticate the user without any UI updates
      await loginUser(formData.get("username"), formData.get("password"));

      if (AUTH_DEBUG) {
        console.debug('[Auth] Login successful', {
          ...logContext,
          duration: Date.now() - logContext.timestamp,
          status: 'SUCCESS'
        });
      }

      // Instead of directly calling renderProjects, redirect to the projects page
      // which will properly load the projects through normal initialization
      window.location.href = '/?view=projects';

      // In case the redirect doesn't happen immediately, show visual feedback
      this.closest('#authDropdown')?.classList.remove('animate-slide-in');
    } catch (error) {
      // Standardize error for logging
      const standardError = window.auth.standardizeError(error, 'login_form');

      logFormIssue(
        standardError.code === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' :
        error.status === 429 ? 'RATE_LIMIT' : 'LOGIN_FAILURE',
        {
          ...logContext,
          status: error.status,
          message: error.message,
          code: standardError.code,
          duration: Date.now() - logContext.timestamp
        }
      );

      notify(error.message || "Login failed", "error");
    } finally {
      // Clear the safety timeout since we've reached the finally block
      clearTimeout(safetyTimeout);

      // Re-enable the form
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;

      if (AUTH_DEBUG) {
        console.debug('[Auth] Form submission completed', {
          requestId: logContext.requestId,
          totalDuration: Date.now() - logContext.timestamp
        });
      }
    }
  });
  registerForm?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    // Create logging context with safe user information
    const logContext = {
      username: formData.get("username"),
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      formId: 'registerForm',
      requestId: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    };

    // Get submit button state
    const submitBtn = this.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : 'Register';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<svg class="animate-spin h-4 w-4 mx-auto text-white" viewBox="0 0 24 24">...</svg>`;
    }

    // Validate input fields
    if (!formData.get("username") || !formData.get("password")) {
      logFormIssue('REGISTER_EMPTY_FIELDS', logContext);
      notify("Username and password are required", "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    if (formData.get("password").length < 12) {
      logFormIssue('REGISTER_PASSWORD_TOO_SHORT', {
        ...logContext,
        passwordLength: formData.get("password").length
      });
      notify("Password must be at least 12 characters", "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    // Set a safety timeout
    const safetyTimeout = setTimeout(() => {
      logFormIssue('REGISTER_TIMEOUT', {
        ...logContext,
        duration: Date.now() - logContext.timestamp,
        message: "Registration request timed out"
      });
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }, 10000);

    try {
      if (AUTH_DEBUG) {
        console.debug('[Auth] Registration started', {
          ...logContext,
          inputValid: true
        });
      }

      await handleRegister(formData);

      if (AUTH_DEBUG) {
        console.debug('[Auth] Registration successful', {
          ...logContext,
          duration: Date.now() - logContext.timestamp,
          status: 'SUCCESS'
        });
      }
    } catch (error) {
      // Standardize error for logging
      const standardError = window.auth.standardizeError(error, 'register_form');

      logFormIssue('REGISTRATION_FAILURE', {
        ...logContext,
        status: error.status,
        message: error.message,
        code: standardError.code,
        duration: Date.now() - logContext.timestamp
      });
    } finally {
      // Clear the safety timeout
      clearTimeout(safetyTimeout);

      // Re-enable the form
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }

      if (AUTH_DEBUG) {
        console.debug('[Auth] Registration form submission completed', {
          requestId: logContext.requestId,
          totalDuration: Date.now() - logContext.timestamp
        });
      }
    }
  });
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

function switchForm(isLogin) {
  const elements = {
    loginTab: document.getElementById("loginTab"),
    registerTab: document.getElementById("registerTab"),
    loginForm: document.getElementById("loginForm"),
    registerForm: document.getElementById("registerForm")
  };

  // Toggle classes based on login/register state
  elements.loginTab.classList.toggle("border-blue-500", isLogin);
  elements.loginTab.classList.toggle("text-blue-600", isLogin);
  elements.loginTab.classList.toggle("text-gray-500", !isLogin);
  elements.registerTab.classList.toggle("border-blue-500", !isLogin);
  elements.registerTab.classList.toggle("text-blue-600", !isLogin);
  elements.registerTab.classList.toggle("text-gray-500", isLogin);
  elements.loginForm.classList.toggle("hidden", !isLogin);
  elements.registerForm.classList.toggle("hidden", isLogin);
}

// Initialize auth object if it doesn't exist
window.auth = window.auth || {};
const standardizeErrorFn = function (error, context) {
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
// Initialize the window.auth object if it doesn't exist
window.auth = window.auth || {};

// Add ready state and event dispatcher
window.auth.isReady = false;
window.auth.readyPromise = new Promise((resolve) => {
  window.auth._resolveReady = resolve;
});

// Create a method to signal auth is ready
function signalAuthReady() {
  window.auth.isReady = true;
  window.auth._resolveReady();
  // Dispatch event for components that use event listeners
  document.dispatchEvent(new CustomEvent('authReady', { detail: { timestamp: Date.now() } }));
  console.log("[Auth] Module ready and exported to window.auth");
}

// Safe error handler for auth-related failures
function handleAuthError(error, context = '') {
  console.error(`[Auth] Error in ${context}:`, error);
  if (error.status === 401 || error.message?.includes('expired')) {
    clearTokenState();
    broadcastAuth(false);
    showSessionExpiredModal();
  }
  return false;
}

// Show a standardized session expired modal
function showSessionExpiredModal() {
  if (window.showNotification) {
    window.showNotification("Your session has expired. Please log in again.", "error");
  }
}

// Export all functions to window.auth
Object.assign(window.auth, {
  init: async function() {
    try {
      const result = await init();
      signalAuthReady();
      return result;
    } catch (error) {
      console.error("[Auth] Initialization failed:", error);
      // Still mark as ready, just in failed state
      signalAuthReady();
      return false;
    }
  },
  standardizeError: standardizeErrorFn,
  isAuthenticated: async function (options = {}) {
    try {
      return await verifyAuthState(options.forceVerify || false);
    } catch (error) {
      console.error("[Auth] Authentication check failed:", error);
      return false;
    }
  },
  logout,
  login: loginUser,
  getAuthToken,
  refreshTokens,
  verifyAuthState,
  clear: clearTokenState,
  broadcastAuth,
  isInitialized: false,
  handleRegister,
  handleAuthError
});

// Re-export as a module for ES module consumers
export {
  init,
  loginUser as login,
  logout,
  verifyAuthState,
  refreshTokens,
  getAuthToken,
  clearTokenState,
  standardizeErrorFn as standardizeError,
  handleAuthError
};
