#!/usr/bin/env node
/* eslint-env node */
/* global process */

/**
 * patternChecker.cjs – 2025-05-16 (Updated with Edge Case Handling)
 * Enforces Frontend Code Guardrails with improved accuracy and configurability.
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
    // Colour fallback to no-op functions
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

/* ───────────────────────── Built-In Rule Maps ─────────────────── */
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
  0: "Other Issues",
};

const RULE_DESC = {
  1: "Export `createXyz` factory, validate deps, expose cleanup, no top-level code.",
  2: "No direct globals or direct service imports; inject via DI.",
  3: "No side-effects at import time; all logic inside the factory.",
  4: "Use central `eventHandlers.trackListener` + `cleanupListeners` only.",
  5: "Every listener and log must include a `{ context }` tag.",
  6: "Always call `sanitizer.sanitize()` before inserting user HTML.",
  7: "DOM/app readiness handled *only* by DI-injected `domReadinessService`.",
  8: "Never mutate global state (e.g., `app.state`) directly; use dedicated setters.",
  9: "Dispatch custom events through a dedicated `EventTarget` bus.",
  10: "All routing via DI-injected `navigationService.navigateTo()`.",
  11: "All network calls via DI-injected `apiClient`.",
  12: "No `console.*`; all logs via DI logger and include context.",
  13: "Single source of truth: `appModule.state` only; no local `authState` objects.",
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
    globalApp: "app",       // For app.state
    stateProperty: "state", // For app.state -> 'state'
  },
  knownBusNames: ["eventBus", "moduleBus", "appBus"],
  factoryValidationRegex: "Missing\\b|\\brequired\\b", // accept “…is required” wording too
};

let currentConfig = DEFAULT_CONFIG;

/* ───────────────────────── Load Config / Plugins ─────────────── */
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
        // "patternsChecker" key if in package.json, otherwise read root
        const loadedConfig = raw["patternsChecker"] ?? (path.basename(p) === "package.json" ? {} : raw);

        // Merge loaded config deeply into default
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
        };
        return currentConfig;
      } catch (e) {
        console.warn(`${SYM.warn} Failed to parse config file ${p}: ${e.message}`);
      }
    }
  }
  return DEFAULT_CONFIG; // Return default if no file found or parsing failed
}

