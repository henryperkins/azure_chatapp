/**
 * validateDeps.js
 *
 * Lightweight helper to enforce strict Dependency Injection.
 * Each factory passes its deps bag and an array of required keys.
 *
 * @param {string} moduleName - Name of the caller module (for error context).
 * @param {Object} deps - Dependency bag provided by the caller.
 * @param {string[]} requiredKeys - List of property names that MUST exist on `deps`.
 *
 * @throws {Error} If any required key is missing or falsy.
 */
export function validateDeps(moduleName, deps = {}, requiredKeys = []) {
  if (!deps || typeof deps !== 'object') {
    throw new Error(`[${moduleName}] deps must be an object`);
  }

  const missing = requiredKeys.filter((key) => !deps[key]);
  if (missing.length) {
    throw new Error(
      `[${moduleName}] missing required dependencies: ${missing.join(', ')}`
    );
  }
}
