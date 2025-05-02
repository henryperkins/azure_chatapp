// scripts/checklist-verify.js
// Checklist-driven static audit for modular frontend JS code.
//
// Scans static/js and src for "red flag" anti-patterns violating architecture checklist (DI, event handling, notification, state, error, security, testability).
//
// To run: `node scripts/checklist-verify.js`
//
// Add new rules heuristically via checks array below.

import fs from 'fs';
import path from 'path';

const scanDirs = ['static/js']; // Add 'src' if your app uses it

// Catalog of JS checklist/static code smells. Comments show which principle is targeted.
const checks = [
  // 1. Modularity / DI: forbidden global/window and direct imports
  { regex: /\bwindow\./, desc: 'Direct window global usage (No globals/Modularity)' },
  { regex: /\bglobalThis\./, desc: 'Direct globalThis usage (No globals/Modularity)' },
  { regex: /\brequire\s*\(.+?\)/, desc: 'Dynamic require (DI/Modularity)' },
  { regex: /\bimport\s+['"][^'"]+['"]/, desc: 'Side-effect import (must import only used, no singletons)' },

  // 2. Tracked Listener Management
  { regex: /(?<!trackListener\([^)]*)addEventListener\s*\(/, desc: 'Bare addEventListener (must use trackListener)' },

  // 3. Notification Routing
  { regex: /\b(alert|prompt|confirm)\s*\(/, desc: 'Direct browser alert/prompt/confirm (must use notificationHandler)' },
  { regex: /\bconsole\.(log|warn|error|info|debug)\s*\(/, desc: 'Direct console output (must use notificationHandler)' },

  // 4. State/Side effects: (mutation to window/localStorage/global)
  { regex: /\blocalStorage\./, desc: 'Direct localStorage usage (abstract via injectable)' },
  { regex: /\bsessionStorage\./, desc: 'Direct sessionStorage usage (abstract via injectable)' },

  // 5. Error handling (async): async function with no try/catch inside (approx heuristic only)
  { regex: /async function\s+\w+\s*\(/, desc: 'Async function detected (check for try/catch inside)' },

  // 6. Security (DOM API unsafe use)
  { regex: /\.innerHTML\s*=/, desc: 'Direct innerHTML assignment (must sanitize with DOMPurify or equivalent)' },
  { regex: /\.outerHTML\s*=/, desc: 'Direct outerHTML assignment (dangerous, sanitize and validate context)' },

  // 7. Testability/Mockability
  { regex: /fetch\s*\(/, desc: 'Direct fetch (should use injectable API client)' },
  { regex: /XMLHttpRequest\s*\(/, desc: 'Direct XMLHttpRequest (should use injectable API client)' },
  { regex: /\bnew WebSocket\s*\(/, desc: 'Direct WebSocket usage (should be injectably abstracted)' },

  // 8. Factory/Class Exports (not static singleton)
  { regex: /export\s+default\s+[^f]/, desc: 'Export default is not a function/class (must export factory or class)' },

  // 9. Timing hacks
  { regex: /\bsetTimeout\s*\(/, desc: 'Raw setTimeout (timing hacks discouraged, clarify reason)' },
  { regex: /\bsetInterval\s*\(/, desc: 'Raw setInterval (timing hacks discouraged, clarify reason)' },
];

// Helper: get all JS files in directory (one level, see audit.js pattern)
function getFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(dir, f));
}

// Main audit
scanDirs.forEach(dir => {
  getFiles(dir).forEach(file => {
    // Skip sentry-init.js from all checks
    if (path.basename(file) === 'sentry-init.js') return;

    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let flagged = false;

    checks.forEach(({ regex, desc }) => {
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          if (!flagged) {
            console.log(`\n=== ${file} ===`);
            flagged = true;
          }
          console.log(`  Line ${idx + 1}: ⚠️ ${desc}\n    > ${line.trim()}`);
        }
      });
    });

    // Extra: warn on large functions (readability)
    let funcLine = -1;
    for (let i = 0; i < lines.length; ++i) {
      if (/function\s+\w+\s*\(/.test(lines[i]) || /^\s*\w+\s*=\s*function\s*\(/.test(lines[i])) {
        funcLine = i;
      }
      // end of function?
      if (funcLine !== -1 && lines[i].includes('}') && ((i - funcLine) > 40)) {
        console.log(`  Line ${funcLine + 1}: ⚠️ Function > 40 lines (Readability)\n    > Starts: ${lines[funcLine].trim()}`);
        funcLine = -1;
      }
    }
  });
});

console.log('\nAudit complete. Please review any flagged issues per the modular architecture checklist.');
