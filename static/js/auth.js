/* The above code is a JavaScript code snippet that defines a constant variable `AUTH_DEBUG` with a
boolean value of `true`. The code also includes a comment denoted by ` */
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
  if (tokenRefreshInProgress) {
    const now = Date.now();
    if (now - lastRefreshAttempt < 1000) {
      if (AUTH_DEBUG) console.debug('[Auth] Token refresh already in progress, returning existing promise');
      return window.__tokenRefreshPromise;
    }
    if (AUTH_DEBUG) console.debug('[Auth] Allowing new refresh attempt after 1s buffer');
  }
  const timeSinceLastVerified = Date.now() - authState.lastVerified;
  if (timeSinceLastVerified < 5000) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping refresh - recent login detected');
    return { success: true, version: authState.tokenVersion, token: getCookie('access_token') };
  }
  const now = Date.now();
  if (lastRefreshAttempt && now - lastRefreshAttempt < 30000 && refreshFailCount >= MAX_REFRESH_RETRIES) {
    console.warn('[Auth] Too many failed refresh attempts - not forcing logout, just failing');
    return Promise.reject(new Error('Too many refresh attempts - please check your connection'));
  }
  tokenRefreshInProgress = true;
  lastRefreshAttempt = Date.now();
  window.__tokenRefreshPromise = new Promise(async (resolve, reject) => {
    try {
      if (AUTH_DEBUG) console.debug('[Auth] Refreshing tokens...');
      const currentToken = getCookie('refresh_token');
      if (!currentToken) throw new Error('No token available for refresh');
      const expiry = getTokenExpiry(currentToken);
      if (expiry && expiry < Date.now()) throw new Error('Token already expired');
      let lastError, response;
      for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt++) {
        try {
          const fetchPromise = apiRequest('/api/auth/refresh', 'POST');
          const timeoutPromise = new Promise((_, rej) => {
            setTimeout(() => rej(new Error('Token refresh timeout')),
              AUTH_CONSTANTS.REFRESH_TIMEOUT * Math.pow(2, attempt - 1)
            );
          });
          response = await Promise.race([fetchPromise, timeoutPromise]);
          if (!response?.access_token) throw new Error('Invalid refresh response');
          if (response.token_version) authState.tokenVersion = response.token_version;
          break;
        } catch (err) {
          lastError = err;
          if (attempt < MAX_REFRESH_RETRIES) {
            const delay = 300 * Math.pow(2, attempt - 1);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      if (lastError) throw lastError;
      refreshFailCount = 0;
      authState.lastVerified = Date.now();
      if (AUTH_DEBUG) console.debug('[Auth] Token refreshed successfully');
      document.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: true } }));
      if (response.token_version) {
        document.cookie = `token_version=${response.token_version}; path=/; ${location.protocol === 'https:' ? 'Secure; ' : ''
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
        detail: { success: false, error: err, message: errorMessage, attempts: refreshFailCount }
      }));
      reject(new Error(errorMessage));
    } finally {
      tokenRefreshInProgress = false;
    }
  });
  return window.__tokenRefreshPromise;
}

function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000;
  } catch (e) {
    console.warn('[Auth] Error extracting token expiry:', e);
    return null;
  }
}

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

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  let cookieValue = null;
  if (parts.length === 2) cookieValue = parts.pop().split(';').shift();
  if (name === 'access_token' || name === 'refresh_token') return cookieValue;
  return cookieValue;
}

async function fetchTokenExpirySettings() {
  try {
    const response = await fetch('/settings/token-expiry', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Failed to fetch token expiry settings');
    return await response.json();
  } catch (error) {
    console.error('[Auth] Failed to fetch token expiry settings:', error);
    return { access_token_expire_minutes: 30, refresh_token_expire_days: 7 };
  }
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

async function apiRequest(url, method, data = null) {
  if (window.apiRequest) return window.apiRequest(url, method, data);
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
    if (AUTH_DEBUG) console.debug("[Auth] Already initialized");
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

function setupTokenSync() { }

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
  const VERIFICATION_INTERVAL = AUTH_CONSTANTS.VERIFICATION_INTERVAL * 2; // Double the normal interval
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
  
  // Restore tokens from sessionStorage if they exist
  const restoreTokenBackup = () => {
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
        
        if (AUTH_DEBUG) console.debug('[Auth] Restored tokens from sessionStorage backup');
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

async function loginUser(username, password) {
  try {
    if (AUTH_DEBUG) console.debug('[Auth] Starting login for user:', username);
    const response = await apiRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password,
    });
    if (AUTH_DEBUG) console.debug('[Auth] Login response received', response);
    if (!response.access_token) throw new Error('No access token received');
    if (response.token_version) authState.tokenVersion = response.token_version;
    
    // Store tokens in memory for fallback scenarios
    window.__recentLoginTimestamp = Date.now();
    window.__directAccessToken = response.access_token;
    window.__directRefreshToken = response.refresh_token;
    window.__lastUsername = username;
    
    // Wait for cookies to be set by server
    await new Promise(r => setTimeout(r, 800));
    
    // Check for cookies with progressive retries
    let accessTokenCookie = null, refreshTokenCookie = null;
    let cookieRetries = 12; // Increased from 10 to 12
    let cookieCheckInterval = 150; // Start with shorter intervals
    
    while (cookieRetries-- > 0) {
      // Check for standard cookies
      accessTokenCookie = getCookie('access_token');
      refreshTokenCookie = getCookie('refresh_token');
      
      // Also check for fallback cookies
      if (!accessTokenCookie) accessTokenCookie = getCookie('access_token_fallback');
      if (!refreshTokenCookie) refreshTokenCookie = getCookie('refresh_token_fallback');
      
      // Check for cookie support flag
      const cookieSupportCheck = getCookie('cookie_support_check');

      if (accessTokenCookie && refreshTokenCookie) {
        if (AUTH_DEBUG) console.debug(`[Auth] Both cookies found after ${12 - cookieRetries} attempts`);
        break;
      }
      
      if (AUTH_DEBUG) {
        console.debug(`[Auth] Waiting for cookies after login, retries left: ${cookieRetries}, cookie support: ${cookieSupportCheck ? 'detected' : 'not detected'}`);
      }
      
      // Progressive backoff with increasing intervals
      await new Promise(r => setTimeout(r, cookieCheckInterval));
      cookieCheckInterval = Math.min(cookieCheckInterval * 1.5, 500); // Increase interval with cap at 500ms
    }
    
    if (AUTH_DEBUG) {
      console.debug('[Auth] Post-login cookie check:', {
        accessToken: !!accessTokenCookie,
        refreshToken: !!refreshTokenCookie,
        retriesLeft: cookieRetries,
        directTokenAvailable: !!window.__directAccessToken
      });
    }
    
    // If cookies failed to set, use server-side cookie setting API as primary fallback
    if (!accessTokenCookie && response.access_token) {
      console.warn('[Auth] Cookies not set after login, trying server-side cookie API fallback');
      
      try {
        const cookieResponse = await apiRequest('/api/auth/set-cookies', 'POST', {
          access_token: response.access_token,
          refresh_token: response.refresh_token
        });
        
        if (AUTH_DEBUG) console.debug('[Auth] Manual cookie setting API response:', cookieResponse);
        
        // Check if cookies were set after the API call
        await new Promise(r => setTimeout(r, 300));
        const apiSetCookie = getCookie('access_token') || getCookie('access_token_fallback');
        
        if (apiSetCookie) {
          if (AUTH_DEBUG) console.debug('[Auth] Server-side cookie setting succeeded');
        } else {
          // Last resort: client-side cookie setting
          if (AUTH_DEBUG) console.debug('[Auth] Server-side cookie setting failed, trying client-side as last resort');
          
          // Try both domain-specific and domain-less cookies for maximum compatibility
          const hostname = window.location.hostname;
          const isSecure = window.location.protocol === 'https:';
          const sameSite = isSecure ? 'Strict' : 'Lax';
          
          document.cookie = `access_token=${response.access_token}; path=/; max-age=${60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES}; SameSite=${sameSite}`;
          if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
            document.cookie = `access_token=${response.access_token}; path=/; domain=${hostname}; max-age=${60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES}; SameSite=${sameSite}`;
          }
          
          if (response.refresh_token) {
            document.cookie = `refresh_token=${response.refresh_token}; path=/; max-age=${60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS}; SameSite=${sameSite}`;
            if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
              document.cookie = `refresh_token=${response.refresh_token}; path=/; domain=${hostname}; max-age=${60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS}; SameSite=${sameSite}`;
            }
          }
        }
      } catch (cookieError) {
        console.warn('[Auth] Cookie-setting API call failed:', cookieError);
      }
    }
    
    // Ensure we're authenticated regardless of cookie status
    authState.isAuthenticated = true;
    authState.username = response.username || username;
    authState.lastVerified = Date.now();
    sessionExpiredFlag = false;
    broadcastAuth(true, response.username || username);
    
    if (AUTH_DEBUG) {
      console.debug('[Auth] Login successful, auth state updated. Cookie status:', !!getCookie('access_token'));
    }
    
    return {
      ...response,
    };
  } catch (error) {
    console.error("[Auth] loginUser error details:", error);
    let message = "Login failed";
    if (error.status === 401) message = "Invalid username or password";
    else if (error.status === 429) message = "Too many attempts. Please try again later.";
    else if (error.message) message = error.message;
    throw new Error(message);
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
  loginForm?.addEventListener("submit", async function (e) {
    e.preventDefault();
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
      const projectManagerPanel = document.getElementById('projectManagerPanel');
      if (projectManagerPanel) projectManagerPanel.classList.remove('hidden');
      if (window.projectDashboard?.showProjectList) {
        window.projectDashboard.showProjectList();
      } else if (window.projectManager?.showProjectList) {
        window.projectManager.showProjectList();
      } else {
        const projectListView = document.getElementById('projectListView');
        const projectDetailsView = document.getElementById('projectDetailsView');
        if (projectListView) projectListView.classList.remove('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');
      }
      window.history.pushState({}, '', '/?view=projectList');
      if (window.sidebar?.updateAuthDependentUI) {
        window.sidebar.updateAuthDependentUI(true, username);
      }
      // Ensure project list loads immediately after login
      await new Promise(r => setTimeout(r, 500)); // Short delay to allow DOM updates
      
      // Define a more reliable project list loading function
      const ensureProjectListLoaded = async () => {
        try {
          if (AUTH_DEBUG) console.debug('[Auth] Running post-login tasks with prioritized project list loading...');
          
          // First priority: Initialize dashboard if needed
          if (typeof window.initProjectDashboard === 'function' && !window.projectDashboard) {
            if (AUTH_DEBUG) console.debug('[Auth] Initializing project dashboard...');
            try {
              await window.initProjectDashboard();
              if (AUTH_DEBUG) console.debug('[Auth] Dashboard initialized successfully');
            } catch (err) {
              console.error('[Auth] Dashboard initialization failed:', err);
            }
          }
          
          // Second priority: Show project list using the dashboard
          if (window.projectDashboard?.showProjectList) {
            if (AUTH_DEBUG) console.debug('[Auth] Showing project list via dashboard...');
            window.projectDashboard.showProjectList();
          }
          
          // Third priority: Load projects data
          const projectLoadMethods = [
            // Try these methods in order
            () => window.projectDashboard?.loadProjects(),
            () => window.loadProjectList?.(),
            () => window.projectManager?.loadProjects()
          ];
          
          // Find first available method
          const loadMethod = projectLoadMethods.find(method => typeof method() === 'function');
          if (loadMethod) {
            if (AUTH_DEBUG) console.debug('[Auth] Loading projects data...');
            await loadMethod();
          }
          
          // Load sidebar projects if available
          if (typeof window.loadSidebarProjects === 'function') {
            if (AUTH_DEBUG) console.debug('[Auth] Loading sidebar projects...');
            await window.loadSidebarProjects();
          }
          
          // Additional tasks
          const additionalTasks = [];
          
          if (typeof window.loadStarredConversations === 'function') {
            additionalTasks.push(window.loadStarredConversations());
          }
          
          const isChatPage = window.location.pathname === '/' || window.location.pathname.includes('chat');
          if (isChatPage && typeof window.createNewChat === 'function' && !window.CHAT_CONFIG?.chatId) {
            additionalTasks.push(window.createNewChat());
          }
          
          // Run additional tasks in parallel
          if (additionalTasks.length > 0) {
            const results = await Promise.allSettled(additionalTasks);
            let successCount = 0, failureCount = 0;
            results.forEach(r => {
              if (r.status === 'rejected') {
                failureCount++;
                console.warn("[Auth] Additional task failed:", r.reason);
              } else {
                successCount++;
              }
            });
            
            if (AUTH_DEBUG) console.debug(`[Auth] Additional tasks completed: ${successCount} succeeded, ${failureCount} failed`);
          }
          
          // Ensure project list view is visible
          const projectListView = document.getElementById('projectListView');
          if (projectListView) {
            projectListView.classList.remove('hidden');
            const projectDetailsView = document.getElementById('projectDetailsView');
            if (projectDetailsView) projectDetailsView.classList.add('hidden');
          }
          
          // Update URL to indicate project list view
          if (!window.location.search.includes('project=')) {
            window.history.pushState({}, '', '/?view=projectList');
          }
          
          if (AUTH_DEBUG) console.debug('[Auth] Project list loading completed successfully');
        } catch (error) {
          console.error('[Auth] Error in post-login project loading:', error);
        }
      };
      
      // Execute project list loading
      ensureProjectListLoaded();
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      notify(error.message || "Login failed", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
  registerForm?.addEventListener("submit", async function (e) {
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

window.auth = window.auth || {};
const standardizeErrorFn = window.auth.standardizeError || function (error, context) {
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
  handleRegister
});
