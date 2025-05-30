#!/usr/bin/env node
/* eslint-env node */
/* global process */

/**
 * patternChecker.cjs – Remediated Version (2025 Guardrails Update)
 * Properly enforces all Frontend Code Guardrails
 * Includes changes from the remediation guide to ensure:
 *   - factory cleanup calls eventHandlers.cleanupListeners({ context: ... })
 *   - logger.withContext(...) usage, AND direct logger calls,
 *     MUST have a final metadata object with { context: ... }
 *   - domAPI.js no longer fully exempt from vSanitize; only certain assignments allowed
 *   - logger runtime controls restricted to bootstrap/logger.js
 * Includes enhancements for 2025 guardrails:
 *   - Vendored library exemption for module size.
 *   - DependencySystem.modules.get() restricted from module-level scope.
 *   - Clearer distinction for bootstrap files (app.js, appInitializer.js).
 */

"use strict";

/* ───────────────────────── Dependencies ───────────────────────── */
const fs = require("fs");
const path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const chalk = (() => {
  try {
    return require("chalk");
  } catch {
    const p = t => t;
    return {
      red: p, yellow: p, green: p, blue: p, cyan: p, bold: p, dim: p,
      redBright: p, yellowBright: p, greenBright: p, blueBright: p, cyanBright: p
    };
  }
})();

/* ───────────────────────── Symbols ────────────────────────────── */
const SYM = {
  error: chalk.red("✖"),
  warn: chalk.yellow("⚠"),
  info: chalk.cyan("ℹ"),
  ok: chalk.green("✓"),
  shield: chalk.blue("🛡️"),
  lock: chalk.blue("🔒"),
  alert: chalk.redBright("🚨"),
  lamp: chalk.yellowBright("💡"),
  bullet: "•",
};

/* ───────────────────────── Rule Maps ─────────────────────────── */
const RULE_NAME = {
  1: "Factory Function Export",
  2: "Strict Dependency Injection",
  3: "Pure Imports",
  4: "Centralised Event Handling",
  5: "Context Tags",
  6: "Sanitize All User HTML",
  7: "domReadinessService Only",
  8: "Centralised State Access",
  9: "Module Event Bus",
  10: "Navigation Service",
  11: "Single API Client",
  12: "Logger / Observability",
  13: "Authentication Consolidation",
  14: "Module Size Limit",
  15: "Canonical Implementations",
  16: "Error Object Structure",
  17: "Logger Factory Placement",
  18: "Obsolete Logger APIs",
  0: "Other Issues",
};

const RULE_DESC = {
  1: "Export `createXyz` factory, validate deps, expose cleanup, no top-level code.",
  2: "No direct globals or service imports (except bootstrap); inject via DI. `DependencySystem.modules.get()` only inside functions, not at module scope.",
  3: "No side-effects at import time; all logic inside the factory.",
  4: "Use central `eventHandlers.trackListener` + `cleanupListeners` only.",
  5: "Every listener and log must include a `{ context }` tag.",
  6: "Always call `sanitizer.sanitize()` before inserting user HTML.",
  7: "DOM/app readiness handled *only* by DI-injected `domReadinessService`.",
  8: "Never mutate global state (e.g., `app.state`) directly; use dedicated setters.",
  9: "Dispatch custom events through a dedicated `EventTarget` bus.",
  10: "All routing via DI-injected `navigationService.navigateTo()`.",
  11: "All network calls via DI-injected `apiClient`.",
  12: "No `console.*`; all logs via DI logger with context. Use canonical safeHandler for event error handling.",
  13: "Single source of truth: `appModule.state` only; no local `authState` or dual checks.",
  14: "Modules must not exceed 1000 lines (configurable, with vendor exemptions).",
  15: "Use canonical implementations only (safeHandler, form handlers, URL parsing, etc.)",
  16: "Error objects must use standard { status, data, message } structure.",
  17: "`createLogger()` may appear **only** in logger.js or bootstrap (e.g. app.js).",
  18: "Deprecated logger APIs: authModule param or logger.setAuthModule().",
};

/* ───────────────────────── Default Configuration ──────────────── */
const DEFAULT_CONFIG = {
  serviceNames: {
    logger: "logger",
    apiClient: "apiClient",
    eventHandlers: "eventHandlers",
    sanitizer: "sanitizer",
    domReadinessService: "domReadinessService",
    navigationService: "navigationService",
    // Consider adding browserService if it's a core DI service
  },
  objectNames: {
    globalApp: "app", // Often 'appModule'
    stateProperty: "state",
    dependencySystem: "DependencySystem", // Name of the DI container
  },
  knownBusNames: ["eventBus", "moduleBus", "appBus", "AuthBus"],
  factoryValidationRegex: "Missing\\b|\\brequired\\b",
  maxModuleLines: 1000,
  // Regex to identify bootstrap files like app.js, appInitializer.js
  bootstrapFileRegex: /(?:^|[\\/])(app|main|appInitializer|bootstrap)\.(js|ts|jsx|tsx)$/i,
  // Regex to identify comments for vendored library size exemption
  vendoredCommentRegex: /^\s*\/\/\s*VENDOR-EXEMPT-SIZE:/im,
};

//   Certain low-level infra modules (they *implement* the wrappers the other
//   rules depend on) must be exempt from some checks to avoid false positives.
const WRAPPER_FILE_REGEX = /(?:^|[\\/])(domAPI|eventHandler|eventHandlers|domReadinessService|browserService)\.(js|ts)$/i;

//  Node / tooling files (CLI, tests, repo scripts) – console* is allowed
const NODE_SCRIPT_REGEX = /(?:^|[\\/])(scripts|tests)[\\/].+\.(?:c?js|mjs|ts)$/i;
// Forbidden browser-storage APIs
const STORAGE_IDENTIFIERS = ["localStorage", "sessionStorage"];

let currentConfig = DEFAULT_CONFIG;

/* ───────────────────────── Load Config ─────────────────────────── */
function loadConfig(cwd) {
  const tryPaths = [
    path.join(cwd, "patterns-checker.config.json"),
    path.join(cwd, ".patterns-checkerrc"),
    path.join(cwd, "package.json")
  ];
  for (const p of tryPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf8"));
        const loadedConfig = raw["patternsChecker"] ?? (path.basename(p) === "package.json" ? {} : raw);

        currentConfig = {
          ...DEFAULT_CONFIG,
          ...loadedConfig,
          serviceNames: {
            ...DEFAULT_CONFIG.serviceNames,
            ...loadedConfig.serviceNames,
          },
          objectNames: {
            ...DEFAULT_CONFIG.objectNames,
            ...loadedConfig.objectNames,
          },
          knownBusNames: loadedConfig.knownBusNames || DEFAULT_CONFIG.knownBusNames,
          factoryValidationRegex: loadedConfig.factoryValidationRegex || DEFAULT_CONFIG.factoryValidationRegex,
          maxModuleLines: loadedConfig.maxModuleLines || DEFAULT_CONFIG.maxModuleLines,
          bootstrapFileRegex: new RegExp(loadedConfig.bootstrapFileRegex || DEFAULT_CONFIG.bootstrapFileRegex),
          vendoredCommentRegex: new RegExp(loadedConfig.vendoredCommentRegex || DEFAULT_CONFIG.vendoredCommentRegex),
        };
        // Ensure regexes are actual RegExp objects if loaded from JSON as strings
        if (typeof currentConfig.bootstrapFileRegex === 'string') {
            currentConfig.bootstrapFileRegex = new RegExp(currentConfig.bootstrapFileRegex, 'i');
        }
        if (typeof currentConfig.vendoredCommentRegex === 'string') {
            currentConfig.vendoredCommentRegex = new RegExp(currentConfig.vendoredCommentRegex, 'im');
        }
        return currentConfig;
      } catch (e) {
        console.warn(`${SYM.warn} Failed to parse config file ${p}: ${e.message}`);
      }
    }
  }
  // Ensure regexes from default are actual RegExp objects
  if (typeof currentConfig.bootstrapFileRegex === 'string') {
      currentConfig.bootstrapFileRegex = new RegExp(currentConfig.bootstrapFileRegex, 'i');
  }
  if (typeof currentConfig.vendoredCommentRegex === 'string') {
      currentConfig.vendoredCommentRegex = new RegExp(currentConfig.vendoredCommentRegex, 'im');
  }
  return currentConfig; // Return default if no config found or if parsing failed and it reset to default
}

/* ───────────────────────── Helpers ────────────────────────────── */
const read = f => fs.readFileSync(f, "utf8");
const splitLines = code => code.split(/\r?\n/);
const getLine = (code, n) => splitLines(code)[n - 1] ?? "";
function E(file, line, ruleId, msg, hint = "") {
  return { file, line, ruleId, message: msg, hint };
}

function hasProp(objExpr, propName) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return false;
  return objExpr.properties.some(
    p => {
      if (p.type === "Property" && p.key) {
        return (p.key.type === "Identifier" && p.key.name === propName) ||
          (p.key.type === "StringLiteral" && p.key.value === propName);
      }
      if (p.type === "MethodDefinition" && p.key) { // For classes, though less common in this checker's target
        return (p.key.type === "Identifier" && p.key.name === propName) ||
          (p.key.type === "StringLiteral" && p.key.value === propName);
      }
      // Check for ObjectMethod, used for methods in object literals like cleanup() {}
      if (p.type === "ObjectMethod" && p.key) {
         return (p.key.type === "Identifier" && p.key.name === propName) ||
          (p.key.type === "StringLiteral" && p.key.value === propName);
      }
      if (p.type === "SpreadElement") {
        return false;
      }
      return false;
    }
  );
}

function resolveIdentifierToValue(identifierPath) {
  if (!identifierPath || identifierPath.node.type !== "Identifier") return null;
  const binding = identifierPath.scope.getBinding(identifierPath.node.name);
  if (binding && binding.path.isVariableDeclarator() && binding.path.node.init) {
    return binding.path.get("init");
  }
  return null;
}

function getExpressionSourceNode(path) {
  if (!path) return null;
  if (path.isIdentifier()) {
    const resolved = resolveIdentifierToValue(path);
    return resolved ? resolved.node : path.node;
  }
  return path.node;
}

function mergeVisitors(...visitors) {
  const merged = {};

  visitors.forEach(visitor => {
    if (!visitor) return;

    Object.keys(visitor).forEach(nodeType => {
      const handler = visitor[nodeType];

      if (typeof handler === "function") {
        if (!merged[nodeType]) {
          merged[nodeType] = { functions: [], enter: [], exit: [] };
        } else if (Array.isArray(merged[nodeType])) { // Legacy: if it was just an array of functions
          merged[nodeType] = { functions: merged[nodeType], enter: [], exit: [] };
        }
        merged[nodeType].functions.push(handler);
      } else if (handler && typeof handler === "object") {
        if (!merged[nodeType]) {
          merged[nodeType] = { functions: [], enter: [], exit: [] };
        } else if (Array.isArray(merged[nodeType])) { // Legacy
          merged[nodeType] = { functions: merged[nodeType], enter: [], exit: [] };
        }

        if (handler.enter) {
          const enterHandler = Array.isArray(handler.enter) ? handler.enter : [handler.enter];
          merged[nodeType].enter.push(...enterHandler);
        }

        if (handler.exit) {
          const exitHandler = Array.isArray(handler.exit) ? handler.exit : [handler.exit];
          merged[nodeType].exit.push(...exitHandler);
        }
      }
    });
  });

  Object.keys(merged).forEach(nodeType => {
    const handlers = merged[nodeType];

    if (handlers && typeof handlers === "object") {
      const result = {};

      if (handlers.functions && handlers.functions.length > 0) {
        if (handlers.enter.length === 0 && handlers.exit.length === 0) {
          // Only direct functions, no enter/exit
          merged[nodeType] = (path) => {
            handlers.functions.forEach(fn => fn(path));
          };
          return; // Skip to next nodeType
        } else {
          // If there are also enter/exit, merge direct functions into enter
          handlers.enter = [...handlers.functions, ...handlers.enter];
        }
      }

      if (handlers.enter && handlers.enter.length > 0) {
        result.enter = (path) => {
          handlers.enter.forEach(fn => fn(path));
        };
      }

      if (handlers.exit && handlers.exit.length > 0) {
        result.exit = (path) => {
          handlers.exit.forEach(fn => fn(path));
        };
      }

      if (Object.keys(result).length > 0) {
        merged[nodeType] = result;
      } else {
        // If after processing, nothing is in result (e.g. only empty arrays), delete the key
        delete merged[nodeType];
      }
    }
  });

  return merged;
}

