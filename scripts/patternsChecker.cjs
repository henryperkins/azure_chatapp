#!/usr/bin/env node
/* eslint-env node */
/* global process */

/**
 * patternChecker.cjs – Production-Ready Version
 * Enforces Frontend Code Guardrails with refinements for accuracy.
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
  19: "Unauthorised Module Path",
  20: "Duplicate Code Block",
  0:  "Other Issues",
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
  19: "Files added outside the approved module manifest are forbidden.",
  20: "≥ 15-line clones across distinct modules are forbidden.",
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
  },
  objectNames: {
    globalApp: "app",
    stateProperty: "state",
    dependencySystem: "DependencySystem",
  },
  knownBusNames: ["eventBus", "moduleBus", "appBus", "AuthBus"],
  factoryValidationRegex: "Missing\\b|\\brequired\\b", // String, converted to RegExp in loadConfig
  maxModuleLines: 1000,
  bootstrapFileRegex: /(?:^|[\\/])(app|main|appInitializer|bootstrap)\.(js|ts|jsx|tsx)$/i, // Is a RegExp literal
  vendoredCommentRegex: /^\s*\/\/\s*VENDOR-EXEMPT-SIZE:/im, // Is a RegExp literal

  /* NEW */
  allowedModulesManifest: "allowed-modules.json",   // Relative to CWD
  duplicateBlockLines:    15,                       // Rolling-hash window
};

const WRAPPER_FILE_REGEX = /(?:^|[\\/])(domAPI|eventHandler|eventHandlers|domReadinessService|browserService)\.(js|ts)$/i;
const NODE_SCRIPT_REGEX = /(?:^|[\\/])(scripts|tests)[\\/].+\.(?:c?js|mjs|ts)$/i;
const STORAGE_IDENTIFIERS = ["localStorage", "sessionStorage"];

// Global hash map for rolling-hash clone detection (rule 20)
const globalHashMap = new Map(); // hash → {file, start}

/* ───────────────────────── Load Config ─────────────────────────── */
function loadConfig(cwd) {
  let effectiveConfig = {
    ...DEFAULT_CONFIG, // Spread top-level scalar properties
    serviceNames: { ...DEFAULT_CONFIG.serviceNames }, // Deep copy objects
    objectNames: { ...DEFAULT_CONFIG.objectNames },
    knownBusNames: [...DEFAULT_CONFIG.knownBusNames], // Deep copy arrays
    // Initialize RegExp properties from DEFAULT_CONFIG correctly
    factoryValidationRegex: new RegExp(DEFAULT_CONFIG.factoryValidationRegex, "i"),
    bootstrapFileRegex: new RegExp(DEFAULT_CONFIG.bootstrapFileRegex.source, DEFAULT_CONFIG.bootstrapFileRegex.flags),
    vendoredCommentRegex: new RegExp(DEFAULT_CONFIG.vendoredCommentRegex.source, DEFAULT_CONFIG.vendoredCommentRegex.flags),
  };

  const tryPaths = [
    path.join(cwd, "patterns-checker.config.json"),
    path.join(cwd, ".patterns-checkerrc"),
    path.join(cwd, "package.json")
  ];

  for (const p of tryPaths) {
    if (fs.existsSync(p)) {
      try {
        const rawContent = fs.readFileSync(p, "utf8");
        if (!rawContent.trim()) continue;
        const raw = JSON.parse(rawContent);
        const loadedConfig = raw["patternsChecker"] ?? (path.basename(p) === "package.json" ? {} : raw);

        effectiveConfig.maxModuleLines = loadedConfig.maxModuleLines ?? effectiveConfig.maxModuleLines;
        effectiveConfig.knownBusNames = loadedConfig.knownBusNames ?? effectiveConfig.knownBusNames;

        if (loadedConfig.serviceNames) {
          effectiveConfig.serviceNames = { ...effectiveConfig.serviceNames, ...loadedConfig.serviceNames };
        }
        if (loadedConfig.objectNames) {
          effectiveConfig.objectNames = { ...effectiveConfig.objectNames, ...loadedConfig.objectNames };
        }

        if (typeof loadedConfig.factoryValidationRegex === 'string') {
          effectiveConfig.factoryValidationRegex = new RegExp(loadedConfig.factoryValidationRegex, "i");
        } else if (loadedConfig.factoryValidationRegex instanceof RegExp) {
          effectiveConfig.factoryValidationRegex = loadedConfig.factoryValidationRegex;
        }

        if (typeof loadedConfig.bootstrapFileRegex === 'string') {
          effectiveConfig.bootstrapFileRegex = new RegExp(loadedConfig.bootstrapFileRegex, 'i');
        } else if (loadedConfig.bootstrapFileRegex instanceof RegExp) {
          effectiveConfig.bootstrapFileRegex = loadedConfig.bootstrapFileRegex;
        }

        if (typeof loadedConfig.vendoredCommentRegex === 'string') {
          effectiveConfig.vendoredCommentRegex = new RegExp(loadedConfig.vendoredCommentRegex, 'im');
        } else if (loadedConfig.vendoredCommentRegex instanceof RegExp) {
          effectiveConfig.vendoredCommentRegex = loadedConfig.vendoredCommentRegex;
        }

        return effectiveConfig;
      } catch (e) {
        console.warn(`${SYM.warn} Failed to parse config file ${p}: ${e.message}.`);
      }
    }
  }
  return effectiveConfig;
}

/* ───────────────────────── Helpers ────────────────────────────── */
const read = f => fs.readFileSync(f, "utf8");
const splitLines = code => code.split(/\r?\n/);
const getLine = (code, n) => splitLines(code)[n - 1] ?? "";

/**
 * Compute rolling hashes of normalized lines for clone detection (rule 20).
 */
