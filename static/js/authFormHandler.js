/**
 * @file authFormHandler.js
 * @description Manages all UI interactions for authentication forms, including validation and state changes.
 */

const MODULE_CONTEXT = 'AuthFormHandler';

export function createAuthFormHandler(dependencies) {
    const { domAPI, eventHandlers, logger, sanitizer, safeHandler } = dependencies;

    const requiredDeps = ['domAPI', 'eventHandlers', 'logger', 'sanitizer', 'safeHandler'];
    for (const dep of requiredDeps) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    const formElements = {
        login: domAPI.getElementById('loginModalForm'),
        register: domAPI.getElementById('registerModalForm'),
    };

    function _validateField(value, { minLength = 0, pattern, errorMessage }) {
        if (!value || value.length < minLength) {
            throw new Error(errorMessage);
        }
        if (pattern && !pattern.test(value)) {
            throw new Error(errorMessage);
        }
    }

    function _getErrorContainer(form) {
        return form?.querySelector('.error-message-area');
    }

    return {
        /* ---------------------- Validation ---------------------- */
        validate(username, password, email) {
            _validateField(username, {
                minLength: 3,
                errorMessage: 'Username must be at least 3 characters.',
            });
            _validateField(password, {
                minLength: 8,
                errorMessage: 'Password must be at least 8 characters.',
            });
            if (email !== undefined) {
                _validateField(email, {
                    pattern: /.+@.+\\..+/,
                    errorMessage: 'Please enter a valid email address.',
                });
            }
        },

        /* ---------------------- UI helpers ---------------------- */
        displayError(formType, message) {
            const form = formElements[formType];
            const errorEl = _getErrorContainer(form);
            if (errorEl) {
                errorEl.textContent = sanitizer.sanitize(message);
                domAPI.removeClass(errorEl, 'hidden');
            } else {
                logger.warn(
                    `[${MODULE_CONTEXT}] No error container found for ${formType}`,
                );
            }
        },

        showSuccess(formType, message) {
            const form = formElements[formType];
            const successEl = form?.querySelector('.success-message-area');
            if (successEl) {
                successEl.textContent = sanitizer.sanitize(message);
                domAPI.removeClass(successEl, 'hidden');
            }
        },

        /* ---------------------- Binding ------------------------- */
        bindSubmissions({ login, register }) {
            if (formElements.login) {
                eventHandlers.trackListener(
                    formElements.login,
                    'submit',
                    safeHandler(async (e) => {
                        e.preventDefault();
                        const data = Object.fromEntries(
                            new FormData(formElements.login).entries(),
                        );
                        await login(data);
                    }),
                    { context: MODULE_CONTEXT },
                );
            }

            if (formElements.register) {
                eventHandlers.trackListener(
                    formElements.register,
                    'submit',
                    safeHandler(async (e) => {
                        e.preventDefault();
                        const data = Object.fromEntries(
                            new FormData(formElements.register).entries(),
                        );
                        await register(data);
                    }),
                    { context: MODULE_CONTEXT },
                );
            }
        },

        cleanup() {
            eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
        },
    };
}
