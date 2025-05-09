/**
 * session.js - Generate and provide a session UUID for this app/browser tab.
 * Used for correlating frontend logs/errors across notifications.
 */
let sessionId = null;
function generateSessionId() {
  // Generate RFC4122v4 string with fallback if crypto not present
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'ssn-xxxxxxxxyxxxxxxxyxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
export function getSessionId() {
  if (!sessionId) sessionId = generateSessionId();
  return sessionId;
}