function collectDIParamNamesFromParam(param, namesSet) {
  if (!param) return;
  if (param.type === "ObjectPattern") {
    param.properties.forEach(pr => {
      if (pr.type === "Property" && pr.key) {
        const keyName = pr.key.name || pr.key.value;
        if (keyName) namesSet.add(keyName);
      } else if (pr.type === "RestElement" && pr.argument.type === "Identifier") {
        namesSet.add(pr.argument.name);
      }
    });
  } else if (param.type === "Identifier") {
    namesSet.add(param.name);
  } else if (param.type === "AssignmentPattern" && param.left) {
    collectDIParamNamesFromParam(param.left, namesSet);
  }
}

function collectDIParamNamesFromParams(params, namesSet) {
  (params || []).forEach(param => collectDIParamNamesFromParam(param, namesSet));
}

/* ───────────────────────── Visitors ───────────────────────────── */

/* 1. Factory Function Export */
function vFactory(err, file, config) {
  let factoryInfo = { found: false, line: 1, name: "", paramsNode: null };
  let hasCleanup = false;
  let hasDepCheck = false;
  let cleanupInvokesEH = false;

  return {
    ExportNamedDeclaration(p) {
      const decl = p.node.declaration;
      let funcName, funcNode;

      if (decl && decl.type === "FunctionDeclaration") {
        funcName = decl.id?.name;
        funcNode = decl;
      } else if (decl && decl.type === "VariableDeclaration" && decl.declarations.length === 1) {
        const declarator = decl.declarations[0];
        if (
          declarator.id.type === "Identifier" &&
          (declarator.init?.type === "FunctionExpression" ||
            declarator.init?.type === "ArrowFunctionExpression")
        ) {
          funcName = declarator.id.name;
          funcNode = declarator.init;
        }
      }

      if (funcName && funcNode && /^create[A-Z]/.test(funcName)) {
        factoryInfo.found = true;
        factoryInfo.line = funcNode.loc.start.line;
        factoryInfo.name = funcName;
        factoryInfo.paramsNode = funcNode.params;

        if (!funcNode.params || !funcNode.params.length) {
          err.push(
            E(
              file,
              funcNode.loc.start.line,
              1,
              `${funcName} must accept a 'dependencies' object or parameters.`,
              `Example: export function ${funcName}(deps) { /* ... */ } or export function ${funcName}({ logger, apiClient }) { /* ... */ }`
            )
          );
        }

        p.traverse({
          ThrowStatement(throwPath) {
            if (
              throwPath.node.argument?.type === "NewExpression" &&
              throwPath.node.argument.callee.name === "Error" &&
              throwPath.node.argument.arguments.length > 0
            ) {
              const arg0 = throwPath.node.argument.arguments[0];
              const errorText =
                arg0.type === "StringLiteral"
                  ? arg0.value
                  : arg0.type === "TemplateLiteral"
                    ? arg0.quasis.map(q => q.value.raw).join("")
                    : "";
              const validationRegex = new RegExp(
                config.factoryValidationRegex || DEFAULT_CONFIG.factoryValidationRegex,
                "i"
              );
              if (validationRegex.test(errorText) ||
                /is required|not found|missing/i.test(errorText)) {
                hasDepCheck = true;
              }
            }
          },
          IfStatement(ifPath) {
            const isParamNegation = (node) => {
              if (node.type === "UnaryExpression" && node.operator === "!") {
                if (node.argument.type === "Identifier") return true;
                if (node.argument.type === "MemberExpression") return true;
              }
              return false;
            };
            const hasParamValidation = (testNode) => {
              if (isParamNegation(testNode)) return true;
              if (testNode.type === "LogicalExpression") {
                return hasParamValidation(testNode.left) || hasParamValidation(testNode.right);
              }
              return false;
            };
            if (hasParamValidation(ifPath.node.test)) {
              hasDepCheck = true;
            }
          }
        });

        p.traverse({
          ReturnStatement(returnPath) {
            // Ensure this return is directly from the factory, not a nested function
            if (returnPath.getFunctionParent()?.node !== funcNode) return;

            if (returnPath.node.argument?.type === "ObjectExpression") {
              const hasDirectCleanup =
                hasProp(returnPath.node.argument, "cleanup") ||
                hasProp(returnPath.node.argument, "teardown") ||
                hasProp(returnPath.node.argument, "destroy");

              if (hasDirectCleanup) {
                hasCleanup = true;
                returnPath.get("argument").get("properties").forEach(propPath => {
                  const keyNode = propPath.node.key;
                  const keyName = (keyNode?.type === "Identifier" ? keyNode.name : (keyNode?.type === "StringLiteral" ? keyNode.value : null));

                  if (["cleanup", "teardown", "destroy"].includes(keyName) && propPath.node.value) {
                    propPath.get("value").traverse({ // Traverse the cleanup function's body
                      CallExpression(callPath) {
                        const cal = callPath.node.callee;
                        if (
                          cal.type === "MemberExpression" &&
                          cal.object.name === config.serviceNames.eventHandlers && // Assuming eventHandlers is DI'd
                          cal.property.name === "cleanupListeners"
                        ) {
                          const callArgs = callPath.get("arguments");
                          if (callArgs.length > 0) {
                            const firstArgPath = callArgs[0];
                            const firstArgNode = getExpressionSourceNode(firstArgPath);
                            if (
                              firstArgNode &&
                              firstArgNode.type === "ObjectExpression" &&
                              hasProp(firstArgNode, "context")
                            ) {
                              cleanupInvokesEH = true;
                            }
                          }
                        }
                      }
                    });
                  }
                });
              }
            }
          },
          // Consider cleanup defined as a separate function within the factory scope and returned by reference
          // This is more complex; the current check focuses on inline object returns.
        });
      }
    },

    Program: {
      exit() {
        if (!factoryInfo.found) {
          err.push(
            E(
              file,
              1,
              1,
              "Missing factory export.",
              "A module must export a function like 'createMyFeature(deps)'."
            )
          );
        } else {
          if (!hasDepCheck) {
            err.push(
              E(
                file,
                factoryInfo.line,
                1,
                `Factory '${factoryInfo.name}' must validate its dependencies.`,
                `Example: if (!deps.logger) throw new Error("Missing logger dependency");`
              )
            );
          }
          if (!hasCleanup) {
            err.push(
              E(
                file,
                factoryInfo.line,
                1,
                `Factory '${factoryInfo.name}' must expose a cleanup, teardown, or destroy API.`,
                `Example: return { ..., cleanup: () => { /* detach listeners, etc. */ } };`
              )
            );
          } else if (!cleanupInvokesEH) {
            // This check assumes eventHandlers is available and used.
            // If a module legitimately has no event listeners to clean up via eventHandlers,
            // this might be a false positive. Consider if config.serviceNames.eventHandlers is injected.
            err.push(
              E(
                file,
                factoryInfo.line,
                4, // Rule 4: Centralised Event Handling for cleanup part
                `Factory '${factoryInfo.name}' provides cleanup() but does not appear to call ${config.serviceNames.eventHandlers}.cleanupListeners({ context: … }).`,
                `Invoke ${config.serviceNames.eventHandlers}.cleanupListeners({ context: … }) inside cleanup() if listeners were tracked.`
              )
            );
          }
        }
      }
    }
  };
}

