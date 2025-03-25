// auth.js - streamlined authentication logic for Azure Chat App

// -------------------------
// Initialization
// -------------------------
async function initAuth() {
  try {
    console.log("Initializing auth module");
    setupUIListeners();
    await updateAuthStatus();
    console.log("Auth module initialized");
  } catch (error) {
    console.error("Auth initialization failed:", error);
    throw error;
  }
}

// Export initialization function
window.initAuth = initAuth;

// -------------------------
// UI Event Listeners
// -------------------------
function setupUIListeners() {
  toggleForms();
  handleAuthDropdown();

  document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

function toggleForms() {
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  loginTab?.addEventListener("click", () => switchForm(true));
  registerTab?.addEventListener("click", () => switchForm(false));

  function switchForm(isLogin) {
    loginTab.classList.toggle("border-blue-500", isLogin);
    registerTab.classList.toggle("border-blue-500", !isLogin);
    loginForm.classList.toggle("hidden", !isLogin);
    registerForm.classList.toggle("hidden", isLogin);
  }
}

function handleAuthDropdown() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");
  const authContainer = document.getElementById("authContainer");

  authBtn?.addEventListener("click", () => authDropdown?.classList.toggle("hidden"));
  document.addEventListener("click", (e) => {
    if (!authContainer?.contains(e.target)) authDropdown?.classList.add("hidden");
  });
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
  const data = await authRequest('/api/auth/login', username, password);
  sessionStorage.setItem('userInfo', JSON.stringify({ username: data.username }));

  updateUserUI(data.username);
  setupTokenRefresh();
  broadcastAuth(true, data.username);
  notify(`Welcome back, ${data.username}`, "success");
}

async function logout(e) {
  e?.preventDefault();
  try { await api('/api/auth/logout', 'POST'); } catch (e) {}
  clearSession();
  updateUserUI(null);
  broadcastAuth(false);
  notify("Logged out", "success");
  window.location.href = '/login';
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
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error((await res.json()).message || res.statusText);
  return await res.json();
}

function updateUserUI(username) {
  document.getElementById("authButton")?.classList.toggle("hidden", !!username);
  document.getElementById("userMenu")?.classList.toggle("hidden", !username);

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
  
  try {
    console.log('Attempting token refresh...');
    const response = await api('/api/auth/refresh', 'POST');
    
    if (!response?.access_token) {
      throw new Error('No access token in refresh response');
    }

    console.log('Token refresh successful');
    return true;
    
  } catch (error) {
    console.error('Token refresh failed:', error);
    
    // Special handling for 401 - don't logout immediately
    if (error.message.includes('401')) {
      console.warn('Refresh token invalid, attempting full reauthentication');
      await updateAuthStatus();
      return false;
    }
    
    // For other errors, logout completely
    logout();
    return false;
  }
}

// -------------------------
// Initial Auth Check
// -------------------------
async function updateAuthStatus() {
  try {
    const data = await api('/api/auth/verify');
    sessionStorage.setItem('userInfo', JSON.stringify({ username: data.username }));
    updateUserUI(data.username);
    setupTokenRefresh();
    broadcastAuth(true, data.username);
  } catch {
    clearSession();
    updateUserUI(null);
    broadcastAuth(false);
  }
}
