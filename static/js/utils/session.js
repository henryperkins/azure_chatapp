/**
 * session.js - Generate and provide a session UUID for this app/browser tab.
 * Used for correlating frontend logs/errors across notifications.
 */
let sessionId = null;
let _browserService = null;
export function setBrowserService(bs) { _browserService = bs; }
function generateSessionId() {
  // Generate RFC4122v4 string; crypto randomUUID is required
  const cryptoObj = _browserService?.getWindow?.()?.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  throw new Error('[session.js] crypto.randomUUID is required; fallback UUID generation is forbidden.');
}
export function getSessionId() {
  if (!sessionId) sessionId = generateSessionId();
  return sessionId;
}
export function resetSessionId(){ sessionId=null; }

export function createSessionManager({ browserService, logger } = {}) {
  if (!browserService) throw new Error('[session] browserService required');
  setBrowserService(browserService);
  const log = logger ?? { debug(){}, error(){} };
  return {
    getSessionId,
    resetSessionId,
    cleanup () {
      resetSessionId();
      setBrowserService(null);
      log.debug('[session] cleaned up', { context: 'session:cleanup' });
    }
  };
}