function rollingHashes(code, windowSize) {
  const lines = splitLines(code);
  const base = 257, mod = 1000000007;
  let hash = 0, power = 1;
  const hashes = [];
  for (let i = 0; i < lines.length; i++) {
    const charSum = [...lines[i]].reduce((s, c) => s + c.codePointAt(0), 0);
    hash = (hash * base + charSum) % mod;
    if (i >= windowSize) {
      const oldSum = [...lines[i - windowSize]].reduce((s, c) => s + c.codePointAt(0), 0);
      hash = (hash - (oldSum * power) % mod + mod) % mod;
    } else {
      power = (power * base) % mod;
    }
    if (i >= windowSize - 1) hashes.push([hash, i - windowSize + 1]);
  }
  return hashes;
}
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
      if (p.type === "MethodDefinition" && p.key) {
        return (p.key.type === "Identifier" && p.key.name === propName) ||
          (p.key.type === "StringLiteral" && p.key.value === propName);
      }
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
        if (!merged[nodeType]) merged[nodeType] = { functions: [], enter: [], exit: [] };
        else if (Array.isArray(merged[nodeType])) merged[nodeType] = { functions: merged[nodeType], enter: [], exit: [] };
        merged[nodeType].functions.push(handler);
      } else if (handler && typeof handler === "object") {
        if (!merged[nodeType]) merged[nodeType] = { functions: [], enter: [], exit: [] };
        else if (Array.isArray(merged[nodeType])) merged[nodeType] = { functions: merged[nodeType], enter: [], exit: [] };
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
          merged[nodeType] = (path) => { handlers.functions.forEach(fn => fn(path)); };
          return;
        } else {
          handlers.enter = [...handlers.functions, ...handlers.enter];
        }
      }
      if (handlers.enter && handlers.enter.length > 0) {
        result.enter = (path) => { handlers.enter.forEach(fn => fn(path)); };
      }
      if (handlers.exit && handlers.exit.length > 0) {
        result.exit = (path) => { handlers.exit.forEach(fn => fn(path)); };
      }
      if (Object.keys(result).length > 0) merged[nodeType] = result;
      else delete merged[nodeType];
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
  let factoryInfo = {
    found: false,
    line: 1,
    name: "",
    paramsNode: null,
    returnNodePath: null,
    // To store the Path of the factory function itself, not just its scope.
    // The path object contains the node and its scope.
    factoryFunctionPath: null
  };
  let hasCleanup = false;
  let hasDepCheck = false;
  let cleanupInvokesEH = false;
  let trackListenerUsed = false;          // ← NEW
  let returnsObjectExpression = false;        // NEW

  return {
    ExportNamedDeclaration(p) {
      const decl = p.node.declaration;
      let funcName, funcNode, funcPath;

      if (decl && decl.type === "FunctionDeclaration") {
        funcName = decl.id?.name;
        funcNode = decl;
        funcPath = p.get("declaration"); // Path to the FunctionDeclaration
      } else if (decl && decl.type === "VariableDeclaration" && decl.declarations.length === 1) {
        const declarator = decl.declarations[0];
        if (
          declarator.id.type === "Identifier" &&
          (declarator.init?.type === "FunctionExpression" ||
            declarator.init?.type === "ArrowFunctionExpression")
        ) {
          funcName = declarator.id.name;
          funcNode = declarator.init;
          funcPath = p.get("declaration.declarations.0.init"); // Path to the FunctionExpression/ArrowFunctionExpression
        }
      }

      if (funcName && funcNode && /^create[A-Z]/.test(funcName)) {
        const firstParamNode = funcNode.params[0];
        const isDIObjectParam =
          firstParamNode &&
          (
            firstParamNode.type === 'ObjectPattern' ||                              // { logger, … }
            (firstParamNode.type === 'AssignmentPattern' &&
             firstParamNode.left.type === 'ObjectPattern')                         // { … } = {}
          );

        if (!isDIObjectParam) {
          // Not a DI factory → skip Rule-1 checks to avoid false positives
          return;
        }

        factoryInfo.found = true;
        factoryInfo.line = funcNode.loc.start.line;
        factoryInfo.name = funcName;
        factoryInfo.paramsNode = funcNode.params;
        factoryInfo.factoryFunctionPath = funcPath; // Store the path to the function node

        // Dependency validation check (within the factory's direct scope)
        funcPath.traverse({
          ThrowStatement(throwPath) {
            // Only consider throws directly within this factory function, not nested ones.
            if (throwPath.getFunctionParent() !== funcPath) return;
            // Generic guard: ANY top-level `throw new Error(...)` counts
            if (
                throwPath.node.argument?.type === 'NewExpression' &&
                throwPath.node.argument.callee.name === 'Error'
            ) {
                hasDepCheck = true;                // ← NEW
            }
            // Realistic check for dependency error throwing:
            // Check if throwing an Error with a message indicating missing dependency
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
                  ? arg0.quasis.map((q) => q.value.raw).join("")
                  : "";
              const validationRegex = new RegExp(
                config.factoryValidationRegex.source,
                config.factoryValidationRegex.flags
              );
              if (
                validationRegex.test(errorText) ||
                /is required|not found|missing/i.test(errorText)
              ) {
                hasDepCheck = true;
              }
            }
          },
          IfStatement(ifPath) {
            if (ifPath.getFunctionParent() !== funcPath) return;
            // ... (your existing if-statement based dep check logic) ...
            // For brevity, I'll assume this sets hasDepCheck correctly if criteria met.
            // Example:
            const isParamNegation = (node) => { /* ... */ };
            const hasParamValidation = (testNode) => { /* ... */ };
            if (hasParamValidation(ifPath.node.test)) hasDepCheck = true;
          },
          CallExpression(callPath) {
            if (callPath.getFunctionParent() !== funcPath) return;

            const cal = callPath.node.callee;
            const isAssert =
                  (cal.type === 'Identifier' && cal.name === 'assertDeps') ||
                  (cal.type === 'MemberExpression' && cal.property?.name === 'assertDeps');

            if (isAssert) hasDepCheck = true;

            // --- detect use of eventHandlers.trackListener -----------------
            const c = callPath.node.callee;
            if (
                c.type === 'MemberExpression' &&
                c.property?.name === 'trackListener'
            ) {
                trackListenerUsed = true;        // ← NEW
            }

          }
        });


        // Find the return statement of the factory
        const factoryBodyPath = funcPath.get("body");
        if (factoryBodyPath.isBlockStatement()) { // For function declarations/expressions
            factoryBodyPath.traverse({
                ReturnStatement(returnPath) {
                    if (returnPath.getFunctionParent() === funcPath) { // Check if return is for *this* factory
                        factoryInfo.returnNodePath = returnPath;
                        returnPath.stop();
                    }
                }
            });
        } else { // For ArrowFunctionExpression with implicit return
            factoryInfo.returnNodePath = factoryBodyPath;
        }
      }
    },

    Program: {
      exit() {
        if (!factoryInfo.found) {
          err.push(E(file, 1, 1, "Missing factory export.", "A module must export a function like 'createMyFeature(deps)'."));
          return;
        }
        if (!hasDepCheck) {
            err.push(E(file, factoryInfo.line, 1, `Factory '${factoryInfo.name}' must validate its dependencies.`, `Example: if (!deps.logger) throw new Error("Missing logger dependency");`));
        }

        if (factoryInfo.returnNodePath) {
          let returnArgPath = factoryInfo.returnNodePath;
          // If returnNodePath is a ReturnStatement, get its argument
          if (factoryInfo.returnNodePath.isReturnStatement()) {
              returnArgPath = factoryInfo.returnNodePath.get("argument");
          }
          // Now returnArgPath is the path to what's being returned (e.g., ObjectExpression or Identifier)

          let returnedObjectPath = returnArgPath;

          if (returnArgPath.isIdentifier()) {
            // Use the scope of the factory function to find the binding
            const binding = factoryInfo.factoryFunctionPath.scope.getBinding(returnArgPath.node.name);
            if (binding && binding.path.isVariableDeclarator() && binding.path.get("init").isObjectExpression()) {
              returnedObjectPath = binding.path.get("init");
            } else {
              returnedObjectPath = null;
            }
          }

          if (returnedObjectPath && returnedObjectPath.isObjectExpression()) {
            returnsObjectExpression = true;            // NEW  (track that factory returns an object)
            const returnedObjectNode = returnedObjectPath.node;
            if (hasProp(returnedObjectNode, "cleanup") || hasProp(returnedObjectNode, "teardown") || hasProp(returnedObjectNode, "destroy")) {
              hasCleanup = true;

              returnedObjectPath.get("properties").forEach(propPath => {
                if (!propPath.isObjectMethod() && !propPath.isProperty()) return;
                const keyNode = propPath.node.key;
                const keyName = (keyNode?.type === "Identifier" ? keyNode.name : (keyNode?.type === "StringLiteral" ? keyNode.value : null));

                if (["cleanup", "teardown", "destroy"].includes(keyName)) {
                  const valuePathInner = propPath.isObjectMethod()
                      ? propPath
                      : propPath.get("value");         // ← NEW – replaces old valuePath

                  // helper-delegated cleanup (e.g.  cleanup: makeCleanup(...))
                  if (valuePathInner?.isCallExpression?.()) {
                      hasCleanup = true;
                      cleanupInvokesEH = true;
                      return;                          // keep previous early-return
                  }
                  let actualFunctionPath = null;

                  if (valuePathInner.isFunction()) {
                    actualFunctionPath = valuePathInner;
                  } else if (valuePathInner.isIdentifier() && factoryInfo.factoryFunctionPath) {
                    const functionName = valuePathInner.node.name;
                    // Resolve the binding within the factory function's scope
                    const binding = factoryInfo.factoryFunctionPath.scope.getBinding(functionName);
                    if (binding) {
                        if (binding.path.isFunctionDeclaration()) {
                            actualFunctionPath = binding.path;
                        } else if (binding.path.isVariableDeclarator() && binding.path.get("init").isFunction()) {
                            actualFunctionPath = binding.path.get("init");
                        }
                    }
                  }

                  if (actualFunctionPath) {
                    actualFunctionPath.traverse({
                      CallExpression(callPath) {
                        // Ensure this CallExpression is within the *actualFunctionPath*'s scope, not some deeper nested func
                        if(callPath.getFunctionParent() !== actualFunctionPath) return;

                        const cal = callPath.node.callee;
                        const ehName = config.serviceNames.eventHandlers;
                        let isEhCall = false;
                        const isMember =
                          cal.type === "MemberExpression" ||
                          cal.type === "OptionalMemberExpression";

                        if (isMember && cal.property?.name === "cleanupListeners") {
                            if (cal.object.type === "Identifier") {
                                const objectName = cal.object.name;
                                // Check if it's the global/imported eventHandlers service
                                if (objectName === ehName && !actualFunctionPath.scope.hasBinding(ehName)) {
                                    isEhCall = true;
                                } else {
                                    // Check if it's a DI parameter of the main factory
                                    const factoryParamNames = new Set();
                                    if (factoryInfo.paramsNode) { // paramsNode from the main factory
                                        collectDIParamNamesFromParams(factoryInfo.paramsNode.params, factoryParamNames);
                                    }
                                    if (factoryParamNames.has(objectName)) {
                                      isEhCall = true;
                                    } else {
                                      // Or if it's a variable in the cleanup function's scope that was assigned a DI param
                                      const bindingInCleanupScope = actualFunctionPath.scope.getBinding(objectName);
                                      if (bindingInCleanupScope?.path.isVariableDeclarator()) {
                                        const initNode = bindingInCleanupScope.path.get("init");
                                        if (initNode.isIdentifier() && factoryParamNames.has(initNode.node.name)) {
                                            isEhCall = true;
                                        }
                                      }
                                    }
                                }
                            }
                        }

                        if (isEhCall) {
                          const callArgs = callPath.get("arguments");
                          if (callArgs.length > 0) {
                            const firstArgPath = callArgs[0];
                            const firstArgNode = getExpressionSourceNode(firstArgPath);
                            if (firstArgNode && firstArgNode.type === "ObjectExpression" && hasProp(firstArgNode, "context")) {
                              cleanupInvokesEH = true;
                              callPath.stop(); // Stop traversing this CallExpression's children
                            }
                          }
                        }

                        // Accept delegate teardown (instance.destroy(), instance.teardown() …)
                        if (
                          !cleanupInvokesEH &&
                          isMember &&
                          ["destroy", "cleanup", "teardown", "dispose"].includes(cal.property?.name)
                        ) {
                          cleanupInvokesEH = true;
                        }

                        if (cleanupInvokesEH) callPath.stop(); // Stop traversing further if already found
                      }
                    });
                  }
                }
                if (cleanupInvokesEH) return; // Stop checking other properties if already found
              });
            }
          }
        }

        if (returnsObjectExpression && !hasCleanup) {
          err.push(E(file, factoryInfo.line, 1,
            `Factory '${factoryInfo.name}' must expose a cleanup, teardown, or destroy API.`,
            `Example: return { ..., cleanup: () => { /* ... */ } };`));
        } else if (returnsObjectExpression && trackListenerUsed && !cleanupInvokesEH) {
          err.push(E(file, factoryInfo.line, 4,
            `Factory '${factoryInfo.name}' provides cleanup() but does not appear to call ${config.serviceNames.eventHandlers}.cleanupListeners({ context: … }).`,
            `Invoke ${config.serviceNames.eventHandlers}.cleanupListeners({ context: … }) inside cleanup() if listeners were tracked.`));
        }
      }
    }
  };
}

