#!/usr/bin/env node
/* eslint-env node */
/* global process */
/*
  patternChecker.js

  Scans your JavaScript code for violations of frontend coding patterns.

  Usage:
    1) npm install --save-dev @babel/core @babel/parser @babel/traverse
    2) node patternChecker.js <file1.js> [file2.js...]
*/

"use strict";

const fs = require("fs");
const path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;

////////////////////////////////////////////////////////////////////////////////
// Visitor-merging helper
////////////////////////////////////////////////////////////////////////////////
function mergeVisitors(...visitors) {
  const merged = {};
  visitors.forEach((v) => {
    if (!v) return; // Skip null/undefined visitors
    Object.entries(v).forEach(([key, fn]) => {
      if (typeof fn === 'function') {
        (merged[key] ??= []).push(fn);
      }
    });
  });
  Object.keys(merged).forEach((k) => {
    const chain = merged[k];
    merged[k] = function (path) {
      chain.forEach((f) => {
        if (typeof f === 'function') {
          f(path);
        }
      });
    };
  });
  return merged;
}

////////////////////////////////////////////////////////////////////////////////
// CLI symbols
////////////////////////////////////////////////////////////////////////////////
const SYMBOLS = {
  error: "✖",
  warning: "⚠",
  info: "ℹ",
  success: "✓",
  bullet: "•",
  pointer: "❯",
  arrowRight: "→",
  shield: "🛡️",
  lock: "🔒",
  alert: "🚨",
  light: "💡",
};

////////////////////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////////////////////
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`${SYMBOLS.error} Unable to read file: ${filePath}\n`, err);
    return null;
  }
}

function getLineContent(fullCode, lineNumber) {
  if (!fullCode || typeof lineNumber !== "number" || lineNumber < 1) return "";
  const lines = fullCode.split(/\r?\n/);
  return lines[lineNumber - 1]?.trim() ?? "";
}

// Helper to safely get property key name
function getPropertyKeyName(prop) {
  if (!prop || !prop.key) return null;

  if (prop.key.type === "Identifier") {
    return prop.key.name;
  } else if (prop.key.type === "StringLiteral") {
    return prop.key.value;
  }

  return null;
}

// Check if an object expression has a property with a specific name
function hasProperty(objExpr, propName) {
  if (!objExpr || objExpr.type !== "ObjectExpression" || !objExpr.properties) {
    return false;
  }

  return objExpr.properties.some(prop => {
    const keyName = getPropertyKeyName(prop);
    return keyName === propName;
  });
}

////////////////////////////////////////////////////////////////////////////////
// Guardrail check visitors 1-17
////////////////////////////////////////////////////////////////////////////////

/* ---------- 1) Factory Function Export ---------- */
function checkFactoryFunctionExportPattern(errors, filePath) {
  const state = { foundExport: false };

  return {
    ExportNamedDeclaration(pathNode) {
      const decl = pathNode.node.declaration;
      if (decl?.type !== "FunctionDeclaration") return;

      const fnName = decl.id?.name;
      if (!fnName?.startsWith("create")) return;

      state.foundExport = true;

      const hasDepsParam = decl.params.length > 0;
      let hasDepValidation = false;
      let hasNew = false;

      pathNode.traverse({
        IfStatement(inner) {
          if (/throw new Error\([^)]*dependency/i.test(inner.toString()))
            hasDepValidation = true;
        },
        NewExpression() {
          hasNew = true;
        },
      });

      if (!hasDepsParam)
        errors.push({
          filePath,
          line: decl.loc.start.line,
          message:
            `Factory "${fnName}" should accept 'deps' as its first argument. (factory-function-export-pattern)`,
          hint: `Example: export function ${fnName}(deps) { /* ... */ }`,
          node: decl,
          ruleId: 1,
        });
      if (!hasDepValidation)
        errors.push({
          filePath,
          line: decl.loc.start.line,
          message:
            `Factory "${fnName}" must validate injected dependencies at the top. (factory-function-export-pattern)`,
          hint: "Check required deps at start and throw if missing.",
          node: decl,
          ruleId: 1,
        });
      if (!hasNew)
        errors.push({
          filePath,
          line: decl.loc.start.line,
          message:
            `Factory "${fnName}" should return a new instance (via new …). (factory-function-export-pattern)`,
          hint: "return new MyModule(deps);",
          node: decl,
          ruleId: 1,
        });
    },
    Program: {
      exit() {
        if (!state.foundExport)
          errors.push({
            filePath,
            line: 1,
            message:
              "Missing 'export function createXyz(deps)' factory export. (factory-function-export-pattern)",
            hint: "Module must export a named factory function.",
            ruleId: 1,
          });
      },
    },
  };
}

