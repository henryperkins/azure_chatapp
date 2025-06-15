/**
 * urlUtils.js — pure URL helpers.
 * Provides isAbsoluteUrl and shouldSkipDedup functions.
 */

/** True ⇢ `url` already contains a protocol or starts with ‘//’. */
export function isAbsoluteUrl(url = '') {
  return /^(?:[a-z]+:)?\/\//i.test(String(url));
}

const DEDUP_EXCLUSION_RE = /\/api\/log_notification\b|\/(sse|stream|events)\b/i;

/**
 * Returns true when a GET request to `url` should NOT be deduplicated
 * (each call is unique even if the URL string repeats).
 */
export function shouldSkipDedup(url = '') {
  return DEDUP_EXCLUSION_RE.test(url);
}