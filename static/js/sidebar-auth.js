/**
 * sidebar-auth.js – Handles inline authentication in the sidebar.
 * Exports a factory: createSidebarAuth({ DependencySystem, domAPI, eventHandlers, notify, ... }).
 * All dependencies must be injected (no globals).
 * All notify/info/error use module/context for context-rich telemetry.
 */

export function createSidebarAuth({
  DependencySystem,
  domAPI,
  eventHandlers,
  accessibilityUtils,
  MODULE = "Sidebar"
} = {}) {
  if (!DependencySystem) throw new Error("[sidebar-auth] DependencySystem required.");
  if (!domAPI) throw new Error("[sidebar-auth] domAPI is required.");
  if (!eventHandlers) throw new Error("[sidebar-auth] eventHandlers is required.");

  // Element references
  let sidebarAuthFormContainerEl, sidebarAuthFormTitleEl, sidebarAuthFormEl,
    sidebarUsernameContainerEl, sidebarUsernameInputEl,
    sidebarEmailInputEl, sidebarPasswordInputEl, sidebarConfirmPasswordContainerEl,
    sidebarConfirmPasswordInputEl, sidebarAuthBtnEl, sidebarAuthErrorEl, sidebarAuthToggleEl;

  let isRegisterMode = false;

  function initAuthDom() {
    sidebarAuthFormContainerEl = domAPI.getElementById("sidebarAuthFormContainer");
    sidebarAuthFormTitleEl = domAPI.getElementById("sidebarAuthFormTitle");
    sidebarAuthFormEl = domAPI.getElementById("sidebarAuthForm");
    sidebarUsernameContainerEl = domAPI.getElementById("sidebarUsernameContainer");
    sidebarUsernameInputEl = domAPI.getElementById("sidebarUsername");
    sidebarEmailInputEl = domAPI.getElementById("sidebarEmail");
    sidebarPasswordInputEl = domAPI.getElementById("sidebarPassword");
    sidebarConfirmPasswordContainerEl = domAPI.getElementById("sidebarConfirmPasswordContainer");
    sidebarConfirmPasswordInputEl = domAPI.getElementById("sidebarConfirmPassword");
    sidebarAuthBtnEl = domAPI.getElementById("sidebarAuthBtn");
    sidebarAuthErrorEl = domAPI.getElementById("sidebarAuthError");
    sidebarAuthToggleEl = domAPI.getElementById("sidebarAuthToggle");
  }

  function clearAuthForm() {
    if (sidebarAuthFormEl) sidebarAuthFormEl.reset();
    if (sidebarAuthErrorEl) domAPI.setTextContent(sidebarAuthErrorEl, "");
  }

  function updateAuthFormUI(isRegister) {
    isRegisterMode = isRegister;
    if (!sidebarAuthFormTitleEl || !sidebarAuthBtnEl || !sidebarConfirmPasswordContainerEl || !sidebarAuthToggleEl || !sidebarUsernameContainerEl || !sidebarEmailInputEl) {
      return;
    }
    const emailContainer = sidebarEmailInputEl.parentElement;
    if (isRegister) {
      domAPI.setTextContent(sidebarAuthFormTitleEl, "Register");
      domAPI.setTextContent(sidebarAuthBtnEl, "Register");
      domAPI.removeClass(sidebarUsernameContainerEl, "hidden");
      domAPI.setAttribute(sidebarUsernameInputEl, "required", "true");
      if (emailContainer) domAPI.removeClass(emailContainer, "hidden");
      domAPI.setAttribute(sidebarEmailInputEl, "required", "true");
      domAPI.removeClass(sidebarConfirmPasswordContainerEl, "hidden");
      domAPI.setAttribute(sidebarConfirmPasswordInputEl, "required", "true");
      domAPI.setTextContent(sidebarAuthToggleEl, "Already have an account? Login");
    } else {
      domAPI.setTextContent(sidebarAuthFormTitleEl, "Login");
      domAPI.setTextContent(sidebarAuthBtnEl, "Login");
      domAPI.removeClass(sidebarUsernameContainerEl, "hidden");
      domAPI.setAttribute(sidebarUsernameInputEl, "required", "true");
      if (emailContainer) domAPI.addClass(emailContainer, "hidden");
      domAPI.removeAttribute(sidebarEmailInputEl, "required");
      domAPI.addClass(sidebarConfirmPasswordContainerEl, "hidden");
      domAPI.removeAttribute(sidebarConfirmPasswordInputEl, "required");
      domAPI.setTextContent(sidebarAuthToggleEl, "Need an account? Register");
    }
    clearAuthForm();
  }

  function setupInlineAuthForm() {
    if (
      !sidebarAuthFormContainerEl ||
      !sidebarAuthFormEl ||
      !sidebarAuthToggleEl
    ) {
      return;
    }

    eventHandlers.trackListener(
      sidebarAuthToggleEl,
      "click",
      (e) => {
        e.preventDefault();
        updateAuthFormUI(!isRegisterMode);
      },
      { description: "Toggle Sidebar Auth Mode", module: MODULE, context: "inlineAuth" }
    );

    eventHandlers.trackListener(
      sidebarAuthFormEl,
      "submit",
      async (e) => {
        e.preventDefault();
        domAPI.setTextContent(sidebarAuthErrorEl, "");
        const username = sidebarUsernameInputEl.value.trim();
        const email = sidebarEmailInputEl.value.trim();
        const password = sidebarPasswordInputEl.value;
        const authModule = DependencySystem.modules.get("auth");

        if (!authModule) {
          domAPI.setTextContent(sidebarAuthErrorEl, "Authentication service unavailable.");
          return;
        }

        domAPI.setProperty(sidebarAuthBtnEl, "disabled", true);
        domAPI.addClass(sidebarAuthBtnEl, "loading");

        try {
          if (isRegisterMode) {
            const confirmPassword = sidebarConfirmPasswordInputEl.value;
            if (!username) throw new Error("Username is required.");
            if (!email) throw new Error("Email is required.");
            if (password !== confirmPassword) throw new Error("Passwords do not match.");
            await authModule.register({ username, email, password });
            updateAuthFormUI(false);
            domAPI.setTextContent(sidebarAuthErrorEl, "Registration successful! Please login.");
          } else {
            if (!username) throw new Error("Username is required.");
            await authModule.login(username, password);
          }
        } catch (error) {
          const errorMessage = error?.message || (isRegisterMode ? "Registration failed." : "Login failed.");
          domAPI.setTextContent(sidebarAuthErrorEl, errorMessage);
        } finally {
          domAPI.setProperty(sidebarAuthBtnEl, "disabled", false);
          domAPI.removeClass(sidebarAuthBtnEl, "loading");
        }
      },
      { description: "Sidebar Auth Form Submit", module: MODULE, context: "inlineAuth" }
    );

    const auth = DependencySystem.modules.get("auth");
    const initiallyAuthenticated = auth?.isAuthenticated?.();
    domAPI.toggleClass(sidebarAuthFormContainerEl, "hidden", !!initiallyAuthenticated);
    if (!initiallyAuthenticated) {
      updateAuthFormUI(false);
    }
  }

  // Split out for external coordination
  function handleGlobalAuthStateChange(event) {
    const authModule = DependencySystem.modules.get("auth");
    const eventAuthDetail = event?.detail?.authenticated;
    const moduleAuthStatus = authModule?.isAuthenticated?.();
    const isAuthenticated = eventAuthDetail ?? moduleAuthStatus;

    if (sidebarAuthFormContainerEl) {
      domAPI.toggleClass(sidebarAuthFormContainerEl, "hidden", !!isAuthenticated);
      if (!isAuthenticated) {
        if (isRegisterMode) updateAuthFormUI(false);
        clearAuthForm();
      }
    }
  }

  // Factory initialization
  // Call initAuthDom ONCE before using any methods
  return {
    initAuthDom,
    setupInlineAuthForm,
    clearAuthForm,
    updateAuthFormUI,
    handleGlobalAuthStateChange,
    get isRegisterMode() { return isRegisterMode; }
  };
}