/* ---------- 2 & 6) Strict DI / Notify instead of console/alert ---------- */
function checkNoGlobalUsage(errors, filePath) {
  return {
    MemberExpression(pathNode) {
      const obj = pathNode.node.object;
      if (!obj?.name) return;

      if (["document", "window"].includes(obj.name) && obj.name !== "globalThis") {
        errors.push({
          filePath,
          line: pathNode.node.loc.start.line,
          message:
            `Use injected dependencies instead of ${obj.name}. (strict-dependency-injection)`,
          hint: "const el = domAPI.getElementById('something');",
          node: pathNode.node,
          ruleId: 2,
        });
      } else if (obj.name === "console") {
        errors.push({
          filePath,
          line: pathNode.node.loc.start.line,
          message:
            "Do not use console.*; inject a notify or errorReporter instead. (notifications-via-di)",
          hint:
            "notify.info('msg', { module: 'MyModule', context: 'myFunction' })",
          node: pathNode.node,
          ruleId: 6,
        });
      }
    },
    CallExpression(pathNode) {
      if (pathNode.node.callee.name === "alert") {
        errors.push({
          filePath,
          line: pathNode.node.loc.start.line,
          message: "Use notify instead of alert(). (notifications-via-di)",
          hint:
            "notify.info('User message', { module: 'MyModule', context: 'myFunction' })",
          node: pathNode.node,
          ruleId: 6,
        });
      }
    },
  };
}

/* ---------- 3) Pure imports (no side-effects) ---------- */
function checkPureModuleContracts(errors, filePath) {
  return {
    Program: {
      exit(pathNode) {
        pathNode.node.body.forEach((node) => {
          if (
            node.type === "ImportDeclaration" ||
            node.type === "VariableDeclaration" ||
            (node.type === "ExpressionStatement" &&
              node.expression.type === "Literal" &&
              node.expression.value === "use strict")
          )
            return;

          errors.push({
            filePath,
            line: node.loc.start.line,
            message:
              "Found top-level side-effect; move into the factory. (pure-imports)",
            hint: "Wrap logic in createXyz(...) and export that factory.",
            node,
            ruleId: 3,
          });
        });
      },
    },
  };
}

