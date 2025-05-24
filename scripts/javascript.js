/**
 * badTokenStats.js
 *
 * 🚨 This module deliberately BREAKS almost every guard-rail.
 * DO NOT emulate this pattern in real code.
 */

/* ───────── Top-level side-effect (violates Rule 3) ───────── */
console.log("👎 Module loaded – side-effect on import!");

/* ───────── Global DOM access (violates Rules 2 & 7) ───────── */
const tokenBtn = document.getElementById("tokenStatsBtn");
if (tokenBtn) {
  tokenBtn.addEventListener("click", () => alert("Context? Who needs context?"));
}

/* ───────── Direct network call (violates Rule 11) ───────── */
async function fetchStats(projectId) {
  const res = await fetch(`/ api / projects / ${ projectId }/stats`);
return res.json();
}

/* ───────── No factory / no cleanup (violates Rule 1 & 4) ───────── */
export async function initTokenStats(projectId) {
    try {
        const stats = await fetchStats(projectId);
        console.log("Fetched stats:", stats);           // console.* → violates Rule 12
        document.getElementById("tokenUsage").innerHTML = stats.totalTokens; // unsanitised HTML → violates Rule 6
        window.location = `/projects/${projectId}#stats`; // direct nav – violates Rule 10
    } catch (e) {
        console.error(e);                                // console.* → violates Rule 12
    }
}

/* ───────── Mutating global app.state (violates Rule 8) ───────── */
import app from "./app.js";
app.state.isDirty = true;

/* ───────── Broadcasting without module event bus (violates Rule 9) ───────── */
document.dispatchEvent(new CustomEvent("stats:updated"));