function loadPlugins(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(c?js|ts)$/.test(f))
    .map(f => path.join(dir, f))
    .map(p => {
      try {
        const mod = require(p);
        if (typeof mod.visitor !== "function" || typeof mod.ruleId !== "number") {
          console.warn(`${SYM.warn}  Plugin ${p} ignored – missing visitor() or ruleId`);
          return null;
        }
        if (mod.ruleName) RULE_NAME[mod.ruleId] = mod.ruleName;
        if (mod.ruleDesc) RULE_DESC[mod.ruleId] = mod.ruleDesc;
        return mod;
      } catch (err) {
        console.warn(`${SYM.warn}  Failed to load plugin ${p}: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

/* ───────────────────────── Helpers ────────────────────────────── */
const read = f => fs.readFileSync(f, "utf8");
const splitLines = code => code.split(/\r?\n/);
const getLine = (code, n) => splitLines(code)[n - 1] ?? "";
function E(file, line, ruleId, msg, hint = "") {
  return { file, line, ruleId, message: msg, hint };
}

/**
 * Checks if an ObjectExpression has a given property (by Identifier or StringLiteral).
 */
function hasProp(objExpr, propName) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return false;
  return objExpr.properties.some(
    p =>
      p.type === "Property" &&
      p.key &&
      ((p.key.type === "Identifier" && p.key.name === propName) ||
        (p.key.type === "StringLiteral" && p.key.value === propName))
  );
}

/**
 * "Data-Flow Lite": Tries to resolve an identifier to its initializing expression.
 * Looks up the variable binding in the current or parent scopes, returns its init if found.
 */
function resolveIdentifierToValue(identifierPath) {
  if (!identifierPath || identifierPath.node.type !== "Identifier") return null;
  const binding = identifierPath.scope.getBinding(identifierPath.node.name);
  if (binding && binding.path.isVariableDeclarator() && binding.path.node.init) {
    return binding.path.get("init");
  }
  return null;
}

/**
 * If the path is an Identifier, attempts to resolve it to its init. Otherwise returns path.node.
 */
function getExpressionSourceNode(path) {
  if (!path) return null;
  if (path.isIdentifier()) {
    const resolved = resolveIdentifierToValue(path);
    return resolved ? resolved.node : path.node;
  }
  return path.node;
}

/** Merges multiple Babel visitors into one. */
function mergeVisitors(...visitors) {
  const merged = {};

  visitors.forEach(visitor => {
    if (!visitor) return;

    Object.keys(visitor).forEach(nodeType => {
      const handler = visitor[nodeType];

      if (typeof handler === "function") {
        // Simple function handler
        if (!merged[nodeType]) {
          merged[nodeType] = { functions: [], enter: [], exit: [] };
        } else if (Array.isArray(merged[nodeType])) {
          // Convert existing array to object format
          merged[nodeType] = { functions: merged[nodeType], enter: [], exit: [] };
        }
        merged[nodeType].functions.push(handler);
      } else if (handler && typeof handler === "object") {
        // Object with enter/exit methods
        if (!merged[nodeType]) {
          merged[nodeType] = { functions: [], enter: [], exit: [] };
        } else if (Array.isArray(merged[nodeType])) {
          // Convert existing array to object format
          merged[nodeType] = { functions: merged[nodeType], enter: [], exit: [] };
        }

        if (handler.enter) {
          merged[nodeType].enter.push(handler.enter);
        }

        if (handler.exit) {
          merged[nodeType].exit.push(handler.exit);
        }
      }
    });
  });

  // Convert arrays back to single functions
  Object.keys(merged).forEach(nodeType => {
    const handlers = merged[nodeType];

    if (handlers && typeof handlers === "object") {
      const result = {};

      // Handle simple function handlers
      if (handlers.functions && handlers.functions.length > 0) {
        if (handlers.enter.length === 0 && handlers.exit.length === 0) {
          // Only simple functions, return a single function
          merged[nodeType] = (path) => {
            handlers.functions.forEach(handler => handler(path));
          };
          return;
        } else {
          // Mix of simple functions and enter/exit, put simple functions in enter
          handlers.enter = [...handlers.functions, ...handlers.enter];
        }
      }

      // Handle enter/exit handlers
      if (handlers.enter && handlers.enter.length > 0) {
        result.enter = (path) => {
          handlers.enter.forEach(handler => handler(path));
        };
      }

      if (handlers.exit && handlers.exit.length > 0) {
        result.exit = (path) => {
          handlers.exit.forEach(handler => handler(path));
        };
      }

      if (Object.keys(result).length > 0) {
        merged[nodeType] = result;
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
        // e.g. export function createX({ logger, ...rest }) { ... }
        namesSet.add(pr.argument.name);
      }
    });
  } else if (param.type === "Identifier") {
    namesSet.add(param.name);
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

  return {
    ExportNamedDeclaration(p) {
      const decl = p.node.declaration;
      let funcName, funcNode;

      // Case: export function createSomething(...) { ... }
      if (decl && decl.type === "FunctionDeclaration") {
        funcName = decl.id?.name;
        funcNode = decl;
      }
      // Case: export const createSomething = function() { ... } or arrow
      else if (decl && decl.type === "VariableDeclaration" && decl.declarations.length === 1) {
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

      // Found an exported function whose name starts with createX...
      if (funcName && funcNode && /^create[A-Z]/.test(funcName)) {
        factoryInfo.found = true;
        factoryInfo.line = funcNode.loc.start.line;
        factoryInfo.name = funcName;
        factoryInfo.paramsNode = funcNode.params;

        // Must accept should-be deps
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

        // Look for "throw new Error("Missing ...")" for dep checks
        const validationRegex = new RegExp(
          config.factoryValidationRegex || DEFAULT_CONFIG.factoryValidationRegex,
          "i"
        );
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
              if (validationRegex.test(errorText)) {
                hasDepCheck = true;
              }
            }
          }
        });

        // Check for cleanup function in the factory body
        p.traverse({
          ReturnStatement(returnPath) {
            if (returnPath.node.argument?.type === "ObjectExpression") {
              if (
                hasProp(returnPath.node.argument, "cleanup")   ||
                hasProp(returnPath.node.argument, "teardown")  ||
                hasProp(returnPath.node.argument, "destroy")   /* allow destroy() */
              ) {
                hasCleanup = true;
              }
            }
          },
          FunctionDeclaration(funcDeclPath) {
            // Potentially a named function inside factory
            if (["cleanup", "teardown", "destroy"].includes(funcDeclPath.node.id?.name)) {
              hasCleanup = true;
            }
          }
        });
      }
    },
    // In some codebases, a separate function named cleanup is acceptable, but
    // the guardrail typically wants it inside or returned by the factory.

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
                `Factory '${factoryInfo.name}' must expose a cleanup or teardown API.`,
                `Example: return { ..., cleanup: () => { /* detach listeners, etc. */ } };`
              )
            );
          }
        }
      }
    }
  };
}

/* 2. Strict Dependency Injection & 12. Console Ban / Logger DI */
function vDI(err, file, isAppJs, config) {
  const serviceNamesConfig = config.serviceNames || DEFAULT_CONFIG.serviceNames;
  const bannedGlobals = ["window", "document"];

  // Skip logger.js itself since it needs to use console.* as fallback
  const isLoggerJs = /\/logger\.(js|ts)$/i.test(file);

  const diParamsInFactory = new Set();
  const destructuredServices = new Set();
  let factoryParamsProcessed = false;

  return {
    // Gather the param names from the exported factory
    ExportNamedDeclaration(p) {
      if (factoryParamsProcessed) return;
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

        // Also look for destructuring assignments in the function body
        p.traverse({
          VariableDeclarator(varPath) {
            if (
              varPath.node.id.type === "ObjectPattern" &&
              varPath.node.init &&
              varPath.node.init.type === "Identifier" &&
              diParamsInFactory.has(varPath.node.init.name)
            ) {
              // This is destructuring from a DI parameter, e.g., const { logger, apiClient } = deps;
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

    // Forbid direct import of known services (except in app.js)
    ImportDeclaration(p) {
      if (isAppJs) return;
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
              `Direct import of a service-like module ('${sourceValue}' for '${serviceName}') is forbidden.`,
              `Inject '${serviceName}' via DI through the factory function's parameters.`
            )
          );
        }
      });
    },

    Identifier(p) {
      // Forbidding direct usage of certain globals like window/document
      if (bannedGlobals.includes(p.node.name) && !p.scope.hasBinding(p.node.name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            2,
            `Direct use of global '${p.node.name}' is forbidden. Use DI abstractions.`,
            `If access to '${p.node.name}' is needed, expose it via a DI-provided service.`
          )
        );
      }

      // If a known service name is seen, ensure it's from DI or local destructure
      const serviceName = p.node.name;
      if (
        Object.values(serviceNamesConfig).includes(serviceName) &&
        !diParamsInFactory.has(serviceName) &&           // Not a direct factory param
        !destructuredServices.has(serviceName) &&        // Not destructured from DI param
        !p.scope.hasBinding(serviceName) &&              // Not a local var binding
        !isAppJs
      ) {
        // Try to detect destructured from a DI param object (fallback check)
        let isFromDIObject = false;
        let scopeIter = p.scope;
        while (scopeIter && !isFromDIObject) {
          for (const bindingName in scopeIter.bindings) {
            const binding = scopeIter.bindings[bindingName];
            if (
              binding.path.isVariableDeclarator() &&
              binding.path.node.id.type === "ObjectPattern"
            ) {
              if (
                binding.path.node.init &&
                diParamsInFactory.has(binding.path.node.init.name)
              ) {
                // e.g. const { logger } = deps;
                if (
                  binding.path.node.id.properties.some(
                    prop => prop.key && prop.key.name === serviceName
                  )
                ) {
                  isFromDIObject = true;
                  break;
                }
              }
            }
          }
          scopeIter = scopeIter.parent;
        }

        if (!isFromDIObject) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              2,
              `Service '${serviceName}' is used but does not appear to be injected via factory DI parameters.`,
              `Ensure '${serviceName}' is part of the factory's 'deps' and properly destructured.`
            )
          );
        }
      }
    },

    MemberExpression(p) {
      // e.g. globalThis.window or globalThis.document
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
    },

    // Ban console, require logger + context (except in logger.js itself)
    CallExpression(p) {
      const cNode = p.node.callee;
      if (cNode.type === "MemberExpression" && cNode.object.name === "console" && !isLoggerJs) {
        const badMethod = cNode.property.name;
        err.push(
          E(
            file,
            p.node.loc.start.line,
            12,
            `console.${badMethod} is forbidden – use DI logger.`,
            `Replace 'console.${badMethod}(...)' with '${serviceNamesConfig.logger}.${badMethod === "error" ? "error" : "info"}("desc", data, { context: "module" })'`
          )
        );
      }

      // If calling logger (but not withContext), check for final { context: "" }
      if (
        cNode.type === "MemberExpression" &&
        cNode.object.name === serviceNamesConfig.logger &&
        cNode.property.name !== "withContext"
      ) {
        const lastArgIndex = p.node.arguments.length - 1;
        const lastArgPath = p.get("arguments")[lastArgIndex];
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
              `'${serviceNamesConfig.logger}.${cNode.property.name}' call missing { context } metadata.`,
              `Ensure logger calls end with, e.g., { context: "Module:desc" }.`
            )
          );
        }
      }
    },

    Program: {
      exit() {
        // Potentially check if logger is destructured from DI. Omitted here for brevity.
      }
    }
  };
}