/* ---------- 4 & 5) Centralised event handling / context tags ---------- */
function checkEventListenerCleanup(errors, filePath) {
  const state = { usesTrack: false, hasCleanup: false, cleanupHasContext: false };

  return {
    CallExpression(pathNode) {
      const { callee, arguments: args } = pathNode.node;

      // eventHandlers.trackListener
      if (
        callee.type === "MemberExpression" &&
        callee.object.name === "eventHandlers" &&
        callee.property.name === "trackListener"
      ) {
        state.usesTrack = true;

        const last = args[args.length - 1];
        const ok = last?.type === "ObjectExpression" &&
                   hasProperty(last, "context");
        if (!ok) {
          errors.push({
            filePath,
            line: pathNode.node.loc.start.line,
            message:
              "Missing context tag in eventHandlers.trackListener. (event-context-tag-missing)",
            hint:
              "eventHandlers.trackListener(el, 'click', handler, { context: 'sidebar-menu' })",
            node: pathNode.node,
            ruleId: 5,
          });
        }
      }

      // direct addEventListener on globals
      if (
        callee.type === "MemberExpression" &&
        callee.property.name === "addEventListener" &&
        ((callee.object.type === "MemberExpression" &&
          ["document", "window"].includes(callee.object.object?.name || "")) ||
          (callee.object.type === "Identifier" && !pathNode.scope.hasBinding(callee.object.name)))
      ) {
        errors.push({
          filePath,
          line: pathNode.node.loc.start.line,
          message:
            "Use eventHandlers.trackListener instead of addEventListener. (centralized-event-handling)",
          hint:
            "eventHandlers.trackListener(el, 'click', handler, { context: 'sidebar-menu' })",
          node: pathNode.node,
          ruleId: 4,
        });
      }
    },

    FunctionDeclaration(pathNode) {
      if (["cleanup", "teardown"].includes(pathNode.node.id?.name)) {
        state.hasCleanup = true;
        pathNode.traverse({
          CallExpression(p) {
            if (
              p.node.callee.type === "MemberExpression" &&
              p.node.callee.object.name === "eventHandlers" &&
              p.node.callee.property.name === "cleanupListeners"
            ) {
              const arg = p.node.arguments[0];
              if (arg?.type === "ObjectExpression" &&
                  hasProperty(arg, "context"))
                state.cleanupHasContext = true;
            }
          },
        });
      }
    },

    Program: {
      exit() {
        if (state.usesTrack && (!state.hasCleanup || !state.cleanupHasContext)) {
          errors.push({
            filePath,
            line: 1,
            message:
              "Listeners registered but no cleanupListeners({ context }) call. (centralized-event-handling)",
            hint:
              "function cleanup() {\n  eventHandlers.cleanupListeners({ context: 'module' });\n}",
            ruleId: 4,
          });
        }
      },
    },
  };
}

/* ---------- 7) Debug tools ---------- */
function checkCreateDebugToolsUsage(errors, filePath) {
  return {
    CallExpression(pathNode) {
      if (pathNode.node.callee.name !== "createDebugTools") return;
      const cfg = pathNode.node.arguments[0];
      const hasNotify = cfg?.type === "ObjectExpression" &&
                        hasProperty(cfg, "notify");
      if (!hasNotify) {
        errors.push({
          filePath,
          line: pathNode.node.loc.start.line,
          message: "createDebugTools() should receive notify. (debug-trace-usage)",
          hint: "const dbg = createDebugTools({ notify });",
          node: pathNode.node,
          ruleId: 7,
        });
      }
    },
  };
}

/* ---------- 8) Context-rich error logging ---------- */
function checkErrorHandling(errors, filePath) {
  return {
    CatchClause(pathNode) {
      const errName = pathNode.node.param?.name;
      let ok = false;

      pathNode.traverse({
        CallExpression(p) {
          const { callee, arguments: a } = p.node;
          if (
            callee.type === "MemberExpression" &&
            callee.object.name === "errorReporter" &&
            callee.property.name === "capture"
          ) {
            const first = a[0];
            const meta = a[1];
            const firstMatch = first?.type === "Identifier" && first.name === errName;
            const metaOk = meta?.type === "ObjectExpression" &&
                        ["module", "source", "method"].some(k => hasProperty(meta, k));

            if (firstMatch && metaOk) ok = true;
          }
        },
      });

      if (!ok) {
        errors.push({
          filePath,
          line: pathNode.node.loc.start.line,
          message:
            "No errorReporter.capture(err, { module, … }) in catch block. (error-handling--context-rich-logging)",
          hint:
            "errorReporter.capture(err, { module: 'MyModule', source: 'fnName' });",
          node: pathNode.node,
          ruleId: 8,
        });
      }
    },
  };
}

