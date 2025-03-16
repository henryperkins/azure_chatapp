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
      })
      .catch((err) => {
        console.error("Registration error:", err);
        alert("Failed to register. Check console for details.");
      });
  }

  function loginUser(username, password) {
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
      .then(checkResponse)
      .then((data) => {
        localStorage.setItem("access_token", data.access_token);
        alert("Login successful!");
        updateAuthStatus();
      })
      .catch((err) => {
        console.error("Login error:", err);
        alert("Login failed. Check console for details.");
      });
  }

  function updateAuthStatus() {
    const token = localStorage.getItem("access_token");
    const authSection = document.getElementById("authSection");
    const chatUI = document.getElementById("chatUI");
    if (token) {
      if (authStatus) {
        authStatus.textContent = "Authenticated";
        authStatus.classList.remove("text-red-600");
        authStatus.classList.add("text-green-600");
      }
      if (authSection && chatUI) {
        authSection.classList.add("hidden");
        chatUI.classList.remove("hidden");
      }
    } else {
      if (authStatus) {
        authStatus.textContent = "Not Authenticated";
        authStatus.classList.remove("text-green-600");
        authStatus.classList.add("text-red-600");
      }
      if (authSection && chatUI) {
        authSection.classList.remove("hidden");
        chatUI.classList.add("hidden");
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
