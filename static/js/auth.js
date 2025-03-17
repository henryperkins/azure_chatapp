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
      body: JSON.stringify({ username, password }),
      credentials: "include"
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
        // We rely solely on the HttpOnly cookie now; remove localStorage usage
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
  
  
  async function updateAuthStatus() {
      // We rely on the HttpOnly cookie for authorization
      // Show login UI or fetch user state as needed
      try {
          const resp = await fetch("/api/auth/verify", {
              credentials: "include"
          });
          if (resp.ok) {
              // User is authenticated
          } else {
              // Possibly expired or invalid
          }
      } catch (err) {
          console.error("Auth check failed:", err);
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