/* ---------- 9) Sanitize HTML ---------- */
function checkSanitizedInputs(errors, filePath) {
  const propName = (mem) => {
    if (!mem || !mem.property) return null;

    return mem.property.type === "Identifier"
      ? mem.property.name
      : mem.property.type === "StringLiteral"
      ? mem.property.value
      : null;
  };

  const isSanitizeCall = (n) => {
    if (!n || n.type !== "CallExpression") return false;

    const { callee } = n;

    // Direct sanitize call: sanitize(...)
    if (callee.type === "Identifier" && callee.name === "sanitize") return true;

    // Method call: obj.sanitize(...)
    if (callee.type === "MemberExpression" && propName(callee) === "sanitize") {
      // Simple case: sanitizer.sanitize(...)
      return true;
    }

    // Nested case: deps.sanitizer.sanitize(...)
    if (callee.type === "MemberExpression" &&
        propName(callee) === "sanitize" &&
        callee.object?.type === "MemberExpression" &&
        propName(callee.object) === "sanitizer") {
      return true;
    }

    return false;
  };

  return {
    AssignmentExpression(p) {
      const { left, right } = p.node;
      if (left.type !== "MemberExpression") return;
      const pn = propName(left);
      if (!["innerHTML", "outerHTML"].includes(pn)) return;
      if (right.type === "StringLiteral" && right.value === "") return; // clearing
      if (!isSanitizeCall(right))
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message:
            `Setting .${pn} without sanitizer.sanitize(...). (dom--security-sanitized-inputs)`,
          hint:
            "const safe = sanitizer.sanitize(userHtml);\nel.innerHTML = safe;",
          node: p.node,
          ruleId: 9,
        });
    },

    CallExpression(p) {
      const pn = propName(p.node.callee);
      // insertAdjacentHTML
      if (pn === "insertAdjacentHTML") {
        const htmlArg = p.node.arguments[1];
        if (!isSanitizeCall(htmlArg))
          errors.push({
            filePath,
            line: p.node.loc.start.line,
            message:
              "insertAdjacentHTML() without sanitizer.sanitize(...). (dom--security-sanitized-inputs)",
            hint:
              "el.insertAdjacentHTML('beforeend', sanitizer.sanitize(userHtml));",
            node: p.node,
            ruleId: 9,
          });
      }

      // setAttribute('src', …)
      if (
        pn === "setAttribute" &&
        p.node.arguments.length >= 2 &&
        p.node.arguments[0].type === "StringLiteral" &&
        p.node.arguments[0].value === "src"
      ) {
        const val = p.node.arguments[1];
        const safe =
          (val.type === "StringLiteral" && /^https?:/.test(val.value)) ||
          isSanitizeCall(val);
        if (!safe)
          errors.push({
            filePath,
            line: p.node.loc.start.line,
            message:
              "setAttribute('src', …) without sanitizer or absolute URL. (dom--security-sanitized-inputs)",
            hint:
              "img.setAttribute('src', sanitizer.sanitizeUrl(userUrl)); // or ensure http/https",
            node: p.node,
            ruleId: 9,
          });
      }
    },
  };
}

/* ---------- 10) App readiness ---------- */
function checkAppReadiness(ast, filePath, errors) {
  let ok = false;
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      // DependencySystem.waitFor(...)
      if (
        callee.type === "MemberExpression" &&
        callee.object.name === "DependencySystem" &&
        callee.property.name === "waitFor"
      )
        ok = true;
      // addEventListener('app:ready')
      if (
        callee.type === "MemberExpression" &&
        callee.property.name === "addEventListener" &&
        p.node.arguments[0]?.type === "StringLiteral" &&
        p.node.arguments[0].value === "app:ready"
      )
        ok = true;
    },
  });
  if (!ok)
    errors.push({
      filePath,
      line: 1,
      message:
        "No readiness gate detected before DOM / app access. (app-readiness-check-missing)",
      hint: "Wrap main logic in DependencySystem.waitFor([...]) or 'app:ready'.",
      ruleId: 10,
    });
}

/* ---------- 11) App-state direct mutation ---------- */
function checkAppStateMutation(ast, filePath, errors) {
  traverse(ast, {
    AssignmentExpression(p) {
      const left = p.node.left;
      // app.state.*
      if (
        left.type === "MemberExpression" &&
        left.object.type === "MemberExpression" &&
        left.object.object.name === "app" &&
        left.object.property.name === "state"
      )
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message: "Direct mutation of app.state. (app-state-direct-mutation)",
          hint: "Use app.state.set(...) / designated setter.",
          node: p.node,
          ruleId: 11,
        });
      // this.state.*
      if (
        left.type === "MemberExpression" &&
        left.object.type === "MemberExpression" &&
        left.object.object.type === "ThisExpression" &&
        left.object.property.name === "state"
      )
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message: "Direct mutation of this.state. (app-state-direct-mutation)",
          hint: "Use controlled setter or state manager.",
          node: p.node,
          ruleId: 11,
        });
    },
  });
}

