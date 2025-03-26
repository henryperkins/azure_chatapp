// auth.js - Enhanced authentication logic for Azure Chat App

// -------------------------
// Token Management
// -------------------------
const TokenManager = {
  accessToken: null,
  refreshToken: null,

  setTokens(access, refresh) {
    if (!access) {
      console.warn('Attempted to set null/undefined access token');
      return;
    }
    
    console.log('Setting new access token');
    this.accessToken = access;
    this.refreshToken = refresh;
    
    // Store token info with additional data
    sessionStorage.setItem('auth_state', JSON.stringify({
      hasTokens: true,
      timestamp: Date.now()
    }));
    
    // Set window configuration to indicate authenticated state
    if (window.API_CONFIG) {
      window.API_CONFIG.isAuthenticated = true;
    }
    
    // Also make sure the userInfo is set
    if (sessionStorage.getItem('userInfo') === null && window.AUTH_DATA?.username) {
      sessionStorage.setItem('userInfo', JSON.stringify({
        username: window.AUTH_DATA.username 
      }));
    }
  },

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    sessionStorage.removeItem('auth_state');
  },

  getAuthHeader() {
    return this.accessToken ? { "Authorization": `Bearer ${this.accessToken}` } : {};
  },

  refreshTokens: async function() {
    // Prevent multiple refresh attempts
    if (sessionStorage.getItem('refreshing')) {
      // Wait for the existing refresh to complete
      let attempts = 0;
      while (sessionStorage.getItem('refreshing') && attempts < 10) {
        await new Promise(r => setTimeout(r, 300));
        attempts++;
      }
      // If after waiting it's still refreshing, consider it failed
      if (sessionStorage.getItem('refreshing')) {
        throw new Error('Token refresh timeout');
      }
      return; // Another process completed the refresh
    }
    
    try {
      sessionStorage.setItem('refreshing', 'true');
      console.log('TokenManager: Attempting token refresh...');
      
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        console.error(`TokenManager: Refresh failed with status ${response.status}`);
        throw new Error(`Refresh failed with status ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.access_token) {
        throw new Error('No access token in refresh response');
      }
      
      this.setTokens(data.access_token, data.refresh_token);
      console.log('TokenManager: Token refresh successful');
      return true;
    } catch (error) {
      console.error('TokenManager: Token refresh failed:', error);
      throw error;
    } finally {
      sessionStorage.removeItem('refreshing');
    }
  }
};

// -------------------------
// Initialization
// -------------------------
async function initAuth() {
  try {
    console.log("Initializing auth module");
    
    // Restore session if exists
    const authState = JSON.parse(sessionStorage.getItem('auth_state'));
    if (authState?.hasTokens) {
      await updateAuthStatus();
    } else {
      // Just update UI to logged out state without trying to call the API
      clearSession();
      updateUserUI(null);
      broadcastAuth(false);
      // Make sure login UI is visible
      const loginRequiredMsg = document.getElementById('loginRequiredMessage');
      if (loginRequiredMsg) loginRequiredMsg.classList.remove('hidden');
    }
    
    setupUIListeners();
    console.log("Auth module initialized");
    return true;
  } catch (error) {
    console.error("Auth initialization failed:", error);
    clearSession();
    updateUserUI(null);
    broadcastAuth(false);
    return false;
  }
}

// Export all auth functions to window
window.auth = {
  init: initAuth,
  verify: verifyAuthState,
  updateStatus: updateAuthStatus,
  login: loginUser,
  logout: logout,
  manager: TokenManager
};

// Legacy exports for backward compatibility
window.initAuth = initAuth;
window.TokenManager = TokenManager;
window.verifyAuthState = verifyAuthState;
window.updateAuthStatus = updateAuthStatus;

// -------------------------
// UI Event Listeners
// -------------------------
function setupUIListeners() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");

  if (authBtn && authDropdown) {
    authBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Toggle dropdown visibility with animation
      authDropdown.classList.toggle("hidden");
      authDropdown.classList.toggle("slide-in");
      
      // Close other open dropdowns
      document.querySelectorAll('.dropdown-content').forEach(dropdown => {
        if (dropdown !== authDropdown && !dropdown.classList.contains('hidden')) {
          dropdown.classList.add("hidden");
          dropdown.classList.remove("slide-in");
        }
      });
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#authContainer") && 
          !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
        authDropdown.classList.remove("slide-in");
      }
    });
  }

  // Handle form switching
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

  // Handle form submissions
  document.getElementById("loginForm")?.addEventListener("submit", async function(e) {
    e.preventDefault();
    
    const form = e.target;
    const formData = new FormData(form);
    const username = formData.get("username");
    const password = formData.get("password");

    if (!username || !password) {
      window.showNotification?.("Please enter both username and password", "error");
      return;
    }

    try {
      // Show loading state
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="animate-spin h-4 w-4 mx-auto text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      `;

      // Call login function
      await loginUser(username, password);
      
      // Hide auth dropdown
      const authDropdown = document.getElementById("authDropdown");
      if (authDropdown) {
        authDropdown.classList.add("hidden");
        authDropdown.classList.remove("slide-in");
      }

      // Show success notification
      window.showNotification?.("Login successful", "success");
      
      // Reload page to initialize authenticated state
      window.location.reload();
      
    } catch (error) {
      console.error("Login failed:", error);
      window.showNotification?.(error.message || "Login failed", "error");
    } finally {
      // Reset button state
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Log In";
      }
    }
  });

  document.getElementById("registerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    await handleRegister({
      username: formData.get("username"),
      password: formData.get("password")
    });
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