/* 3. Pure Imports */
function vPure(err, file) {
  return {
    Program(path) {
      let inFactoryScope = false;

      // If we detect a createX function, skip AST statements inside it
      // (somewhat simplistic, but demonstrates the idea)
      path.traverse({
        FunctionDeclaration(p) {
          if (/^create[A-Z]/.test(p.node.id?.name)) {
            inFactoryScope = true;
            p.skip();
          }
        },
        ArrowFunctionExpression(p) {
          if (
            p.parentPath.isVariableDeclarator() &&
            /^create[A-Z]/.test(p.parentPath.node.id?.name)
          ) {
            inFactoryScope = true;
            p.skip();
          }
        }
      });

      path.get("body").forEach(statementPath => {
        // If statement is inside the factory, skip
        if (
          inFactoryScope &&
          statementPath.findParent(
            p =>
              p.isFunctionDeclaration() || p.isArrowFunctionExpression()
          )
        ) {
          return;
        }

        // Allowed top-level statements: imports, exports, type defs, function declarations, etc.
        if (
          statementPath.isImportDeclaration() ||
          statementPath.isExportDeclaration() ||
          statementPath.isFunctionDeclaration() ||
          statementPath.isClassDeclaration() ||
          (statementPath.node.type === "TSInterfaceDeclaration") ||
          (statementPath.node.type === "TSTypeAliasDeclaration")
        ) {
          return;
        }

        // Variables with simple init (literal, obj, arr, function expr, require) are usually safe
        if (statementPath.isVariableDeclaration()) {
          statementPath.node.declarations.forEach(decl => {
            if (decl.init) {
              const initNode = decl.init;
              if (
                initNode.type === "CallExpression" &&
                !(
                  initNode.callee.type === "Identifier" &&
                  initNode.callee.name === "require"
                )
              ) {
                err.push(
                  E(
                    file,
                    initNode.loc.start.line,
                    3,
                    "Potential side-effect from function call at module top-level.",
                    "All executable logic should be inside the factory or DI-provided functions."
                  )
                );
              }
            }
          });
          return;
        }

        if (statementPath.isExpressionStatement()) {
          const expr = statementPath.node.expression;
          if (
            expr.type === "CallExpression" &&
            !(
              expr.callee.type === "FunctionExpression" ||
              expr.callee.type === "ArrowFunctionExpression"
            )
          ) {
            // A top-level IIFE is allowed if the callee is an inline function.
            err.push(
              E(
                file,
                expr.loc.start.line,
                3,
                "Side-effecting call at module top-level.",
                "Ensure all executable logic is within the exported factory."
              )
            );
          }
        } else if (
          statementPath.isAwaitExpression() ||
          statementPath.isImportExpression()
        ) {
          err.push(
            E(
              file,
              statementPath.node.loc.start.line,
              3,
              `Top-level '${statementPath.node.type}' detected.`,
              "Avoid side-effects like top-level awaits or dynamic imports at import time."
            )
          );
        }
      });
    }
  };
}

