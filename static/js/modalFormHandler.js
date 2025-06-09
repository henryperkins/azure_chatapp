/**
 * ModalFormHandler - extracted modal form management (Phase-2)
 * -----------------------------------------------------------
 * Handles form operations within modals, form validation,
 * modal-specific form behaviors. Extracted from oversized modalManager.js.
 */

const MODULE_CONTEXT = 'modalFormHandler';

export function createModalFormHandler({
  domAPI,
  eventHandlers,
  logger,
  sanitizer,
  safeHandler
} = {}) {
  const MODULE = 'ModalFormHandler';

  if (!domAPI || !eventHandlers || !logger || !sanitizer || !safeHandler) {
    throw new Error(`[${MODULE}] Required dependencies missing: domAPI, eventHandlers, logger, sanitizer, safeHandler`);
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

  function bindModalForm(modalEl, formSelector, onSubmit, options = {}) {
    if (!modalEl || !formSelector || typeof onSubmit !== 'function') {
      _logError('bindModalForm: modalEl, formSelector, and onSubmit required');
      return false;
    }

    try {
      const form = modalEl.querySelector(formSelector);
      if (!form) {
        _logError('Form not found in modal', null, { modalId: modalEl.id, formSelector });
        return false;
      }

      const {
        validateOnSubmit = true,
        clearOnSuccess = true,
        closeOnSuccess = true,
        context = MODULE
      } = options;

      const submitHandler = safeHandler(async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // Validate if required
        if (validateOnSubmit) {
          const validation = validateModalForm(form);
          if (!validation.valid) {
            showFormErrors(form, validation.errors);
            return;
          }
        }

        try {
          clearFormErrors(form);
          setFormLoading(form, true);

          const result = await onSubmit(data, form, modalEl);

          if (result !== false) {
            if (clearOnSuccess) {
              clearModalForm(form);
            }

            if (closeOnSuccess) {
              // Emit event to close modal
              eventHandlers.dispatchEvent(modalEl, 'modal:requestClose', {
                source: 'formSuccess',
                modalId: modalEl.id
              });
            }
          }
        } catch (err) {
          _logError('Modal form submission failed', err, { modalId: modalEl.id });
          showFormErrors(form, [err.message || 'An error occurred']);
        } finally {
          setFormLoading(form, false);
        }
      }, `${context}:ModalFormSubmit`);

      eventHandlers.trackListener(form, 'submit', submitHandler, {
        context,
        description: `ModalForm_${modalEl.id}`
      });

      _log('Modal form bound', { modalId: modalEl.id, formSelector });
      return true;
    } catch (err) {
      _logError('Failed to bind modal form', err, { modalId: modalEl.id, formSelector });
      return false;
    }
  }

  function validateModalForm(form) {
    if (!form) {
      return { valid: false, errors: ['Form element required'] };
    }

    const errors = [];

    try {
      // Get all required inputs
      const requiredInputs = form.querySelectorAll('input[required], select[required], textarea[required]');

      requiredInputs.forEach(input => {
        const value = input.value?.trim();
        const fieldName = input.name || input.id || 'Unknown field';

        if (!value) {
          errors.push(`${fieldName} is required`);
          domAPI.addClass(input, 'input-error');
        } else {
          domAPI.removeClass(input, 'input-error');
        }

        // Email validation
        if (input.type === 'email' && value) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            errors.push(`${fieldName} must be a valid email address`);
            domAPI.addClass(input, 'input-error');
          }
        }

        // URL validation
        if (input.type === 'url' && value) {
          try {
            new URL(value);
            domAPI.removeClass(input, 'input-error');
          } catch {
            errors.push(`${fieldName} must be a valid URL`);
            domAPI.addClass(input, 'input-error');
          }
        }

        // Number validation
        if (input.type === 'number' && value) {
          const num = parseFloat(value);
          if (isNaN(num)) {
            errors.push(`${fieldName} must be a valid number`);
            domAPI.addClass(input, 'input-error');
          } else {
            const min = parseFloat(input.min);
            const max = parseFloat(input.max);

            if (!isNaN(min) && num < min) {
              errors.push(`${fieldName} must be at least ${min}`);
              domAPI.addClass(input, 'input-error');
            }

            if (!isNaN(max) && num > max) {
              errors.push(`${fieldName} must be at most ${max}`);
              domAPI.addClass(input, 'input-error');
            }
          }
        }
      });

      const result = { valid: errors.length === 0, errors };
      _log('Modal form validation', {
        valid: result.valid,
        errorCount: errors.length,
        formId: form.id
      });

      return result;
    } catch (err) {
      _logError('Form validation failed', err, { formId: form.id });
      return { valid: false, errors: ['Validation error occurred'] };
    }
  }

  function showFormErrors(form, errors) {
    if (!form || !Array.isArray(errors)) return;

    try {
      clearFormErrors(form);

      if (errors.length === 0) return;

      // Create or update error container
      let errorContainer = form.querySelector('.form-errors');
      if (!errorContainer) {
        errorContainer = domAPI.createElement('div');
        errorContainer.className = 'form-errors alert alert-error mt-3';

        // Insert at top of form
        const firstChild = form.firstElementChild;
        if (firstChild) {
          form.insertBefore(errorContainer, firstChild);
        } else {
          form.appendChild(errorContainer);
        }
      }

      // Create error list
      const errorList = domAPI.createElement('ul');
      errorList.className = 'list-disc list-inside space-y-1';

      errors.forEach(error => {
        const li = domAPI.createElement('li');
        domAPI.setTextContent(li, sanitizer.sanitize(error));
        domAPI.appendChild(errorList, li);
      });

      // Clear and add new errors
      domAPI.removeAllChildren(errorContainer);
      domAPI.appendChild(errorContainer, errorList);

      domAPI.removeClass(errorContainer, 'hidden');

      _log('Form errors displayed', { errorCount: errors.length, formId: form.id });
    } catch (err) {
      _logError('Failed to show form errors', err, { formId: form.id });
    }
  }

  function clearFormErrors(form) {
    if (!form) return;

    try {
      const errorContainer = form.querySelector('.form-errors');
      if (errorContainer) {
        domAPI.addClass(errorContainer, 'hidden');
        domAPI.removeAllChildren(errorContainer);
      }

      // Remove error classes from inputs
      const errorInputs = form.querySelectorAll('.input-error');
      errorInputs.forEach(input => {
        domAPI.removeClass(input, 'input-error');
      });

      _log('Form errors cleared', { formId: form.id });
    } catch (err) {
      _logError('Failed to clear form errors', err, { formId: form.id });
    }
  }

  function setFormLoading(form, isLoading) {
    if (!form) return;

    try {
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      const inputs = form.querySelectorAll('input, select, textarea, button');

      if (isLoading) {
        // Disable all form elements
        inputs.forEach(input => {
          input.disabled = true;
        });

        // Update submit button
        if (submitBtn) {
          submitBtn.dataset.originalText = submitBtn.textContent || submitBtn.value;
          if (submitBtn.tagName === 'BUTTON') {
            submitBtn.textContent = 'Processing...';
          } else {
            submitBtn.value = 'Processing...';
          }
          domAPI.addClass(submitBtn, 'loading');
        }

        domAPI.addClass(form, 'form-loading');
      } else {
        // Enable all form elements
        inputs.forEach(input => {
          input.disabled = false;
        });

        // Restore submit button
        if (submitBtn) {
          const originalText = submitBtn.dataset.originalText;
          if (originalText) {
            if (submitBtn.tagName === 'BUTTON') {
              submitBtn.textContent = originalText;
            } else {
              submitBtn.value = originalText;
            }
            delete submitBtn.dataset.originalText;
          }
          domAPI.removeClass(submitBtn, 'loading');
        }

        domAPI.removeClass(form, 'form-loading');
      }

      _log('Form loading state changed', { isLoading, formId: form.id });
    } catch (err) {
      _logError('Failed to set form loading state', err, { formId: form.id, isLoading });
    }
  }

  function clearModalForm(form) {
    if (!form) return;

    try {
      // Clear text inputs, textareas, and selects
      const inputs = form.querySelectorAll('input[type="text"], input[type="email"], input[type="url"], input[type="number"], input[type="password"], textarea, select');
      inputs.forEach(input => {
        if (input.tagName === 'SELECT') {
          input.selectedIndex = 0;
        } else {
          input.value = '';
        }
      });

      // Clear checkboxes and radio buttons
      const checkboxes = form.querySelectorAll('input[type="checkbox"], input[type="radio"]');
      checkboxes.forEach(input => {
        input.checked = false;
      });

      // Clear any errors
      clearFormErrors(form);

      _log('Modal form cleared', { formId: form.id });
    } catch (err) {
      _logError('Failed to clear modal form', err, { formId: form.id });
    }
  }

  function populateModalForm(form, data) {
    if (!form || !data || typeof data !== 'object') return false;

    try {
      Object.entries(data).forEach(([name, value]) => {
        const input = form.querySelector(`[name="${name}"], #${name}`);
        if (input) {
          if (input.type === 'checkbox' || input.type === 'radio') {
            input.checked = Boolean(value);
          } else if (input.tagName === 'SELECT') {
            input.value = value;
          } else {
            input.value = String(value || '');
          }
        }
      });

      _log('Modal form populated', { formId: form.id, fieldsCount: Object.keys(data).length });
      return true;
    } catch (err) {
      _logError('Failed to populate modal form', err, { formId: form.id });
      return false;
    }
  }

  function getFormData(form) {
    if (!form) return null;

    try {
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      // Handle checkboxes that aren't checked (they won't be in FormData)
      const checkboxes = form.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(checkbox => {
        if (!Object.prototype.hasOwnProperty.call(data, checkbox.name)) {
          data[checkbox.name] = false;
        } else {
          data[checkbox.name] = true;
        }
      });

      return data;
    } catch (err) {
      _logError('Failed to get form data', err, { formId: form.id });
      return null;
    }
  }

  return {
    // Form binding and handling
    bindModalForm,

    // Form validation
    validateModalForm,

    // Error handling
    showFormErrors,
    clearFormErrors,

    // Form state management
    setFormLoading,
    clearModalForm,
    populateModalForm,
    getFormData,

    cleanup() {
      _log('cleanup()');
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
  };
}

export default createModalFormHandler;
