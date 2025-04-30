// Canonical utilities shared across app
import { isValidProjectId } from '../projectManager.js';

// Checks if the current user is authenticated based on canonical state
export function isAuthenticated() {
  return window.app?.state?.isAuthenticated === true;
}

// Unified notification handler
export function showNotification(msg, type = 'info', dur = 5000) {
  if (window.notificationHandler?.show) {
    window.notificationHandler.show(msg, type, { timeout: dur });
  } else {
    console[type === 'error' ? 'error' : 'log'](`[${type}] ${msg}`);
  }
}

export { isValidProjectId }; // re-export as canonical