/* 4 & 5. Centralised Event Handling + Context Tags for listeners */
function vEvent(err, file, isAppJs, moduleCtx, config) {
  const ehName = config.serviceNames.eventHandlers;
  return {
    CallExpression(p) {
      const callee = p.node.callee;

      // Direct "element.addEventListener"
      if (callee.type === "MemberExpression" && callee.property.name === "addEventListener") {
        const objName = callee.object.name;
        // If it's not eventHandlers or doesn't resolve to it, it's a violation
        if (
          objName &&
          objName !== ehName &&
          !(resolveIdentifierToValue(p.get("callee.object"))?.node?.name === ehName)
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              4,
              "Direct 'addEventListener' is discouraged.",
              `Use the centralized '${ehName}.trackListener'.`
            )
          );
        }
      }

      // Checking for trackListener's options having a context
      if (
        callee.type === "MemberExpression" &&
        (callee.object.name === ehName ||
          resolveIdentifierToValue(p.get("callee.object"))?.node?.name === ehName) &&
        callee.property.name === "trackListener"
      ) {
        const optionsArgPath = p.get("arguments")[3]; // 4th argument
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
          // Check if context is an empty string
          const contextProp = optionsNode.properties.find(
            prop =>
              prop.key.name === "context" || prop.key.value === "context"
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
            } else if (
              ![
                "StringLiteral",
                "TemplateLiteral",
                "BinaryExpression",
                "Identifier"
              ].includes(contextValueNode.type)
            ) {
              err.push(
                E(
                  file,
                  contextValueNode.loc.start.line,
                  5,
                  "Context tag value should be a string or resolve to one.",
                  "Use a literal, template, or variable that yields a string."
                )
              );
            }
          }
        }
      }
    },

    // If using React: direct inline onClick, onChange, etc.
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
  const domWriteMethods = ["insertAdjacentHTML", "write", "writeln"];

  function isSanitized(valuePath) {
    if (!valuePath) return false;
    const valueNode = getExpressionSourceNode(valuePath);
    return (
      valueNode &&
      valueNode.type === "CallExpression" &&
      valueNode.callee.type === "MemberExpression" &&
      getExpressionSourceNode(valuePath.get("callee.object"))?.name === sanitizerName &&
      valueNode.callee.property.name === "sanitize"
    );
  }

  return {
    AssignmentExpression(p) {
      // e.g. element.innerHTML = userHtml
      const left = p.node.left;
      if (
        left.type === "MemberExpression" &&
        domWriteProperties.includes(left.property.name)
      ) {
        if (!isSanitized(p.get("right"))) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              6,
              `Direct assignment to '${left.property.name}' without '${sanitizerName}.sanitize()'.`,
              `Always wrap user-provided HTML with '${sanitizerName}.sanitize(html)' before DOM insertion.`
            )
          );
        }
      }
    },
    CallExpression(p) {
      // e.g. element.insertAdjacentHTML(pos, userHtml)
      const callee = p.node.callee;
      if (
        callee.type === "MemberExpression" &&
        domWriteMethods.includes(callee.property.name)
      ) {
        const htmlArgIndex =
          callee.property.name === "insertAdjacentHTML" ? 1 : 0;
        if (!isSanitized(p.get(`arguments.${htmlArgIndex}`))) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              6,
              `Call to '${callee.property.name}' with potentially unsanitized HTML.`,
              `Ensure HTML is processed by '${sanitizerName}.sanitize()'.`
            )
          );
        }
      }
    },

    // React dangerouslySetInnerHTML
    JSXAttribute(p) {
      if (p.node.name.name === "dangerouslySetInnerHTML") {
        if (
          p.node.value.type === "JSXExpressionContainer" &&
          p.node.value.expression.type === "ObjectExpression"
        ) {
          const htmlProp = p.node.value.expression.properties.find(
            prop => prop.key.name === "__html"
          );
          if (htmlProp && htmlProp.value) {
            const htmlValuePath = p
              .get("value.expression")
              .get("properties")
              .find(propP => propP.node.key.name === "__html")
              .get("value");
            if (!isSanitized(htmlValuePath)) {
              err.push(
                E(
                  file,
                  p.node.loc.start.line,
                  6,
                  "Usage of 'dangerouslySetInnerHTML' with unsanitized HTML.",
                  `The value for '__html' must come from '${sanitizerName}.sanitize()'.`
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
function vReadiness(err, file, isAppJs, config) {
  // Skip in app.js (where initial readiness might be used)
  if (isAppJs) return {};

  return {
    CallExpression(p) {
      const callee = p.node.callee;

      /* ------------------------------------------------------------------
       * A. window/document.addEventListener("DOMContentLoaded" | "load")
       * ------------------------------------------------------------------ */
      if (
        callee.type === "MemberExpression" &&
        callee.property.name === "addEventListener"
      ) {
        const evArg = p.node.arguments[0];

        // DOMContentLoaded / load listeners attached to window or document
        if (
          evArg?.type === "StringLiteral" &&
          ["DOMContentLoaded", "load"].includes(evArg.value)
        ) {
          const objSource = getExpressionSourceNode(p.get("callee.object"));
          if (objSource?.name === "window" || objSource?.name === "document") {
            err.push(
              E(
                file,
                p.node.loc.start.line,
                7,
                `Ad-hoc DOM readiness check ('${evArg.value}') found.`,
                `Use DI-injected '${config.serviceNames.domReadinessService}'.`
              )
            );
          }
        }
        /* --------------------------------------------------------------
         * B. Manual application-level readiness events
         * -------------------------------------------------------------- */
        else if (
          evArg?.type === "StringLiteral" &&
          ["app:ready", "AppReady"].includes(evArg.value)
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              7,
              `Manual addEventListener('${evArg.value}', ...) detected.`,
              "Use domReadinessService for all app/module readiness coordination."
            )
          );
        }
      }

      /* ------------------------------------------------------------------
       * C. Direct DependencySystem.waitFor(...)
       * ------------------------------------------------------------------ */
      if (
        callee.type === "MemberExpression" &&
        callee.object.name === "DependencySystem" &&
        callee.property.name === "waitFor"
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            7,
            "Manual DependencySystem.waitFor() call is forbidden for module/app readiness.",
            "Use only domReadinessService.{waitForEvent(),dependenciesAndElements()} via DI."
          )
        );
      }

      /* ------------------------------------------------------------------
       * D. setTimeout / setInterval – often used as ad-hoc readiness hacks
       * ------------------------------------------------------------------ */
      if (
        callee.type === "Identifier" &&
        /^(setTimeout|setInterval)$/.test(callee.name)
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            7,
            "setTimeout/setInterval detected; manual async awaits discouraged.",
            "If this implements readiness orchestration, replace with domReadinessService-based APIs."
          )
        );
      }
    }
  };
}

/* 8. Centralised State Access */
function vState(err, file, isAppJs, config) {
  if (isAppJs) return {};
  const globalAppName = config.objectNames.globalApp;
  const statePropName = config.objectNames.stateProperty;
  // Allow both “app.state” and “appModule.state” to be treated as the canonical
  // global state object.  Support array override via config, but always include
  // the built-in “appModule” alias.
  const globalAppNames = Array.isArray(globalAppName)
    ? [...new Set([...globalAppName, "appModule"])]
    : [globalAppName, "appModule"];

  return {
    AssignmentExpression(p) {
      const left = p.node.left;
      // e.g. app.state.foo = bar
      if (
        left.type === "MemberExpression" &&
        left.object.type === "MemberExpression" &&
        globalAppNames.includes(left.object.object.name) &&
        left.object.property.name === statePropName
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            8,
            `Direct mutation of '${globalAppName}.${statePropName}' property.`,
            "Use dedicated setters to modify global state."
          )
        );
      }
      // e.g. app.state = newState
      else if (
        left.type === "MemberExpression" &&
        globalAppNames.includes(left.object.name) &&
        left.property.name === statePropName
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            8,
            `Direct reassignment of '${globalAppName}.${statePropName}'.`,
            "Use dedicated setters."
          )
        );
      }
    },

    CallExpression(p) {
      // e.g. Object.assign(app.state, ...)
      if (
        p.node.callee.type === "MemberExpression" &&
        p.node.callee.object.name === "Object" &&
        p.node.callee.property.name === "assign" &&
        p.node.arguments.length > 0
      ) {
        const firstArg = p.get("arguments")[0];
        const firstArgSource = getExpressionSourceNode(firstArg);
        if (
          firstArgSource &&
          firstArgSource.type === "MemberExpression" &&
          globalAppNames.includes(firstArgSource.object.name) &&
          firstArgSource.property.name === statePropName
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              8,
              `Direct mutation of '${globalAppName}.${statePropName}' via 'Object.assign'.`,
              "Use dedicated setters."
            )
          );
        }
      }
    }
  };
}