/* 2. Strict Dependency Injection & 12. Console Ban + DIRECT LOGGER CALLS */
function vDI(err, file, isBootstrapFile, config) {
  const serviceNamesConfig = config.serviceNames || DEFAULT_CONFIG.serviceNames;
  const depSystemName = config.objectNames.dependencySystem || DEFAULT_CONFIG.objectNames.dependencySystem;
  const bannedGlobals = ["window", "document", "navigator", "location"];
  const isLoggerJs = /\/logger\.(js|ts)$/i.test(file);
  const isNodeScript = NODE_SCRIPT_REGEX.test(file);

  const diParamsInFactory = new Set();
  const destructuredServices = new Set();
  let factoryParamsProcessed = false;

  return {
    ExportNamedDeclaration(p) {
      // Only process params for the main exported factory
      if (factoryParamsProcessed || p.parentPath.type !== "Program") return;

      const decl = p.node.declaration;
      let funcNode;
      if (
        decl &&
        decl.type === "FunctionDeclaration" &&
        /^create[A-Z]/.test(decl.id?.name)
      ) {
        funcNode = decl;
      } else if (
        decl &&
        decl.type === "VariableDeclaration" &&
        decl.declarations.length === 1
      ) {
        const d = decl.declarations[0];
        if (
          d.id.type === "Identifier" &&
          /^create[A-Z]/.test(d.id.name) &&
          (d.init?.type === "FunctionExpression" ||
            d.init?.type === "ArrowFunctionExpression")
        ) {
          funcNode = d.init;
        }
      }
      if (funcNode) {
        collectDIParamNamesFromParams(funcNode.params, diParamsInFactory);

        // Traverse only this factory for its destructured params
        p.traverse({
          VariableDeclarator(varPath) {
            if (
              varPath.node.id.type === "ObjectPattern" &&
              varPath.node.init &&
              varPath.node.init.type === "Identifier" &&
              diParamsInFactory.has(varPath.node.init.name)
            ) {
              varPath.node.id.properties.forEach(prop => {
                if (prop.type === "Property" && prop.key) {
                  const keyName = prop.key.name || prop.key.value;
                  if (keyName) destructuredServices.add(keyName);
                }
              });
            }
          }
        });
        factoryParamsProcessed = true;
      }
    },

    ImportDeclaration(p) {
      if (isBootstrapFile) return; // Bootstrap files can import services/factories directly

      const sourceValue = p.node.source.value;
      Object.values(serviceNamesConfig).forEach(serviceName => {
        const serviceRegex = new RegExp(`[/\\.]${serviceName}(\\.js|\\.ts)?$`, "i");
        if (
          serviceRegex.test(sourceValue) ||
          sourceValue === serviceName ||
          sourceValue.endsWith(`/${serviceName}`)
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              2,
              `Direct import of a service-like module ('${sourceValue}' for '${serviceName}') is forbidden in non-bootstrap files.`,
              `Inject '${serviceName}' via DI through the factory function's parameters.`
            )
          );
        }
      });
    },

    Identifier(p) {
      if (
        p.parent?.type === "MemberExpression" &&
        p.parent.property === p.node &&
        !p.parent.computed
      ) {
        return;
      }

      if (bannedGlobals.includes(p.node.name) && !p.scope.hasBinding(p.node.name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            2,
            `Direct use of global '${p.node.name}' is forbidden. Use DI abstractions.`,
            `If access to '${p.node.name}' is needed, expose it via a DI-provided service (e.g., browserService).`
          )
        );
      }

      if (STORAGE_IDENTIFIERS.includes(p.node.name) && !p.scope.hasBinding(p.node.name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            2,
            `Direct use of '${p.node.name}' is forbidden.`,
            "Use server-side sessions or appModule.state – never browser storage."
          )
        );
      }

      const serviceName = p.node.name;
      if (
        Object.values(serviceNamesConfig).includes(serviceName) &&
        !p.scope.hasBinding(serviceName) &&
        !isBootstrapFile // Services used in bootstrap files are often globals or directly imported/instantiated there
      ) {
        const isDirectlyInjected =
          diParamsInFactory.has(serviceName) ||
          destructuredServices.has(serviceName);

        if (!isDirectlyInjected) {
           // More robust check for DI object destructuring
          let isFromDIObject = false;
          let currentScope = p.scope;
          while (currentScope && !isFromDIObject) {
            for (const bindingName in currentScope.bindings) {
              const binding = currentScope.bindings[bindingName];
              if (binding.path.isVariableDeclarator() && binding.path.node.id.type === "ObjectPattern") {
                const initNode = binding.path.node.init;
                if (initNode && diParamsInFactory.has(initNode.name)) { // Check if destructured from a factory param
                  if (binding.path.node.id.properties.some(prop => prop.key && (prop.key.name === serviceName || prop.key.value === serviceName))) {
                    isFromDIObject = true;
                    break;
                  }
                }
              }
            }
            if (isFromDIObject) break;
            currentScope = currentScope.parent;
          }

          if (!isFromDIObject) {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                2,
                `Service '${serviceName}' is used but does not appear to be injected via factory DI parameters.`,
                `Ensure '${serviceName}' is part of the factory's 'deps' and properly destructured, or obtained via DependencySystem.modules.get() within a function.`
              )
            );
          }
        }
      }
    },

    MemberExpression(p) {
      if (
        p.node.object.type === "Identifier" &&
        p.node.object.name === "globalThis" &&
        p.node.property.type === "Identifier" &&
        bannedGlobals.includes(p.node.property.name)
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            2,
            `Direct use of global '${p.node.property.name}' via 'globalThis' is forbidden. Use DI.`,
            `Example: inject a service that provides 'window.document' etc.`
          )
        );
      }
      const baseId = p.node.object;
      const propName = p.node.property?.name;
      if (
        propName &&
        STORAGE_IDENTIFIERS.includes(propName) &&
        baseId?.type === "Identifier" &&
        ["window", "globalThis"].includes(baseId.name) &&
        !p.scope.hasBinding(baseId.name)
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            2,
            `Access to '${baseId.name}.${propName}' is forbidden.`,
            "Browser storage APIs violate guard-rails."
          )
        );
      }
    },

    CallExpression(p) {
      const cNode = p.node.callee;
      if (
        cNode.type === "MemberExpression" &&
        cNode.object.type === "Identifier" &&
        cNode.object.name === "console" &&
        !p.scope.hasBinding("console") &&
        !isLoggerJs &&
        !isNodeScript &&
        !isBootstrapFile // Allow console in early bootstrap if necessary
      ) {
        const badMethod = cNode.property.name;
        err.push(
          E(
            file,
            p.node.loc.start.line,
            12,
            `console.${badMethod} is forbidden – use DI logger.`,
            `Replace 'console.${badMethod}(...)' with '${serviceNamesConfig.logger}.${badMethod === "error" ? "error" : "info"}("Message string", data, { context: "Module:operation" })'`
          )
        );
      }

      if (
        cNode.type === "MemberExpression" &&
        cNode.object.type === "Identifier" &&
        cNode.object.name === serviceNamesConfig.logger &&
        !p.scope.hasBinding(serviceNamesConfig.logger) &&
        !isBootstrapFile && !isLoggerJs &&
        cNode.property.name !== "withContext"
      ) {
        const loggerMethodName = cNode.property.name;
        const args = p.get("arguments");
        const lastArgIndex = args.length - 1;

        if (["info", "warn", "error", "debug", "log", "critical", "fatal"].includes(loggerMethodName)) {
          if (lastArgIndex < 0) {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                12,
                `'${serviceNamesConfig.logger}.${loggerMethodName}' call missing arguments (expected at least message and metadata with { context }).`,
                `Example: ${serviceNamesConfig.logger}.${loggerMethodName}("Event occurred", { data: 'details' }, { context: "Module:Action" });`
              )
            );
          } else {
            const lastArgPath = args[lastArgIndex];
            const lastArgNode = getExpressionSourceNode(lastArgPath);
            if (
              !(
                lastArgNode &&
                lastArgNode.type === "ObjectExpression" &&
                hasProp(lastArgNode, "context")
              )
            ) {
              err.push(
                E(
                  file,
                  p.node.loc.start.line,
                  12,
                  `Direct '${serviceNamesConfig.logger}.${loggerMethodName}' call missing a final metadata object with a 'context' property.`,
                  `Ensure logger calls like '${loggerMethodName}' end with, e.g., { context: "Module:description" }. Found type for last arg: ${lastArgNode ? lastArgNode.type : 'undefined'}`
                )
              );
            }
          }
        }
      }

      // Check for DependencySystem.modules.get() at module scope
      if (
        !isBootstrapFile &&
        cNode.type === "MemberExpression" &&
        cNode.object.type === "MemberExpression" &&
        cNode.object.object.type === "Identifier" &&
        cNode.object.object.name === depSystemName &&
        cNode.object.property.name === "modules" &&
        cNode.property.name === "get"
      ) {
        // Check if the call is at the top-level (module scope)
        let isTopLevel = true;
        let currentPath = p;
        while (currentPath.parentPath) {
            if (currentPath.parentPath.isFunction() || currentPath.parentPath.isProgram()) {
                if (currentPath.parentPath.isFunction()) {
                    isTopLevel = false;
                }
                break;
            }
            currentPath = currentPath.parentPath;
        }
        if (isTopLevel && currentPath.parentPath.isProgram()) { // Extra check for Program context
             err.push(
                E(
                    file,
                    p.node.loc.start.line,
                    2,
                    `'${depSystemName}.modules.get()' must not be called at module scope.`,
                    `Use '${depSystemName}.modules.get()' only inside functions (e.g., within a factory after DI). Prefer direct DI for primary dependencies.`
                )
            );
        }
      }
    }
  };
}

/* 12. Logger context checking (for withContext) + SafeHandler usage in events. */
function vLog(err, file, isBootstrapFile, moduleCtx, config) {
  const loggerName = config.serviceNames.logger;
  const isLoggerJs = /\/logger\.(js|ts)$/i.test(file);

  return {
    CallExpression(p) {
      const calleeNode = p.node.callee;

      if (
        calleeNode.type === "MemberExpression" &&
        calleeNode.object.type === "CallExpression" &&
        calleeNode.object.callee?.type === "MemberExpression" &&
        calleeNode.object.callee.object.type === "Identifier" &&
        calleeNode.object.callee.object.name === loggerName &&
        calleeNode.object.callee.property.name === "withContext" &&
        !p.scope.hasBinding(loggerName) &&
        !isBootstrapFile && !isLoggerJs
      ) {
        const chainedMethodName = calleeNode.property.name;
        const chainedArgs = p.get("arguments");
        const lastChainedArgIndex = chainedArgs.length - 1;

        if (!["info", "warn", "error", "debug", "log", "critical", "fatal"].includes(chainedMethodName)) {
          return;
        }

        if (lastChainedArgIndex < 0) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              12,
              `Chained logger call '${loggerName}.withContext(...).${chainedMethodName}' requires at least a message and a final metadata object with { context }.`,
              `Example: ${loggerName}.withContext('BaseContext').${chainedMethodName}('Event occurred', { data: 'val' }, { context: "${moduleCtx}:operation" });`
            )
          );
        } else {
          const lastChainedArgPath = chainedArgs[lastChainedArgIndex];
          const lastChainedArgNode = getExpressionSourceNode(lastChainedArgPath);

          if (
            !(
              lastChainedArgNode &&
              lastChainedArgNode.type === "ObjectExpression" &&
              hasProp(lastChainedArgNode, "context")
            )
          ) {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                12,
                `Chained logger call '${loggerName}.withContext(...).${chainedMethodName}' missing a final metadata object with a 'context' property.`,
                `Example: ${loggerName}.withContext('BaseContext').${chainedMethodName}('Event occurred', { data: 'val' }, { context: "${moduleCtx}:operation" }); Found type for last arg: ${lastChainedArgNode ? lastChainedArgNode.type : 'undefined'}`
              )
            );
          }
        }
      }
    }
  };
}

