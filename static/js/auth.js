async function verifyAuthState(bypassCache = false) {
  try {
    // --- BEGIN RECURSION PREVENTION ---
    if (Date.now() - lastVerifyFailureTime < MIN_RETRY_INTERVAL && !bypassCache) {
      if (AUTH_DEBUG) console.debug('[Auth] Skipping verification - recent failure detected, wait before retrying.');
      return authState.isAuthenticated;
    }
    // --- END RECURSION PREVENTION ---

    // Only skip if not bypassing cache
    if (sessionExpiredFlag && Date.now() - sessionExpiredFlag < 10000 && !bypassCache) {
      if (AUTH_DEBUG) console.debug('[Auth] Skipping verification - session recently expired');
      return false;
    }

    // Clear session expired flag if grace period has passed
    const SESSION_EXPIRY_GRACE_PERIOD = 10000; // 10 seconds in ms
    if (sessionExpiredFlag && Date.now() - sessionExpiredFlag >= SESSION_EXPIRY_GRACE_PERIOD) {
      if (AUTH_DEBUG) console.debug('[Auth] Clearing expired session flag');
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
    if (!bypassCache && authState.lastVerified &&
        Date.now() - authState.lastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION) {
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
      clearTokenState();
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
          window.__directAccessToken = refreshResult.token;
          window.__recentLoginTimestamp = Date.now();
          authState.isAuthenticated = true;
          authState.lastVerified = Date.now();
          broadcastAuth(true);
          return true;
        }
        throw new Error('Token refresh failed');
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
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Auth verification timeout (attempt ${attempt})`)), VERIFY_TIMEOUT)
          )
        ]);

        console.debug('[Auth] Verification successful:', response);
        authState.isAuthenticated = response.authenticated;
        authState.username = response.username || null;
        authState.lastVerified = Date.now();
        lastVerifyFailureTime = 0;

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
          if (window.showSessionExpiredModal) window.showSessionExpiredModal();
          throw new Error('Session expired. Please login again.');
        }

        if (attempt < MAX_VERIFY) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }

    console.error('[Auth] All verification attempts failed. Access token present:', !!getCookie('access_token'),
                 'Refresh token present:', !!getCookie('refresh_token'));
    authState.isAuthenticated = false;
    authState.lastVerified = Date.now();
    broadcastAuth(false);

    let errorMsg = 'Authentication verification failed';
    if (lastError) {
      if (lastError.message?.includes('timeout')) {
        errorMsg = 'Authentication check timed out - please try again later';
      } else if (lastError.status === 401) {
        errorMsg = 'Session expired - please login again';
      } else if (lastError.message?.includes('recursion')) {
        errorMsg = 'Recursive authentication error detected. Please retry.';
      } else if (lastError.message) {
        errorMsg = lastError.message;
      }
    }

    const enhancedError = new Error(`${errorMsg}${authState.tokenVersion ? ` (token v${authState.tokenVersion})` : ''}`);
    enhancedError.code = 'AUTH_VERIFICATION_FAILED';
    throw enhancedError;
  } catch (error) {
    lastVerifyFailureTime = Date.now();
    console.warn('[Auth] Auth verification error:', error);

    if (error.status === 401 || error.message?.includes('expired') || error.message?.includes('Session')) {
      clearTokenState();
      broadcastAuth(false);
    }

    authState.isAuthenticated = false;
    return false;
  }
}