/* 9. Module Event Bus */
function vBus(err, file, config) {
  const knownBusNames = config.knownBusNames || DEFAULT_CONFIG.knownBusNames;
  return {
    CallExpression(p) {
      // e.g. bus.dispatchEvent(event)
      const callee = p.node.callee;
      if (callee.type === "MemberExpression" && callee.property.name === "dispatchEvent") {
        const busObjectPath = p.get("callee.object");
        const busSourceNode = getExpressionSourceNode(busObjectPath);
        if (
          !(
            busSourceNode &&
            knownBusNames.includes(busSourceNode.name)
          ) &&
          busSourceNode?.type !== "ThisExpression"
        ) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              9,
              "Event dispatched on an object not identified as a dedicated event bus.",
              `Dispatch events via a known bus (e.g., '${knownBusNames[0]}.dispatchEvent()').`
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
      // e.g. location.href = ...
      const left = p.node.left;
      if (
        left.type === "MemberExpression" &&
        (left.object.name === "location" ||
          (left.object.type === "MemberExpression" &&
            left.object.object.name === "window" &&
            left.object.property.name === "location"))
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            10,
            `Direct modification of 'location.${left.property.name}'.`,
            `Use '${navServiceName}.navigateTo()'.`
          )
        );
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === "MemberExpression") {
        const objName = callee.object.name;
        const propName = callee.property.name;

        // e.g. location.assign(), location.replace(), location.reload()
        if (
          (objName === "location" ||
            (callee.object.type === "MemberExpression" &&
              callee.object.object.name === "window" &&
              callee.object.property.name === "location")) &&
          ["assign", "replace", "reload"].includes(propName)
        ) {
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

        // e.g. history.pushState(), history.back(), etc.
        if (
          objName === "history" &&
          ["pushState", "replaceState", "go", "back", "forward"].includes(propName)
        ) {
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
      // e.g. fetch(something)
      if (p.node.callee.name === "fetch" && !p.scope.hasBinding("fetch")) {
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
      // e.g. axios(...) or axios.get(...)
      if (p.node.callee.name === "axios" && !p.scope.hasBinding("axios") && apiClientName !== "axios") {
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
        p.node.callee.type === "MemberExpression" &&
        p.node.callee.object.name === "axios" &&
        !p.scope.hasBinding("axios") &&
        apiClientName !== "axios"
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            11,
            `'axios.${p.node.callee.property.name}()' call detected.`,
            `Use DI-injected '${apiClientName}'.`
          )
        );
      }
    },
    NewExpression(p) {
      // e.g. new XMLHttpRequest()
      if (p.node.callee.name === "XMLHttpRequest") {
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

/* 12. Logger Value Checking (complements vDI) */
function vLog(err, file, isAppJs, moduleCtx, config) {
  const loggerName = config.serviceNames.logger;
  return {
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type === "MemberExpression" && c.object.name === loggerName && c.property.name !== "withContext") {
        const lastArgIndex = p.node.arguments.length - 1;
        const lastArgPath = p.get(`arguments.${lastArgIndex}`);
        const lastArgNode = getExpressionSourceNode(lastArgPath);
        if (lastArgNode?.type === "ObjectExpression" && hasProp(lastArgNode, "context")) {
          const contextProp = lastArgNode.properties.find(
            prop =>
              prop.key.name === "context" ||
              prop.key.value === "context"
          );
          if (contextProp && contextProp.value) {
            const contextValueNode = contextProp.value;
            if (contextValueNode.type === "StringLiteral" && contextValueNode.value.trim() === "") {
              err.push(
                E(
                  file,
                  contextValueNode.loc.start.line,
                  5,
                  `'${loggerName}' call has an empty { context } string.`,
                  `Provide a meaningful context, e.g., { context: "${moduleCtx}:operation" }.`
                )
              );
            } else if (
              ![
                "StringLiteral",
                "TemplateLiteral",
                "BinaryExpression",
                "Identifier"
              ].includes(contextValueNode.type)
            ) {
              err.push(
                E(
                  file,
                  contextValueNode.loc.start.line,
                  5,
                  `'${loggerName}' context tag value should be a string or resolve to one.`,
                  `Current type: ${contextValueNode.type}. Use a string, template, or variable.`
                )
              );
            }
          }
        }
      }
    }
  };
}

/* 12-b. Error logging in catch blocks & trackListener safeHandler */
function vErrorLog(err, file, moduleCtx, config) {
  const loggerName = config.serviceNames.logger;
  const ehName = config.serviceNames.eventHandlers;

  return {
    CallExpression(p) {
      // If trackListener is used, ensure callback is wrapped with safeHandler
      const callee = p.node.callee;
      if (
        callee.type === "MemberExpression" &&
        (callee.object.name === ehName ||
          getExpressionSourceNode(p.get("callee.object"))?.node?.name === ehName) &&
        callee.property.name === "trackListener"
      ) {
        const handlerArgPath = p.get("arguments")[2]; // 3rd argument
        if (handlerArgPath) {
          const handlerSourceNode = getExpressionSourceNode(handlerArgPath);
          const notSafeWrapped =
            !(
              handlerSourceNode &&
              handlerSourceNode.type === "CallExpression" &&
              handlerSourceNode.callee.name === "safeHandler"
            );
          if (notSafeWrapped) {
            err.push(
              E(
                file,
                handlerArgPath.node.loc.start.line,
                12,
                `Event handler for '${ehName}.trackListener' must be wrapped by 'safeHandler'.`,
                `Example: ${ehName}.trackListener(el, 'click', safeHandler(myHandler, '${moduleCtx}:desc'), ...);`
              )
            );
          }
        }
      }
    },
    CatchClause(p) {
      // Check that we re-log errors with logger.error(..., { context })
      const errId = p.node.param?.name;
      let loggedCorrectly = false;
      let hasNestedTry = false;

      p.traverse({
        CallExpression(q) {
          const cal = q.node.callee;
          if (
            cal.type === "MemberExpression" &&
            cal.object.name === loggerName &&
            cal.property.name === "error"
          ) {
            // Check that the error variable is included among the call args
            const includesErrorArg = q.node.arguments.some(a => {
              const argPath = q.get(`arguments.${q.node.arguments.indexOf(a)}`);
              const resolved = getExpressionSourceNode(argPath);
              return resolved && resolved.type === "Identifier" && resolved.name === errId;
            });
            // Check the last arg is an object with context
            const lastArgIndex = q.node.arguments.length - 1;
            const lastArgPath = q.get(`arguments.${lastArgIndex}`);
            const lastArgNode = getExpressionSourceNode(lastArgPath);
            const hasContext = lastArgNode?.type === "ObjectExpression" && hasProp(lastArgNode, "context");
            if (includesErrorArg && hasContext) loggedCorrectly = true;
          }
        },
        TryStatement() {
          hasNestedTry = true;
        }
      });

      // Handle small edge cases, e.g. catch (finalErr) {}
      const isSwallow =
        /^(finalErr|logErr)$/i.test(errId || "") && p.node.body.body.length === 0;
      if (!loggedCorrectly && !hasNestedTry && !isSwallow) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            12,
            `Caught errors must be logged via '${loggerName}.error(..., { context: ... })'.`,
            `Example:\n} catch (${errId || "err"}) {\n  ${loggerName}.error("[${moduleCtx}] Something broke", ${errId || "err"}, { context: "${moduleCtx}:myError" });\n}`
          )
        );
      }
    }
  };
}

