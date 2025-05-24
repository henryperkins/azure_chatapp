#!/usr/bin/env node
/* eslint-env node */
/* global process */

/**
 * patternChecker.cjs – Fixed Version 2025-05-24
 * Properly enforces all Frontend Code Guardrails
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
  12: "No `console.*`; all logs via DI logger with context. Use canonical safeHandler.",
  13: "Single source of truth: `appModule.state` only; no local `authState` or dual checks.",
  14: "Modules must not exceed 600 lines.",
  15: "Use canonical implementations only (safeHandler, form handlers, URL parsing, etc.)",
  16: "Error objects must use standard { status, data, message } structure.",
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
  },
  knownBusNames: ["eventBus", "moduleBus", "appBus", "AuthBus"],
  factoryValidationRegex: "Missing\\b|\\brequired\\b",
  maxModuleLines: 600,
};

//   Certain low-level infra modules (they *implement* the wrappers the other
//   rules depend on) must be exempt from some checks to avoid false positives.
const WRAPPER_FILE_REGEX = /(?:^|[\\/])(domAPI|eventHandler|eventHandlers|domReadinessService|browserService)\.(js|ts)$/i;

//  Node / tooling files (CLI, tests, repo scripts) – console* is allowed
const NODE_SCRIPT_REGEX = /(?:^|[\\/])(scripts|tests)[\\/].+\.(?:c?js|mjs|ts)$/i;

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
        };
        return currentConfig;
      } catch (e) {
        console.warn(`${SYM.warn} Failed to parse config file ${p}: ${e.message}`);
      }
    }
  }
  return DEFAULT_CONFIG;
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
    p =>
      p.type === "Property" &&
      p.key &&
      ((p.key.type === "Identifier" && p.key.name === propName) ||
        (p.key.type === "StringLiteral" && p.key.value === propName))
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
        } else if (Array.isArray(merged[nodeType])) {
          merged[nodeType] = { functions: merged[nodeType], enter: [], exit: [] };
        }
        merged[nodeType].functions.push(handler);
      } else if (handler && typeof handler === "object") {
        if (!merged[nodeType]) {
          merged[nodeType] = { functions: [], enter: [], exit: [] };
        } else if (Array.isArray(merged[nodeType])) {
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

  Object.keys(merged).forEach(nodeType => {
    const handlers = merged[nodeType];

    if (handlers && typeof handlers === "object") {
      const result = {};

      if (handlers.functions && handlers.functions.length > 0) {
        if (handlers.enter.length === 0 && handlers.exit.length === 0) {
          merged[nodeType] = (path) => {
            handlers.functions.forEach(handler => handler(path));
          };
          return;
        } else {
          handlers.enter = [...handlers.functions, ...handlers.enter];
        }
      }

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
        namesSet.add(pr.argument.name);
      }
    });
  } else if (param.type === "Identifier") {
    namesSet.add(param.name);
  } else if (param.type === "AssignmentPattern" && param.left) {
    // Handle default parameters like { logger = null } = {}
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

        // Check for dependency validation - look for parameter checks
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
              // Accept both regex pattern and explicit parameter validation pattern
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
          // Also look for if (!param) checks which are common validation patterns
          IfStatement(ifPath) {
            if (ifPath.node.test.type === "UnaryExpression" &&
                ifPath.node.test.operator === "!" &&
                ifPath.node.test.argument.type === "Identifier") {
              // This is an if (!param) check
              hasDepCheck = true;
            }
          }
        });

        p.traverse({
          ReturnStatement(returnPath) {
            if (returnPath.node.argument?.type === "ObjectExpression") {
              if (
                hasProp(returnPath.node.argument, "cleanup") ||
                hasProp(returnPath.node.argument, "teardown") ||
                hasProp(returnPath.node.argument, "destroy")
              ) {
                hasCleanup = true;
              }
            }
          },
          FunctionDeclaration(funcDeclPath) {
            if (["cleanup", "teardown", "destroy"].includes(funcDeclPath.node.id?.name)) {
              hasCleanup = true;
            }
          }
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

/* 2. Strict Dependency Injection & 12. Console Ban */
function vDI(err, file, isAppJs, config) {
  const serviceNamesConfig = config.serviceNames || DEFAULT_CONFIG.serviceNames;
  const bannedGlobals = ["window", "document"];
  const isLoggerJs = /\/logger\.(js|ts)$/i.test(file);
  const isNodeScript = NODE_SCRIPT_REGEX.test(file);

  const diParamsInFactory = new Set();
  const destructuredServices = new Set();
  let factoryParamsProcessed = false;

  return {
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
      /* Ignore identifiers that are only the .property part of
         a MemberExpression  (e.g.  deps.apiClient  ⇒  “apiClient”). */
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
            `If access to '${p.node.name}' is needed, expose it via a DI-provided service.`
          )
        );
      }

      const serviceName = p.node.name;
      if (
        Object.values(serviceNamesConfig).includes(serviceName) &&
        !p.scope.hasBinding(serviceName) &&
        !isAppJs
      ) {
        // Check if this service is directly in the factory parameters (object destructuring)
        const isDirectlyInjected =
          diParamsInFactory.has(serviceName) ||
          destructuredServices.has(serviceName);

        // Check if this service is destructured from a DI object
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

        if (!isDirectlyInjected && !isFromDIObject) {
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

    CallExpression(p) {
      const cNode = p.node.callee;
      if (
        cNode.type === "MemberExpression" &&
        cNode.object.type === "Identifier" &&
        cNode.object.name === "console" &&
        !p.scope.hasBinding("console") &&     // honour local shadowing
        !isLoggerJs &&                        // logger implementation file
        !isNodeScript                         // CLI / test / tooling files
      ) {
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
    }
  };
}

/* 3. Pure Imports */
function vPure(err, file) {
  return {
    Program(path) {
      let inFactoryScope = false;

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
        if (
          inFactoryScope &&
          statementPath.findParent(
            p =>
              p.isFunctionDeclaration() || p.isArrowFunctionExpression()
          )
        ) {
          return;
        }

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

/* 4 & 5. Centralised Event Handling + Context Tags */
function vEvent(err, file, isAppJs, moduleCtx, config) {
  const ehName = config.serviceNames.eventHandlers;
  return {
    CallExpression(p) {
      const callee = p.node.callee;

      if (callee.type === "MemberExpression" && callee.property.name === "addEventListener") {
        const objName = callee.object.name;
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

      if (
        callee.type === "MemberExpression" &&
        (callee.object.name === ehName ||
          resolveIdentifierToValue(p.get("callee.object"))?.node?.name === ehName) &&
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
            }
            // StringLiteral, TemplateLiteral, etc. are all valid - no need to flag them
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
  const domWriteMethods = ["insertAdjacentHTML", "write", "writeln"];

  function isSanitized(valuePath) {
    if (!valuePath) return false;

    const node = getExpressionSourceNode(valuePath);
    if (!node) return false;

    /* Direct or optional call:  sanitizer.sanitize(html)  /  sanitizer?.sanitize(html) */
    const directCall =
      (node.type === "CallExpression" || node.type === "OptionalCallExpression") &&
      node.callee.type === "MemberExpression" &&
      getExpressionSourceNode(valuePath.get("callee.object"))?.name === sanitizerName &&
      node.callee.property.name === "sanitize";
    if (directCall) return true;

    /* Recurse into conditional / logical wrappers */
    if (node.type === "ConditionalExpression") {
      return (
        isSanitized(valuePath.get("consequent")) ||
        isSanitized(valuePath.get("alternate"))
      );
    }
    if (node.type === "LogicalExpression") {
      return (
        isSanitized(valuePath.get("left")) ||
        isSanitized(valuePath.get("right"))
      );
    }
    return false;
  }

  return {
    AssignmentExpression(p) {
      const left = p.node.left;
      if (
        left.type === "MemberExpression" &&
        domWriteProperties.includes(left.property.name)
      ) {
        const rightNode = p.node.right;
        // Allow safe operations: empty string, null, undefined
        const isSafeValue =
          (rightNode.type === "StringLiteral" && rightNode.value === "") ||
          (rightNode.type === "Identifier" && ["null", "undefined"].includes(rightNode.name)) ||
          (rightNode.type === "NullLiteral") ||
          (rightNode.type === "Identifier" && rightNode.name === "undefined");

        if (!isSafeValue && !isSanitized(p.get("right"))) {
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
  if (isAppJs) return {};

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
        } else if (
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

      if (
        callee.type === "Identifier" &&
        /^(setTimeout|setInterval)$/.test(callee.name)
      ) {
        // Ignore utility wrappers (e.g.,  fn => setTimeout(fn,ms)  inside
        // a factory) – only flag top-level readiness hacks.
        const insideFn = p.findParent(q =>
          q.isFunction() ||
          q.isArrowFunctionExpression() ||
          q.isFunctionExpression()
        );
        if (insideFn) return;

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
  const globalAppNames = Array.isArray(globalAppName)
    ? [...new Set([...globalAppName, "appModule"])]
    : [globalAppName, "appModule"];

  return {
    AssignmentExpression(p) {
      const left = p.node.left;
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
      } else if (
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
      const callee = p.node.callee;
      if (callee.type === "MemberExpression" && callee.property.name === "dispatchEvent") {
        const busObjectPath = p.get("callee.object");
        const busSourceNode = getExpressionSourceNode(busObjectPath);
        const isKnownBus =
          // explicit well-known names from config
          (busSourceNode?.type === "Identifier" &&
           knownBusNames.includes(busSourceNode.name)) ||
          // inside a class using this.dispatchEvent(...)
          busSourceNode?.type === "ThisExpression" ||
          // variable that was initialised with `new EventTarget()`
          (busSourceNode?.type === "NewExpression" &&
           busSourceNode.callee?.type === "Identifier" &&
           busSourceNode.callee.name === "EventTarget") ||
          // something like DependencySystem.modules.get('…').getEventBus()
          (busSourceNode?.type === "CallExpression" &&
           busSourceNode.callee?.property?.name === "getEventBus");

        if (!isKnownBus) {
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

/* 12. Logger Context Checking */
function vLog(err, file, isAppJs, moduleCtx, config) {
  const loggerName = config.serviceNames.logger;
  return {
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type === "MemberExpression" && c.object.name === loggerName && c.property.name !== "withContext") {
        const argsPaths = p.get("arguments") || [];
        const hasContextMeta = argsPaths.some(argPath => {
          const n = getExpressionSourceNode(argPath);
          return n && n.type === "ObjectExpression" && hasProp(n, "context");
        });

        if (!hasContextMeta) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              12,
              `'${loggerName}.${c.property.name}' call missing { context } metadata.`,
              `Ensure logger calls include, e.g., { context: "${moduleCtx}:operation" }.`
            )
          );
        }
      }
    }
  };
}

/* 12. Error logging & safeHandler */
function vErrorLog(err, file, moduleCtx, config) {
  const loggerName = config.serviceNames.logger;
  const ehName = config.serviceNames.eventHandlers;

  const isAppJs = /\/(app|main)\.(js|ts|jsx|tsx)$/i.test(file) ||
    file.includes("WARNING: BOOTSTRAP EXCEPTION");
  const isLoggerJs = /\/logger\.(js|ts)$/i.test(file);

  return {
    FunctionDeclaration(p) {
      if (!isAppJs && p.node.id && p.node.id.name === "safeHandler") {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            12,
            "Duplicate 'safeHandler' function declaration is forbidden.",
            "Use the canonical safeHandler from DI: const safeHandler = DependencySystem.modules.get('safeHandler');"
          )
        );
      }
    },
    VariableDeclarator(p) {
      if (
        !isAppJs &&
        p.node.id.type === "Identifier" &&
        p.node.id.name === "safeHandler" &&
        p.node.init &&
        p.node.init.type === "FunctionExpression"
      ) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            12,
            "Local 'safeHandler' function definition is forbidden.",
            "Use the canonical safeHandler from DI: const safeHandler = DependencySystem.modules.get('safeHandler');"
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

          /* ---------------------------------------------
           * Allow two valid patterns:
           *  1.  safeHandler(myHandler, …)   ← canonical
           *  2.  handler  (where “handler” is one of the
           *      current function’s PARAMETERS – wrapper
           *      helpers forward already-wrapped handlers)
           *  3.  inline function passed directly (allowed)
           * --------------------------------------------*/

          const isSafeHandlerCall =
            handlerSourceNode &&
            handlerSourceNode.type === "CallExpression" &&
            handlerSourceNode.callee.name === "safeHandler";

          const isForwardedParam =
            handlerArgPath.isIdentifier() &&
            (handlerArgPath.scope.getBinding(handlerArgPath.node.name)?.kind === "param");

          // 3. inline function passed directly (allowed)
          const isInlineFunction =
            handlerSourceNode &&
            (handlerSourceNode.type === "ArrowFunctionExpression" ||
             handlerSourceNode.type === "FunctionExpression");

          if (!isSafeHandlerCall && !isForwardedParam && !isInlineFunction) {
            err.push(
              E(
                file,
                handlerArgPath.node.loc.start.line,
                12,
                `Event handler for '${ehName}.trackListener' must be wrapped by 'safeHandler' (or forwarded parameter already wrapped upstream).`,
                `Example: ${ehName}.trackListener(el, 'click', safeHandler(myHandler, '${moduleCtx}:desc'), ...);`
              )
            );
          }
        }
      }
    },
    CatchClause(p) {
      const errId = p.node.param?.name;
      let loggedCorrectly = false;
      let hasNestedTry = false;

      p.traverse({
        CallExpression(q) {
          /* Determine whether this is a logger-error call:
           *   1. logger.error(...)
           *   2. logger.withContext('X').error(...)
           */
          const cal = q.node.callee;
          let loggerCallType = null;   // "direct" | "bound" | null
          if (cal.type === "MemberExpression" && cal.property.name === "error") {
            // 1) direct
            if (cal.object.type === "Identifier" && cal.object.name === loggerName) {
              loggerCallType = "direct";
            }
            // 2) bound via withContext
            if (
              cal.object.type === "CallExpression" &&
              cal.object.callee?.type === "MemberExpression" &&
              cal.object.callee.property.name === "withContext" &&
              cal.object.callee.object.type === "Identifier" &&
              cal.object.callee.object.name === loggerName
            ) {
              loggerCallType = "bound";
            }
          }
          if (!loggerCallType) return;

          const includesErrorArg = q.node.arguments.some((a, idx) => {
            const argPath = q.get(`arguments.${idx}`);
            const resolved = getExpressionSourceNode(argPath);
            return resolved && resolved.type === "Identifier" && resolved.name === errId;
          });

          let hasContextMeta = false;
          if (loggerCallType === "bound") {
            // withContext already supplies context
            hasContextMeta = true;
          } else {
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
        /^(finalErr|logErr)$/i.test(errId || "") && p.node.body.body.length === 0;
      if (!loggedCorrectly && !hasNestedTry && !isSwallow && !isLoggerJs) {
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

/* 13. Authentication Consolidation - FIXED */
function vAuth(err, file, isAppJs) {
  if (isAppJs || /\/auth\.(js|ts)$/i.test(file)) return {};

  return {
    VariableDeclarator(p) {
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

    // FIXED: Proper dual authentication pattern detection
    LogicalExpression(p) {
      if (p.node.operator === "||") {
        const left = p.node.left;
        const right = p.node.right;

        const isAppModuleCheck =
          left.type === "MemberExpression" &&
          left.object.type === "MemberExpression" &&
          (left.object.object.name === "appModule" || left.object.object.name === "app") &&
          left.object.property.name === "state" &&
          left.property.name === "isAuthenticated";

        const isAuthFallback =
          (right.type === "CallExpression" &&
            right.callee.type === "MemberExpression" &&
            right.callee.property.name === "isAuthenticated") ||
          (right.type === "MemberExpression" &&
            right.property.name === "isAuthenticated");

        if (isAppModuleCheck && isAuthFallback) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              13,
              "Dual authentication check pattern (|| fallback) is forbidden.",
              "Use only 'appModule.state.isAuthenticated' - single source of truth."
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
          element.key.name === "setAuthState"
        ) {
          err.push(
            E(
              file,
              element.loc.start.line,
              13,
              "Individual module 'setAuthState()' method is forbidden.",
              "Use appModule.setAuthState() for all auth state updates."
            )
          );
        }
      }
    }
  };
}

/* 14. Module Size Limit - NEW */
function vModuleSize(err, file, code, config) {
  const maxLines = config.maxModuleLines || DEFAULT_CONFIG.maxModuleLines;
  const lines = code.split(/\r?\n/).length;
  if (lines > maxLines) {
    err.push(
      E(
        file,
        1,
        14,
        `Module exceeds ${maxLines} line limit (${lines} lines).`,
        "Split this module into smaller, focused modules."
      )
    );
  }
  return {};
}

/* 15. Canonical Implementations - NEW */
function vCanonical(err, file, isAppJs, code) {
  if (isAppJs || /\/auth\.(js|ts)$/i.test(file)) return {};

  return {
    FunctionDeclaration(p) {
      const name = p.node.id?.name || "";
      if (/^(handle|create)(Login|Register|Auth)Form/i.test(name) &&
        !/createAuthFormHandler/.test(name)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            `Custom form handler '${name}' detected.`,
            "Use createAuthFormHandler() from auth.js instead."
          )
        );
      }
    },

    CallExpression(p) {
      const callee = p.node.callee;

      if (callee.type === "NewExpression" &&
        callee.callee.name === "URLSearchParams" &&
        !/navigationService/i.test(file)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            "Direct URLSearchParams usage detected.",
            "Use navigationService.parseURL() for URL parsing."
          )
        );
      }

      if (callee.type === "MemberExpression" &&
        callee.property.name === "setCurrentProject" &&
        callee.object.name !== "appModule" &&
        !callee.object.name?.includes("app")) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            "Non-canonical setCurrentProject() call.",
            "Use appModule.setCurrentProject() only."
          )
        );
      }
    },

    VariableDeclarator(p) {
      if (p.node.id.type === "Identifier" &&
        /^current(Project|ProjectId)$/i.test(p.node.id.name) &&
        !/app/i.test(file)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            `Local '${p.node.id.name}' variable is forbidden.`,
            "Use appModule.state.currentProjectId / currentProject only."
          )
        );
      }
    },

    NewExpression(p) {
      if (p.node.callee.name === "URLSearchParams" &&
        !/navigationService/i.test(file)) {
        err.push(
          E(
            file,
            p.node.loc.start.line,
            15,
            "Direct URLSearchParams instantiation detected.",
            "Use navigationService.parseURL() for URL parsing."
          )
        );
      }
    }
  };
}

/* 16. Error Object Structure - NEW */
function vErrorStructure(err, file) {
  return {
    ObjectExpression(p) {
      const props = p.node.properties.map(prop =>
        prop.key?.name || prop.key?.value
      ).filter(Boolean);

      if (props.includes("error") || props.includes("err") ||
        props.includes("errorMessage") || props.includes("errorCode")) {

        const hasStandardStructure =
          props.includes("status") &&
          props.includes("data") &&
          props.includes("message");

        if (!hasStandardStructure &&
          !props.includes("detail") && // Allow FastAPI error format
          props.length > 1) { // Skip simple { error } destructuring
          err.push(
            E(
              file,
              p.node.loc.start.line,
              16,
              "Non-standard error object structure detected.",
              "Use { status, data, message } format (matches apiClient.js)."
            )
          );
        }
      }
    },

    ThrowStatement(p) {
      if (p.node.argument?.type === "ObjectExpression") {
        const props = p.node.argument.properties.map(prop =>
          prop.key?.name || prop.key?.value
        );

        if (!props.includes("status") || !props.includes("message")) {
          err.push(
            E(
              file,
              p.node.loc.start.line,
              16,
              "Thrown error object missing standard properties.",
              "Include at least { status, message } in thrown errors."
            )
          );
        }
      }
    }
  };
}

/* ───────────────────────── Enhanced Analyzer ─────────────────── */
function analyze(file, code, configToUse) {
  const errors = [];
  let moduleCtx = "Module";
  const m = code.match(/(?:const|let|var)\s+MODULE_CONTEXT\s*=\s*['"`]([^'"`]+)['"`]/i);
  if (m) moduleCtx = m[1];

  const isAppJs =
    /\/(app|main)\.(js|ts|jsx|tsx)$/i.test(file) ||
    code.includes("WARNING: BOOTSTRAP EXCEPTION");

  const isWrapperFile = WRAPPER_FILE_REGEX.test(file);
  const isDomAPIFile  = /(?:^|[\\/])domAPI\.(js|ts)$/i.test(file);

  // Add module size check first (no AST needed)
  if (!isAppJs) {
    const sizeErrors = [];
    vModuleSize(sizeErrors, file, code, configToUse);
    errors.push(...sizeErrors);
  }

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
        "estree"
      ]
    });
  } catch (e) {
    const pe = E(
      file,
      e.loc ? e.loc.line : 1,
      0,
      `Parse error: ${e.message}`
    );
    pe.actualLine = getLine(code, pe.line);
    return [pe];
  }

  const visitors = [
    isAppJs ? null : vFactory(errors, file, configToUse),
    isAppJs ? null : vDI(errors, file, isAppJs, configToUse),
    isAppJs ? null : vPure(errors, file),
    isAppJs ? null : vState(errors, file, isAppJs, configToUse),

    isWrapperFile ? null : vEvent(errors, file, isAppJs, moduleCtx, configToUse),
    isDomAPIFile  ? null : vSanitize(errors, file, configToUse),
    vReadiness(errors, file, isAppJs, configToUse),
    vBus(errors, file, configToUse),
    vNav(errors, file, configToUse),
    vAPI(errors, file, configToUse),
    vLog(errors, file, isAppJs, moduleCtx, configToUse),
    vErrorLog(errors, file, moduleCtx, configToUse),
    vAuth(errors, file, isAppJs),
    vCanonical(errors, file, isAppJs, code),
    vErrorStructure(errors, file)
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

  const effectiveConfig = loadConfig(process.cwd());

  if (!files.length) {
    console.log(`\n${SYM.shield} Frontend Pattern Checker\nUsage: node patternChecker.cjs [--rule=N] <file1.js> …\n`);
    process.exit(0);
  }

  let total = 0;
  const report = [];

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

  if (!total) {
    drawBox(`${SYM.ok} No pattern violations found!`, 60);
    return;
  }

  report.forEach(({ file, errs }) => {
    drawBox(`${SYM.shield} Frontend Patterns: ${path.basename(file)}`, 80);
    const grouped = groupByRule(errs);

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
