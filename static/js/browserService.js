/**
 * browserService.js
 *
 * Dependency-injectable wrapper for browser APIs.
 * No direct window/global usage in consuming modules.
 */

export const browserService = {
  // Location
  getLocationHref() {
    return typeof window !== 'undefined' ? window.location.href : '';
  },

  // History
  setHistory(url) {
    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      window.history.replaceState({}, '', url);
    }
  },

  // URL Search Params
  getSearchParam(key) {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      return url.searchParams.get(key);
    }
    return null;
  },

  setSearchParam(key, value) {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set(key, value);
      window.history.replaceState({}, '', url.toString());
    }
  },

  removeSearchParam(key) {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete(key);
      window.history.replaceState({}, '', url.toString());
    }
  },

  // Local Storage
  setItem(key, value) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  },

  getItem(key) {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    return null;
  },

  removeItem(key) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  },

  // Timers
  setTimeout(fn, ms) {
    return typeof setTimeout === 'function' ? setTimeout(fn, ms) : null;
  },

  requestAnimationFrame(fn) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(fn);
    }
    // Fallback for non-browser/test environments
    return this.setTimeout(fn, 0);
  }
};