/* 13. Authentication Consolidation */
function vAuth(err, file, isAppJs) {
  // Skip auth.js itself and app.js (bootstrap exceptions)
  if (isAppJs || /\/auth\.(js|ts)$/i.test(file)) return {};

  return {
    VariableDeclarator(p) {
      // Detect local authState variable declarations
      if (p.node.id.type === "Identifier" && p.node.id.name === "authState") {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            "Local 'authState' variable declaration is forbidden.",
            "Use 'appModule.state.isAuthenticated' and 'appModule.state.currentUser' instead."
          )
        );
      }
    },
    Property(p) {
      // Detect authState properties in object literals (e.g., this.state = { authState: ... })
      if (
        p.node.key &&
        ((p.node.key.type === "Identifier" && p.node.key.name === "authState") ||
          (p.node.key.type === "StringLiteral" && p.node.key.value === "authState"))
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            "Local 'authState' property is forbidden.",
            "Remove local authentication state storage. Read from 'appModule.state' instead."
          )
        );
      }
    },
    MemberExpression(p) {
      // Detect authState.property access patterns
      if (p.node.object.type === "Identifier" && p.node.object.name === "authState") {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            `Access to 'authState.${p.node.property.name}' is forbidden.`,
            "Use 'appModule.state.isAuthenticated' or 'appModule.state.currentUser' instead."
          )
        );
      }
      // Detect this.authState or this.state.authState patterns
      if (
        p.node.object.type === "MemberExpression" &&
        p.node.object.object.type === "ThisExpression" &&
        p.node.object.property.name === "state" &&
        p.node.property.name === "authState"
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            "Access to 'this.state.authState' is forbidden.",
            "Remove local authentication state. Use 'appModule.state' instead."
          )
        );
      }
    },
    AssignmentExpression(p) {
      // Detect authState assignments
      const left = p.node.left;
      if (left.type === "Identifier" && left.name === "authState") {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            "Assignment to 'authState' variable is forbidden.",
            "Use 'appModule.setAuthState()' to update authentication state."
          )
        );
      }
      // Detect this.state.authState = ... assignments
      if (
        left.type === "MemberExpression" &&
        left.object.type === "MemberExpression" &&
        left.object.object.type === "ThisExpression" &&
        left.object.property.name === "state" &&
        left.property.name === "authState"
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            13,
            "Assignment to 'this.state.authState' is forbidden.",
            "Remove local authentication state storage."
          )
        );
      }
    },
    CallExpression(p) {
      // Detect dual authentication checks (fallback patterns)
      const callee = p.node.callee;
      if (
        callee.type === "LogicalExpression" &&
        callee.operator === "||"
      ) {
        // Look for patterns like: appModule.state.isAuthenticated || auth.isAuthenticated()
        const left = callee.left;
        const right = callee.right;

        const isAppModuleCheck =
          left.type === "MemberExpression" &&
          left.object.type === "MemberExpression" &&
          left.object.property.name === "state" &&
          left.property.name === "isAuthenticated";

        const isAuthModuleCheck =
          right.type === "CallExpression" &&
          right.callee.type === "MemberExpression" &&
          right.callee.property.name === "isAuthenticated";

        if (isAppModuleCheck && isAuthModuleCheck) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              13,
              "Dual authentication check pattern is forbidden.",
              "Use only 'appModule.state.isAuthenticated' - single source of truth."
            )
          );
        }
      }
    }
  };
}