/* ---------- 12) Module Event Bus ---------- */
function checkModuleEventBus(ast, filePath, errors) {
  let newEventTarget = false;
  traverse(ast, {
    NewExpression(p) {
      if (p.node.callee.name === "EventTarget") newEventTarget = true;
    },
  });
  let dispatchesCustom = false;
  traverse(ast, {
    CallExpression(p) {
      if (
        p.node.callee.type === "MemberExpression" &&
        p.node.callee.property.name === "dispatchEvent" &&
        p.node.arguments[0]?.type === "NewExpression" &&
        p.node.arguments[0].callee.name === "CustomEvent"
      )
        dispatchesCustom = true;
    },
  });
  if (dispatchesCustom && !newEventTarget)
    errors.push({
      filePath,
      line: 1,
      message:
        "Custom events dispatched without dedicated EventTarget. (module-event-bus-missing)",
      hint:
        "const MyBus = new EventTarget(); … MyBus.dispatchEvent(new CustomEvent('x'));",
      ruleId: 12,
    });
}

/* ---------- 13) Navigation Service ---------- */
function checkNavigationService(ast, filePath, errors) {
  traverse(ast, {
    AssignmentExpression(p) {
      const { left } = p.node;
      if (
        left.type === "MemberExpression" &&
        left.object.name === "window" &&
        ["location", "href"].includes(left.property.name)
      )
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message:
            "Use navigationService.navigateTo() instead of window.location assignment. (navigation-service-bypass)",
          hint: "navigationService.navigateTo('/route');",
          node: p.node,
          ruleId: 13,
        });
    },
    CallExpression(p) {
      const c = p.node.callee;
      if (
        c.type === "MemberExpression" &&
        c.object.type === "MemberExpression" &&
        c.object.object.name === "window" &&
        c.object.property.name === "location" &&
        c.property.name === "assign"
      )
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message:
            "Use navigationService.navigateTo() instead of window.location.assign(). (navigation-service-bypass)",
          hint: "navigationService.navigateTo('/route');",
          node: p.node,
          ruleId: 13,
        });
    },
  });
}

/* ---------- 14) Single API Client ---------- */
function checkApiClientUsage(ast, filePath, errors) {
  traverse(ast, {
    NewExpression(p) {
      if (p.node.callee.name === "XMLHttpRequest")
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message: "Use apiClient instead of XMLHttpRequest. (api-client-bypass)",
          hint: "apiClient.get('/api/data')",
          node: p.node,
          ruleId: 14,
        });
    },
    CallExpression(p) {
      if (p.node.callee.name === "fetch" && !filePath.includes("apiClient"))
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message: "Use apiClient instead of fetch. (api-client-bypass)",
          hint: "apiClient.post('/endpoint', payload)",
          node: p.node,
          ruleId: 14,
        });
    },
  });
}

