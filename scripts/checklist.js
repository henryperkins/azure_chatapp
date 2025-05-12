#!/usr/bin/env node
/**
 * scripts/checklist.js
 *
 * Enhanced checklist-driven static audit for modular frontend JS code.
 * Scans `static/js` and `src` directories (recursively) for anti-patterns
 * (DI, event handling, notifications, state, error, security, testability,
 * timing, readability) and outputs:
 *  • Severity levels & rule IDs
 *  • Colorized, clickable file:line output
 *  • Summary table
 *  • Machine-readable JSON (`--format=json`)
 *  • Grouping by file or by rule (`--group-by`)
 *  • Exit code 1 if any errors are found
 *  • Inline guideline excerpts from markdown docs
 *
 * Usage:
 *   node scripts/checklist.js [--format text|json] [--group-by file|rule]
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import process from 'process';

// ── CLI Options ────────────────────────────────────────────────────────────────

const DEFAULT_GUIDELINES_PATH = fs.existsSync(path.resolve(process.cwd(), '.clinerules/custominstructions.md'))
  ? '.clinerules/custominstructions.md'
  : './custominstructions.md';

const argv = yargs(hideBin(process.argv))
  .option('format', {
    alias: 'f',
    choices: ['text', 'json'],
    default: 'text',
    describe: 'Output format'
  })
  .option('group-by', {
    alias: 'g',
    choices: ['file', 'rule'],
    default: 'file',
    describe: 'Group violations by file or by rule'
  })
  .option('guidelines', {
    alias: 'm',
    type: 'string',
    default: DEFAULT_GUIDELINES_PATH,
    describe: 'Path to markdown guidelines file'
  })
  .option('guideline-max-lines', {
    type: 'number',
    default: 8,
    describe: 'Maximum number of guideline lines to show'
  })
  .help()
  .argv;

// ── Markdown Guidelines Parser ─────────────────────────────────────────────────

/**
 * Loads and parses guidelines from markdown file into a slug→content map
 * @param {string} mdPath - Path to markdown file
 * @returns {Object} - Map of markdown slugs to content sections
 */
function loadGuidelines(mdPath) {
  if (!fs.existsSync(mdPath)) {
    console.warn(chalk.yellow(`Guidelines file not found: ${mdPath}`));
    return {};
  }

  const md = fs.readFileSync(mdPath, 'utf8');
  const guidelines = {};

  try {
    // Parse markdown
    const processor = unified()
      .use(remarkParse);

    const tree = processor.parse(md);

    // Extract content sections by heading (only at depth 2, i.e., ##)
    let currentHeading = null;
    let buffer = [];

    tree.children.forEach(node => {
      if (node.type === 'heading' && node.depth === 2) {
        // Save previous section
        if (currentHeading && buffer.length > 0) {
          // Find the slug annotation if it exists
          const slugLine = buffer.find(line =>
            line.includes('*(slug:') && line.includes(')*'));

          let slugValue = null;
          if (slugLine) {
            const match = slugLine.match(/\*\(slug:\s*['"]?([^'")\s]+)['"]?\)\*/);
            if (match && match[1]) {
              slugValue = match[1];
            }
          }

          // Store the content under BOTH the explicit slug and the simplified anchor name
          if (slugValue) {
            guidelines[slugValue] = buffer.join('\n\n').trim();

            // Also store under simplified anchor names for backward compatibility
            // Extract the main part before any hyphens in qualifiers
            const simplifiedSlug = slugValue.split('-')[0];
            guidelines[simplifiedSlug] = buffer.join('\n\n').trim();
          }
        }

        // Start new section
        currentHeading = node;
        buffer = [];
      } else if (currentHeading) {
        // Serialize node to markdown
        const content = unified()
          .use(remarkStringify)
          .stringify({ type: 'root', children: [node] })
          .trim();

        if (content) buffer.push(content);
      }
    });

    // Save final section
    if (currentHeading && buffer.length > 0) {
      // Similar logic as above for the last section
      const slugLine = buffer.find(line =>
        line.includes('*(slug:') && line.includes(')*'));

      let slugValue = null;
      if (slugLine) {
        const match = slugLine.match(/\*\(slug:\s*['"]?([^'")\s]+)['"]?\)\*/);
        if (match && match[1]) {
          slugValue = match[1];
        }
      }

      if (slugValue) {
        guidelines[slugValue] = buffer.join('\n\n').trim();

        // Also store under simplified anchor names
        const simplifiedSlug = slugValue.split('-')[0];
        guidelines[simplifiedSlug] = buffer.join('\n\n').trim();
      }
    }

    console.log(`Loaded ${Object.keys(guidelines).length} guidelines with slugs: ${Object.keys(guidelines).join(', ')}`);
    return guidelines;
  } catch (err) {
    console.error(chalk.red(`Error parsing guidelines: ${err.message}`));
    return {};
  }
}