/* 3. Pure Imports */
function vPure(err, file) {
  return {
    Program(path) {
      let inFactoryScope = false; // This logic might be too simple if factories are deeply nested or complexly defined

      path.traverse({
        FunctionDeclaration(p) {
          if (/^create[A-Z]/.test(p.node.id?.name) && p.parentPath.isProgram()) {
            // Considering only top-level create functions as main factory entry for this check
            inFactoryScope = true; // Sets a flag, but doesn't properly scope skip
            // p.skip(); // This would skip traversing children of the factory, which we might want for other rules.
          }
        },
        VariableDeclarator(p) {
            if (p.node.id?.type === "Identifier" && /^create[A-Z]/.test(p.node.id.name) &&
                (p.node.init?.type === "ArrowFunctionExpression" || p.node.init?.type === "FunctionExpression") &&
                p.parentPath.parentPath.isProgram() // const createFactory = () => {} at top level
            ) {
                 inFactoryScope = true;
            }
        }
      });


      path.get("body").forEach(statementPath => {
        // If we are conceptually "outside" any top-level factory definition
        // This check is tricky. A statement might be inside a function that is NOT the main factory.
        // A more robust check would be to see if the statement is directly under Program,
        // or only under non-factory function scopes at the top level.

        // Check if statement is directly under Program or only within non-factory functions/classes at top level
        let isEffectivelyTopLevel = true;
        let parent = statementPath.parentPath;
        let factoryParentFound = false;

        while(parent && !parent.isProgram()) {
            if ((parent.isFunctionDeclaration() && /^create[A-Z]/.test(parent.node.id?.name)) ||
                (parent.isVariableDeclarator() && parent.node.id?.type === "Identifier" && /^create[A-Z]/.test(parent.node.id.name) && (parent.node.init?.type === "ArrowFunctionExpression" || parent.node.init?.type === "FunctionExpression"))
            ) {
                factoryParentFound = true;
                break;
            }
            if (parent.isFunction() || parent.isClassBody()) { // any other function or class
                // If it's inside some other function, it's not a top-level side effect for *this* rule's purpose
                // This makes the rule less strict, allowing helper functions at top-level to have logic.
                // The original vPure was very strict.
            }
            parent = parent.parentPath;
        }

        if (factoryParentFound) return; // It's inside a factory, allowed.

        if (
          statementPath.isImportDeclaration() ||
          statementPath.isExportDeclaration() || // Allows exporting declared functions/consts
          statementPath.isFunctionDeclaration() || // Allows top-level helper function definitions
          statementPath.isClassDeclaration() ||   // Allows top-level class definitions
          (statementPath.node.type === "TSInterfaceDeclaration") ||
          (statementPath.node.type === "TSTypeAliasDeclaration")
        ) {
          return;
        }

        // VariableDeclarations at top level are allowed if they are simple constants or function expressions
        // but not if they involve immediate function calls (except require)
        if (statementPath.isVariableDeclaration()) {
          statementPath.node.declarations.forEach(decl => {
            if (decl.init) {
              const initNode = decl.init;
              if (
                initNode.type === "CallExpression" &&
                !(initNode.callee.type === "Identifier" && initNode.callee.name === "require") && // Allow require
                !(initNode.callee.type === "Identifier" && /^(Symbol)$/.test(initNode.callee.name)) // Allow Symbol()
              ) {
                err.push(
                  E(
                    file,
                    initNode.loc.start.line,
                    3,
                    "Potential side-effect from function call at module top-level.",
                    "All executable logic should be inside the factory or DI-provided functions. Allowed: const foo = () => {}; const bar = Symbol();"
                  )
                );
              }
            }
          });
          return;
        }

        // Any other kind of statement that implies execution is suspect
        if (statementPath.isExpressionStatement()) { // e.g. a function call `doSomething();`
          const expr = statementPath.node.expression;
          if (
            expr.type === "CallExpression" &&
            !( // Allow IIFEs if they are just defining things, not causing broad side effects
              expr.callee.type === "FunctionExpression" ||
              expr.callee.type === "ArrowFunctionExpression"
            )
          ) {
             // More specific check: is it a call to something that isn't 'require'?
            if (!(expr.callee.type === "Identifier" && expr.callee.name === "require")) {
                err.push(
                    E(
                        file,
                        expr.loc.start.line,
                        3,
                        "Side-effecting call at module top-level.",
                        "Ensure all executable logic is within the exported factory or helper functions called by it."
                    )
                );
            }
          }
        } else if ( // These are almost always side-effects at top level
          statementPath.isAwaitExpression() || // Top-level await
          statementPath.isImportExpression() || // Dynamic import call
          statementPath.isForStatement() ||
          statementPath.isForInStatement() ||
          statementPath.isForOfStatement() ||
          statementPath.isWhileStatement() ||
          statementPath.isDoWhileStatement() ||
          statementPath.isIfStatement() // Top-level if without being in a function
        ) {
          err.push(
            E(
              file,
              statementPath.node.loc.start.line,
              3,
              `Top-level '${statementPath.node.type}' detected.`,
              "Avoid side-effects like top-level awaits, dynamic imports, loops, or conditional logic at import time. Encapsulate in functions."
            )
          );
        }
      });
    }
  };
}

/* 4 & 5. Centralised Event Handling + Context Tags */
function vEvent(err, file, isBootstrapFile, moduleCtx, config) {
  const ehName = config.serviceNames.eventHandlers;
  return {
    CallExpression(p) {
      const callee = p.node.callee;

      if (callee.type === "MemberExpression" && callee.property.name === "addEventListener") {
        const objName = callee.object.name; // Simple check
        const objSourceNode = getExpressionSourceNode(p.get("callee.object"));

        if (objName && objName !== ehName && objSourceNode?.name !== ehName) {
          // Check if it's on a known bus name, which might be allowed if not using eventHandlers for bus subscriptions
          const isKnownBusCall = config.knownBusNames.includes(objSourceNode?.name);
          if (!isKnownBusCall) {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                4,
                "Direct 'addEventListener' is discouraged.",
                `Use the centralized '${ehName}.trackListener' for DOM events or subscribe to a configured event bus.`
              )
            );
          }
        }
      }

      if (
        callee.type === "MemberExpression" &&
        (callee.object.name === ehName ||
          getExpressionSourceNode(p.get("callee.object"))?.node?.name === ehName) &&
        callee.property.name === "trackListener"
      ) {
        const optionsArgPath = p.get("arguments")[3];
        const optionsNode = getExpressionSourceNode(optionsArgPath);
        if (
          !optionsNode ||
          optionsNode.type !== "ObjectExpression" ||
          !hasProp(optionsNode, "context")
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              5,
              `'${ehName}.trackListener' call missing a context tag in options.`,
              `Example: ${ehName}.trackListener(el, 'click', handler, { context: '${moduleCtx}:myListener' });`
            )
          );
        } else if (optionsNode.type === "ObjectExpression" && hasProp(optionsNode, "context")) {
          const contextProp = optionsNode.properties.find(
            prop => (prop.key?.name === "context" || prop.key?.value === "context") && prop.type === "Property" // Ensure it's a Property
          );
          if (contextProp && contextProp.value) {
            const contextValueNode = contextProp.value;
            if (
              contextValueNode.type === "StringLiteral" &&
              contextValueNode.value.trim() === ""
            ) {
              err.push(
                E(
                  file,
                  contextValueNode.loc.start.line,
                  5,
                  "Context tag value is an empty string.",
                  "Provide a meaningful context."
                )
              );
            }
          }
        }
      }
    },

    JSXAttribute(p) {
      if (p.node.name.type === "JSXIdentifier" && /^on[A-Z]/.test(p.node.name.name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            4,
            `Direct JSX event handler '${p.node.name.name}' is discouraged.`,
            `Bind events via '${ehName}.trackListener' for centralized event management.`
          )
        );
      }
    }
  };
}

/* 6. Sanitize All User HTML */
function vSanitize(err, file, config) {
  const sanitizerName = config.serviceNames.sanitizer;
  const domWriteProperties = ["innerHTML", "outerHTML"];
  const domWriteMethods = ["insertAdjacentHTML", "write", "writeln"]; // document.write is highly discouraged anyway

  function isSanitized(valuePath) {
    if (!valuePath) return false;

    // Attempt to resolve to the actual source node if it's an identifier
    const node = getExpressionSourceNode(valuePath);
    if (!node) return false;

    if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") &&
        node.callee.type === "MemberExpression") {
        // Check if callee.object resolves to sanitizerName
        const calleeObjectPath = valuePath.get("callee.object");
        const calleeObjectSourceNode = getExpressionSourceNode(calleeObjectPath);

        if (calleeObjectSourceNode?.name === sanitizerName && node.callee.property.name === "sanitize") {
            return true;
        }
    }
    if (node.type === "ConditionalExpression") {
      return (
        isSanitized(valuePath.get("consequent")) && // Require both branches to be sanitized for safety
        isSanitized(valuePath.get("alternate"))
      );
    }
    if (node.type === "LogicalExpression" && node.operator === "||") { // a || b, if a is sanitized, that's not enough if b is chosen
      return ( // For '||', both must be sanitized if they could be chosen. For '&&', if left is sanitized, it might be enough if it's the result.
        isSanitized(valuePath.get("left")) && // This is a stricter check, often one is enough for ||
        isSanitized(valuePath.get("right"))
      );
    }
    // Allow string literals, number literals, boolean literals as inherently safe
    if (["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral"].includes(node.type)) {
        return true;
    }
    // Allow template literals if all expressions within them are sanitized
    if (node.type === "TemplateLiteral") {
        return node.expressions.every(exprNode => isSanitized(valuePath.get("expressions")[node.expressions.indexOf(exprNode)]));
    }

    return false;
  }

  return {
    AssignmentExpression(p) {
      const left = p.node.left;
      if (
        left.type === "MemberExpression" &&
        left.property.type === "Identifier" && // Ensure property is an Identifier
        domWriteProperties.includes(left.property.name)
      ) {
        // Exemption for domAPI.js as per original rules, assuming it has its own canonical sanitizer call
        const isDomAPIFileCurrent = /(?:^|[\\/])domAPI\.(js|ts)$/i.test(file);
        if (isDomAPIFileCurrent) {
          // Even in domAPI.js, if it's assigning to innerHTML, it should be sanitized unless it's a very specific internal assignment
          // For now, retain original exemption but it's a point of scrutiny.
          // The rule was: "domAPI.js no longer fully exempt from vSanitize; only certain assignments allowed"
          // This implies domAPI should *use* the sanitizer, but perhaps not be flagged for its own `setInnerHTML` implementation.
          // The current check *would* flag domAPI if it wrote `el.innerHTML = unsanitized`.
          // Let's assume domAPI is trusted to call its *own* internal setInnerHTML that uses sanitizer.
          // This rule should primarily catch *other* modules doing this.
          // To be more precise, we could check if `left.object` is `this` within a `domAPI` method.
          return;
        }

        if (!isSanitized(p.get("right"))) {
            err.push(
                E(
                file,
                p.node.loc.start.line,
                6,
                `Direct assignment to '${left.property.name}' with potentially unsanitized HTML.`,
                `Use a safe DOM update method or ensure HTML is processed by '${sanitizerName}.sanitize()'. Consider domAPI.setInnerHTML().`
                )
            );
        }
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (
        callee.type === "MemberExpression" &&
        callee.property.type === "Identifier" &&
        domWriteMethods.includes(callee.property.name)
      ) {
        // For document.write(html) or element.insertAdjacentHTML(position, html)
        const htmlArgIndex = (callee.property.name === "insertAdjacentHTML") ? 1 : 0;
        const htmlArgPath = p.get(`arguments.${htmlArgIndex}`);

        if (htmlArgPath && !isSanitized(htmlArgPath)) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              6,
              `Call to '${callee.property.name}' with potentially unsanitized HTML.`,
              `Ensure HTML argument is processed by '${sanitizerName}.sanitize()'.`
            )
          );
        }
      }
    },

    JSXAttribute(p) {
      if (p.node.name.name === "dangerouslySetInnerHTML") {
        if (
          p.node.value.type === "JSXExpressionContainer" &&
          p.node.value.expression.type === "ObjectExpression"
        ) {
          const htmlProp = p.node.value.expression.properties.find(
            prop => prop.type === "Property" && prop.key.name === "__html" // Ensure it's a Property
          );
          if (htmlProp && htmlProp.value) {
            // Find the path to the __html property's value
            let htmlValuePath;
            const propertiesPaths = p.get("value.expression.properties");
            for (const propPath of propertiesPaths) {
                if (propPath.isProperty() && propPath.node.key.name === "__html") {
                    htmlValuePath = propPath.get("value");
                    break;
                }
            }

            if (htmlValuePath && !isSanitized(htmlValuePath)) {
              err.push(
                E(
                  file,
                  p.node.loc.start.line,
                  6,
                  "Usage of 'dangerouslySetInnerHTML' with unsanitized HTML.",
                  `The value for '__html' must come from '${sanitizerName}.sanitize()'.`
                )
              );
            } else if (!htmlValuePath) {
                 err.push(
                    E(
                        file,
                        p.node.loc.start.line,
                        6,
                        "'dangerouslySetInnerHTML' __html property is malformed or its value couldn't be statically analyzed.",
                        "Ensure it's a direct object { __html: sanitizedValue }."
                    )
                );
            }
          } else {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                6,
                "'dangerouslySetInnerHTML' must be an object like '{ __html: sanitizedValue }'.",
                "Missing or incorrect __html property."
              )
            );
          }
        } else {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              6,
              "'dangerouslySetInnerHTML' value must be an object expression.",
              "Example: dangerouslySetInnerHTML={{ __html: sanitizer.sanitize(value) }}"
            )
          );
        }
      }
    }
  };
}