/* ---------- 15) Contextual notifier factories ---------- */
function checkNotifyWithContextUsage(errors, filePath) {
  let hasWithContext = false;
  let notifyCalls = 0;

  return {
    CallExpression(p) {
      const { callee } = p.node;
      // notify.withContext(...)
      if (
        callee.type === "MemberExpression" &&
        callee.object.name === "notify" &&
        callee.property.name === "withContext"
      ) {
        hasWithContext = true;
        const meta = p.node.arguments[0];
        const hasModule = meta?.type === "ObjectExpression" &&
                          hasProperty(meta, "module");
        const hasContext = meta?.type === "ObjectExpression" &&
                          hasProperty(meta, "context");

        if (!hasModule || !hasContext)
          errors.push({
            filePath,
            line: p.node.loc.start.line,
            message:
              "notify.withContext() must include module and context. (contextual-notifier-factories)",
            node: p.node,
            ruleId: 15,
          });
      }

      // notify.info / moduleNotify.info
      if (
        callee.type === "MemberExpression" &&
        ((callee.object.name === "notify" &&
          ["info", "warn", "error", "success", "debug", "apiError", "authWarn"].includes(
            callee.property.name
          )) ||
          (callee.object.type === "Identifier" && hasWithContext))
      ) {
        notifyCalls += 1;
        const meta = p.node.arguments[1];
        const missing = [];

        // Check for required properties
        ["module", "context", "source"].forEach((k) => {
          if (meta?.type === "ObjectExpression" && !hasProperty(meta, k)) {
            missing.push(k);
          }
        });

        if (missing.length)
          errors.push({
            filePath,
            line: p.node.loc.start.line,
            message:
              `notify call missing properties: ${missing.join(", ")}. (contextual-notifier-factories)`,
            node: p.node,
            ruleId: 15,
          });
      }
    },
    Program: {
      exit() {
        if (notifyCalls > 2 && !hasWithContext)
          errors.push({
            filePath,
            line: 1,
            message:
              "Multiple notify calls without notify.withContext(). (contextual-notifier-factories)",
            hint:
              "const n = notify.withContext({ module: 'MyModule', context: 'ops' });",
            ruleId: 15,
          });
      },
    },
  };
}

/* ---------- 16) Backend event logging ---------- */
function checkBackendEventLogging(ast, filePath, errors) {
  let logged = false;
  traverse(ast, {
    CallExpression(p) {
      const { callee } = p.node;
      if (
        callee.type === "MemberExpression" &&
        callee.object.name === "backendLogger" &&
        callee.property.name === "log"
      )
        logged = true;
    },
  });
  if (!logged)
    errors.push({
      filePath,
      line: 1,
      message:
        "No backendLogger.log(...) call detected. (backend-event-logging-missing)",
      hint:
        "backendLogger.log({ level: 'info', module: 'MyModule', message: 'loaded' });",
      ruleId: 16,
    });
}

/* ---------- 17) User consent before analytics ---------- */
function checkUserConsent(ast, filePath, errors) {
  const analytics = ["GoogleAnalytics", "Segment", "Mixpanel", "Sentry", "LogRocket"];
  traverse(ast, {
    NewExpression(p) {
      if (!analytics.includes(p.node.callee.name)) return;

      let consent = false;
      let current = p.parentPath;
      while (current && !consent) {
        if (current.isIfStatement()) {
          current.traverse({
            MemberExpression(inner) {
              if (
                inner.node.object.name === "user" &&
                inner.node.property.name === "hasConsent"
              )
                consent = true;
            },
          });
        }
        current = current.parentPath;
      }
      if (!consent)
        errors.push({
          filePath,
          line: p.node.loc.start.line,
          message: "Analytics init without user consent. (user-consent-check-missing)",
          hint: "if (user.hasConsent('analytics')) { initAnalytics(); }",
          ruleId: 17,
        });
    },
  });
}

////////////////////////////////////////////////////////////////////////////////
// Main analysis per file
////////////////////////////////////////////////////////////////////////////////
function analyzeFile(filePath, code) {
  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "classPrivateProperties",
        "decorators-legacy",
        "dynamicImport",
        "optionalChaining",
        "nullishCoalescingOperator",
      ],
    });
  } catch (err) {
    return [{ filePath, message: `Failed to parse: ${err.message}` }];
  }

  const errors = [];

  // ────────────────── Phase 1: single-pass visitor guardrails ──────────────────
  const visitor = mergeVisitors(
    checkFactoryFunctionExportPattern(errors, filePath),
    checkNoGlobalUsage(errors, filePath),
    checkPureModuleContracts(errors, filePath),
    checkEventListenerCleanup(errors, filePath),
    checkCreateDebugToolsUsage(errors, filePath),
    checkErrorHandling(errors, filePath),
    checkSanitizedInputs(errors, filePath),
    checkNotifyWithContextUsage(errors, filePath)
  );

  traverse(ast, visitor);

  // ────────────────── Phase 2: AST-scanning guardrails ──────────────────
  checkAppStateMutation(ast, filePath, errors);
  checkModuleEventBus(ast, filePath, errors);
  checkNavigationService(ast, filePath, errors);
  checkApiClientUsage(ast, filePath, errors);
  checkBackendEventLogging(ast, filePath, errors);
  checkUserConsent(ast, filePath, errors);
  checkAppReadiness(ast, filePath, errors);     // readiness check last

  errors.forEach((e) => {
    if (e.line) e.actualLineContent = getLineContent(code, e.line);
  });
  return errors;
}

