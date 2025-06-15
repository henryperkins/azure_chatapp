/**
 * jsonUtils.js — pure JSON helpers.
 * Provides stableStringify and safeParseJSON functions.
 */

export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(",")}}`;
}

export function safeParseJSON(str) {
  if (typeof str !== "string") {
    throw new Error('[safeParseJSON] Input not a string and fallback is forbidden.');
  }
  try {
    return JSON.parse(str);
  } catch (err) {
    throw new Error('[safeParseJSON] JSON parse failed and fallback is forbidden: ' + (err?.message || err));
  }
}