// -------------------------
// Authentication Handlers
// -------------------------
async function handleRegister(e) {
  e.preventDefault();
  const { username, password } = e.target;

  if (password.value.length < 8) {
    notify("Password must be at least 8 characters", "error");
    return;
  }

  await authRequest('/api/auth/register', username.value, password.value);
  await loginUser(username.value, password.value);
  e.target.reset();
}

async function handleLogin(e) {
  e.preventDefault();
  const { username, password } = e.target;

  await loginUser(username.value, password.value);
  e.target.reset();
}

// -------------------------
// Core Auth Functions
// -------------------------
async function loginUser(username, password) {
  try {
    // Request login and get tokens
    const data = await api('/api/auth/login', 'POST', { 
      username: username.trim(), 
      password 
    });
    
    if (!data.access_token) {
      throw new Error("Invalid response from server");
    }

    // Store user info
    sessionStorage.setItem('userInfo', JSON.stringify({ 
      username: username.toLowerCase(),
      timestamp: Date.now() 
    }));

    // Set tokens
    TokenManager.setTokens(data.access_token, data.refresh_token);
    
    // Update UI
    updateUserUI(username.toLowerCase());
    setupTokenRefresh();
    broadcastAuth(true, username.toLowerCase());
    
    return data;
  } catch (error) {
    console.error("Login failed:", error);
    
    // Provide specific error messages
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
    // Only try to call the API if we're actually logged in
    if (TokenManager.accessToken) {
      try { 
        await api('/api/auth/logout', 'POST'); 
      } catch (error) {
        console.warn("Logout API error:", error);
        // Continue with local logout regardless of API errors
      }
    }
    
    // Clear tokens and session data
    TokenManager.clearTokens();
    try {
      sessionStorage.clear();
    } catch (storageError) {
      console.warn('Failed to clear session storage:', storageError);
    }
    
    // Better cookie removal
    document.cookie = "access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    
    // Update UI
    updateUserUI(null);
    broadcastAuth(false);
    
    // Only redirect/notify if this was triggered by a user action
    if (e) {
      notify("Logged out", "success");
      window.location.href = '/';
    }
  } catch (error) {
    console.error("Logout error:", error);
    // Still attempt to clear local state
    TokenManager.clearTokens();
    sessionStorage.clear();
    updateUserUI(null);
    
    if (e) {
      window.location.href = '/';
    }
  }
}

// -------------------------
// API & Helpers
// -------------------------
async function authRequest(url, username, password) {
  try {
    return await api(url, 'POST', { username: username.trim(), password });
  } catch (err) {
    notify(err.message || "Authentication failed", "error");
    throw err;
  }
}

