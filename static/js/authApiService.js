/**
 * AuthApiService - extracted API and CSRF management (Phase-2)
 * -----------------------------------------------------------
 * Handles all authentication API calls, CSRF token management,
 * and network-related authentication logic. Extracted from oversized auth.js.
 */

export function createAuthApiService({
  apiClient,
  apiEndpoints,
  logger,
  browserService
} = {}) {
  const MODULE = 'AuthApiService';

  if (!apiClient || !apiEndpoints || !logger || !browserService) {
    throw new Error(`[${MODULE}] Required dependencies missing: apiClient, apiEndpoints, logger, browserService`);
  }

  // Validate required endpoints
  const requiredEndpoints = ['AUTH_CSRF', 'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_REGISTER', 'AUTH_VERIFY', 'AUTH_REFRESH'];
  const missingEndpoints = requiredEndpoints.filter(key => !apiEndpoints[key]);
  if (missingEndpoints.length > 0) {
    throw new Error(`[${MODULE}] Missing required auth endpoints: ${missingEndpoints.join(', ')}`);
  }

  const _log = (msg, extra = {}) => logger?.debug?.(`[${MODULE}] ${msg}`, {
    context: MODULE,
    ...extra
  });

  const _logError = (msg, err, extra = {}) => {
    logger?.error?.(`[${MODULE}] ${msg}`, err?.stack || err, {
      context: MODULE,
      ...extra
    });
  };

  // CSRF token cache
  let csrfTokenCache = null;
  let csrfTokenExpiry = null;

  function getCSRFToken() {
    if (!csrfTokenCache || (csrfTokenExpiry && Date.now() > csrfTokenExpiry)) {
      return null;
    }
    return csrfTokenCache;
  }

  async function fetchCSRFToken() {
    try {
      _log('Fetching CSRF token from server');
      const response = await apiClient(apiEndpoints.AUTH_CSRF, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`CSRF fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.csrf_token) {
        throw new Error('CSRF token missing from server response');
      }

      csrfTokenCache = data.csrf_token;
      // Set expiry to 55 minutes (assuming 1-hour server expiry)
      csrfTokenExpiry = Date.now() + (55 * 60 * 1000);

      _log('CSRF token fetched successfully');
      return csrfTokenCache;
    } catch (err) {
      _logError('Failed to fetch CSRF token', err);
      csrfTokenCache = null;
      csrfTokenExpiry = null;
      throw err;
    }
  }

  async function getCSRFTokenAsync(forceFetch = false) {
    if (!forceFetch) {
      const cached = getCSRFToken();
      if (cached) {
        return cached;
      }
    }
    return await fetchCSRFToken();
  }

  function extendErrorWithStatus(error, message) {
    const extendedError = new Error(message);
    extendedError.originalError = error;
    extendedError.status = error.status || 'unknown';
    extendedError.statusText = error.statusText || 'Unknown error';
    return extendedError;
  }

  async function authRequest(endpoint, method, body = null) {
    try {
      _log('Making auth request', { endpoint, method, hasBody: !!body });

      // Get CSRF token for non-GET requests
      let headers = { 'Accept': 'application/json' };
      if (method !== 'GET') {
        const csrfToken = await getCSRFTokenAsync();
        headers['X-CSRFToken'] = csrfToken;
        headers['Content-Type'] = 'application/json';
      }

      const config = { method, headers };
      if (body && method !== 'GET') {
        config.body = JSON.stringify(body);
      }

      const response = await apiClient(endpoint, config);
      
      if (!response.ok) {
        let errorMessage = `Request failed: ${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = errorData.detail;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // Use default error message if JSON parsing fails
        }
        
        const error = new Error(errorMessage);
        error.status = response.status;
        error.statusText = response.statusText;
        throw error;
      }

      const data = await response.json();
      _log('Auth request successful', { endpoint, method, status: response.status });
      return data;
    } catch (err) {
      _logError('Auth request failed', err, { endpoint, method });
      throw extendErrorWithStatus(err, err.message || 'Authentication request failed');
    }
  }

  async function login(username, password) {
    _log('Attempting login', { username });
    
    try {
      const response = await authRequest(apiEndpoints.AUTH_LOGIN, 'POST', {
        username: username.trim(),
        password
      });

      if (response.success && response.user) {
        _log('Login successful', { userId: response.user.id, username: response.user.username });
        return response;
      } else {
        throw new Error(response.message || 'Login failed - invalid response format');
      }
    } catch (err) {
      _logError('Login failed', err, { username });
      throw err;
    }
  }

  async function logout() {
    _log('Attempting logout');
    
    try {
      const response = await authRequest(apiEndpoints.AUTH_LOGOUT, 'POST');
      
      // Clear CSRF token on logout
      csrfTokenCache = null;
      csrfTokenExpiry = null;
      
      _log('Logout successful');
      return response;
    } catch (err) {
      _logError('Logout failed', err);
      // Clear tokens even if logout request failed
      csrfTokenCache = null;
      csrfTokenExpiry = null;
      throw err;
    }
  }

  async function register(username, email, password) {
    _log('Attempting registration', { username, email });
    
    try {
      const response = await authRequest(apiEndpoints.AUTH_REGISTER, 'POST', {
        username: username.trim(),
        email: email.trim(),
        password
      });

      if (response.success) {
        _log('Registration successful', { username, email });
        return response;
      } else {
        throw new Error(response.message || 'Registration failed - invalid response format');
      }
    } catch (err) {
      _logError('Registration failed', err, { username, email });
      throw err;
    }
  }

  async function verifySession() {
    _log('Verifying session');
    
    try {
      const response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
      
      if (response.authenticated && response.user) {
        _log('Session verification successful', { 
          userId: response.user.id, 
          username: response.user.username 
        });
        return response;
      } else {
        _log('Session verification failed - not authenticated');
        return { authenticated: false, user: null };
      }
    } catch (err) {
      _logError('Session verification failed', err);
      // Don't throw on verification failure - just return unauthenticated state
      return { authenticated: false, user: null };
    }
  }

  async function refreshSession() {
    _log('Attempting session refresh');
    
    try {
      const response = await authRequest(apiEndpoints.AUTH_REFRESH, 'POST');
      
      if (response.success && response.user) {
        _log('Session refresh successful', { 
          userId: response.user.id, 
          username: response.user.username 
        });
        return response;
      } else {
        throw new Error(response.message || 'Session refresh failed');
      }
    } catch (err) {
      _logError('Session refresh failed', err);
      throw err;
    }
  }

  function clearTokenCache() {
    _log('Clearing token cache');
    csrfTokenCache = null;
    csrfTokenExpiry = null;
  }

  return {
    // CSRF management
    getCSRFToken,
    getCSRFTokenAsync,
    fetchCSRFToken,

    // Authentication operations
    login,
    logout,
    register,
    verifySession,
    refreshSession,

    // Generic auth request helper
    authRequest,

    // Cache management
    clearTokenCache,

    cleanup() {
      _log('cleanup()');
      clearTokenCache();
    }
  };
}

export default createAuthApiService;