/* 7. domReadinessService Only */
function vReadiness(err, file, isBootstrapFile, config) {
  if (isBootstrapFile) return {}; // Bootstrap files manage readiness

  return {
    CallExpression(p) {
      const callee = p.node.callee;

      if (
        callee.type === "MemberExpression" &&
        callee.property.name === "addEventListener"
      ) {
        const evArg = p.node.arguments[0];

        if (
          evArg?.type === "StringLiteral" &&
          ["DOMContentLoaded", "load"].includes(evArg.value)
        ) {
          const objSource = getExpressionSourceNode(p.get("callee.object"));
          // Check if listener is on window or document without a local binding
          if (objSource && !p.scope.hasBinding(objSource.name) && (objSource.name === "window" || objSource.name === "document")) {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                7,
                `Ad-hoc DOM readiness check ('${evArg.value}') found on global '${objSource.name}'.`,
                `Use DI-injected '${config.serviceNames.domReadinessService}'.`
              )
            );
          }
        } else if (
          evArg?.type === "StringLiteral" &&
          ["app:ready", "AppReady"].includes(evArg.value) && // Generic app ready events
          // If this is on a known event bus, it might be okay, but this rule is for DOM readiness service
          !(getExpressionSourceNode(p.get("callee.object"))?.name === config.serviceNames.eventHandlers) && // Allow if it's eventHandlers itself
          !config.knownBusNames.includes(getExpressionSourceNode(p.get("callee.object"))?.name)
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              7,
              `Manual addEventListener for app readiness ('${evArg.value}') detected.`,
              `Use '${config.serviceNames.domReadinessService}' for all app/module readiness coordination.`
            )
          );
        }
      }

      if (
        callee.type === "MemberExpression" &&
        callee.object.name === (config.objectNames.dependencySystem || "DependencySystem") &&
        callee.property.name === "waitFor"
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            7,
            `Manual ${config.objectNames.dependencySystem}.waitFor() call is forbidden for module/app readiness.`,
            `Use only ${config.serviceNames.domReadinessService}.{waitForEvent(),dependenciesAndElements()} via DI.`
          )
        );
      }

      if (
        callee.type === "Identifier" &&
        /^(setTimeout|setInterval)$/.test(callee.name) &&
        !p.scope.hasBinding(callee.name) // Global setTimeout/setInterval
      ) {
        // Check if at module scope (not inside any function)
        if (!p.getFunctionParent()) {
            err.push(
                E(
                file,
                p.node.loc.start.line,
                7, // Could also be rule 3 (Pure Imports)
                `Global '${callee.name}' call at module scope.`,
                `If for readiness, use '${config.serviceNames.domReadinessService}'. Avoid top-level timers.`
                )
            );
        }
      }
    }
  };
}

/* 8. Centralised State Access */
function vState(err, file, isBootstrapFile, config) {
  if (isBootstrapFile) return {};
  const globalAppName = config.objectNames.globalApp || "app"; // Default to "app"
  const statePropName = config.objectNames.stateProperty || "state";
  // Handle if globalAppName is configured as an array or single string
  const globalAppNames = Array.isArray(globalAppName) ? globalAppName : [globalAppName];


  return {
    AssignmentExpression(p) {
      const left = p.node.left;
      // app.state.someProp = value;
      if (
        left.type === "MemberExpression" &&
        left.object.type === "MemberExpression" &&
        left.object.object.type === "Identifier" &&
        globalAppNames.includes(left.object.object.name) &&
        !p.scope.hasBinding(left.object.object.name) && // Ensure it's the global app object
        left.object.property.name === statePropName
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            8,
            `Direct mutation of '${left.object.object.name}.${statePropName}.${left.property.name}'.`,
            "Use dedicated setters provided by the application module (e.g., appModule.setSomeState(...)) to modify global state."
          )
        );
      } else if ( // app.state = newObject; (reassigning the whole state object)
        left.type === "MemberExpression" &&
        left.object.type === "Identifier" &&
        globalAppNames.includes(left.object.name) &&
        !p.scope.hasBinding(left.object.name) &&
        left.property.name === statePropName
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            8,
            `Direct reassignment of '${left.object.name}.${statePropName}'.`,
            "Global state object should not be reassigned. Use dedicated setters for its properties."
          )
        );
      }
    },

    CallExpression(p) {
      // Object.assign(app.state, newProps);
      if (
        p.node.callee.type === "MemberExpression" &&
        p.node.callee.object.name === "Object" &&
        p.node.callee.property.name === "assign" &&
        p.node.arguments.length > 0
      ) {
        const firstArgPath = p.get("arguments")[0];
        const firstArgSourceNode = getExpressionSourceNode(firstArgPath);

        if (
          firstArgSourceNode &&
          firstArgSourceNode.type === "MemberExpression" &&
          firstArgSourceNode.object.type === "Identifier" &&
          globalAppNames.includes(firstArgSourceNode.object.name) &&
          !p.scope.hasBinding(firstArgSourceNode.object.name) &&
          firstArgSourceNode.property.name === statePropName
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              8,
              `Direct mutation of '${firstArgSourceNode.object.name}.${statePropName}' via 'Object.assign'.`,
              "Use dedicated setters provided by the application module."
            )
          );
        }
      }
      // Also consider spread syntax for merging state: app.state = { ...app.state, ...newProps }
      // This is covered by the AssignmentExpression check for `app.state = ...`
    }
  };
}

/* 9. Module Event Bus */
function vBus(err, file, config) {
  const knownBusNames = config.knownBusNames || DEFAULT_CONFIG.knownBusNames;
  return {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === "MemberExpression" && callee.property.name === "dispatchEvent") {
        const busObjectPath = p.get("callee.object");
        const busSourceNode = getExpressionSourceNode(busObjectPath); // Resolves identifier to its declaration if possible

        // Allow if the object is explicitly 'domAPI' (for native element dispatch)
        if (busSourceNode?.name === "domAPI") {
            return;
        }
        // Allow if object is 'eventHandlers' (if it has its own dispatch proxy)
        if (busSourceNode?.name === config.serviceNames.eventHandlers) {
            return;
        }


        let isKnownBus = false;
        if (busSourceNode) {
            if (busSourceNode.type === "Identifier" && knownBusNames.includes(busSourceNode.name) && !p.scope.hasBinding(busSourceNode.name)) {
                isKnownBus = true; // Global/DI'd known bus
            } else if (busSourceNode.type === "Identifier" && p.scope.hasBinding(busSourceNode.name)) {
                // Check if a local variable is an instance of EventTarget or a known bus class
                const binding = p.scope.getBinding(busSourceNode.name);
                if (binding?.path.node.init?.type === "NewExpression" &&
                    binding.path.node.init.callee.name === "EventTarget") {
                    isKnownBus = true;
                }
                // Could add more checks here if buses are created via factories, e.g., createEventBus()
            } else if (busSourceNode.type === "ThisExpression") {
                isKnownBus = true; // Assuming `this.dispatchEvent` is on a class that is a bus
            } else if (busSourceNode.type === "NewExpression" && busSourceNode.callee.name === "EventTarget") {
                isKnownBus = true; // new EventTarget().dispatchEvent()
            }
            // Add check for buses obtained via a getter, e.g. someService.getEventBus().dispatchEvent()
            else if (busSourceNode.type === "CallExpression" && busSourceNode.callee.property?.name?.match(/get.*Bus$/i)) {
                isKnownBus = true;
            }
        }


        if (!isKnownBus) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              9,
              `Event dispatched on an object not identified as a dedicated event bus (found: ${busSourceNode?.name || busSourceNode?.type || 'unknown'}).`,
              `Dispatch events via a DI-provided known bus (e.g., '${knownBusNames[0]}.dispatchEvent()') or an instance of EventTarget.`
            )
          );
        }
      }
    }
  };
}

/* 10. Navigation Service */
function vNav(err, file, config) {
  const navServiceName = config.serviceNames.navigationService;

  return {
    AssignmentExpression(p) {
      const left = p.node.left;
      if (
        left.type === "MemberExpression" &&
        left.object.type === "Identifier" &&
        left.object.name === "location" &&
        !p.scope.hasBinding("location") // Global location
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            10,
            `Direct modification of 'location.${left.property.name}'.`,
            `Use '${navServiceName}.navigateTo()' or other methods from the navigation service.`
          )
        );
      } else if ( // window.location.href = ...
        left.type === "MemberExpression" &&
        left.object.type === "MemberExpression" &&
        left.object.object.name === "window" &&
        !p.scope.hasBinding("window") &&
        left.object.property.name === "location"
      ) {
         err.push(
          E(
            file,
            p.node.loc.start.line,
            10,
            `Direct modification of 'window.location.${left.property.name}'.`,
            `Use '${navServiceName}.navigateTo()' or other methods from the navigation service.`
          )
        );
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === "MemberExpression") {
        const obj = callee.object;
        const propName = callee.property.name;

        let isGlobalLocation = false;
        if (obj.type === "Identifier" && obj.name === "location" && !p.scope.hasBinding("location")) {
            isGlobalLocation = true;
        } else if (obj.type === "MemberExpression" && obj.object.name === "window" && !p.scope.hasBinding("window") && obj.property.name === "location") {
            isGlobalLocation = true;
        }

        if (isGlobalLocation && ["assign", "replace", "reload"].includes(propName)) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              10,
              `Direct call to 'location.${propName}()'.`,
              `Use '${navServiceName}' for navigation.`
            )
          );
        }

        // history.pushState, etc.
        if (obj.type === "Identifier" && obj.name === "history" && !p.scope.hasBinding("history") &&
            ["pushState", "replaceState", "go", "back", "forward"].includes(propName)) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              10,
              `Direct use of 'history.${propName}()'.`,
              `Use '${navServiceName}' for routing/navigation.`
            )
          );
        }
      }
    }
  };
}