/* ───────────────────────── Analyzer ─────────────────────────── */
function analyze(file, code, configToUse) {
  const errors = [];
  let moduleCtx = "Module"; // Default
  const m = code.match(/(?:const|let|var)\s+MODULE_CONTEXT\s*=\s*['"`]([^'"`]+)['"`]/i);
  if (m) moduleCtx = m[1];

  // Bootstrapping exceptions
  const isAppJs =
    /\/(app|main)\.(js|ts|jsx|tsx)$/i.test(file) ||
    code.includes("WARNING: BOOTSTRAP EXCEPTION");

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "decorators-legacy",
        "dynamicImport",
        "optionalChaining",
        "nullishCoalescingOperator",
        "estree" // Optionally, for location data
      ]
    });
  } catch (e) {
    // If Babel parse fails, report parse error
    return [
      E(
        file,
        e.loc ? e.loc.line : 1,
        0,
        `Parse error: ${e.message}`
      )
    ];
  }

  // Combine relevant visitors (some skip if isAppJs)
  const visitors = [
    isAppJs ? null : vFactory(errors, file, configToUse),
    isAppJs ? null : vDI(errors, file, isAppJs, configToUse),
    isAppJs ? null : vPure(errors, file),
    isAppJs ? null : vState(errors, file, isAppJs, configToUse),

    vEvent(errors, file, isAppJs, moduleCtx, configToUse),
    vSanitize(errors, file, configToUse),
    vReadiness(errors, file, isAppJs, configToUse),
    vBus(errors, file, configToUse),
    vNav(errors, file, configToUse),
    vAPI(errors, file, configToUse),
    vLog(errors, file, isAppJs, moduleCtx, configToUse),
    vErrorLog(errors, file, moduleCtx, configToUse),
    vAuth(errors, file, isAppJs)
  ].filter(Boolean);

  traverse(ast, mergeVisitors(...visitors));

  errors.forEach(e => (e.actualLine = getLine(code, e.line)));
  return errors;
}

/* ───────────────────────── CLI UI Helpers ────────────────────── */
function pad(s, l) { return String(s) + " ".repeat(Math.max(0, l - String(s).length)); }

function drawBox(title, w = 80) {
  const top = "┌" + "─".repeat(w - 2) + "┐";
  const side = "│";
  const empty = side + " ".repeat(w - 2) + side;
  const midSide = side + pad("", Math.floor((w - 2 - chalk.reset(title).length) / 2));
  const mid = midSide + title + pad("", Math.ceil((w - 2 - chalk.reset(title).length) / 2)) + side;
  console.log(chalk.blueBright(`${top}\n${empty}\n${mid}\n${empty}\n└${"─".repeat(w - 2)}┘\n`));
}

function drawTable(rows, hdr, widths) {
  const headerRow = hdr.map((h, i) => chalk.bold(pad(h, widths[i]))).join(chalk.dim(" │ "));
  const sep = widths.map(w => "─".repeat(w)).join(chalk.dim("─┼─"));
  console.log(chalk.dim("┌─") + sep + chalk.dim("─┐"));
  console.log(chalk.dim("│ ") + headerRow + chalk.dim(" │"));
  console.log(chalk.dim("├─") + sep + chalk.dim("─┤"));
  rows.forEach(r =>
    console.log(
      chalk.dim("│ ") +
      r.map((c, i) => pad(c, widths[i])).join(chalk.dim(" │ ")) +
      chalk.dim(" │")
    )
  );
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
  const files = argv.filter(a => !a.startsWith("--"));

  // Load config once from current working directory
  const effectiveConfig = loadConfig(process.cwd());
  // Optionally load plugins if you wish to extend
  // const pluginsDir = effectiveConfig.pluginsDir ? path.resolve(process.cwd(), effectiveConfig.pluginsDir) : null;
  // const plugins = loadPlugins(pluginsDir);

  if (!files.length) {
    console.log(`\n${SYM.shield} Frontend Pattern Checker\nUsage: node patternChecker.cjs [--rule=N] <file1.js> …\n`);
    // console.log("Current configuration (or defaults):", effectiveConfig);
    process.exit(0);
  }

  let total = 0;
  const report = [];

  // Analyze each file
  files.forEach(f => {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) {
      console.error(`${SYM.error} File not found: ${abs}`);
      return;
    }
    const code = read(abs);
    let errs = analyze(abs, code, effectiveConfig);
    if (ruleFilter !== null) {
      errs = errs.filter(e => e.ruleId === ruleFilter);
    }
    if (errs.length) {
      total += errs.length;
      report.push({ file: abs, errs });
    }
  });

  // Output results
  if (!total) {
    drawBox(`${SYM.ok} No pattern violations found!`, 60);
    return;
  }

  report.forEach(({ file, errs }) => {
    drawBox(`${SYM.shield} Frontend Patterns: ${path.basename(file)}`, 80);
    const grouped = groupByRule(errs);

    // Table summarizing how many for each rule
    const tableRows = Object.entries(grouped)
      .sort(([idA], [idB]) => parseInt(idA, 10) - parseInt(idB, 10))
      .map(([id, v]) => [
        `${SYM.lock} ${pad(id + ".", 3)} ${RULE_NAME[id] || "Unknown Rule"}`,
        chalk.yellow(String(v.length))
      ]);
    drawTable(tableRows, ["Pattern", "Violations"], [65, 10]);

    console.log(chalk.bold("Detailed Violations\n"));
    Object.entries(grouped)
      .sort(([idA], [idB]) => parseInt(idA, 10) - parseInt(idB, 10))
      .forEach(([id, vList]) => {
        console.log(chalk.cyanBright.bold(`${SYM.bullet} Rule ${id}: ${RULE_NAME[id]}`));
        console.log(chalk.dim(`  ${RULE_DESC[id]}\n`));

        vList.forEach(violation => {
          const lineStr =
            chalk.redBright(`  Line ${violation.line}: `) +
            chalk.white(violation.actualLine.trim());
          console.log(lineStr);
          console.log(
            chalk.yellowBright.bold(`  ${SYM.warn}  Violation:`),
            chalk.yellow(violation.message)
          );
          if (violation.hint) {
            console.log(chalk.greenBright.bold(`  ${SYM.lamp} Hint:`));
            violation.hint.split("\n").forEach(l => console.log(chalk.green("     " + l)));
          }
          console.log("");
        });
      });
  });

  drawBox(`${SYM.alert} Found ${total} pattern violation(s)! See details above.`, 80);
  process.exit(1);
})();