////////////////////////////////////////////////////////////////////////////////
// CLI helpers (drawBox, drawTable)
////////////////////////////////////////////////////////////////////////////////
function pad(s, len, padChar = " ") {
  return s + padChar.repeat(Math.max(0, len - s.length));
}
function drawBox(title, width = 80) {
  const top = "┌" + "─".repeat(width - 2) + "┐";
  const bot = "└" + "─".repeat(width - 2) + "┘";
  const empty = "│" + " ".repeat(width - 2) + "│";
  const start = Math.floor((width - title.length - 2) / 2);
  const line =
    "│" + " ".repeat(start) + title + " ".repeat(width - 2 - start - title.length) + "│";
  console.log(top);
  console.log(empty);
  console.log(line);
  console.log(empty);
  console.log(bot);
  console.log("");
}
function drawTable(rows, headers, widths) {
  const headerRow = headers.map((h, i) => pad(h, widths[i])).join(" │ ");
  const sep = widths.map((w) => "─".repeat(w)).join("─┼─");
  console.log("┌─" + sep + "─┐");
  console.log("│ " + headerRow + " │");
  console.log("├─" + sep + "─┤");
  rows.forEach((r) => console.log("│ " + r.map((c, i) => pad(c, widths[i])).join(" │ ") + " │"));
  console.log("└─" + sep + "─┘\n");
}