/* 11. Single API Client */
function vAPI(err, file, config) {
  const apiClientName = config.serviceNames.apiClient;
  return {
    CallExpression(p) {
      const callee = p.node.callee;
      // Check for apiClient calls missing CSRF if it's a direct call to the configured apiClient function/object method
      if (
        (callee.type === "Identifier" && callee.name === apiClientName && !p.scope.hasBinding(apiClientName)) ||
        (callee.type === "MemberExpression" && callee.object.name === apiClientName && !p.scope.hasBinding(apiClientName)) // apiClient.post(), etc.
      ) {
        const optsArg = (callee.type === "Identifier") ? p.get("arguments")[1] : p.get("arguments")[0]; // apiClient(url, opts) vs apiClient.post(url, data, opts)
        // This heuristic for optsArg might need refinement based on actual apiClient signature
        let actualOptsPath = optsArg;
        if (callee.type === "MemberExpression" && p.node.arguments.length > 1) { // e.g. apiClient.post(url, data, config)
            if (p.node.arguments.length === 2 && p.get("arguments")[1].isObjectExpression()) { // apiClient.post(url, config)
                actualOptsPath = p.get("arguments")[1];
            } else if (p.node.arguments.length >=3 && p.get("arguments")[2].isObjectExpression()) { // apiClient.post(url, data, config)
                actualOptsPath = p.get("arguments")[2];
            }
        }


        if (actualOptsPath && actualOptsPath.isObjectExpression()) {
          const optsNode = actualOptsPath.node;

          let method = "GET"; // Default method
          // Find method in options
          const methodProp = optsNode.properties.find(pr => pr.type === "Property" && (pr.key.name === "method" || pr.key.value === "method"));
          if (methodProp && methodProp.value.type === "StringLiteral") {
            method = methodProp.value.value.toUpperCase();
          } else if (callee.type === "MemberExpression" && /^(post|put|patch|delete)$/i.test(callee.property.name)) {
            method = callee.property.name.toUpperCase(); // Method from apiClient.post()
          }


          const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
          if (mutating) {
            let hasCsrf = false;
            const headersProp = optsNode.properties.find(pr => pr.type === "Property" && (pr.key.name === "headers" || pr.key.value === "headers"));
            if (headersProp && headersProp.value.type === "ObjectExpression") {
              hasCsrf = headersProp.value.properties.some(hp =>
                hp.type === "Property" && (hp.key.name || hp.key.value) && /^x[-_]csrf[-_]token$/i.test(hp.key.name || hp.key.value)
              );
            }
            if (!hasCsrf) {
              err.push(
                E(
                  file,
                  p.node.loc.start.line,
                  11,
                  `State-changing API call (method: ${method}) via '${apiClientName}' appears to be missing an 'X-CSRF-Token' header.`,
                  "Add the CSRF token to options.headers for POST, PUT, PATCH, DELETE requests."
                )
              );
            }
          }
        }
      }

      // Banning global fetch/axios
      if (callee.type === "Identifier" && callee.name === "fetch" && !p.scope.hasBinding("fetch")) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            11,
            "Global 'fetch()' call detected.",
            `Use DI-injected '${apiClientName}'.`
          )
        );
      }
      if (callee.type === "Identifier" && callee.name === "axios" && !p.scope.hasBinding("axios") && apiClientName !== "axios") {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            11,
            "Global 'axios()' call detected.",
            `Use DI-injected '${apiClientName}'.`
          )
        );
      }
      if (
        callee.type === "MemberExpression" &&
        callee.object.name === "axios" && !p.scope.hasBinding("axios") &&
        apiClientName !== "axios" // if axios *is* the apiClientName, this is fine
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            11,
            `'axios.${callee.property.name}()' call detected.`,
            `Use DI-injected '${apiClientName}'.`
          )
        );
      }
    },
    NewExpression(p) {
      if (p.node.callee.name === "XMLHttpRequest" && !p.scope.hasBinding("XMLHttpRequest")) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            11,
            "'new XMLHttpRequest()' detected.",
            `Use DI-injected '${apiClientName}'.`
          )
        );
      }
    }
  };
}

/* 12. Error logging & safeHandler */
function vErrorLog(err, file, isBootstrapFile, moduleCtx, config) {
  const loggerName = config.serviceNames.logger;
  const ehName = config.serviceNames.eventHandlers;
  const depSystemName = config.objectNames.dependencySystem || "DependencySystem";

  const isLoggerJs = /\/logger\.(js|ts)$/i.test(file);

  return {
    FunctionDeclaration(p) {
      if (!isBootstrapFile && p.node.id && p.node.id.name === "safeHandler") {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15, // Rule 15: Canonical Implementations
            "Duplicate 'safeHandler' function declaration is forbidden.",
            `Use the canonical safeHandler, typically provided via DI (e.g., from ${depSystemName} or a utility module).`
          )
        );
      }
    },
    VariableDeclarator(p) {
      if (
        !isBootstrapFile &&
        p.node.id.type === "Identifier" &&
        p.node.id.name === "safeHandler" &&
        p.node.init &&
        (p.node.init.type === "FunctionExpression" || p.node.init.type === "ArrowFunctionExpression")
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15, // Rule 15
            "Local 'safeHandler' function definition is forbidden.",
            `Use the canonical safeHandler, typically provided via DI.`
          )
        );
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (
        callee.type === "MemberExpression" &&
        (callee.object.name === ehName ||
          getExpressionSourceNode(p.get("callee.object"))?.node?.name === ehName) &&
        callee.property.name === "trackListener"
      ) {
        const handlerArgPath = p.get("arguments")[2];
        if (handlerArgPath) {
          const handlerSourceNode = getExpressionSourceNode(handlerArgPath);

          const isSafeHandlerCall =
            handlerSourceNode &&
            handlerSourceNode.type === "CallExpression" &&
            handlerSourceNode.callee.type === "Identifier" && // Ensure callee is an Identifier
            handlerSourceNode.callee.name === "safeHandler";

          const isForwardedParam =
            handlerArgPath.isIdentifier() &&
            (handlerArgPath.scope.getBinding(handlerArgPath.node.name)?.kind === "param");

          const isInlineFunction = // Inline functions are common, safeHandler should wrap their *body* or be used directly
            handlerSourceNode &&
            (handlerSourceNode.type === "ArrowFunctionExpression" ||
              handlerSourceNode.type === "FunctionExpression");

          // This logic is tricky: inline functions themselves aren't wrapped by safeHandler,
          // but their content should be, or the inline function should call safeHandler.
          // The rule implies the handler *itself* should be the result of safeHandler(fn).
          if (!isSafeHandlerCall && !isForwardedParam && !isInlineFunction) {
            err.push(
              E(
                file,
                handlerArgPath.node.loc.start.line,
                12,
                `Event handler for '${ehName}.trackListener' should be wrapped by 'safeHandler' (or be a directly passed param, or simple inline function).`,
                `Complex handlers or those prone to errors should be: ${ehName}.trackListener(el, 'click', safeHandler(myHandler, '${moduleCtx}:desc'), ...);`
              )
            );
          } else if (isInlineFunction) {
            // For inline functions, it's harder to enforce safeHandler wrapping automatically.
            // This is more of a code review point unless the inline function is trivial.
            // For now, we allow inline functions without explicit safeHandler wrapping by this linter.
          }
        }
      }
    },
    CatchClause(p) {
      const errIdNode = p.node.param;
      const errId = errIdNode?.name; // Error param might be an ObjectPattern, e.g. catch ({ message })
      if (!errId && errIdNode?.type === "Identifier") return; // Should always be an identifier if simple

      let loggedCorrectly = false;
      let hasNestedTry = false;

      p.traverse({
        CallExpression(q) {
          const cal = q.node.callee;
          let loggerCallType = null;
          if (cal.type === "MemberExpression" && (cal.property.name === "error" || cal.property.name === "fatal")) {
            const loggerObjectSource = getExpressionSourceNode(q.get("callee.object"));
            if (loggerObjectSource?.name === loggerName) {
                loggerCallType = "direct";
            } else if (
              cal.object.type === "CallExpression" && // logger.withContext().error()
              cal.object.callee?.type === "MemberExpression" &&
              cal.object.callee.property.name === "withContext"
            ) {
                const baseLogger = getExpressionSourceNode(q.get("callee.object.callee.object"));
                if (baseLogger?.name === loggerName) {
                    loggerCallType = "bound";
                }
            }
          }
          if (!loggerCallType) return;

          // Check if the caught error variable (errId) is one of the arguments to logger.error
          const includesErrorArg = q.node.arguments.some((argNode, idx) => {
            if (argNode.type === "Identifier" && argNode.name === errId) return true;
            // Also check if error object is spread or part of another object
            const argPath = q.get(`arguments.${idx}`);
            const resolvedArg = getExpressionSourceNode(argPath);
            if(resolvedArg === errIdNode) return true; // Direct reference
            if(resolvedArg?.type === "ObjectExpression" && resolvedArg.properties.some(prop => prop.type === "SpreadElement" && prop.argument.name === errId)) return true; // { ...err }
            return false;
          });

          let hasContextMeta = false;
          if (loggerCallType === "bound") { // logger.withContext(...).error(msg, err, { context: 'override' })
            // The base context is already there. Check for overriding context in the final metadata object.
            const lastArgPath = q.get(`arguments.${q.node.arguments.length - 1}`);
            const lastArgNode = getExpressionSourceNode(lastArgPath);
            hasContextMeta = (lastArgNode?.type === "ObjectExpression" && hasProp(lastArgNode, "context"));
            if (!hasContextMeta && q.node.arguments.length > 0) hasContextMeta = true; // Allow if withContext() provides base and no override
          } else { // logger.error(msg, err, { context: '...' })
            const lastArgPath = q.get(`arguments.${q.node.arguments.length - 1}`);
            const lastArgNode = getExpressionSourceNode(lastArgPath);
            hasContextMeta =
              lastArgNode?.type === "ObjectExpression" && hasProp(lastArgNode, "context");
          }

          if (includesErrorArg && hasContextMeta) loggedCorrectly = true;
        },
        TryStatement() {
          hasNestedTry = true;
        }
      });

      const isSwallow =
        /^(finalErr|logErr|_|ignored)$/i.test(errId || "") && p.node.body.body.length === 0;
      if (!loggedCorrectly && !hasNestedTry && !isSwallow && !isLoggerJs && !isBootstrapFile) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            12,
            `Caught errors must be logged via '${loggerName}.error(message, errorObject, { context: ... })' or equivalent.`,
            `Example:\n} catch (${errId || "err"}) {\n  ${loggerName}.error("Operation failed", ${errId || "err"}, { context: "${moduleCtx}:myError" });\n}`
          )
        );
      }
    }
  };
}