// Helper function to extract text from a heading node
function toString(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if (node.children) return node.children.map(toString).join('');
  return '';
}


// Load guidelines at startup
const GUIDELINES_PATH = path.resolve(process.cwd(), argv.guidelines);
const GUIDELINES = loadGuidelines(GUIDELINES_PATH);
console.log(`[DEBUG] Loaded ${Object.keys(GUIDELINES).length} guidelines from ${GUIDELINES_PATH}`);

// ── Configuration ──────────────────────────────────────────────────────────────

const scanDirs = ['static/js', 'src'];

const checks = [
  // Modularity / DI
  {
    id: 'DI-WINDOW',
    severity: 'error',
    // Match window.foo, window['foo'], window["foo"], window[`foo`], window = ..., but NOT as a parameter or in createBrowserService
    regex: /\bwindow\s*(\.|\[)|\bwindow\s*=/,
    desc: 'Direct window global usage',
    suggestion: 'Use injected domAPI or browserService.',
    link: 'custominstructions.md#strict-dependency-injection'
  },
  {
    id: 'DI-DOCUMENT',
    severity: 'error',
    // Match document.foo, document['foo'], document = …, but NOT when passed as
    // an injected parameter identifier.
    regex: /\bdocument\s*(\.|\[)|\bdocument\s*=/,
    desc: 'Direct document global usage',
    suggestion: 'Use injected domAPI abstraction.',
    link: 'custominstructions.md#strict-dependency-injection'
  },
  {
    id: 'DI-GLOBALTHIS',
    severity: 'error',
    regex: /\bglobalThis\./,
    desc: 'Direct globalThis usage',
    suggestion: 'Use injected domAPI or browserService.',
    link: 'custominstructions.md#strict-dependency-injection'
  },
  {
    id: 'DI-REQUIRE',
    severity: 'error',
    regex: /\brequire\s*\(.+?\)/,
    desc: 'Dynamic require',
    suggestion: 'Use static imports or DI factory functions.',
    link: 'custominstructions.md#factory-function-export-pattern'
  },
  {
    id: 'DI-SIDEFFECT-IMPORT',
    severity: 'error',
    regex: /\bimport\s+['"][^'"]+['"]/,
    desc: 'Side-effect import',
    suggestion: 'Only import what you use; avoid singletons.',
    link: 'custominstructions.md#factory-function-export-pattern'
  },

  // Event listener management
  {
    id: 'EV-ADD-EVENT-LISTENER',
    severity: 'error',
    regex: /(?<!trackListener\([^)]*)addEventListener\s*\(/,
    desc: 'Bare addEventListener',
    suggestion: 'Use eventHandlers.trackListener(el, type, handler, { description }).',
    link: 'custominstructions.md#event-listener--cleanup-pattern'
  },

  // Notifications
  {
    id: 'NOT-ALERT',
    severity: 'error',
    regex: /\b(alert|prompt|confirm)\s*\(/,
    desc: 'Direct browser alert/prompt/confirm',
    suggestion: 'Use injected notify utility with context.',
    link: 'custominstructions.md#notifications-via-di'
  },
  {
    id: 'NOT-CONSOLE',
    severity: 'error',
    // Match global console.log/etc, but not domAPI.console or injected usage
    regex: /(?<!domAPI\.|browserService\.|notify\.|\w+\s*=\s*console\s*;)\bconsole\.(log|warn|error|info|debug)\s*\(/,
    desc: 'Direct console output',
    suggestion: 'Use injected notify utility with context.',
    link: 'custominstructions.md#notifications-via-di'
  },

  // State / side-effects
  {
    id: 'STORAGE-LOCALSTORAGE',
    severity: 'error',
    regex: /\blocalStorage\./,
    desc: 'Direct localStorage usage',
    suggestion: 'Use browserService.getItem/setItem/removeItem.',
    link: 'custominstructions.md#storage--abstract-via-injectable'
  },
  {
    id: 'STORAGE-SESSIONSTORAGE',
    severity: 'error',
    regex: /\bsessionStorage\./,
    desc: 'Direct sessionStorage usage',
    suggestion: 'Use browserService.getItem/setItem/removeItem.',
    link: 'custominstructions.md#storage--abstract-via-injectable'
  },

  // Async error handling
  {
    id: 'ASYNC-NO-TRY',
    severity: 'warn',
    regex: /async function\s+\w+\s*\(/,
    desc: 'Async function without try/catch',
    suggestion: 'Wrap in try/catch and use errorReporter.capture().',
    link: 'custominstructions.md#error-handling--context-rich-logging'
  },

  // Security (DOM API)
  {
    id: 'SEC-INNERHTML',
    severity: 'error',
    regex: /\.innerHTML\s*=/,
    desc: 'Direct innerHTML assignment',
    suggestion: 'Sanitize first: el.innerHTML = sanitizer.sanitize(...).',
    link: 'custominstructions.md#dom--security-sanitized-inputs'
  },
  {
    id: 'SEC-OUTERHTML',
    severity: 'error',
    regex: /\.outerHTML\s*=/,
    desc: 'Direct outerHTML assignment',
    suggestion: 'Sanitize first: el.innerHTML = sanitizer.sanitize(...).',
    link: 'custominstructions.md#dom--security-sanitized-inputs'
  },

  // Testability / mockability (network)
  {
    id: 'NET-FETCH',
    severity: 'error',
    regex: /fetch\s*\(/,
    desc: 'Direct fetch',
    suggestion: 'Use injected API client/service.',
    link: 'custominstructions.md#testing--pure-module-contracts'
  },
  {
    id: 'NET-XHR',
    severity: 'error',
    regex: /XMLHttpRequest\s*\(/,
    desc: 'Direct XMLHttpRequest',
    suggestion: 'Use injected API client/service.',
    link: 'custominstructions.md#testing--pure-module-contracts'
  },
  {
    id: 'NET-WS',
    severity: 'error',
    regex: /\bnew WebSocket\s*\(/,
    desc: 'Direct WebSocket usage',
    suggestion: 'Use injectable abstraction.',
    link: 'custominstructions.md#testing--pure-module-contracts'
  },

  // Factory / class exports
  {
    id: 'EXP-DEFAULT',
    severity: 'error',
    regex: /export\s+default\s+[^f]/,
    desc: 'Export default is not a function/class',
    suggestion: 'Export a factory or class (e.g. `export function createX(deps){}`)',
    link: 'custominstructions.md#factory-function-export-pattern'
  },

  // Timing hacks
  {
    id: 'NO-SETTIMEOUT',
    severity: 'warn',
    regex: /\bsetTimeout\s*\(/,
    desc: 'Raw setTimeout used',
    suggestion: 'Use browserService.setTimeout; document reason.',
    link: 'custominstructions.md#injectable-timers'
  },
  {
    id: 'NO-SETINTERVAL',
    severity: 'warn',
    regex: /\bsetInterval\s*\(/,
    desc: 'Raw setInterval used',
    suggestion: 'Use browserService.setInterval; document reason.',
    link: 'custominstructions.md#injectable-timers'
  },
];

// Maximum lines in a function before flagging readability
const MAX_FUNC_LINES = 40;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Recursively collect all .js files under a directory */
function getFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(getFiles(full));
    } else if (entry.endsWith('.js')) {
      // skip sentry-init.js
      if (!/(?:^|[\\/])sentry-init\.js$/.test(full)) {
        results.push(full);
      }
    }
  }
  return results;
}

/** Flag functions longer than MAX_FUNC_LINES */
function detectLargeFunctions(lines, file, violations) {
  let inFn = false, depth = 0, start = 0;
  lines.forEach((line, i) => {
    if (!inFn && /(async\s+)?function\s+\w+|\w+\s*=\s*function/.test(line)) {
      inFn = true; depth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length; start = i;
    } else if (inFn) {
      depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      if (depth <= 0) {
        const len = i - start + 1;
        if (len > MAX_FUNC_LINES) {
          violations.push({
            file, line: start + 1,
            id: 'READ-LONG-FN',
            severity: 'info',
            desc: `Function longer than ${MAX_FUNC_LINES} lines`,
            suggestion: 'Consider refactoring into smaller helper functions.',
            link: 'custominstructions.md#readability--large-functions'
          });
        }
        inFn = false;
      }
    }
  });
}

// ── Scan & Collect Violations ──────────────────────────────────────────────────

const violations = [];

scanDirs.forEach(dir => {
  for (const file of getFiles(dir)) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');

    // Pattern checks
    checks.forEach(rule => {
      lines.forEach((line, idx) => {
        if (rule.regex.test(line)) {
          violations.push({
            file,
            line: idx + 1,
            ...rule
          });
        }
      });
    });

    // Large-function detection
    detectLargeFunctions(lines, file, violations);
  }
});

// ── Summaries ──────────────────────────────────────────────────────────────────

const summary = {
  total: violations.length,
  errors: violations.filter(v => v.severity === 'error').length,
  warnings: violations.filter(v => v.severity === 'warn').length,
  info: violations.filter(v => v.severity === 'info').length
};

// ── Output ─────────────────────────────────────────────────────────────────────

if (argv.format === 'json') {
  console.log(JSON.stringify({ violations, summary }, null, 2));
} else {
  // Text mode
  const colorFor = sev => sev === 'error'
    ? chalk.red
    : sev === 'warn'
      ? chalk.yellow
      : chalk.cyan;

  if (argv['group-by'] === 'rule') {
    // Group by rule ID
    const byRule = violations.reduce((acc, v) => {
      acc[v.id] = acc[v.id] || { ...v, count: 0, occ: [] };
      acc[v.id].count++;
      acc[v.id].occ.push(`${v.file}:${v.line}`);
      return acc;
    }, {});
    for (const ruleId of Object.keys(byRule)) {
      const { desc, severity, count, occ, link } = byRule[ruleId];
      const color = colorFor(severity);
      console.log(color.bold(`[${ruleId}][${severity}] ${desc} — ${count} occurrence(s)`));
      occ.forEach(loc => console.log(`  • ${loc}`));

      // Show guideline if available
      const slug = link?.split('#')[1];
      const guideline = GUIDELINES[slug];
      if (guideline) {
        console.log(chalk.dim('\n  📝 Guideline:'));
        // remove any "*(slug: …)*" lines so only the real example remains
        let lines = guideline
          .split('\n')
          .filter(l => !/^\*\(slug:.*\)\*/.test(l.trim()));
        // Remove leading/trailing blank lines
        while (lines.length && lines[0].trim() === '') lines.shift();
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        // Display the entire guideline including code blocks
        lines.forEach(line =>
          console.log(chalk.dim(`    ${line}`))
        );
      }

      console.log('');
    }
  } else {
    // Default: group by file
    const byFile = violations.reduce((acc, v) => {
      (acc[v.file] = acc[v.file] || []).push(v);
      return acc;
    }, {});
    for (const file of Object.keys(byFile).sort()) {
      console.log(chalk.underline.bold(file));
      // Track which guidelines have been printed for this file
      const printedSlugs = new Set();
      byFile[file].forEach(v => {
        const color = colorFor(v.severity);
        const header = color(`[${v.id}][${v.severity}]`);
        console.log(`  ${v.line}: ${header} ${v.desc}`);
        console.log(`       → ${v.suggestion}`);

        // Show guideline if available, only once per slug per file
        const slug = v.link?.split('#')[1];
        const guideline = GUIDELINES[slug];

        if (guideline && !printedSlugs.has(slug)) {
          console.log(chalk.dim('\n       📝 Guideline:'));
          let lines = guideline
            .split('\n')
            .filter(l => !/^\*\(slug:.*\)\*/.test(l.trim()));
          while (lines.length && lines[0].trim() === '') lines.shift();
          while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
          // Display the entire guideline including code blocks
          lines.forEach(line =>
            console.log(chalk.dim(`         ${line}`))
          );
          printedSlugs.add(slug);
        }
      });
      console.log('');
    }
  }

  // Summary
  console.log(chalk.bold('Summary:'),
    chalk.red(`Errors: ${summary.errors}`),
    chalk.yellow(`Warnings: ${summary.warnings}`),
    chalk.cyan(`Info: ${summary.info}`)
  );
}

// ── Exit Code ───────────────────────────────────────────────────────────────────

process.exit(summary.errors > 0 ? 1 : 0);