////////////////////////////////////////////////////////////////////////////////
// CLI entry
////////////////////////////////////////////////////////////////////////////////
function main() {
  const args = process.argv.slice(2);
  let ruleFilter = null;
  let files = [];

  // Check for --rule=N filter option
  args.forEach(arg => {
    if (arg.startsWith('--rule=')) {
      ruleFilter = parseInt(arg.split('=')[1], 10);
      if (isNaN(ruleFilter)) ruleFilter = null;
    } else {
      files.push(arg);
    }
  });

  if (!files.length) {
    console.log("\nFrontend Pattern Checker\n");
    console.log("Usage: node patternChecker.js [--rule=N] <file1.js> [file2.js...]");
    console.log("Options:");
    console.log("  --rule=N  Only check rule number N (1-17)");
    process.exit(0);
  }

  let total = 0;
  const all = [];

  files.forEach((f) => {
    const abs = path.resolve(f);
    const code = readFileContent(abs);
    if (!code) return;

    // Get all errors
    let errs = analyzeFile(abs, code);

    // Filter by rule number if specified
    if (ruleFilter !== null) {
      errs = errs.filter(err => err.ruleId === ruleFilter);
    }

    if (errs.length) {
      total += errs.length;
      all.push({ filePath: abs, errors: errs });
    }
  });

  if (total) {
    all.forEach(({ filePath, errors }) => {
      drawBox(`${SYMBOLS.shield} Frontend Patterns: ${path.basename(filePath)}`, 80);
      const grouped = groupErrorsByGuardrail(errors);
      drawTable(
        Object.entries(grouped).map(([id, v]) => [getGuardrailName(id), String(v.length)]),
        ["Pattern", "Violations"],
        [50, 10]
      );

      console.log("Detailed Violations\n");
      Object.entries(grouped).forEach(([id, violations]) => {
        console.log(`${SYMBOLS.lock} ${getGuardrailName(id)}\n${getGuardrailDescription(id)}\n`);
        const byRule = {};
        violations.forEach((v) => {
          const m = v.message.match(/\(([\w-]+)\)/);
          const rule = m ? m[1] : "unknown";
          (byRule[rule] ??= []).push(v);
        });
        Object.values(byRule).forEach((list) =>
          list.forEach((v, i) => {
            console.log(`Line ${v.line}: ${v.actualLineContent}`);
            console.log(`${SYMBOLS.error} ${v.message.split("(")[0].trim()}`);
            if (i === 0 && v.hint) {
              console.log(`${SYMBOLS.light} Pattern:`);
              v.hint.split("\n").forEach((l) => console.log("   " + l));
            }
            console.log("");
          })
        );
      });
    });
    drawBox(`${SYMBOLS.alert} Found ${total} pattern violation(s)!`, 80);
    process.exit(1);
  } else {
    drawBox(`${SYMBOLS.success} No pattern violations found!`, 60);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Mapping helpers
////////////////////////////////////////////////////////////////////////////////
function mapErrorTypeToGuardrail(t) {
  const m = {
    "factory-function-export-pattern": 1,
    "strict-dependency-injection": 2,
    "pure-imports": 3,
    "centralized-event-handling": 4,
    "event-context-tag-missing": 5,
    "notifications-via-di": 6,
    "debug-trace-usage": 7,
    "error-handling--context-rich-logging": 8,
    "dom--security-sanitized-inputs": 9,
    "app-readiness-check-missing": 10,
    "app-state-direct-mutation": 11,
    "module-event-bus-missing": 12,
    "navigation-service-bypass": 13,
    "api-client-bypass": 14,
    "contextual-notifier-factories": 15,
    "backend-event-logging-missing": 16,
    "user-consent-check-missing": 17,
  };
  if (!m[t]) for (const [pat, id] of Object.entries(m)) if (t.includes(pat)) return id;
  return m[t] ?? 0;
}
function groupErrorsByGuardrail(errs) {
  const g = {};
  errs.forEach((e) => {
    const id = e.ruleId ?? mapErrorTypeToGuardrail(e.message.match(/\(([\w-]+)\)/)?.[1] ?? "0");
    (g[id] ??= []).push(e);
  });
  return g;
}
function getGuardrailName(id) {
  const n = {
    1: "Factory Function Export",
    2: "Strict Dependency Injection",
    3: "Pure Imports",
    4: "Centralized Event Handling",
    5: "Context Tags",
    6: "Notifications via notify",
    7: "Debug & Trace Utilities",
    8: "Context-Rich Error Logging",
    9: "Sanitize All User HTML",
    10: "App Readiness",
    11: "Central app.state Only",
    12: "Module Event Bus",
    13: "Navigation Service",
    14: "Single API Client",
    15: "Notifier Factories",
    16: "Backend Event Logging",
    17: "User Consent for Monitoring",
    0: "Other Issues",
  };
  return n[id] ?? `Unknown (${id})`;
}
function getGuardrailDescription(id) {
  const d = {
    1: "Export each module through a named factory (`createXyz`). Validate deps and expose cleanup.",
    2: "Do **not** access globals directly; inject DOM helpers / utilities.",
    3: "No side-effects on import; all init in factory.",
    4: "Use eventHandlers.trackListener / cleanupListeners with context.",
    5: "Every listener/notification must include a `context` tag.",
    6: "Replace console/alert with notify (or notify.withContext).",
    7: "Use createDebugTools({ notify }) for tracing.",
    8: "errorReporter.capture(err, { module, source/method, … }) in every catch.",
    9: "sanitizer.sanitize() before inserting user HTML.",
    10: "Wait for DependencySystem.waitFor(...) or 'app:ready' before DOM/app usage.",
    11: "Never mutate app.state or this.state directly.",
    12: "Use a dedicated EventTarget for intra-module events.",
    13: "All navigation via navigationService.navigateTo().",
    14: "All network requests via apiClient.",
    15: "Prefer notify.withContext({ module, context }). Each notify call must have module, context, source.",
    16: "Log critical events via backendLogger.log(...).",
    17: "Check user.hasConsent(...) before analytics/monitoring.",
    0: "Miscellaneous / unknown pattern.",
  };
  return d[id] ?? "";
}

////////////////////////////////////////////////////////////////////////////////
// Run
////////////////////////////////////////////////////////////////////////////////
main();