/* 2. Strict Dependency Injection & 12. Console Ban + DIRECT LOGGER CALLS */
function vDI(err, file, isBootstrapFile, config) {
  const serviceNamesConfig = config.serviceNames;
  const depSystemName = config.objectNames.dependencySystem;
  const bannedGlobals = ["window", "document", "navigator", "location"];
  const isLoggerJs = /\/logger\.(js|ts)$/i.test(file);
  const isNodeScript = NODE_SCRIPT_REGEX.test(file);
  const diParamsInFactory = new Set();
  const destructuredServices = new Set();
  let factoryParamsProcessed = false;

  return {
    ExportNamedDeclaration(p) {
      if (factoryParamsProcessed || p.parentPath.type !== "Program") return;
      const decl = p.node.declaration;
      let funcNode;
      if ( decl && decl.type === "FunctionDeclaration" && /^create[A-Z]/.test(decl.id?.name) ) funcNode = decl;
      else if ( decl && decl.type === "VariableDeclaration" && decl.declarations.length === 1 ) {
        const d = decl.declarations[0];
        if ( d.id.type === "Identifier" && /^create[A-Z]/.test(d.id.name) && (d.init?.type === "FunctionExpression" || d.init?.type === "ArrowFunctionExpression") ) funcNode = d.init;
      }
      if (funcNode) {
        collectDIParamNamesFromParams(funcNode.params, diParamsInFactory);
        p.traverse({
          VariableDeclarator(varPath) {
            if ( varPath.node.id.type === "ObjectPattern" && varPath.node.init && varPath.node.init.type === "Identifier" && diParamsInFactory.has(varPath.node.init.name) ) {
              varPath.node.id.properties.forEach(prop => { if (prop.type === "Property" && prop.key) { const keyName = prop.key.name || prop.key.value; if (keyName) destructuredServices.add(keyName); } });
            }
          }
        });
        factoryParamsProcessed = true;
      }
    },
    ImportDeclaration(p) {
      if (isBootstrapFile) return;
      const sourceValue = p.node.source.value;
      Object.values(serviceNamesConfig).forEach(serviceName => {
        const serviceRegex = new RegExp(`[/\\.]${serviceName}(\\.js|\\.ts)?$`, "i");
        if ( serviceRegex.test(sourceValue) || sourceValue === serviceName || sourceValue.endsWith(`/${serviceName}`) ) {
          err.push(E(file, p.node.loc.start.line, 2, `Direct import of a service-like module ('${sourceValue}' for '${serviceName}') is forbidden in non-bootstrap files.`, `Inject '${serviceName}' via DI through the factory function's parameters.`));
        }
      });
    },
    Identifier(p) {
      if ( p.parent?.type === "MemberExpression" && p.parent.property === p.node && !p.parent.computed ) return;
      if (bannedGlobals.includes(p.node.name) && !p.scope.hasBinding(p.node.name)) {
        err.push(E(file, p.node.loc.start.line, 2, `Direct use of global '${p.node.name}' is forbidden. Use DI abstractions.`, `If access to '${p.node.name}' is needed, expose it via a DI-provided service (e.g., browserService).`));
      }
      if (STORAGE_IDENTIFIERS.includes(p.node.name) && !p.scope.hasBinding(p.node.name)) {
        err.push(E(file, p.node.loc.start.line, 2, `Direct use of '${p.node.name}' is forbidden.`, "Use server-side sessions or appModule.state – never browser storage."));
      }
      const serviceName = p.node.name;
      if ( Object.values(serviceNamesConfig).includes(serviceName) &&
          !p.scope.hasBinding(serviceName) &&
          !isBootstrapFile ) {
        const isDirectlyInjected = diParamsInFactory.has(serviceName) || destructuredServices.has(serviceName);
        /* NEW: follow alias chains one level */
        const aliasBinding = p.scope.getBinding(serviceName);
        if (aliasBinding &&
            aliasBinding.path.isVariableDeclarator() &&
            aliasBinding.path.get("init").isIdentifier()) {
          const initId = aliasBinding.path.get("init").node.name;
          if (diParamsInFactory.has(initId) || destructuredServices.has(initId)) return;
        }
        if (!isDirectlyInjected) {
          let isFromDIObject = false; let currentScope = p.scope;
          while (currentScope && !isFromDIObject) {
            for (const bindingName in currentScope.bindings) {
              const binding = currentScope.bindings[bindingName];
              if (binding.path.isVariableDeclarator() && binding.path.node.id.type === "ObjectPattern") {
                const initNode = binding.path.node.init;
                if (initNode && diParamsInFactory.has(initNode.name)) {
                  if (binding.path.node.id.properties.some(prop => prop.key && (prop.key.name === serviceName || prop.key.value === serviceName))) { isFromDIObject = true; break; }
                }
              }
            }
            if (isFromDIObject) break; currentScope = currentScope.parent;
          }
          if (!isFromDIObject) {
            err.push(E(file, p.node.loc.start.line, 2, `Service '${serviceName}' is used but does not appear to be injected via factory DI parameters.`, `Ensure '${serviceName}' is part of the factory's 'deps' and properly destructured, or obtained via DependencySystem.modules.get() within a function.`));
          }
        }
      }
    },
    MemberExpression(p) {
      if ( p.node.object.type === "Identifier" && p.node.object.name === "globalThis" && p.node.property.type === "Identifier" && bannedGlobals.includes(p.node.property.name) ) {
        err.push(E(file, p.node.loc.start.line, 2, `Direct use of global '${p.node.property.name}' via 'globalThis' is forbidden. Use DI.`, `Example: inject a service that provides 'window.document' etc.`));
      }
      const baseId = p.node.object; const propName = p.node.property?.name;
      if ( propName && STORAGE_IDENTIFIERS.includes(propName) && baseId?.type === "Identifier" && ["window", "globalThis"].includes(baseId.name) && !p.scope.hasBinding(baseId.name) ) {
        err.push(E(file, p.node.loc.start.line, 2, `Access to '${baseId.name}.${propName}' is forbidden.`, "Browser storage APIs violate guard-rails."));
      }
    },
    CallExpression(p) {
      const cNode = p.node.callee;
      if ( cNode.type === "MemberExpression" && cNode.object.type === "Identifier" && cNode.object.name === "console" && !p.scope.hasBinding("console") && !isLoggerJs && !isNodeScript && !isBootstrapFile ) {
        const badMethod = cNode.property.name;
        err.push(E(file, p.node.loc.start.line, 12, `console.${badMethod} is forbidden – use DI logger.`, `Replace 'console.${badMethod}(...)' with '${serviceNamesConfig.logger}.${badMethod === "error" ? "error" : "info"}("Message string", data, { context: "Module:operation" })'`));
      }
      if ( cNode.type === "MemberExpression" && cNode.object.type === "Identifier" && cNode.object.name === serviceNamesConfig.logger && !p.scope.hasBinding(serviceNamesConfig.logger) && !isBootstrapFile && !isLoggerJs && cNode.property.name !== "withContext" ) {
        const loggerMethodName = cNode.property.name; const args = p.get("arguments"); const lastArgIndex = args.length - 1;
        if (["info", "warn", "error", "debug", "log", "critical", "fatal"].includes(loggerMethodName)) {
          if (lastArgIndex < 0) {
            err.push(E(file, p.node.loc.start.line, 12, `'${serviceNamesConfig.logger}.${loggerMethodName}' call missing arguments (expected at least message and metadata with { context }).`, `Example: ${serviceNamesConfig.logger}.${loggerMethodName}("Event occurred", { data: 'details' }, { context: "Module:Action" });`));
          } else {
            const lastArgPath = args[lastArgIndex]; const lastArgNode = getExpressionSourceNode(lastArgPath);
            if ( !(lastArgNode && lastArgNode.type === "ObjectExpression" && hasProp(lastArgNode, "context")) ) {
              err.push(E(file, p.node.loc.start.line, 12, `Direct '${serviceNamesConfig.logger}.${loggerMethodName}' call missing a final metadata object with a 'context' property.`, `Ensure logger calls like '${loggerMethodName}' end with, e.g., { context: "Module:description" }. Found type for last arg: ${lastArgNode ? lastArgNode.type : 'undefined'}`));
            }
          }
        }
      }
      if ( !isBootstrapFile && cNode.type === "MemberExpression" && cNode.object.type === "MemberExpression" && cNode.object.object.type === "Identifier" && cNode.object.object.name === depSystemName && cNode.object.property.name === "modules" && cNode.property.name === "get" ) {
        let isTopLevel = true; let currentPath = p;
        while (currentPath.parentPath) {
            if (currentPath.parentPath.isFunction() || currentPath.parentPath.isProgram()) { if (currentPath.parentPath.isFunction()) isTopLevel = false; break; }
            currentPath = currentPath.parentPath;
        }
        if (isTopLevel && currentPath.parentPath.isProgram()) {
             err.push(E(file, p.node.loc.start.line, 2, `'${depSystemName}.modules.get()' must not be called at module scope.`, `Use '${depSystemName}.modules.get()' only inside functions (e.g., within a factory after DI). Prefer direct DI for primary dependencies.`));
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
      if ( calleeNode.type === "MemberExpression" && calleeNode.object.type === "CallExpression" && calleeNode.object.callee?.type === "MemberExpression" && calleeNode.object.callee.object.type === "Identifier" && calleeNode.object.callee.object.name === loggerName && calleeNode.object.callee.property.name === "withContext" && !p.scope.hasBinding(loggerName) && !isBootstrapFile && !isLoggerJs ) {
        const chainedMethodName = calleeNode.property.name; const chainedArgs = p.get("arguments"); const lastChainedArgIndex = chainedArgs.length - 1;
        if (!["info", "warn", "error", "debug", "log", "critical", "fatal"].includes(chainedMethodName)) return;
        if (lastChainedArgIndex < 0) {
          err.push(E(file, p.node.loc.start.line, 12, `Chained logger call '${loggerName}.withContext(...).${chainedMethodName}' requires at least a message and a final metadata object with { context }.`, `Example: ${loggerName}.withContext('BaseContext').${chainedMethodName}('Event occurred', { data: 'val' }, { context: "${moduleCtx}:operation" });`));
        } else {
          const lastChainedArgPath = chainedArgs[lastChainedArgIndex]; const lastChainedArgNode = getExpressionSourceNode(lastChainedArgPath);
          if ( !(lastChainedArgNode && lastChainedArgNode.type === "ObjectExpression" && hasProp(lastChainedArgNode, "context")) ) {
            err.push(E(file, p.node.loc.start.line, 12, `Chained logger call '${loggerName}.withContext(...).${chainedMethodName}' missing a final metadata object with a 'context' property.`, `Example: ${loggerName}.withContext('BaseContext').${chainedMethodName}('Event occurred', { data: 'val' }, { context: "${moduleCtx}:operation" }); Found type for last arg: ${lastChainedArgNode ? lastChainedArgNode.type : 'undefined'}`));
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
      path.get("body").forEach(statementPath => {
        if (
          statementPath.isExpressionStatement() &&
          statementPath.get("expression.callee").isFunction() &&
          !statementPath.parentPath.isAwaitExpression()
        ) {
          return; // treat as safe pure helper
        }
        let factoryParentFound = false; let parent = statementPath.parentPath;
        while(parent && !parent.isProgram()) {
            if ((parent.isFunctionDeclaration() && /^create[A-Z]/.test(parent.node.id?.name)) || (parent.isVariableDeclarator() && parent.node.id?.type === "Identifier" && /^create[A-Z]/.test(parent.node.id.name) && (parent.node.init?.type === "ArrowFunctionExpression" || parent.node.init?.type === "FunctionExpression"))) { factoryParentFound = true; break; }
            parent = parent.parentPath;
        }
        if (factoryParentFound) return;

        if ( statementPath.isImportDeclaration() || statementPath.isExportDeclaration() || statementPath.isFunctionDeclaration() || statementPath.isClassDeclaration() || (statementPath.node.type === "TSInterfaceDeclaration") || (statementPath.node.type === "TSTypeAliasDeclaration") ) return;

        if (statementPath.isVariableDeclaration()) {
          statementPath.node.declarations.forEach(decl => {
            if (decl.init) {
              const initNode = decl.init;
              if ( initNode.type === "CallExpression" && !(initNode.callee.type === "Identifier" && initNode.callee.name === "require") && !(initNode.callee.type === "Identifier" && /^(Symbol)$/.test(initNode.callee.name)) ) {
                err.push(E(file, initNode.loc.start.line, 3, "Potential side-effect from function call at module top-level.", "All executable logic should be inside the factory or DI-provided functions. Allowed: const foo = () => {}; const bar = Symbol();"));
              }
            }
          });
          return;
        }

        if (statementPath.isExpressionStatement()) {
          const expr = statementPath.node.expression;
          if ( expr.type === "CallExpression" && !(expr.callee.type === "FunctionExpression" || expr.callee.type === "ArrowFunctionExpression") ) {
            if (!(expr.callee.type === "Identifier" && expr.callee.name === "require")) {
                err.push(E(file, expr.loc.start.line, 3, "Side-effecting call at module top-level.", "Ensure all executable logic is within the exported factory or helper functions called by it."));
            }
          }
        } else if ( statementPath.isAwaitExpression() || statementPath.isImportExpression() || statementPath.isForStatement() || statementPath.isForInStatement() || statementPath.isForOfStatement() || statementPath.isWhileStatement() || statementPath.isDoWhileStatement() || statementPath.isIfStatement() ) {
          err.push(E(file, statementPath.node.loc.start.line, 3, `Top-level '${statementPath.node.type}' detected.`, "Avoid side-effects like top-level awaits, dynamic imports, loops, or conditional logic at import time. Encapsulate in functions."));
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
        const objName = callee.object.name; const objSourceNode = getExpressionSourceNode(p.get("callee.object"));
        if (objName && objName !== ehName && objSourceNode?.name !== ehName) {
          const isKnownBusCall = config.knownBusNames.includes(objSourceNode?.name);
          if (!isKnownBusCall) err.push(E(file, p.node.loc.start.line, 4, "Direct 'addEventListener' is discouraged.", `Use the centralized '${ehName}.trackListener' for DOM events or subscribe to a configured event bus.`));
        }
      }
      if ( callee.type === "MemberExpression" && (callee.object.name === ehName || getExpressionSourceNode(p.get("callee.object"))?.node?.name === ehName) && callee.property.name === "trackListener" ) {
        const optionsArgPath = p.get("arguments")[3]; const optionsNode = getExpressionSourceNode(optionsArgPath);
        if ( !optionsNode || optionsNode.type !== "ObjectExpression" || !hasProp(optionsNode, "context") ) {
          err.push(E(file, p.node.loc.start.line, 5, `'${ehName}.trackListener' call missing a context tag in options.`, `Example: ${ehName}.trackListener(el, 'click', handler, { context: '${moduleCtx}:myListener' });`));
        } else if (optionsNode.type === "ObjectExpression" && hasProp(optionsNode, "context")) {
          const contextProp = optionsNode.properties.find( prop => (prop.key?.name === "context" || prop.key?.value === "context") && prop.type === "Property" );
          if (contextProp && contextProp.value) {
            const contextValueNode = contextProp.value;
            if ( contextValueNode.type === "StringLiteral" && contextValueNode.value.trim() === "" ) {
              err.push(E(file, contextValueNode.loc.start.line, 5, "Context tag value is an empty string.", "Provide a meaningful context."));
            }
          }
        }
      }
    },
    JSXAttribute(p) {
      if (p.node.name.type === "JSXIdentifier" && /^on[A-Z]/.test(p.node.name.name)) {
        err.push(E(file, p.node.loc.start.line, 4, `Direct JSX event handler '${p.node.name.name}' is discouraged.`, `Bind events via '${ehName}.trackListener' for centralized event management.`));
      }
    }
  };
}

/* 6. Sanitize All User HTML */
function vSanitize(err, file, config) {
  const sanitizerName = config.serviceNames.sanitizer;
  const domWriteProperties = ["innerHTML", "outerHTML"];
  const domWriteMethods = ["insertAdjacentHTML", "write", "writeln"];

  function isSanitized(valuePath) {
    if (!valuePath) return false;
    const node = getExpressionSourceNode(valuePath);
    if (!node) return false;
    if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") && node.callee.type === "MemberExpression") {
        const calleeObjectPath = valuePath.get("callee.object"); const calleeObjectSourceNode = getExpressionSourceNode(calleeObjectPath);
        if (calleeObjectSourceNode?.name === sanitizerName && node.callee.property.name === "sanitize") return true;
    }
    if (node.type === "ConditionalExpression") return isSanitized(valuePath.get("consequent")) && isSanitized(valuePath.get("alternate"));
    if (node.type === "LogicalExpression" && node.operator === "||") return isSanitized(valuePath.get("left")) && isSanitized(valuePath.get("right"));
    if (["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral"].includes(node.type)) return true;
    if (node.type === "TemplateLiteral") return node.expressions.every(exprNode => isSanitized(valuePath.get("expressions")[node.expressions.indexOf(exprNode)]));
    return false;
  }

  return {
    AssignmentExpression(p) {
      const left = p.node.left;
      if ( left.type === "MemberExpression" && left.property.type === "Identifier" && domWriteProperties.includes(left.property.name) ) {
        const isDomAPIFileCurrent = /(?:^|[\\/])domAPI\.(js|ts)$/i.test(file);
        if (isDomAPIFileCurrent) return;
        if (!isSanitized(p.get("right"))) {
            err.push(E(file, p.node.loc.start.line, 6, `Direct assignment to '${left.property.name}' with potentially unsanitized HTML.`, `Use a safe DOM update method or ensure HTML is processed by '${sanitizerName}.sanitize()'. Consider domAPI.setInnerHTML().`));
        }
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if ( callee.type === "MemberExpression" && callee.property.type === "Identifier" && domWriteMethods.includes(callee.property.name) ) {
        const htmlArgIndex = (callee.property.name === "insertAdjacentHTML") ? 1 : 0; const htmlArgPath = p.get(`arguments.${htmlArgIndex}`);
        if (htmlArgPath && !isSanitized(htmlArgPath)) {
          err.push(E(file, p.node.loc.start.line, 6, `Call to '${callee.property.name}' with potentially unsanitized HTML.`, `Ensure HTML argument is processed by '${sanitizerName}.sanitize()'.`));
        }
      }
    },
    JSXAttribute(p) {
      if (p.node.name.name === "dangerouslySetInnerHTML") {
        if ( p.node.value.type === "JSXExpressionContainer" && p.node.value.expression.type === "ObjectExpression" ) {
          const htmlProp = p.node.value.expression.properties.find(prop => prop.type === "Property" && prop.key.name === "__html");
          if (htmlProp && htmlProp.value) {
            let htmlValuePath; const propertiesPaths = p.get("value.expression.properties");
            for (const propPath of propertiesPaths) { if (propPath.isProperty() && propPath.node.key.name === "__html") { htmlValuePath = propPath.get("value"); break; } }
            if (htmlValuePath && !isSanitized(htmlValuePath)) {
              err.push(E(file, p.node.loc.start.line, 6, "Usage of 'dangerouslySetInnerHTML' with unsanitized HTML.", `The value for '__html' must come from '${sanitizerName}.sanitize()'.`));
            } else if (!htmlValuePath) {
                 err.push(E(file, p.node.loc.start.line, 6, "'dangerouslySetInnerHTML' __html property is malformed or its value couldn't be statically analyzed.", "Ensure it's a direct object { __html: sanitizedValue }."));
            }
          } else {
            err.push(E(file, p.node.loc.start.line, 6, "'dangerouslySetInnerHTML' must be an object like '{ __html: sanitizedValue }'.", "Missing or incorrect __html property."));
          }
        } else {
          err.push(E(file, p.node.loc.start.line, 6, "'dangerouslySetInnerHTML' value must be an object expression.", "Example: dangerouslySetInnerHTML={{ __html: sanitizer.sanitize(value) }}"));
        }
      }
    }
  };
}

/* 7. domReadinessService Only */
function vReadiness(err, file, isBootstrapFile, config) {
  if (isBootstrapFile) return {};
  return {
    CallExpression(p) {
      const callee = p.node.callee;
      if ( callee.type === "MemberExpression" && callee.property.name === "addEventListener" ) {
        const evArg = p.node.arguments[0];
        if ( evArg?.type === "StringLiteral" && ["DOMContentLoaded", "load"].includes(evArg.value) ) {
          const objSource = getExpressionSourceNode(p.get("callee.object"));
          if (objSource && !p.scope.hasBinding(objSource.name) && (objSource.name === "window" || objSource.name === "document")) {
            err.push(E(file, p.node.loc.start.line, 7, `Ad-hoc DOM readiness check ('${evArg.value}') found on global '${objSource.name}'.`, `Use DI-injected '${config.serviceNames.domReadinessService}'.`));
          }
        } else if ( evArg?.type === "StringLiteral" && ["app:ready", "AppReady"].includes(evArg.value) && !(getExpressionSourceNode(p.get("callee.object"))?.name === config.serviceNames.eventHandlers) && !config.knownBusNames.includes(getExpressionSourceNode(p.get("callee.object"))?.name) ) {
          err.push(E(file, p.node.loc.start.line, 7, `Manual addEventListener for app readiness ('${evArg.value}') detected.`, `Use '${config.serviceNames.domReadinessService}' for all app/module readiness coordination.`));
        }
      }
      if ( callee.type === "MemberExpression" && callee.object.name === (config.objectNames.dependencySystem || "DependencySystem") && callee.property.name === "waitFor" ) {
        err.push(E(file, p.node.loc.start.line, 7, `Manual ${config.objectNames.dependencySystem}.waitFor() call is forbidden for module/app readiness.`, `Use only ${config.serviceNames.domReadinessService}.{waitForEvent(),dependenciesAndElements()} via DI.`));
      }
      if ( callee.type === "Identifier" && /^(setTimeout|setInterval)$/.test(callee.name) && !p.scope.hasBinding(callee.name) ) {
        if (!p.getFunctionParent()) {
            err.push(E(file, p.node.loc.start.line, 7, `Global '${callee.name}' call at module scope.`, `If for readiness, use '${config.serviceNames.domReadinessService}'. Avoid top-level timers.`));
        }
      }
    }
  };
}

/* 8. Centralised State Access */
function vState(err, file, isBootstrapFile, config) {
  if (isBootstrapFile) return {};
  const globalAppName = config.objectNames.globalApp || "app";
  const statePropName = config.objectNames.stateProperty || "state";
  const globalAppNames = Array.isArray(globalAppName) ? globalAppName : [globalAppName];

  return {
    AssignmentExpression(p) {
      const left = p.node.left;
      if ( left.type === "MemberExpression" && left.object.type === "MemberExpression" && left.object.object.type === "Identifier" && globalAppNames.includes(left.object.object.name) && !p.scope.hasBinding(left.object.object.name) && left.object.property.name === statePropName ) {
        err.push(E(file, p.node.loc.start.line, 8, `Direct mutation of '${left.object.object.name}.${statePropName}.${left.property.name}'.`, "Use dedicated setters provided by the application module (e.g., appModule.setSomeState(...)) to modify global state."));
      } else if ( left.type === "MemberExpression" && left.object.type === "Identifier" && globalAppNames.includes(left.object.name) && !p.scope.hasBinding(left.object.name) && left.property.name === statePropName ) {
        err.push(E(file, p.node.loc.start.line, 8, `Direct reassignment of '${left.object.name}.${statePropName}'.`, "Global state object should not be reassigned. Use dedicated setters for its properties."));
      }
    },
    CallExpression(p) {
      if ( p.node.callee.type === "MemberExpression" && p.node.callee.object.name === "Object" && p.node.callee.property.name === "assign" && p.node.arguments.length > 0 ) {
        const firstArgPath = p.get("arguments")[0]; const firstArgSourceNode = getExpressionSourceNode(firstArgPath);
        if ( firstArgSourceNode && firstArgSourceNode.type === "MemberExpression" && firstArgSourceNode.object.type === "Identifier" && globalAppNames.includes(firstArgSourceNode.object.name) && !p.scope.hasBinding(firstArgSourceNode.object.name) && firstArgSourceNode.property.name === statePropName ) {
          err.push(E(file, p.node.loc.start.line, 8, `Direct mutation of '${firstArgSourceNode.object.name}.${statePropName}' via 'Object.assign'.`, "Use dedicated setters provided by the application module."));
        }
      }
    }
  };
}

/* 9. Module Event Bus */
function vBus(err, file, config) {
  const knownBusNames = config.knownBusNames || DEFAULT_CONFIG.knownBusNames;
  const ehName = config.serviceNames.eventHandlers;

  return {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === "MemberExpression" && callee.property.name === "dispatchEvent") {
        const busObjectPath = p.get("callee.object");
        const busSourceNode = getExpressionSourceNode(busObjectPath);

        if (busSourceNode?.name === "domAPI") return;
        if (busSourceNode?.name === "document" && !p.scope.hasBinding("document")) return;
        if (busSourceNode?.name === "window" && !p.scope.hasBinding("window")) return;

        if (busSourceNode?.type === "Identifier" && busSourceNode.name === ehName && !p.scope.hasBinding(ehName)) {
          return;
        }

        if (busSourceNode?.type === "Identifier" && p.scope.hasBinding(busSourceNode.name)) {
            const binding = p.scope.getBinding(busSourceNode.name);
            // This check is imperfect for DI without knowing factory params.
            // Consider adding `eventHandlers` to `knownBusNames` in config if it's a bus.
            if(binding?.path.isVariableDeclarator() && binding.path.node.init?.name === ehName && !binding.scope.hasBinding(ehName)) {
                 /* empty */
            }
        }


        let isKnownBus = false;
        // Auto-whitelist vars initialised with new EventTarget()
        if (p.scope.hasBinding(busSourceNode.name)) {
          const b = p.scope.getBinding(busSourceNode.name);
          if (b.path.isVariableDeclarator() &&
              b.path.node.init?.type === "NewExpression" &&
              b.path.node.init.callee.name === "EventTarget") {
            isKnownBus = true;
          }
        }
        if (busSourceNode) {
          if (busSourceNode.type === "Identifier" && knownBusNames.includes(busSourceNode.name) && !p.scope.hasBinding(busSourceNode.name)) isKnownBus = true;
          else if (busSourceNode.type === "Identifier" && p.scope.hasBinding(busSourceNode.name)) {
            const binding = p.scope.getBinding(busSourceNode.name);
            if (binding?.path.node.init?.type === "NewExpression" && binding.path.node.init.callee.name === "EventTarget") isKnownBus = true;
            if (binding?.path.node.init?.type === "Identifier" && knownBusNames.includes(binding.path.node.init.name)) isKnownBus = true;
          }
          else if (busSourceNode.type === "ThisExpression") isKnownBus = true;
          else if (busSourceNode.type === "NewExpression" && busSourceNode.callee.name === "EventTarget") isKnownBus = true;
          else if (busSourceNode.type === "CallExpression" && busSourceNode.callee.property?.name?.match(/get.*Bus$/i)) isKnownBus = true;
        }

        if (!isKnownBus) {
          err.push(E(file, p.node.loc.start.line, 9, `Event dispatched on an object not identified as a dedicated event bus (found: ${busSourceNode?.name || busSourceNode?.type || 'unknown'}).`, `Dispatch events via a DI-provided known bus (e.g., '${knownBusNames[0]}.dispatchEvent()'), an instance of EventTarget, or the canonical 'eventHandlers.dispatchEvent()'. Global document.dispatchEvent() is also permitted.`));
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
      if ( left.type === "MemberExpression" && left.object.type === "Identifier" && left.object.name === "location" && !p.scope.hasBinding("location") ) {
        err.push(E(file, p.node.loc.start.line, 10, `Direct modification of 'location.${left.property.name}'.`, `Use '${navServiceName}.navigateTo()' or other methods from the navigation service.`));
      } else if ( left.type === "MemberExpression" && left.object.type === "MemberExpression" && left.object.object.name === "window" && !p.scope.hasBinding("window") && left.object.property.name === "location" ) {
         err.push(E(file, p.node.loc.start.line, 10, `Direct modification of 'window.location.${left.property.name}'.`, `Use '${navServiceName}.navigateTo()' or other methods from the navigation service.`));
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === "MemberExpression") {
        const obj = callee.object; const propName = callee.property.name; let isGlobalLocation = false;
        if (obj.type === "Identifier" && obj.name === "location" && !p.scope.hasBinding("location")) isGlobalLocation = true;
        else if (obj.type === "MemberExpression" && obj.object.name === "window" && !p.scope.hasBinding("window") && obj.property.name === "location") isGlobalLocation = true;
        if (isGlobalLocation && ["assign", "replace", "reload"].includes(propName)) {
          err.push(E(file, p.node.loc.start.line, 10, `Direct call to 'location.${propName}()'.`, `Use '${navServiceName}' for navigation.`));
        }
        if (obj.type === "Identifier" && obj.name === "history" && !p.scope.hasBinding("history") && ["pushState", "replaceState", "go", "back", "forward"].includes(propName)) {
          err.push(E(file, p.node.loc.start.line, 10, `Direct use of 'history.${propName}()'.`, `Use '${navServiceName}' for routing/navigation.`));
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
      if ( (callee.type === "Identifier" && callee.name === apiClientName && !p.scope.hasBinding(apiClientName)) || (callee.type === "MemberExpression" && callee.object.name === apiClientName && !p.scope.hasBinding(apiClientName)) ) {
        const optsArg = (callee.type === "Identifier") ? p.get("arguments")[1] : p.get("arguments")[0]; let actualOptsPath = optsArg;
        if (callee.type === "MemberExpression" && p.node.arguments.length > 1) {
            if (p.node.arguments.length === 2 && p.get("arguments")[1].isObjectExpression()) actualOptsPath = p.get("arguments")[1];
            else if (p.node.arguments.length >=3 && p.get("arguments")[2].isObjectExpression()) actualOptsPath = p.get("arguments")[2];
        }
        if (actualOptsPath && actualOptsPath.isObjectExpression()) {
          const optsNode = actualOptsPath.node; let method = "GET";
          const methodProp = optsNode.properties.find(pr => pr.type === "Property" && (pr.key.name === "method" || pr.key.value === "method"));
          if (methodProp && methodProp.value.type === "StringLiteral") method = methodProp.value.value.toUpperCase();
          else if (callee.type === "MemberExpression" && /^(post|put|patch|delete)$/i.test(callee.property.name)) method = callee.property.name.toUpperCase();
          const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
          if (mutating) {
            let hasCsrf = false; const headersProp = optsNode.properties.find(pr => pr.type === "Property" && (pr.key.name === "headers" || pr.key.value === "headers"));
            if (headersProp && headersProp.value.type === "ObjectExpression") {
              hasCsrf = headersProp.value.properties.some(hp => hp.type === "Property" && (hp.key.name || hp.key.value) && /^x[-_]csrf[-_]token$/i.test(hp.key.name || hp.key.value));
            }
            if (!hasCsrf) err.push(E(file, p.node.loc.start.line, 11, `State-changing API call (method: ${method}) via '${apiClientName}' appears to be missing an 'X-CSRF-Token' header.`, "Add the CSRF token to options.headers for POST, PUT, PATCH, DELETE requests."));
          }
        }
      }
      if (callee.type === "Identifier" && callee.name === "fetch" && !p.scope.hasBinding("fetch")) err.push(E(file, p.node.loc.start.line, 11, "Global 'fetch()' call detected.", `Use DI-injected '${apiClientName}'.`));
      if (callee.type === "Identifier" && callee.name === "axios" && !p.scope.hasBinding("axios") && apiClientName !== "axios") err.push(E(file, p.node.loc.start.line, 11, "Global 'axios()' call detected.", `Use DI-injected '${apiClientName}'.`));
      if ( callee.type === "MemberExpression" && callee.object.name === "axios" && !p.scope.hasBinding("axios") && apiClientName !== "axios" ) err.push(E(file, p.node.loc.start.line, 11, `'axios.${callee.property.name}()' call detected.`, `Use DI-injected '${apiClientName}'.`));
    },
    NewExpression(p) {
      if (p.node.callee.name === "XMLHttpRequest" && !p.scope.hasBinding("XMLHttpRequest")) err.push(E(file, p.node.loc.start.line, 11, "'new XMLHttpRequest()' detected.", `Use DI-injected '${apiClientName}'.`));
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
        err.push(E(file, p.node.loc.start.line, 15, "Duplicate 'safeHandler' function declaration is forbidden.", `Use the canonical safeHandler, typically provided via DI (e.g., from ${depSystemName} or a utility module).`));
      }
    },
    VariableDeclarator(p) {
      if ( !isBootstrapFile && p.node.id.type === "Identifier" && p.node.id.name === "safeHandler" && p.node.init && (p.node.init.type === "FunctionExpression" || p.node.init.type === "ArrowFunctionExpression") ) {
        err.push(E(file, p.node.loc.start.line, 15, "Local 'safeHandler' function definition is forbidden.", `Use the canonical safeHandler, typically provided via DI.`));
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if ( callee.type === "MemberExpression" && (callee.object.name === ehName || getExpressionSourceNode(p.get("callee.object"))?.node?.name === ehName) && callee.property.name === "trackListener" ) {
        const handlerArgPath = p.get("arguments")[2];
        if (handlerArgPath) {
          const handlerSourceNode = getExpressionSourceNode(handlerArgPath);
          const isSafeHandlerCall = handlerSourceNode && handlerSourceNode.type === "CallExpression" && handlerSourceNode.callee.type === "Identifier" && handlerSourceNode.callee.name === "safeHandler";
          const isForwardedParam = handlerArgPath.isIdentifier() && (handlerArgPath.scope.getBinding(handlerArgPath.node.name)?.kind === "param");
          const isInlineFunction = handlerSourceNode && (handlerSourceNode.type === "ArrowFunctionExpression" || handlerSourceNode.type === "FunctionExpression");
          if (!isSafeHandlerCall && !isForwardedParam && !isInlineFunction) {
            err.push(E(file, handlerArgPath.node.loc.start.line, 12, `Event handler for '${ehName}.trackListener' should be wrapped by 'safeHandler' (or be a directly passed param, or simple inline function).`, `Complex handlers or those prone to errors should be: ${ehName}.trackListener(el, 'click', safeHandler(myHandler, '${moduleCtx}:desc'), ...);`));
          }
        }
      }
    },
    CatchClause(p) {
      const errIdNode = p.node.param; const errId = errIdNode?.name;
      if (!errId && errIdNode?.type === "Identifier") return;
      let loggedCorrectly = false; let hasNestedTry = false;
      p.traverse({
        CallExpression(q) {
          const cal = q.node.callee; let loggerCallType = null;
          if (cal.type === "MemberExpression" && (cal.property.name === "error" || cal.property.name === "fatal")) {
            const loggerObjectSource = getExpressionSourceNode(q.get("callee.object"));
            if (loggerObjectSource?.name === loggerName) loggerCallType = "direct";
            else if ( cal.object.type === "CallExpression" && cal.object.callee?.type === "MemberExpression" && cal.object.callee.property.name === "withContext" ) {
                const baseLogger = getExpressionSourceNode(q.get("callee.object.callee.object"));
                if (baseLogger?.name === loggerName) loggerCallType = "bound";
            }
          }
          if (!loggerCallType) return;
          const includesErrorArg = q.node.arguments.some((argNode, idx) => {
            if (argNode.type === "Identifier" && argNode.name === errId) return true;
            const argPath = q.get(`arguments.${idx}`); const resolvedArg = getExpressionSourceNode(argPath);
            if(resolvedArg === errIdNode) return true;
            if(resolvedArg?.type === "ObjectExpression" && resolvedArg.properties.some(prop => prop.type === "SpreadElement" && prop.argument.name === errId)) return true;
            return false;
          });
          let hasContextMeta = false;
          if (loggerCallType === "bound") {
            const lastArgPath = q.get(`arguments.${q.node.arguments.length - 1}`); const lastArgNode = getExpressionSourceNode(lastArgPath);
            hasContextMeta = (lastArgNode?.type === "ObjectExpression" && hasProp(lastArgNode, "context"));
            if (!hasContextMeta && q.node.arguments.length > 0) hasContextMeta = true;
          } else {
            const lastArgPath = q.get(`arguments.${q.node.arguments.length - 1}`); const lastArgNode = getExpressionSourceNode(lastArgPath);
            hasContextMeta = lastArgNode?.type === "ObjectExpression" && hasProp(lastArgNode, "context");
          }
          if (includesErrorArg && hasContextMeta) loggedCorrectly = true;
        },
        TryStatement() { hasNestedTry = true; }
      });
      const isSwallow = /^(finalErr|logErr|_|ignored)$/i.test(errId || "") && p.node.body.body.length === 0;
      if (!loggedCorrectly && !hasNestedTry && !isSwallow && !isLoggerJs && !isBootstrapFile) {
        err.push(E(file, p.node.loc.start.line, 12, `Caught errors must be logged via '${loggerName}.error(message, errorObject, { context: ... })' or equivalent.`, `Example:\n} catch (${errId || "err"}) {\n  ${loggerName}.error("Operation failed", ${errId || "err"}, { context: "${moduleCtx}:myError" });\n}`));
      }
    }
  };
}

/* 13. Authentication Consolidation */
function vAuth(err, file, isBootstrapFile, config) {
  if (isBootstrapFile || /\/(auth|appModule)\.(js|ts)$/i.test(file)) return {};
  const globalAppName = config.objectNames.globalApp || "app";
  const globalAppNames = Array.isArray(globalAppName) ? globalAppName : [globalAppName];

  return {
    VariableDeclarator(p) {
      if (p.node.id.type === "Identifier" && /^(auth|user)State$/i.test(p.node.id.name)) {
        err.push(E(file, p.node.loc.start.line, 13, `Local '${p.node.id.name}' variable declaration is forbidden.`, `Use '${globalAppNames[0]}.state.isAuthenticated' and '${globalAppNames[0]}.state.currentUser' (or similar from the central app module) instead.`));
      }
    },
    Property(p) {
      if ( p.node.key && ((p.node.key.type === "Identifier" && /^(auth|user)State$/i.test(p.node.key.name)) || (p.node.key.type === "StringLiteral" && /^(auth|user)State$/i.test(p.node.key.value))) && !p.findParent(path => path.isExportNamedDeclaration() && path.node.declaration?.id?.name?.toLowerCase().includes("appmodule")) ) {
        err.push(E(file, p.node.loc.start.line, 13, `Local '${p.node.key.name || p.node.key.value}' property/field is forbidden.`, `Read from '${globalAppNames[0]}.state' instead.`));
      }
    },
    MemberExpression(p) {
      if (p.node.object.type === "Identifier" && /^(auth|user)State$/i.test(p.node.object.name) && !p.scope.hasBinding(p.node.object.name)) {
        err.push(E(file, p.node.loc.start.line, 13, `Access to global-like '${p.node.object.name}.${p.node.property.name}' is forbidden.`, `Use '${globalAppNames[0]}.state.isAuthenticated' or '${globalAppNames[0]}.state.currentUser' instead.`));
      }
      if ( p.node.object.type === "MemberExpression" && p.node.object.object.type === "ThisExpression" && p.node.object.property.name === "state" && /^(auth|user)State$/i.test(p.node.property.name) ) {
        err.push(E(file, p.node.loc.start.line, 13, `Access to 'this.state.${p.node.property.name}' is forbidden.`, `Remove local authentication state. Use '${globalAppNames[0]}.state' instead.`));
      }
    },
    AssignmentExpression(p) {
      const left = p.node.left;
      if (left.type === "Identifier" && /^(auth|user)State$/i.test(left.name) && !p.scope.hasBinding(left.name)) {
        err.push(E(file, p.node.loc.start.line, 13, `Assignment to global-like '${left.name}' variable is forbidden.`, `Use methods on '${globalAppNames[0]}' (e.g., ${globalAppNames[0]}.setAuthState()) to update authentication state.`));
      }
      if ( left.type === "MemberExpression" && left.object.type === "MemberExpression" && left.object.object.type === "ThisExpression" && left.object.property.name === "state" && /^(auth|user)State$/i.test(left.property.name) ) {
        err.push(E(file, p.node.loc.start.line, 13, `Assignment to 'this.state.${left.property.name}' is forbidden.`, "Remove local authentication state storage."));
      }
    },
    LogicalExpression(p) {
      if (p.node.operator === "||") {
        const left = p.node.left; const right = p.node.right;
        const isAppModuleAuthCheck = (node) => node.type === "MemberExpression" && node.object.type === "MemberExpression" && node.object.object.type === "Identifier" && globalAppNames.includes(node.object.object.name) && node.object.property.name === (config.objectNames.stateProperty || "state") && /^(isAuth|isAuthenticated)$/i.test(node.property.name);
        const isLocalAuthFallback = (node) => (node.type === "CallExpression" && node.callee.type === "MemberExpression" && /^(isAuth|isAuthenticated)$/i.test(node.callee.property.name) && !globalAppNames.includes(getExpressionSourceNode(p.get("right.callee.object"))?.name) ) || (node.type === "MemberExpression" && /^(isAuth|isAuthenticated)$/i.test(node.property.name)  && !globalAppNames.includes(getExpressionSourceNode(p.get("right.object"))?.name) );
        if (isAppModuleAuthCheck(left) && isLocalAuthFallback(right)) {
          err.push(E(file, p.node.loc.start.line, 13, "Dual authentication check pattern (appModule.state.isAuthenticated || localFallback) is forbidden.", `Use only '${globalAppNames[0]}.state.isAuthenticated' - single source of truth.`));
        }
      }
    },
    ClassBody(p) {
      for (const element of p.node.body) {
        if ( element.type === "MethodDefinition" && element.key && element.key.type === "Identifier" && /^(setAuth|setUser)State$/i.test(element.key.name) ) {
          const className = p.parentPath.node.id?.name;
          if (className && (globalAppNames.some(name => className.toLowerCase().includes(name.toLowerCase())) || /authservice/i.test(className))) return;
          err.push(E(file, element.loc.start.line, 13, `Individual module '${element.key.name}()' method is forbidden.`, `Use methods on '${globalAppNames[0]}' (e.g., ${globalAppNames[0]}.setAuthState()) for all auth state updates.`));
        }
      }
    }
  };
}

/* 14. Module Size Limit */
function vModuleSize(err, file, code, config) {
  if (/[/\\](auth|appModule)\.(js|ts)$/i.test(file) || config.bootstrapFileRegex.test(file)) return {};
  if (config.vendoredCommentRegex && config.vendoredCommentRegex.test(code.substring(0, 500))) return {};
  const maxLines = config.maxModuleLines || DEFAULT_CONFIG.maxModuleLines;
  const lines = code.split(/\r?\n/).length;
  if (lines > maxLines) {
    err.push(E(file, 1, 14, `Module exceeds ${maxLines} line limit (${lines} lines).`, `Split this module into smaller, focused modules. Vendored libraries can be exempted with a '${"// VENDOR-EXEMPT-SIZE: library name and reason"}' comment at the top.`));
  }
  return {};
}

/* 15. Canonical Implementations */
function vCanonical(err, file, isBootstrapFile, code, config) {
  if (isBootstrapFile || /\/(auth|appModule|logger|eventHandlers|domAPI|navigationService)\.(js|ts)$/i.test(file)) return {};
  const globalAppName = config.objectNames.globalApp || "app";
  const globalAppNames = Array.isArray(globalAppName) ? globalAppName : [globalAppName];

  return {
    FunctionDeclaration(p) {
      const name = p.node.id?.name || "";
      if (/^(handle|create).*(Login|Register|Auth|Password).*Form$/i.test(name) && !/createAuthFormHandler/i.test(name)) {
        err.push(E(file, p.node.loc.start.line, 15, `Custom auth-related form handler '${name}' detected.`, "Use a canonical auth form handler (e.g., createAuthFormHandler()) from the authentication module/service if available."));
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === "NewExpression" && callee.callee.type === "Identifier" && callee.callee.name === "URLSearchParams" && !p.scope.hasBinding("URLSearchParams") && config.serviceNames.navigationService ) {
        err.push(E(file, p.node.loc.start.line, 15, "Direct 'new URLSearchParams()' usage detected.", `Use '${config.serviceNames.navigationService}.parseURL()' or similar utility for URL parsing if provided.`));
      }
      if (callee.type === "MemberExpression" && /^(set|update)(Global|App|Current|Shared)[A-Z]/.test(callee.property.name) ) {
        const objSource = getExpressionSourceNode(p.get("callee.object"));
        if (objSource && objSource.type === "Identifier" && !globalAppNames.includes(objSource.name)) {
            err.push(E(file, p.node.loc.start.line, 15, `Potential non-canonical global state setter '${objSource.name}.${callee.property.name}()'.`, `Global state mutations should typically be via methods on '${globalAppNames[0]}'.`));
        }
      }
    },
    VariableDeclarator(p) {
      if (p.node.id.type === "Identifier" && /^(current|active|global|shared).*(User|Project|Session|Config|State|Settings)$/i.test(p.node.id.name) && !p.getFunctionParent() ) {
        err.push(E(file, p.node.loc.start.line, 15, `Module-level variable '${p.node.id.name}' appears to shadow global/shared state.`, `Access such state via '${globalAppNames[0]}.state' or equivalent canonical source.`));
      }
    }
  };
}

/* 16. Error Object Structure */
function vErrorStructure(err, file, config) {
  if (/[/\\](logger|apiClient|appInitializer|bootstrap)\.(js|ts)$/i.test(file) || config.bootstrapFileRegex.test(file)) {
    return {};
  }
  const loggerName = config.serviceNames.logger;

  return {
    ObjectExpression(p) {
      if (p.parentPath.isCallExpression() && p.parentPath.node.callee.type === "MemberExpression" && p.parentPath.node.callee.object.name === loggerName) {
        const args = p.parentPath.get("arguments");
        if (!(args.length > 0 && args[args.length - 1].node === p.node)) return;
      }
      if (p.parentPath.isCallExpression()) {
        const callee = p.parentPath.node.callee;
        if (callee.type === "MemberExpression" && (callee.object.name === "modalManager" || callee.property.name === "confirmAction" || (callee.object.name === "Object" && callee.property.name === "assign"))) return;
      }
      if (p.parentPath.isVariableDeclarator()) {
        const varName = p.parentPath.node.id.name;
        if (varName && /(CONFIG|DETAIL|PARAMS|OPTIONS|MAPPINGS|STATE|EVENT_DATA)$/i.test(varName)) return;
      }
      if (p.parentPath.isProperty() && p.parentPath.node.key && /(CONFIG|DETAIL|PARAMS|OPTIONS|MAPPINGS|STATE|EVENT_DATA)$/i.test(p.parentPath.node.key.name || p.parentPath.node.key.value)) return;

      const props = p.node.properties.map(prop => prop.key?.name || prop.key?.value).filter(Boolean);
      let isLikelyErrorContext = false;
      const funcParent = p.getFunctionParent();
      if (funcParent && funcParent.isFunctionDeclaration() && /^(create|build|generate|format|to)Error$/i.test(funcParent.node.id?.name)) {
        if (p.parentPath.isReturnStatement() && p.parentPath.getFunctionParent() === funcParent) isLikelyErrorContext = true;
      }
      if (p.parentPath.isVariableDeclarator() && p.parentPath.node.id.name && /^(err(or)?|exception|fault)$/i.test(p.parentPath.node.id.name)) isLikelyErrorContext = true;

      const hasErrorKeywords = props.some(key => /err(or)?|fault|issue|problem|status(Code)?|code/i.test(key));
      const hasMessageAndOthers = props.includes("message") && props.length > 1;
      if (!isLikelyErrorContext && !(hasErrorKeywords || hasMessageAndOthers)) return;

      if (props.includes("valid") && typeof p.node.properties.find(pr => pr.key?.name === "valid" || pr.key?.value === "valid")?.value?.value === 'boolean' && props.includes("message")) return;
      const hasStandardStructure = (props.includes("status") || props.includes("statusCode")) && props.includes("message");
      const hasAlternativeStructure = (props.includes("code") && props.includes("message")) || (props.includes("detail") && props.includes("message"));
      if (props.length === 1 && (props.includes("message") || props.includes("stack"))) return;
      if (props.length === 2 && props.includes("message") && props.includes("stack")) return;

      if (!hasStandardStructure && !hasAlternativeStructure) {
          if (isLikelyErrorContext || (hasErrorKeywords && hasMessageAndOthers && !props.includes("type"))) {
            err.push(E(file, p.node.loc.start.line, 16, "Non-standard error object structure detected.", "Prefer { status, message, data? }, { code, message, detail? }, or a standard Error instance. Validation results like { valid: boolean, message: string } are also acceptable."));
          }
      }
    },
    ThrowStatement(p) {
      if (p.node.argument?.type === "ObjectExpression") {
        const props = p.node.argument.properties.map(prop => prop.key?.name || prop.key?.value).filter(Boolean);
        if (!props.includes("message")) {
          err.push(E(file, p.node.loc.start.line, 16, "Thrown error object missing 'message' property.", "Thrown custom error objects must include at least a 'message'. Consider adding 'status' or 'code'."));
        }
      }
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
          err.push(E(file, p.node.loc.start.line, 17, "`createLogger()` can only be called in logger.js or a bootstrap file (e.g. app.js).", "All other modules must receive a prepared logger via DI."));
        }
        const cfgArg = p.get("arguments")[0];
        if (cfgArg && cfgArg.isObjectExpression() && hasProp(cfgArg.node, "authModule")) {
          err.push(E(file, cfgArg.node.loc.start.line, 18, "`authModule` parameter to createLogger() is deprecated.", "Remove this property—logger discovers auth via appModule.state or similar central auth status."));
        }
      }
      if ( p.node.callee.type === "MemberExpression" && p.node.callee.object.type === "Identifier" && p.node.callee.object.name === config.serviceNames.logger && !p.scope.hasBinding(config.serviceNames.logger) ) {
        const method = p.node.callee.property.name;
        if (["setServerLoggingEnabled", "setMinLevel", "setLogLevel", "addTransport", "removeTransport"].includes(method)) {
          if (!isBootstrapFile && !isLoggerJs) {
            err.push(E(file, p.node.loc.start.line, 17, `'${config.serviceNames.logger}.${method}()' must only be called in bootstrap files or logger.js.`, "Centralize runtime logger controls."));
          }
        }
      }
    }
  };
}

/* ───────────────────────── Enhanced Analyzer ─────────────────── */
/**
 * Load allowed modules manifest for rule 19 (Unauthorised Module Path).
 * Returns a Set of absolute allowed file paths, or null if manifest not found.
 */
function loadAllowedSet(cwd, manifestFile) {
  try {
    const raw = fs.readFileSync(path.join(cwd, manifestFile), "utf-8");
    const list = JSON.parse(raw);
    return new Set(list.map(p => path.resolve(cwd, p)));
  } catch {
    return null;
  }
}

/* ───────────────────────── Enhanced Analyzer ─────────────────── */
function analyze(file, code, configToUse) {
  const errors = [];
  let moduleCtx = "Module";
  const moduleContextMatch = code.match(/(?:const|let|var)\s+(?:MODULE_CONTEXT|CONTEXT_ID|MODULE_NAME)\s*=\s*['"`]([^'"`]+)['"`]/i);
  if (moduleContextMatch) moduleCtx = moduleContextMatch[1];
  else {
    const base = path.basename(file, path.extname(file));
    moduleCtx = base.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    if (moduleCtx === 'index') {
        const parentDir = path.basename(path.dirname(file));
        if (parentDir && parentDir !== 'js' && parentDir !== 'ts' && parentDir !== 'src') {
            moduleCtx = parentDir.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
        }
    }
  }

  if (!configToUse || !configToUse.bootstrapFileRegex || !(configToUse.bootstrapFileRegex instanceof RegExp)) {
    console.error(`FATAL: Invalid config passed to analyze for file ${file}. bootstrapFileRegex is missing or not a RegExp.`);
    console.error("configToUse:", JSON.stringify(configToUse, (k,v) => v instanceof RegExp ? v.toString() : v, 2));
    errors.push(E(file, 1, 0, "Internal checker error: Configuration object is invalid. Check console.", "This is a bug in the pattern checker or its configuration loading."));
    return errors;
  }

  const isBootstrapFile = configToUse.bootstrapFileRegex.test(file);
  const isWrapperFile = WRAPPER_FILE_REGEX.test(file);

  /* ── Rule 19: new-module blacklist ─────────────────────────────────── */
  const allowSet = loadAllowedSet(process.cwd(), configToUse.allowedModulesManifest);
  if (allowSet && !allowSet.has(path.resolve(file))) {
    errors.push(E(file, 1, 19,
      "File not present in allowed-modules manifest.",
      `Add this path to ${configToUse.allowedModulesManifest} as part of an approved refactor, or move logic into an existing module.`
    ));
  }

  vModuleSize(errors, file, code, configToUse);

  // --- VENDOR-EXEMPT EARLY RETURN ---
  const isVendorFile =
    configToUse.vendoredCommentRegex &&
    configToUse.vendoredCommentRegex.test(code.slice(0, 500));

  if (isVendorFile) {
    // still honour size-rule (already executed above) but ignore the rest
    return errors;   // ← early-return, after vModuleSize but BEFORE AST parse
  }

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "classProperties", "decorators-legacy", "decoratorAutoAccessors", "dynamicImport", "optionalChaining", "nullishCoalescingOperator", "estree"],
      errorRecovery: true,
    });
  } catch (e) {
    const pe = E(file, e.loc ? e.loc.line : 1, 0, `Parse error: ${e.message}`);
    pe.actualLine = getLine(code, pe.line);
    return [pe, ...errors];
  }

  const visitors = [
    isBootstrapFile ? null : vFactory(errors, file, configToUse),
    vDI(errors, file, isBootstrapFile, configToUse),
    isBootstrapFile ? null : vPure(errors, file),
    vState(errors, file, isBootstrapFile, configToUse),
    isWrapperFile || isBootstrapFile ? null : vEvent(errors, file, isBootstrapFile, moduleCtx, configToUse),
    vSanitize(errors, file, configToUse),
    vReadiness(errors, file, isBootstrapFile, configToUse),
    vBus(errors, file, configToUse),
    vNav(errors, file, configToUse),
    vAPI(errors, file, configToUse),
    vLoggerFactory(errors, file, isBootstrapFile, configToUse),
    vLog(errors, file, isBootstrapFile, moduleCtx, configToUse),
    vErrorLog(errors, file, isBootstrapFile, moduleCtx, configToUse),
    vAuth(errors, file, isBootstrapFile, configToUse),
    vCanonical(errors, file, isBootstrapFile, code, configToUse),
    vErrorStructure(errors, file, configToUse) // Pass config here for bootstrapFileRegex exemption
  ].filter(Boolean);

  traverse(ast, mergeVisitors(...visitors));

  /* ── Rule 20: rolling-hash clone detection ───────────────────────── */
  if (!isBootstrapFile) {
    const win = configToUse.duplicateBlockLines;
    const curr = rollingHashes(code, win);
    curr.forEach(([h, start]) => {
      const dupe = globalHashMap.get(h);
      if (dupe && dupe.file !== file) {
        errors.push(E(file, start+1, 20,
          `Block duplicates lines ${dupe.start+1}-${dupe.start+win} of ${path.basename(dupe.file)}.`,
          "Refactor shared logic into a utility or import the original."
        ));
      } else {
        globalHashMap.set(h, { file, start });
      }
    });
  }

  errors.forEach(e => { if (!e.actualLine && e.line) e.actualLine = getLine(code, e.line); });
  return errors;
}

/* ───────────────────────── CLI UI Helpers ────────────────────── */
// Function to strip ANSI escape codes
function stripAnsi(str) {
  if (typeof str !== 'string') {
    return String(str); // Ensure input is a string
  }
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return str.replace(ansiRegex, '');
}

// pad function (ensure this is the version that uses chalk.reset for visible length)
// MODIFIED: This comment was misleading. chalk.reset does NOT give visible length correctly.
// Using stripAnsi instead.
function pad(s, l, alignRight = false) {
  const rawString = String(s); // Keep the original string with ANSI codes
  // const visibleString = chalk.reset(rawString); // OLD BUGGY LINE based on chalk.reset
  const visibleString = stripAnsi(rawString);    // CORRECTED: Use stripAnsi
  const visibleLength = visibleString.length;

  const paddingLength = Math.max(0, l - visibleLength);
  const padding = " ".repeat(paddingLength);

  return alignRight ? padding + rawString : rawString + padding;
}

const BOX_WIDTH = 80;

function drawBox(title, w = BOX_WIDTH) {
  // For drawBox, if title contains ANSI codes, its centering might also be off.
  // A full fix would involve stripAnsi here too for titleVisibleLength.
  // const titleNoColor = chalk.reset(title); // Old way
  const titleNoColor = stripAnsi(title); // Correct way if title has styles
  const titleVisibleLength = titleNoColor.length;
  const top = chalk.blueBright("┌" + "─".repeat(w - 2) + "┐");
  const side = chalk.blueBright("│");
  const empty = side + " ".repeat(w - 2) + side;
  const paddingNeeded = w - 2 - titleVisibleLength;
  const leftPad = Math.floor(paddingNeeded / 2);
  const rightPad = Math.ceil(paddingNeeded / 2);
  const mid = side + " ".repeat(leftPad) + title + " ".repeat(rightPad) + side;
  console.log(`${top}\n${empty}\n${mid}\n${empty}\n${chalk.blueBright("└" + "─".repeat(w - 2) + "┘")}\n`);
}

function drawTable(rows, hdr) {
  const styledCountColTitle = chalk.bold(hdr[1]); // e.g., chalk.bold("Count")

  // Calculate column widths based on VISIBLE lengths using stripAnsi
  const countColW = Math.max(
    stripAnsi(styledCountColTitle).length, // Visible length of the header (e.g., "Count" -> 5)
    ...rows.map(r => stripAnsi(String(r[1])).length) // Visible length of data (e.g., "1" -> 1, "10" -> 2)
  );
  // Example: countColW = Math.max(stripAnsi(chalk.bold("Count")).length, stripAnsi(chalk.yellow("1")).length)
  // countColW = Math.max(5, 1) = 5. This is the desired narrow width.

  const ruleColW = BOX_WIDTH - countColW - 3; // Account for 3 separators: | rule | count |
  const widths = [ruleColW, countColW];

  const top =
    chalk.dim(
      "┌" +
      "─".repeat(widths[0]) +
      "┬" +
      "─".repeat(widths[1]) +
      "┐"
    );

  const header =
    chalk.dim("│") +
    pad(chalk.bold(hdr[0]), widths[0], false) + // Pad first header
    chalk.dim("│") +
    pad(styledCountColTitle, widths[1], false) + // Pad the styled "Count" header into the calculated width
    chalk.dim("│");

  const sep =
    chalk.dim(
      "├" +
      "─".repeat(widths[0]) +
      "┼" +
      "─".repeat(widths[1]) +
      "┤"
    );

  function tableRow(data) {
    // data[0] is the rule text, data[1] is the styled count string (e.g., chalk.yellow("1"))
    return (
      chalk.dim("│") +
      pad(data[0], widths[0], false) +
      chalk.dim("│") +
      pad(String(data[1]), widths[1], false) + // Pad the styled count data
      chalk.dim("│")
    );
  }
  const bottom =
    chalk.dim(
      "└" +
      "─".repeat(widths[0]) +
      "┴" +
      "─".repeat(widths[1]) +
      "┘\n"
    );
  console.log(top);
  console.log(header);
  console.log(sep);
  rows.forEach(r => {
    console.log(tableRow(r));
  });
  console.log(bottom);
}
function groupByRule(errs) {
  const g = {}; errs.forEach(e => (g[e.ruleId] ??= []).push(e)); return g;
}

/* ───────────────────────── Main CLI ─────────────────────────── */
(function main() {
  const argv = process.argv.slice(2);
  const ruleFilterArg = argv.find(a => a.startsWith("--rule="));
  const ruleFilter = ruleFilterArg ? parseInt(ruleFilterArg.split("=")[1], 10) : null;
  const files = argv.filter(a => !a.startsWith("--") && (fs.existsSync(a) ? fs.statSync(a).isFile() : true));
  const dirs = argv.filter(a => !a.startsWith("--") && fs.existsSync(a) && fs.statSync(a).isDirectory());

  const effectiveConfig = loadConfig(process.cwd());

  // Defensive check for the most common error source
  if (!effectiveConfig || !effectiveConfig.bootstrapFileRegex || !(effectiveConfig.bootstrapFileRegex instanceof RegExp)) {
      console.error(chalk.redBright("CRITICAL ERROR: Configuration loading failed or bootstrapFileRegex is invalid."));
      console.error("Effective Config:", JSON.stringify(effectiveConfig, (k,v) => v instanceof RegExp ? v.toString() : v, 2));
      process.exit(2);
  }


  let allFiles = [...files];
  dirs.forEach(dir => {
    try {
        const glob = require("glob");
        const foundFiles = glob.sync(path.join(dir, "**/*.{js,mjs,cjs,ts,jsx,tsx}"), { nodir: true, ignore: ['**/node_modules/**', '**/*.d.ts'] });
        allFiles.push(...foundFiles);
    } catch (e) {
        console.warn(chalk.yellow(`${SYM.warn} Failed to load 'glob' module. Directory scanning will be skipped. Please install glob: npm install glob`));
    }
  });
  allFiles = [...new Set(allFiles)];

  if (!allFiles.length) {
    console.log(`\n${SYM.shield} Frontend Pattern Checker\nUsage: node patternChecker.cjs [--rule=N] <file1.js> [dir1/] …\n`);
    process.exit(0);
  }

  let totalViolations = 0; const report = []; let filesScanned = 0; let filesWithViolations = 0;
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
    if (ruleFilter !== null && ruleFilter !== 0) errs = errs.filter(e => e.ruleId === ruleFilter);
    if (errs.length) {
      totalViolations += errs.length;
      if(!report.find(r => r.file === abs)) filesWithViolations++;
      report.push({ file: abs, errs });
    }
  });
  process.stdout.write(" ".repeat(process.stdout.columns ? process.stdout.columns -1 : 70) + "\r");

  if (!totalViolations) {
    drawBox(`${SYM.ok} No pattern violations found in ${filesScanned} file(s)!`, 60);
    process.exit(0);
  }

  report.sort((a,b) => path.basename(a.file).localeCompare(path.basename(b.file)));
  const uniqueFileReports = []; const seenFiles = new Set();
  report.forEach(item => {
      if(!seenFiles.has(item.file)) {
          uniqueFileReports.push({ file: item.file, errs: report.filter(r => r.file === item.file).reduce((acc, curr) => acc.concat(curr.errs), []) });
          seenFiles.add(item.file);
      }
  });

  uniqueFileReports.forEach(({ file, errs }) => {
    drawBox(`${SYM.shield} Violations in: ${path.basename(file)} (${errs.length})`, BOX_WIDTH);
    const grouped = groupByRule(errs);
    const tableRows = Object.entries(grouped)
      .sort(([idA], [idB]) => parseInt(idA, 10) - parseInt(idB, 10))
      .map(([id, v]) => [
        `${SYM.lock} ${pad(id + ".", 3)} ${RULE_NAME[id] || "Unknown Rule"}`,
        chalk.yellow(String(v.length))
      ]);
    drawTable(tableRows, ["Pattern Rule", "Count"]);
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
          console.log(chalk.yellowBright.bold(`  ${SYM.warn}  Violation:`), chalk.yellow(violation.message));
          if (violation.hint) {
            console.log(chalk.greenBright.bold(`  ${SYM.lamp} Hint:`));
            violation.hint.split("\n").forEach(l => console.log(chalk.green("     " + l)));
          }
          console.log("");
        });
      });
  });

  console.log(chalk.blueBright("-".repeat(80)));
  const summaryTitle = `${SYM.alert} Found ${totalViolations} violation(s) in ${filesWithViolations} of ${filesScanned} file(s) scanned.`;
  drawBox(summaryTitle, Math.max(80, chalk.reset(summaryTitle).length + 4));
  process.exit(1);
})();