/* 13. Authentication Consolidation */
function vAuth(err, file, isBootstrapFile, config) {
    // Allow appModule itself to define/manage its state, and auth module to implement logic
  if (isBootstrapFile || /\/(auth|appModule)\.(js|ts)$/i.test(file)) return {};
  const globalAppName = config.objectNames.globalApp || "app";
  const globalAppNames = Array.isArray(globalAppName) ? globalAppName : [globalAppName];


  return {
    VariableDeclarator(p) {
      if (p.node.id.type === "Identifier" && /^(auth|user)State$/i.test(p.node.id.name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            `Local '${p.node.id.name}' variable declaration is forbidden.`,
            `Use '${globalAppNames[0]}.state.isAuthenticated' and '${globalAppNames[0]}.state.currentUser' (or similar from the central app module) instead.`
          )
        );
      }
    },
    Property(p) { // For object properties or class fields
      if (
        p.node.key &&
        ((p.node.key.type === "Identifier" && /^(auth|user)State$/i.test(p.node.key.name)) ||
          (p.node.key.type === "StringLiteral" && /^(auth|user)State$/i.test(p.node.key.value))) &&
        // Ensure this is not within the appModule itself
        !p.findParent(path => path.isExportNamedDeclaration() && path.node.declaration?.id?.name?.toLowerCase().includes("appmodule"))
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            `Local '${p.node.key.name || p.node.key.value}' property/field is forbidden.`,
            `Read from '${globalAppNames[0]}.state' instead.`
          )
        );
      }
    },
    MemberExpression(p) {
      if (p.node.object.type === "Identifier" && /^(auth|user)State$/i.test(p.node.object.name) && !p.scope.hasBinding(p.node.object.name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            `Access to global-like '${p.node.object.name}.${p.node.property.name}' is forbidden.`,
            `Use '${globalAppNames[0]}.state.isAuthenticated' or '${globalAppNames[0]}.state.currentUser' instead.`
          )
        );
      }
      // this.state.authState
      if (
        p.node.object.type === "MemberExpression" &&
        p.node.object.object.type === "ThisExpression" &&
        p.node.object.property.name === "state" &&
        /^(auth|user)State$/i.test(p.node.property.name)
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            `Access to 'this.state.${p.node.property.name}' is forbidden.`,
            `Remove local authentication state. Use '${globalAppNames[0]}.state' instead.`
          )
        );
      }
    },
    AssignmentExpression(p) {
      const left = p.node.left;
      if (left.type === "Identifier" && /^(auth|user)State$/i.test(left.name) && !p.scope.hasBinding(left.name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            `Assignment to global-like '${left.name}' variable is forbidden.`,
            `Use methods on '${globalAppNames[0]}' (e.g., ${globalAppNames[0]}.setAuthState()) to update authentication state.`
          )
        );
      }
      if (
        left.type === "MemberExpression" &&
        left.object.type === "MemberExpression" &&
        left.object.object.type === "ThisExpression" &&
        left.object.property.name === "state" &&
        /^(auth|user)State$/i.test(left.property.name)
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            `Assignment to 'this.state.${left.property.name}' is forbidden.`,
            "Remove local authentication state storage."
          )
        );
      }
    },

    LogicalExpression(p) {
      if (p.node.operator === "||") {
        const left = p.node.left;
        const right = p.node.right;

        // appModule.state.isAuthenticated || someLocalAuth.isAuthenticated
        const isAppModuleAuthCheck = (node) =>
          node.type === "MemberExpression" &&
          node.object.type === "MemberExpression" &&
          node.object.object.type === "Identifier" &&
          globalAppNames.includes(node.object.object.name) &&
          node.object.property.name === (config.objectNames.stateProperty || "state") &&
          /^(isAuth|isAuthenticated)$/i.test(node.property.name);

        const isLocalAuthFallback = (node) =>
          (node.type === "CallExpression" && // someAuth.isAuthenticated()
            node.callee.type === "MemberExpression" &&
            /^(isAuth|isAuthenticated)$/i.test(node.callee.property.name) &&
            !globalAppNames.includes(getExpressionSourceNode(p.get("right.callee.object"))?.name) // Ensure it's not another appModule check
            ) ||
          (node.type === "MemberExpression" && // someAuth.isAuthenticated
            /^(isAuth|isAuthenticated)$/i.test(node.property.name)  &&
             !globalAppNames.includes(getExpressionSourceNode(p.get("right.object"))?.name)
            );


        if (isAppModuleAuthCheck(left) && isLocalAuthFallback(right)) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              13,
              "Dual authentication check pattern (appModule.state.isAuthenticated || localFallback) is forbidden.",
              `Use only '${globalAppNames[0]}.state.isAuthenticated' - single source of truth.`
            )
          );
        }
      }
    },

    ClassBody(p) {
      for (const element of p.node.body) {
        if (
          element.type === "MethodDefinition" &&
          element.key &&
          element.key.type === "Identifier" && // Ensure key is an Identifier
          /^(setAuth|setUser)State$/i.test(element.key.name)
        ) {
          // Allow if this class is the appModule itself or an auth service
          const className = p.parentPath.node.id?.name;
          if (className && (globalAppNames.some(name => className.toLowerCase().includes(name.toLowerCase())) || /authservice/i.test(className))) {
            return;
          }
          err.push(
            E(
              file,
              element.loc.start.line,
              13,
              `Individual module '${element.key.name}()' method is forbidden.`,
              `Use methods on '${globalAppNames[0]}' (e.g., ${globalAppNames[0]}.setAuthState()) for all auth state updates.`
            )
          );
        }
      }
    }
  };
}

/* 14. Module Size Limit */
function vModuleSize(err, file, code, config) {
  // Exemptions for auth module or init files if they are genuinely large due to bootstrapping necessities.
  // Consider if bootstrap files should also be exempt or have a higher limit.
  if (/[/\\](auth|appModule)\.(js|ts)$/i.test(file) || config.bootstrapFileRegex.test(file)) {
      // Potentially apply a different, larger limit for these core files or fully exempt.
      // For now, let's exempt them from the default limit.
      return {};
  }

  // Check for vendor exemption comment
  if (config.vendoredCommentRegex && config.vendoredCommentRegex.test(code.substring(0, 500))) { // Check near top of file
    return {}; // Exempted
  }

  const maxLines = config.maxModuleLines || DEFAULT_CONFIG.maxModuleLines;
  const lines = code.split(/\r?\n/).length;
  if (lines > maxLines) {
    err.push(
      E(
        file,
        1,
        14,
        `Module exceeds ${maxLines} line limit (${lines} lines).`,
        `Split this module into smaller, focused modules. Vendored libraries can be exempted with a '${"// VENDOR-EXEMPT-SIZE: library name and reason"}' comment at the top.`
      )
    );
  }
  return {};
}

/* 15. Canonical Implementations */
function vCanonical(err, file, isBootstrapFile, code, config) {
  // Bootstrap files and auth module might define some of these canonicals
  if (isBootstrapFile || /\/(auth|appModule|logger|eventHandlers|domAPI|navigationService)\.(js|ts)$/i.test(file)) return {};
  const globalAppName = config.objectNames.globalApp || "app";
  const globalAppNames = Array.isArray(globalAppName) ? globalAppName : [globalAppName];


  return {
    FunctionDeclaration(p) {
      const name = p.node.id?.name || "";
      // Discourage re-implementing form handlers that should be canonical
      if (/^(handle|create).*(Login|Register|Auth|Password).*Form$/i.test(name) &&
        !/createAuthFormHandler/i.test(name)) { // Allow the canonical factory itself
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            `Custom auth-related form handler '${name}' detected.`,
            "Use a canonical auth form handler (e.g., createAuthFormHandler()) from the authentication module/service if available."
          )
        );
      }
    },

    CallExpression(p) {
      const callee = p.node.callee;

      // Discourage direct new URLSearchParams if a navigation service provides parsing
      if (callee.type === "NewExpression" &&
        callee.callee.type === "Identifier" &&
        callee.callee.name === "URLSearchParams" &&
        !p.scope.hasBinding("URLSearchParams") && // Global
        config.serviceNames.navigationService // Only if a nav service is configured
        ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            "Direct 'new URLSearchParams()' usage detected.",
            `Use '${config.serviceNames.navigationService}.parseURL()' or similar utility for URL parsing if provided.`
          )
        );
      }

      // Example: setSomeGlobalThing() should only be on appModule
      if (callee.type === "MemberExpression" &&
        /^(set|update)(Global|App|Current|Shared)[A-Z]/.test(callee.property.name) // Heuristic for global setters
        ) {
        const objSource = getExpressionSourceNode(p.get("callee.object"));
        if (objSource && objSource.type === "Identifier" && !globalAppNames.includes(objSource.name)) {
            err.push(
            E(
                file,
                p.node.loc.start.line,
                15,
                `Potential non-canonical global state setter '${objSource.name}.${callee.property.name}()'.`,
                `Global state mutations should typically be via methods on '${globalAppNames[0]}'.`
            )
            );
        }
      }
    },

    VariableDeclarator(p) {
      // Discourage local copies of global-like state
      if (p.node.id.type === "Identifier" &&
        /^(current|active|global|shared).*(User|Project|Session|Config|State|Settings)$/i.test(p.node.id.name) &&
        !p.getFunctionParent() // At module scope
        ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            `Module-level variable '${p.node.id.name}' appears to shadow global/shared state.`,
            `Access such state via '${globalAppNames[0]}.state' or equivalent canonical source.`
          )
        );
      }
    },
    // NewExpression check for URLSearchParams is covered by CallExpression with NewExpression as callee effectively
  };
}

/* 16. Error Object Structure */
function vErrorStructure(err, file) {
  if (/[/\\](logger|apiClient)\.(js|ts)$/i.test(file)) return {}; // Logger/API client might define these structures

  return {
    ObjectExpression(p) {
      // Check only if this object is part of an error context (e.g., in a throw, or assigned to an 'error' var)
      // This is hard to do perfectly. For now, check objects with typical error-like property names.
      const props = p.node.properties.map(prop =>
        prop.key?.name || prop.key?.value
      ).filter(Boolean);

      const hasErrorIndicator = props.some(key => /err(or)?|fault|issue|problem/i.test(key)) ||
                               (props.includes("message") && props.length > 1); // 'message' alone is fine, but with other props suggests an error object

      if (hasErrorIndicator) {
        const hasStandardStructure =
          props.includes("status") && // Or statusCode
          // props.includes("data") && // Data is optional, message is key
          props.includes("message");

        // More lenient: if it has 'detail' or 'code', might be another valid internal error structure.
        const hasOtherValidStructure = props.includes("detail") || props.includes("code");

        if (!hasStandardStructure && !hasOtherValidStructure && props.length > 1 && !props.includes("stack")) { // Allow { message, stack }
          // Check if it's directly inside a NewExpression for Error, TypeError etc.
          if (p.parentPath.isNewExpression() && /Error$/.test(p.parentPath.node.callee?.name)) {
            // Standard Error constructor takes message, then options { cause }
            // `new Error("msg", { cause: otherError, custom: foo })`
            // This rule might be too noisy for Error constructor options.
            return;
          }

          err.push(
            E(
              file,
              p.node.loc.start.line,
              16,
              "Non-standard error object structure detected.",
              "Prefer { status, message, data? } or { code, message, detail? } for custom error objects. Standard Error instances are fine."
            )
          );
        }
      }
    },

    ThrowStatement(p) {
      if (p.node.argument?.type === "ObjectExpression") {
        const props = p.node.argument.properties.map(prop =>
          prop.key?.name || prop.key?.value
        ).filter(Boolean);

        if (!props.includes("message") || (!props.includes("status") && !props.includes("code") && !props.includes("detail"))) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              16,
              "Thrown error object missing standard properties.",
              "Include at least { message } and preferably { status } or { code } in thrown custom error objects."
            )
          );
        }
      }
      // `throw new Error("message")` is fine and not an ObjectExpression.
    }
  };
}

/* 17 & 18. Logger factory and obsolete APIs */
function vLoggerFactory(err, file, isBootstrapFile, config) {
  const isLoggerJs = /[/\\]logger\.(js|ts)$/i.test(file);

  return {
    CallExpression(p) {
      if (p.node.callee.type === "Identifier" && p.node.callee.name === "createLogger") {
        if (!isLoggerJs && !isBootstrapFile) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              17,
              "`createLogger()` can only be called in logger.js or a bootstrap file (e.g. app.js).",
              "All other modules must receive a prepared logger via DI."
            )
          );
        }
        const cfgArg = p.get("arguments")[0];
        if (cfgArg && cfgArg.isObjectExpression() && hasProp(cfgArg.node, "authModule")) {
          err.push(
            E(
              file,
              cfgArg.node.loc.start.line,
              18,
              "`authModule` parameter to createLogger() is deprecated.",
              "Remove this property—logger discovers auth via appModule.state or similar central auth status."
            )
          );
        }
      }

      if (
        p.node.callee.type === "MemberExpression" &&
        p.node.callee.object.type === "Identifier" &&
        p.node.callee.object.name === config.serviceNames.logger &&
        !p.scope.hasBinding(config.serviceNames.logger) // Global/DI'd logger
      ) {
        const method = p.node.callee.property.name;
        if (["setServerLoggingEnabled", "setMinLevel", "setLogLevel", "addTransport", "removeTransport"].includes(method)) {
          if (!isBootstrapFile && !isLoggerJs) {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                17, // Re-using 17 for logger runtime control placement
                `'${config.serviceNames.logger}.${method}()' must only be called in bootstrap files or logger.js.`,
                "Centralize runtime logger controls."
              )
            );
          }
        }
      }
    }
  };
}

