/**
 * auth.js
 * ------------------------
 * Production-ready user authentication logic for the Azure Chat Application.
 * - Registers new users (stores hashed passwords in DB).
 * - Logs in existing users (retrieves JWT).
 * - Saves the JWT to localStorage for subsequent requests.
 * - Optionally provides logout functionality.
 */

document.addEventListener("DOMContentLoaded", () => {
  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  const logoutBtn = document.getElementById("logoutBtn");
  const authStatus = document.getElementById("authStatus");

  // Check if already logged in
  updateAuthStatus();

setInterval(checkTokenExpiry, 5 * 60 * 1000);
  // -----------------------------
  // Event Listeners
  // -----------------------------
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = e.target.username.value.trim();
      const password = e.target.password.value.trim();
      registerUser(username, password);
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = e.target.username.value.trim();
      const password = e.target.password.value.trim();
      loginUser(username, password);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("access_token");
      updateAuthStatus();
    });
  }

  // -----------------------------
  // Functions
  // -----------------------------

  function registerUser(username, password) {
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
      .then(checkResponse)
      .then((data) => {
        alert(data.message || "Registration successful!");
        // auto-login immediately after registration
        loginUser(username, password);
      })
      .catch((err) => {
        console.error("Registration error:", err);
        const msgString = err.message || "";
        if (msgString.includes("Username already taken")) {
          alert("Username is already taken. Please choose another.");
        } else {
          alert("Failed to register: " + msgString);
        }
      });
  }

  function loginUser(username, password) {
    fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include"
    })
    .then(checkResponse)
    .then(data => {
        localStorage.setItem("access_token", data.access_token);
        updateAuthStatus();
        document.dispatchEvent(new CustomEvent("authStateChanged", {
            detail: { authenticated: true }
        }));
    })
    .catch((err) => {
        console.error("Login error:", err);
        showNotification(err.message || "Login failed", "error");
    });
  }
  
  // Refresh the token if it's close to expiring
  async function refreshTokenIfNeeded() {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    try {
      const { exp } = JSON.parse(atob(token.split('.')[1]));
      const timeLeft = exp * 1000 - Date.now();
      
      if (timeLeft < 300000 && timeLeft > 0) { // 5 min threshold
        const newToken = await fetch("/api/auth/refresh", {
          headers: getHeaders()
        }).then(checkResponse);
        
        localStorage.setItem("access_token", newToken.access_token);
        return true;
      }
    } catch (e) {
      console.error("Token refresh failed:", e);
      localStorage.removeItem("access_token");
    }
    return false;
  }
  
  async function updateAuthStatus() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      // Show login UI
      return;
    }

    try {
      const resp = await fetch("/api/auth/verify", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      
      if (resp.ok) {
        // User is authenticated
      } else {
        // Handle expired/invalid token
      }
    } catch (err) {
      console.error("Auth check failed:", err);
    }
  }

function checkTokenExpiry() {
  const token = localStorage.getItem("access_token");
  if (token) {
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      if (decoded.exp * 1000 < Date.now()) {
        localStorage.removeItem("access_token");
        updateAuthStatus();
        alert("Session expired. Please log in again.");
      }
    } catch (e) {
      console.error("Token parse error", e);
    }
  }
}
  function checkResponse(resp) {
    if (!resp.ok) {
      return resp.text().then((text) => {
        throw new Error(`${resp.status} - ${text}`);
      });
    }
    return resp.json();
  }
});
