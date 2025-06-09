/**
 * AuthFormHandler - extracted form management helpers (Phase-2)
 * -----------------------------------------------------------
 * Handles form validation, UI interactions, and form-specific logic
 * for authentication forms. Extracted from oversized auth.js module.
 */

export function createAuthFormHandler({
  domAPI,
  sanitizer,
  eventHandlers,
  logger,
  safeHandler
} = {}) {
  const MODULE = 'AuthFormHandler';

  if (!domAPI || !sanitizer || !eventHandlers || !logger || !safeHandler) {
    throw new Error(`[${MODULE}] Required dependencies missing: domAPI, sanitizer, eventHandlers, logger, safeHandler`);
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

  function validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, message: 'Username is required' };
    }
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      return { valid: false, message: 'Username must be at least 3 characters' };
    }
    if (trimmed.length > 50) {
      return { valid: false, message: 'Username must be 50 characters or less' };
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      return { valid: false, message: 'Username can only contain letters, numbers, dots, dashes, and underscores' };
    }
    return { valid: true, value: trimmed };
  }

  function validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return { valid: false, message: 'Password is required' };
    }
    if (password.length < 8) {
      return { valid: false, message: 'Password must be at least 8 characters' };
    }
    if (password.length > 128) {
      return { valid: false, message: 'Password must be 128 characters or less' };
    }
    return { valid: true, value: password };
  }

  function validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, message: 'Email is required' };
    }
    const trimmed = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return { valid: false, message: 'Please enter a valid email address' };
    }
    return { valid: true, value: trimmed };
  }

  function setButtonLoading(btn, isLoading, loadingText = 'Processing...') {
    if (!btn) return;

    try {
      if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = loadingText;
        domAPI.addClass(btn, 'loading');
      } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || btn.textContent;
        domAPI.removeClass(btn, 'loading');
        delete btn.dataset.originalText;
      }
    } catch (err) {
      _logError('Failed to set button loading state', err, { isLoading, loadingText });
    }
  }

  function showError(container, message) {
    if (!container || !message) return;

    try {
      let errorEl = container.querySelector('.error-message');
      if (!errorEl) {
        errorEl = domAPI.createElement('div');
        errorEl.className = 'error-message text-error text-sm mt-2';
        domAPI.appendChild(container, errorEl);
      }
      domAPI.setTextContent(errorEl, sanitizer.sanitize(message));
      domAPI.removeClass(errorEl, 'hidden');
    } catch (err) {
      _logError('Failed to show error message', err, { message });
    }
  }

  function hideError(container) {
    if (!container) return;

    try {
      const errorEl = container.querySelector('.error-message');
      if (errorEl) {
        domAPI.addClass(errorEl, 'hidden');
      }
    } catch (err) {
      _logError('Failed to hide error message', err);
    }
  }

  function clearForm(formEl) {
    if (!formEl) return;

    try {
      const inputs = formEl.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
      inputs.forEach(input => {
        input.value = '';
        hideError(input.parentElement);
      });
    } catch (err) {
      _logError('Failed to clear form', err);
    }
  }

  function bindFormSubmission(formEl, onSubmit, { context = MODULE } = {}) {
    if (!formEl || typeof onSubmit !== 'function') {
      _logError('bindFormSubmission: form and onSubmit handler required');
      return;
    }

    const handler = safeHandler(async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const formData = new FormData(formEl);
      const data = Object.fromEntries(formData.entries());

      try {
        await onSubmit(data, formEl);
      } catch (err) {
        _logError('Form submission failed', err, { formId: formEl.id });
      }
    }, `${context}:FormSubmit`);

    eventHandlers.trackListener(formEl, 'submit', handler, {
      context,
      description: 'FormSubmission'
    });

    _log('Form submission bound', { formId: formEl.id, context });
  }

  function bindInputValidation(inputEl, validator, { context = MODULE } = {}) {
    if (!inputEl || typeof validator !== 'function') {
      _logError('bindInputValidation: input and validator required');
      return;
    }

    const handler = safeHandler(() => {
      const value = inputEl.value;
      const result = validator(value);

      const container = inputEl.parentElement;
      if (result.valid) {
        hideError(container);
        domAPI.removeClass(inputEl, 'input-error');
      } else {
        showError(container, result.message);
        domAPI.addClass(inputEl, 'input-error');
      }
    }, `${context}:InputValidation`);

    eventHandlers.trackListener(inputEl, 'blur', handler, {
      context,
      description: 'InputValidation'
    });
  }

  function extendProps(target, props) {
    if (target && props) Object.assign(target, props);
  }

  function applyStyles(target, styles) {
    if (target && styles) Object.assign(target.style, styles);
  }

  return {
    // Validation functions
    validateUsername,
    validatePassword,
    validateEmail,

    // UI helper functions
    setButtonLoading,
    showError,
    hideError,
    clearForm,

    // Event binding functions
    bindFormSubmission,
    bindInputValidation,

    // Utility functions
    extendProps,
    applyStyles,

    cleanup() {
      _log('cleanup()');
      eventHandlers.cleanupListeners({ context: 'authFormHandler' });
    }
  };
}

export default createAuthFormHandler;