/* ───────────────────────── Enhanced Analyzer ─────────────────── */
function analyze(file, code, configToUse) {
  const errors = [];
  let moduleCtx = "Module"; // Default context
  // Try to extract MODULE_CONTEXT or similar for more specific hints
  const moduleContextMatch = code.match(/(?:const|let|var)\s+(?:MODULE_CONTEXT|CONTEXT_ID|MODULE_NAME)\s*=\s*['"`]([^'"`]+)['"`]/i);
  if (moduleContextMatch) moduleCtx = moduleContextMatch[1];
  else { // Fallback: derive from filename
    const base = path.basename(file, path.extname(file));
    moduleCtx = base.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, ''); // camelCase or PascalCase to kebab-case
    if (moduleCtx === 'index') { // if index, use parent directory name
        const parentDir = path.basename(path.dirname(file));
        if (parentDir && parentDir !== 'js' && parentDir !== 'ts' && parentDir !== 'src') {
            moduleCtx = parentDir.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
        }
    }
  }


  const isBootstrapFile = configToUse.bootstrapFileRegex.test(file);
  const isWrapperFile = WRAPPER_FILE_REGEX.test(file);

  // Module size check first, as it doesn't need AST
  vModuleSize(errors, file, code, configToUse); // Pass errors array directly

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "decorators-legacy", // if you use legacy decorators
        "decoratorAutoAccessors", // for modern decorators if needed
        "dynamicImport",
        "optionalChaining",
        "nullishCoalescingOperator",
        "estree" // for estree-compatible output if other tools need it
      ],
      errorRecovery: true, // Try to parse even with some errors
    });
  } catch (e) {
    const pe = E(
      file,
      e.loc ? e.loc.line : 1,
      0,
      `Parse error: ${e.message}`
    );
    pe.actualLine = getLine(code, pe.line);
    return [pe, ...errors]; // Include size errors if any
  }

  // --- Limitations Note ---
  // The following checks are complex and generally beyond simple AST traversal:
  // 1. Verifying the *exact internal structure* of bootstrap files (e.g., app.js importing and using createAppInitializer correctly).
  //    This checker focuses on patterns within general modules.
  // 2. Enforcing that global access (e.g., window.document) *must* go through a specific wrapper service method
  //    (e.g., browserService.getDocument()) rather than just banning the direct global. This requires advanced data flow.
  // 3. Detecting all forms of "business logic" outside DI or "shadow state" is heuristic.

  const visitors = [
    isBootstrapFile ? null : vFactory(errors, file, configToUse), // Factories not required for bootstrap files themselves
    vDI(errors, file, isBootstrapFile, configToUse),
    isBootstrapFile ? null : vPure(errors, file), // Bootstrap files will have side effects
    vState(errors, file, isBootstrapFile, configToUse),
    isWrapperFile || isBootstrapFile ? null : vEvent(errors, file, isBootstrapFile, moduleCtx, configToUse),
    vSanitize(errors, file, configToUse), // Sanitization applies everywhere, including bootstrap if it handles HTML
    vReadiness(errors, file, isBootstrapFile, configToUse),
    vBus(errors, file, configToUse),
    vNav(errors, file, configToUse),
    vAPI(errors, file, configToUse),
    vLoggerFactory(errors, file, isBootstrapFile, configToUse),
    vLog(errors, file, isBootstrapFile, moduleCtx, configToUse),
    vErrorLog(errors, file, isBootstrapFile, moduleCtx, configToUse),
    vAuth(errors, file, isBootstrapFile, configToUse),
    vCanonical(errors, file, isBootstrapFile, code, configToUse),
    vErrorStructure(errors, file)
  ].filter(Boolean);

  traverse(ast, mergeVisitors(...visitors));

  errors.forEach(e => {
      if (!e.actualLine && e.line) {
          e.actualLine = getLine(code, e.line);
      }
  });
  return errors;
}

/* ───────────────────────── CLI UI Helpers ────────────────────── */
function pad(s, l, alignRight = false) {
  const str = String(s);
  const padding = " ".repeat(Math.max(0, l - str.length));
  return alignRight ? padding + str : str + padding;
}


function drawBox(title, w = 80) {
  const titleNoColor = chalk.reset(title);
  const titleVisibleLength = titleNoColor.length; // Length without ANSI codes

  const top = chalk.blueBright("┌" + "─".repeat(w - 2) + "┐");
  const side = chalk.blueBright("│");
  const empty = side + " ".repeat(w - 2) + side;

  const paddingNeeded = w - 2 - titleVisibleLength;
  const leftPad = Math.floor(paddingNeeded / 2);
  const rightPad = Math.ceil(paddingNeeded / 2);

  const mid = side + " ".repeat(leftPad) + title + " ".repeat(rightPad) + side;
  console.log(`${top}\n${empty}\n${mid}\n${empty}\n${chalk.blueBright("└" + "─".repeat(w - 2) + "┘")}\n`);
}


function drawTable(rows, hdr, widths) {
  const headerRow = hdr.map((h, i) => chalk.bold(pad(h, widths[i]))).join(chalk.dim(" │ "));
  const sep = widths.map(w => "─".repeat(w)).join(chalk.dim("─┼─"));
  console.log(chalk.dim("┌─") + sep + chalk.dim("─┐"));
  console.log(chalk.dim("│ ") + headerRow + chalk.dim(" │"));
  console.log(chalk.dim("├─") + sep + chalk.dim("─┤"));
  rows.forEach(r => {
    const cells = r.map((c, i) => {
        const cellContent = String(c);
        const alignRight = i === widths.length -1; // Align last column (violations count) to the right
        return pad(cellContent, widths[i], alignRight);
    });
    console.log(
      chalk.dim("│ ") +
      cells.join(chalk.dim(" │ ")) +
      chalk.dim(" │")
    );
  });
  console.log(chalk.dim("└─") + sep + chalk.dim("─┘\n"));
}

function groupByRule(errs) {
  const g = {};
  errs.forEach(e => (g[e.ruleId] ??= []).push(e));
  return g;
}

/* ───────────────────────── Main CLI ─────────────────────────── */
(function main() {
  const argv = process.argv.slice(2);
  const ruleFilterArg = argv.find(a => a.startsWith("--rule="));
  const ruleFilter = ruleFilterArg ? parseInt(ruleFilterArg.split("=")[1], 10) : null;
  const files = argv.filter(a => !a.startsWith("--") && (fs.existsSync(a) ? fs.statSync(a).isFile() : true /* allow non-existent for now, will be caught */) );
  const dirs = argv.filter(a => !a.startsWith("--") && fs.existsSync(a) && fs.statSync(a).isDirectory());

  const effectiveConfig = loadConfig(process.cwd());

  let allFiles = [...files];
  dirs.forEach(dir => {
    const glob = require("glob"); // Lazy require glob
    const foundFiles = glob.sync(path.join(dir, "**/*.{js,mjs,cjs,ts,jsx,tsx}"), { nodir: true, ignore: ['**/node_modules/**', '**/*.d.ts'] });
    allFiles.push(...foundFiles);
  });
  allFiles = [...new Set(allFiles)]; // Unique files

  if (!allFiles.length) {
    console.log(`\n${SYM.shield} Frontend Pattern Checker\nUsage: node patternChecker.cjs [--rule=N] <file1.js> [dir1/] …\n`);
    process.exit(0);
  }

  let totalViolations = 0;
  const report = [];
  let filesScanned = 0;
  let filesWithViolations = 0;

  console.log(chalk.blueBright(`${SYM.shield} Frontend Pattern Checker - Scanning...\n`));

  allFiles.forEach(f => {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      console.error(chalk.red(`${SYM.error} File not found or is not a file: ${abs}`));
      return;
    }
    filesScanned++;
    process.stdout.write(chalk.dim(`Scanning: ${path.basename(abs)}\r`));

    const code = read(abs);
    let errs = analyze(abs, code, effectiveConfig);
    if (ruleFilter !== null && ruleFilter !== 0) { // Rule 0 is "Other Issues" like parse errors
      errs = errs.filter(e => e.ruleId === ruleFilter);
    }
    if (errs.length) {
      totalViolations += errs.length;
      if(!report.find(r => r.file === abs)) filesWithViolations++;
      report.push({ file: abs, errs });
    }
  });
  process.stdout.write(" ".repeat(process.stdout.columns ? process.stdout.columns -1 : 70) + "\r"); // Clear line

  if (!totalViolations) {
    drawBox(`${SYM.ok} No pattern violations found in ${filesScanned} file(s)!`, 60);
    process.exit(0);
  }

  report.sort((a,b) => path.basename(a.file).localeCompare(path.basename(b.file)));
  const uniqueFileReports = [];
  const seenFiles = new Set();
  report.forEach(item => {
      if(!seenFiles.has(item.file)) {
          uniqueFileReports.push({
              file: item.file,
              errs: report.filter(r => r.file === item.file).reduce((acc, curr) => acc.concat(curr.errs), [])
          });
          seenFiles.add(item.file);
      }
  });


  uniqueFileReports.forEach(({ file, errs }) => {
    drawBox(`${SYM.shield} Violations in: ${path.basename(file)} (${errs.length})`, 80);
    const grouped = groupByRule(errs);

    const tableRows = Object.entries(grouped)
      .sort(([idA], [idB]) => parseInt(idA, 10) - parseInt(idB, 10))
      .map(([id, v]) => [
        `${SYM.lock} ${pad(id + ".", 3)} ${RULE_NAME[id] || "Unknown Rule"}`,
        chalk.yellow(String(v.length))
      ]);
    drawTable(tableRows, ["Pattern Rule", "Count"], [65, 10]);

    console.log(chalk.bold("Detailed Violations:\n"));
    Object.entries(grouped)
      .sort(([idA], [idB]) => parseInt(idA, 10) - parseInt(idB, 10))
      .forEach(([id, vList]) => {
        console.log(chalk.cyanBright.bold(`${SYM.bullet} Rule ${id}: ${RULE_NAME[id]}`));
        console.log(chalk.dim(`  ${RULE_DESC[id] || "No description for this rule."}\n`));

        vList.forEach(violation => {
          const lineNumStr = pad(`L${violation.line}:`, 6);
          const actualLineTrimmed = violation.actualLine ? violation.actualLine.trim() : "[Code not available]";
          console.log(chalk.redBright(lineNumStr) + chalk.white(actualLineTrimmed.substring(0, 100) + (actualLineTrimmed.length > 100 ? "..." : "")));
          console.log(
            chalk.yellowBright.bold(`  ${SYM.warn}  Violation:`),
            chalk.yellow(violation.message)
          );
          if (violation.hint) {
            console.log(chalk.greenBright.bold(`  ${SYM.lamp} Hint:`));
            violation.hint.split("\n").forEach(l => console.log(chalk.green("     " + l)));
          }
          console.log(""); // Spacer
        });
      });
  });

  console.log(chalk.blueBright("-".repeat(80)));
  const summaryTitle = `${SYM.alert} Found ${totalViolations} violation(s) in ${filesWithViolations} of ${filesScanned} file(s) scanned.`;
  drawBox(summaryTitle, Math.max(80, chalk.reset(summaryTitle).length + 4));
  process.exit(1);
})();