async function api(url, method = 'GET', body) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...TokenManager.getAuthHeader()
    },
    credentials: 'include'
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      // Skip logging for expected 401 errors
      if (response.status === 401) {
        const error = new Error('Not authenticated');
        error.status = 401;
        error.expected = true;
        throw error;
      }

      // Handle other errors normally
      const error = new Error(response.statusText);
      error.status = response.status;
      
      try {
        const errorData = await response.json();
        error.message = errorData.message || errorData.detail || response.statusText;
      } catch {
        error.message = response.statusText;
      }
      
      throw error;
    }

    const data = await response.json();
    
    // Update tokens if present in response
    if (data.access_token) {
      TokenManager.setTokens(data.access_token, data.refresh_token);
    }
    
    return data;
  } catch (error) {
    console.error(`API request to ${url} failed:`, error);
    throw error;
  }
}

function updateUserUI(username) {
  document.getElementById("authButton")?.classList.toggle("hidden", !!username);

  const userMenu = document.getElementById("userMenu");
  if (userMenu) {
    userMenu.classList.toggle("hidden", !username);
  }

  const statusEl = document.getElementById("authStatus");
  if (statusEl) {
    statusEl.textContent = username || "Not Authenticated";
    statusEl.classList.toggle("text-green-600", !!username);
    statusEl.classList.toggle("text-red-600", !username);
  }
}

function notify(message, type = "info") {
  window.showNotification?.(message, type);
}

function broadcastAuth(authenticated, username = null) {
  document.dispatchEvent(new CustomEvent("authStateChanged", { detail: { authenticated, username }}));
}

function clearSession() {
  sessionStorage.clear();
  clearTokenTimers();
}

// -------------------------
// Token Refresh Management
// -------------------------
let tokenRefreshTimer;

function setupTokenRefresh() {
  clearTokenTimers();
  tokenRefreshTimer = setInterval(refreshTokenIfActive, 15 * 60 * 1000); // 15 min
  document.addEventListener("visibilitychange", refreshTokenIfActive);
}

function clearTokenTimers() {
  clearInterval(tokenRefreshTimer);
}

async function refreshTokenIfActive() {
  if (document.visibilityState !== "visible") return;
  
  // Prevent multiple refresh attempts
  if (sessionStorage.getItem('refreshing')) {
    // Wait for the existing refresh to complete
    let attempts = 0;
    while (sessionStorage.getItem('refreshing') && attempts < 10) {
      await new Promise(r => setTimeout(r, 300));
      attempts++;
    }
    // If after waiting it's still refreshing, consider it failed
    if (sessionStorage.getItem('refreshing')) {
      console.warn('Token refresh timeout after waiting');
      return false;
    }
    return; // Another process completed the refresh
  }
  
  try {
    sessionStorage.setItem('refreshing', 'true');
    console.log('Attempting token refresh...');
    const response = await api('/api/auth/refresh', 'POST');
    
    if (!response?.access_token) {
      throw new Error('No access token in refresh response');
    }

    TokenManager.setTokens(response.access_token, response.refresh_token);
    console.log('Token refresh successful');
    return true;
    
  } catch (error) {
    console.error('Token refresh failed:', error);
    if (error.status === 401) {
      console.warn('Refresh token expired, attempting re-authentication');
      try {
        await updateAuthStatus();
        return true;
      } catch (reAuthError) {
        console.error('Re-authentication failed:', reAuthError);
      }
    }
    
    TokenManager.clearTokens();
    await logout();
    return false;
  } finally {
    sessionStorage.removeItem('refreshing');
  }
}

// -------------------------
// Initial Auth Check
// -------------------------
async function verifyAuthState() {
  // Skip verification if we have no auth header
  const authHeader = TokenManager.getAuthHeader();
  if (!authHeader || !authHeader.Authorization) {
    return false;
  }

  try {
    const response = await api('/api/auth/verify');
    return response.authenticated;
  } catch {
    return false;
  }
}

async function updateAuthStatus() {
  try {
    const data = await api('/api/auth/verify');
    
    // Update tokens if present in response
    if (data.access_token) {
      TokenManager.setTokens(data.access_token, data.refresh_token);
    }
    
    // Update session info with extended user data
    sessionStorage.setItem('userInfo', JSON.stringify({
      username: data.username,
      roles: data.roles || [],
      lastVerified: Date.now()
    }));
    
    updateUserUI(data.username);
    setupTokenRefresh();
    broadcastAuth(true, data.username);
    return true;
  } catch (error) {
    console.error('Auth status check failed:', error);
    TokenManager.clearTokens();
    clearSession();
    updateUserUI(null);
    broadcastAuth(false);
    return false;
  }
}
