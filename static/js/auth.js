/***************************************
 * auth.js - Cookie-Based Auth Module
 * 
 * State management via server-set HTTP-only cookies.
 ***************************************/

// Debug flag for verbose auth logging
const AUTH_DEBUG = true;  // You can disable or toggle manually

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
// UI & Form Handlers
// ---------------------------------------------------------------------
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
        const loadTasks = [];
        
        // Load project components
        if (typeof window.loadSidebarProjects === 'function') {
          loadTasks.push(window.loadSidebarProjects().catch(err => console.warn("[Auth] Failed to load sidebar projects:", err)));
        }
        if (typeof window.loadProjectList === 'function') {
          loadTasks.push(window.loadProjectList().catch(err => console.warn("[Auth] Failed to load project list:", err)));
        }
        if (typeof window.initProjectDashboard === 'function') {
          loadTasks.push(window.initProjectDashboard().catch(err => console.warn("[Auth] Failed to init project dashboard:", err)));
        }
        
        // Load starred conversations
        if (typeof window.loadStarredConversations === 'function') {
          loadTasks.push(window.loadStarredConversations().catch(err => console.warn("[Auth] Failed to load starred conversations:", err)));
        }
        
        // Handle chat page initialization
        const isChatPage = window.location.pathname === '/' || window.location.pathname.includes('chat');
        if (isChatPage && typeof window.createNewChat === 'function' && !window.CHAT_CONFIG?.chatId) {
          loadTasks.push(window.createNewChat().catch(err => console.warn("[Auth] Failed to create chat:", err)));
        }
        
        // Execute all load tasks in parallel
        Promise.all(loadTasks).catch(err => {
          console.warn("[Auth] Some post-login tasks failed:", err);
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
// Registration + Login (cookie-based)
// ---------------------------------------------------------------------
async function handleRegister(formData) {
  const username = formData.get("username");
  const password = formData.get("password");
  if (!username || !password) {
    notify("Please fill out all fields", "error");
    return;
  }
  if (password.length < 12) {
    notify("Password must be at least 12 characters with uppercase, lowercase, number, and special character.", "error");
    return;
  }

  try {
    // Server sets cookies upon successful registration & login
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

    // Use window.apiRequest if available, otherwise fall back to direct fetch
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

    // Store token version if available
    if (response.token_version && window.TokenManager) {
      window.TokenManager.version = response.token_version;
    }

    broadcastAuth(true, response.username || username);
    return {
      ...response,
      // Include WebSocket connection details
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

async function logout(e) {
  e?.preventDefault();
  try {
    if (AUTH_DEBUG) {
      console.debug('[Auth] Starting logout');
    }
    
    // Use window.apiRequest if available, otherwise fall back to direct fetch
    const apiCall = window.apiRequest || 
      ((url, method) => authRequest(url, method));
    
    try {
      await apiCall('/api/auth/logout', 'POST');
    } catch (apiErr) {
      console.warn("[Auth] Logout API error:", apiErr);
    }

    broadcastAuth(false);
    notify("Logged out", "success");
    window.location.href = '/index.html';
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    broadcastAuth(false);
    if (e) {
      window.location.href = '/';
    }
  }
}

// ---------------------------------------------------------------------
// Auth Verification & Status Updates (cookie-based)
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

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
}

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

async function verifyAuthState(bypassCache = false) {
  try {
    if (!bypassCache && authVerificationCache.isValid()) {
      return authVerificationCache.result;
    }

    // First check if we have an expired access token
    const accessToken = getCookie('access_token');
    const refreshToken = getCookie('refresh_token');
    
    if (accessToken && isTokenExpired(accessToken)) {
      if (!refreshToken) {
        broadcastAuth(false);
        throw new Error('Session expired. Please login again.');
      }
      
      try {
        const apiCall = window.apiRequest || ((url, method) => authRequest(url, method));
        
        // First attempt refresh with timeout
        const REFRESH_TIMEOUT = 8000; // 8 seconds timeout
        const refreshPromise = apiCall('/api/auth/refresh', 'POST', null, {
          credentials: 'include',
          headers: {
            'Cache-Control': 'no-cache'
          }
        });
        
        // Add timeout to refresh request
        const refreshResult = await Promise.race([
          refreshPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Auth refresh timeout')), REFRESH_TIMEOUT)
          )
        ]);

        // Verify and wait for new token
        let retries = 3;
        let newAccessToken;
        while (retries-- > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
          newAccessToken = getCookie('access_token');
          if (newAccessToken) break;
        }

        if (!newAccessToken) {
          throw new Error('No access token received from refresh');
        }

        // Add the new token explicitly to verify request with timeout
        const VERIFY_TIMEOUT = 5000; // 5 seconds timeout
        const verifyPromise = apiCall('/api/auth/verify', 'GET', null, {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${newAccessToken}`,
            'Cache-Control': 'no-cache'
          }
        });
        
        return await Promise.race([
          verifyPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Auth verification timeout')), VERIFY_TIMEOUT)
          )
        ]);
      } catch (refreshError) {
        console.error('Auth refresh failed:', refreshError);
        if (typeof clearAuthState === 'function') {
          clearAuthState();
        }
        broadcastAuth(false);
        
        const errorMessage = refreshError.message || 'Session expired. Please login again.';
        const isTimeout = errorMessage.includes('timeout');
        throw new Error(isTimeout ? 'Authentication timed out. Please try again.' : 'Session expired. Please login again.');
      }
    }

    // Check with the server for auth status
    const apiCall = window.apiRequest ||
      ((url, method) => authRequest(url, method));
    
    try {
      const VERIFY_TIMEOUT = 5000; // 5 seconds timeout
      const verifyPromise = apiCall('/api/auth/verify', 'GET', null, {
        credentials: 'include' // Ensure cookies are sent
      });
      
      // Add timeout to verify request
      const response = await Promise.race([
        verifyPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Auth verification timeout')), VERIFY_TIMEOUT)
        )
      ]);
      
      authVerificationCache.set(response.authenticated);
      if (response.authenticated) {
        broadcastAuth(true, response.username);
      }
      return response.authenticated;
    } catch (verifyError) {
      console.error('Auth verification failed:', verifyError);
      if (verifyError.status === 401) {
        if (typeof clearAuthState === 'function') {
          clearAuthState();
        }
        broadcastAuth(false);
        throw new Error('Session expired. Please login again.');
      }
      
      // Handle timeout specifically
      if (verifyError.message && verifyError.message.includes('timeout')) {
        throw new Error('Authentication check timed out - please try again');
      }
      
      throw verifyError;
    }
  } catch (error) {
    console.warn('[Auth] Auth verification error:', error);
    authVerificationCache.set(false);
    return false;
  }
}

async function updateAuthStatus() {
  try {
    const result = await verifyAuthState(true);
    return result;
  } catch (error) {
    console.error('[Auth] Auth status update failed:', error);
    broadcastAuth(false);
    return false;
  }
}

// Clear authentication state
function clearAuthState() {
  // Clear verification cache
  authVerificationCache.set(false);
  
  // Reset any UI that depends on auth state
  broadcastAuth(false);
  
  // Clear TokenManager state if available
  if (window.TokenManager && typeof window.TokenManager.clear === 'function') {
    window.TokenManager.clear();
  }
  
  console.debug('[Auth] Auth state cleared');
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function broadcastAuth(authenticated, username = null) {
  document.dispatchEvent(new CustomEvent("authStateChanged", {
    detail: { authenticated, username }
  }));

  // Update UI based on auth state
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
// Expose Auth to window
// ---------------------------------------------------------------------
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

      // Check auth state with server
      const isAuthenticated = await verifyAuthState(true);
      if (!isAuthenticated) {
        broadcastAuth(false);
      }

      setupUIListeners();
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
    }
  },

  verify: verifyAuthState,
  updateStatus: updateAuthStatus,
  login: loginUser,
  logout: logout,
  isInitialized: false,

  /**
   * Checks server for authentication status (cookie-based).
   */
  isAuthenticated: async function (options = {}) {
    const { skipCache = false, forceVerify = false } = options;

    // Fast path: if cached
    if (!skipCache && authVerificationCache.isValid()) {
      return authVerificationCache.result;
    }

    // Otherwise, verify with server
    try {
      const apiCall = window.apiRequest || 
        ((url, method, data, timeout, ttl, opts) => authRequest(url, method, data));
        
      const response = await apiCall('/api/auth/verify', 'GET', null, 0, 3000, {
        skipAuthCheck: true,
        skipRetry: true
      });
      
      const isAuthenticated = response?.authenticated === true;
      
      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = isAuthenticated;
      }
      
      authVerificationCache.set(isAuthenticated);
      
      if (isAuthenticated) {
        broadcastAuth(true, response.username);
      } else {
        broadcastAuth(false);
      }
      
      return isAuthenticated;
    } catch (error) {
      console.error("[Auth] Authentication check failed:", error);
      authVerificationCache.set(false);
      broadcastAuth(false);
      
      if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = false;
      }
      
      return false;
    }
  }
};

console.log("[Auth] Module loaded and exposed to window.auth");
