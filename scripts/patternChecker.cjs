#!/usr/bin/env node
/* eslint-env node */
/* global process */
/*
  guardrailChecker.js

  Scans your JavaScript code for violations of frontend coding guardrails.

  Usage:
    1) npm install --save-dev @babel/core @babel/parser @babel/traverse
    2) node guardrailChecker.js <file1.js> [file2.js...]
*/

"use strict";

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Simple symbols (no external library needed)
const SYMBOLS = {
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  success: '✓',
  bullet: '•',
  pointer: '❯',
  arrowRight: '→',
  shield: '🛡️',
  lock: '🔒',
  alert: '🚨',
  light: '💡'
};

/**
 * Read file contents safely.
 */
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`${SYMBOLS.error} Unable to read file: ${filePath}\n`, err);
    return null;
  }
}

// ... [All the check functions remain the same as the previous implementation] ...

/**
 * 1) Factory Function Export Pattern
 */
function checkFactoryFunctionExportPattern(ast, filePath, errors) {
  let foundMatchingFactory = false;

  traverse(ast, {
    ExportNamedDeclaration(pathNode) {
      const { declaration } = pathNode.node;
      if (declaration && declaration.type === 'FunctionDeclaration') {
        const fnName = declaration.id && declaration.id.name;
        if (fnName && fnName.startsWith('create')) {
          // Check for 'deps' parameter (or at least one parameter)
          const hasDepsParam = declaration.params.length > 0;
          // A simple check for a 'new' expression in the body
          let hasNewExpressionInBody = false;
          traverse(declaration.body, {
            NewExpression(innerPath) {
              hasNewExpressionInBody = true;
              innerPath.stop(); // Stop traversal once found
            },
          }, pathNode.scope, pathNode); // Pass scope and parent path

          if (hasDepsParam && hasNewExpressionInBody) {
            foundMatchingFactory = true;
            pathNode.stop(); // Stop traversal once a matching factory is found
          } else if (hasDepsParam && !hasNewExpressionInBody) {
            errors.push({
              filePath,
              line: declaration.loc?.start.line,
              message: `Factory function "${fnName}" should typically return a new instance (e.g., using "new"). (factory-function-export-pattern)`,
              hint: `Example: return new MyModule(deps);`,
              node: declaration,
              ruleId: 1
            });
          } else if (!hasDepsParam && hasNewExpressionInBody) {
             errors.push({
              filePath,
              line: declaration.loc?.start.line,
              message: `Factory function "${fnName}" should accept a dependencies argument (e.g., "deps"). (factory-function-export-pattern)`,
              hint: `Example: export function ${fnName}(deps) { ... }`,
              node: declaration,
              ruleId: 1
            });
          }
        }
      }
    },
  });

  if (!foundMatchingFactory) {
    let hasAnyCreateExportNode = null;
    traverse(ast, {
      ExportNamedDeclaration(pathNode) {
        const { declaration } = pathNode.node;
        if (declaration && declaration.type === 'FunctionDeclaration') {
          const fnName = declaration.id && declaration.id.name;
          if (fnName && fnName.startsWith('create')) {
            hasAnyCreateExportNode = declaration; // Store the node if it's a potential but non-matching factory
            pathNode.stop();
          }
        }
      }
    });

    if (!hasAnyCreateExportNode) {
        errors.push({
            filePath,
            line: 1, // General file issue
            message: `Missing "export function createXYZ(deps)" pattern that returns a new instance. (factory-function-export-pattern)`,
            hint: `Example:\n\nexport function createProjectManager(deps) {\n  if (!deps.DependencySystem) throw new Error('DependencySystem required');\n  return new ProjectManager(deps);\n}`,
            // No specific node for this general error
            ruleId: 1
        });
    } else if (!foundMatchingFactory &&
               !errors.some(e => e.message.includes(`Factory function "${hasAnyCreateExportNode.id.name}"`))) {
        // If a createXXX function exists but didn't trigger specific errors above
        errors.push({
            filePath,
            line: hasAnyCreateExportNode.loc?.start.line,
            message: `Exported function "${hasAnyCreateExportNode.id.name}" looks like a factory but doesn't fully match the pattern. (factory-function-export-pattern)`,
            hint: `Example:\n\nexport function ${hasAnyCreateExportNode.id.name}(deps) {\n  /* ... validate deps ... */\n  return new SomeModule(deps);\n}`,
            node: hasAnyCreateExportNode,
            ruleId: 1
        });
    }
  }
}

/**
 * 2) Strict Dependency Injection (No Globals)
 * 6) Notifications via notify (not console/alert)
 */
function checkNoGlobalUsage(ast, filePath, errors) {
  traverse(ast, {
    MemberExpression(pathNode) {
      const { object } = pathNode.node;
      if (!object || !object.name) return;

      if (['document', 'window'].includes(object.name) && object.name !== 'globalThis') {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use injected dependencies instead of ${object.name}. (strict-dependency-injection)`,
          hint: `Example:\nconst el = domAPI.getElementById('something');`,
          node: pathNode.node,
          ruleId: 2
        });
      } else if (object.name === 'console') {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Do not use console.*; inject a notify or errorReporter instead. (notifications-via-di)`,
          hint: `Example:\nnotify.info('message', { module: 'MyModule', context: 'myFunction' })`,
          node: pathNode.node,
          ruleId: 6
        });
      }
    },
    CallExpression(pathNode) {
      if (pathNode.node.callee.name === 'alert') {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use injected notify utility instead of alert(). (notifications-via-di)`,
          hint: `Example:\nnotify.info('User message', { module: 'MyModule', context: 'myFunction' })`,
          node: pathNode.node,
          ruleId: 6
        });
      }
    }
  });
}

/**
 * 3) Pure Imports - No side effects at import time
 */
function checkPureModuleContracts(ast, filePath, errors) {
  ast.program.body.forEach((node) => {
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type !== 'Literal' // Allow simple literals like "use strict";
    ) {
      // Avoid flagging 'use strict';
      if (node.expression.type === 'Literal' && node.expression.value === 'use strict') {
        return;
      }
      // Avoid flagging constant declarations like: const MY_CONST = "value";
      if (node.type === 'VariableDeclaration' && node.kind === 'const') {
        return;
      }
      errors.push({
        filePath,
        line: node.loc?.start.line,
        message: `Found top-level side effect; factor into createXYZ function. (pure-imports)`,
        hint: `Move initialization and side effects into a createXYZ(...) function.`,
        node,
        ruleId: 3
      });
    }
  });
}

/**
 * 4) Centralized Event Handling
 * 5) Context Tags for event listeners
 */
function checkEventListenerCleanup(ast, filePath, errors) {
  traverse(ast, {
    CallExpression(pathNode) {
      const { callee, arguments: args } = pathNode.node;

      // Check for event listener tracking
      if (
        callee.type === 'MemberExpression' &&
        callee.object.name === 'eventHandlers' &&
        callee.property.name === 'trackListener'
      ) {
        // Check if context is provided (Guardrail #5)
        let hasContextParam = false;

        if (args.length > 1) {
          const lastArg = args[args.length - 1];
          if (lastArg.type === 'ObjectExpression') {
            hasContextParam = lastArg.properties.some(prop =>
              prop.key.name === 'context' && prop.value.type === 'StringLiteral'
            );
          }
        }

        if (!hasContextParam) {
          errors.push({
            filePath,
            line: pathNode.node.loc?.start.line,
            message: `Missing context tag in eventHandlers.trackListener call. (event-context-tag-missing)`,
            hint: `Example:\neventHandlers.trackListener(element, 'click', handleClick, { context: 'sidebar-menu' })`,
            node: pathNode.node,
            ruleId: 5
          });
        }
      }

      // Look for direct addEventListener instead of using eventHandlers
      if (
        callee.type === 'MemberExpression' &&
        callee.property.name === 'addEventListener' &&
        callee.object.type === 'Identifier' &&         // Warn only when the target *is* a bare identifier
        !pathNode.scope.hasBinding(callee.object.name) // that isn’t DI-injected
      ) {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use eventHandlers.trackListener instead of direct addEventListener. (centralized-event-handling)`,
          hint: `Example:\nconst listener = eventHandlers.trackListener(element, 'click', handleClick, { context: 'sidebar-menu' })`,
          node: pathNode.node,
          ruleId: 4
        });
      }
    }
  });

  // Look for cleanup function that removes listeners
  let foundCleanupFunction = false;
  let foundRemoveListenerCalls = false;

  traverse(ast, {
    FunctionDeclaration(pathNode) {
      if (pathNode.node.id?.name === 'cleanup' || pathNode.node.id?.name === 'teardown') { // Added teardown
        foundCleanupFunction = true;

        // Look for cleanupListeners call with context
        pathNode.traverse({
          CallExpression(innerPath) {
            if (
              innerPath.node.callee.type === 'MemberExpression' &&
              innerPath.node.callee.object.name === 'eventHandlers' &&
              innerPath.node.callee.property.name === 'cleanupListeners'
            ) {
              // Check if context is provided
              if (
                innerPath.node.arguments.length > 0 &&
                innerPath.node.arguments[0].type === 'ObjectExpression' &&
                innerPath.node.arguments[0].properties.some(prop => prop.key.name === 'context')
              ) {
                foundRemoveListenerCalls = true;
              }
            }
          }
        });
      }
    }
  });

  // Look for trackListener without proper cleanup
  let usesTrackListener = false;
  traverse(ast, {
    CallExpression(pathNode) {
      if (
        pathNode.node.callee.type === 'MemberExpression' &&
        pathNode.node.callee.object.name === 'eventHandlers' &&
        pathNode.node.callee.property.name === 'trackListener'
      ) {
        usesTrackListener = true;
      }
    }
  });

  if (usesTrackListener && (!foundCleanupFunction || !foundRemoveListenerCalls)) {
    errors.push({
      filePath,
      line: 1, // General file issue
      message: `Module registers event listeners but doesn't have a proper cleanup/teardown function using eventHandlers.cleanupListeners. (centralized-event-handling)`,
      hint: `Example:\nfunction cleanup() {\n  eventHandlers.cleanupListeners({ context: 'module-name' });\n}\n\nreturn { setup, cleanup };`,
      ruleId: 4
    });
  }
}

/**
 * 7) Debug & Trace Utilities
 */
function checkCreateDebugToolsUsage(ast, filePath, errors) {
  let foundCreateDebugTools = false;

  traverse(ast, {
    CallExpression(pathNode) {
      if (pathNode.node.callee.name === 'createDebugTools') {
        foundCreateDebugTools = true;

        // Check if options include notify
        let hasNotifyOption = false;
        if (
          pathNode.node.arguments.length > 0 &&
          pathNode.node.arguments[0].type === 'ObjectExpression'
        ) {
          hasNotifyOption = pathNode.node.arguments[0].properties.some(
            p => p.key.name === 'notify'
          );
        }

        if (!hasNotifyOption) {
          errors.push({
            filePath,
            line: pathNode.node.loc?.start.line,
            message: `createDebugTools() should be called with a notify dependency. (debug-trace-usage)`,
            hint: `Example: const dbg = createDebugTools({ notify });`,
            node: pathNode.node,
            ruleId: 7
          });
        }
      }
    }
  });
}

/**
 * 8) Context-Rich Error Logging
 */
function checkErrorHandling(ast, filePath, errors) {
  traverse(ast, {
    CatchClause(pathNode) {
      const catchParamName = pathNode.node.param ? pathNode.node.param.name : null;
      let foundProperCapture = false;

      pathNode.traverse({
        CallExpression(innerPath) {
          const { callee, arguments: args } = innerPath.node;
          if (
            callee.type === 'MemberExpression' &&
            callee.object.name === 'errorReporter' &&
            callee.property.name === 'capture'
          ) {
            // Check if the first argument is the error object from the catch clause
            const firstArgIsCatchParam = args.length > 0 &&
                                       args[0].type === 'Identifier' &&
                                       args[0].name === catchParamName;

            // Check if the second argument is an ObjectExpression with module/source/method
            let secondArgHasContext = false;
            if (args.length > 1 && args[1].type === 'ObjectExpression') {
              const props = args[1].properties;
              const hasModule = props.some(p => p.key.name === 'module');
              const hasSourceOrMethod = props.some(p =>
                p.key.name === 'source' || p.key.name === 'method'
              );

              if (hasModule && hasSourceOrMethod) {
                secondArgHasContext = true;
              }
            }

            if (firstArgIsCatchParam && secondArgHasContext) {
              foundProperCapture = true;
              innerPath.stop(); // Found a good one, stop searching this catch block
            }
          }
        },
      });

      if (!foundProperCapture) {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `No errorReporter.capture found in catch block with required context. (error-handling--context-rich-logging)`,
          hint: `Example:\ntry {\n  // ...\n} catch (err) {\n  errorReporter.capture(err, {\n    module: 'MyModule',\n    source: 'myFunction',\n    originalError: err \n  });\n}`,
          node: pathNode.node,
          ruleId: 8
        });
      }
    },
  });
}

/**
 * 9) Sanitize All User HTML
 */
function checkSanitizedInputs(ast, filePath, errors) {
  traverse(ast, {
    AssignmentExpression(pathNode) {
      const { left, right } = pathNode.node;
      if (
        left.type === 'MemberExpression' &&
        left.property.name === 'innerHTML'
      ) {
        // Skip if it's an empty string assignment (common for clearing)
        if (right.type === 'StringLiteral' && right.value === '') {
          return;
        }

        const isSanitizedCall =
          right.type === 'CallExpression' &&
          right.callee.type === 'MemberExpression' &&
          right.callee.object?.name === 'sanitizer' &&
          right.callee.property?.name === 'sanitize';

        if (!isSanitizedCall) {
          errors.push({
            filePath,
            line: pathNode.node.loc?.start.line,
            message: `Setting .innerHTML without sanitizer.sanitize(...) detected. (dom--security-sanitized-inputs)`,
            hint: `Example:\nconst safeHtml = sanitizer.sanitize(userHtml);\nel.innerHTML = safeHtml;`,
            node: pathNode.node,
            ruleId: 9
          });
        }
      }
    },
  });
}

/**
 * 10) App Readiness check
 */
function checkAppReadiness(ast, filePath, errors) {
  let foundReadinessCheck = false;

  traverse(ast, {
    CallExpression(pathNode) {
      const { callee } = pathNode.node;

      // Check for DependencySystem.waitFor
      if (
        callee.type === 'MemberExpression' &&
        callee.object.name === 'DependencySystem' &&
        callee.property.name === 'waitFor'
      ) {
        foundReadinessCheck = true;
      }

      // Check for addEventListener with 'app:ready'
      if (
        callee.type === 'MemberExpression' &&
        callee.property.name === 'addEventListener' &&
        pathNode.node.arguments.length > 0 &&
        pathNode.node.arguments[0].type === 'StringLiteral' &&
        pathNode.node.arguments[0].value === 'app:ready'
      ) {
        foundReadinessCheck = true;
      }
    }
  });

  if (!foundReadinessCheck) {
    errors.push({
      filePath,
      line: 1,
      message: `No readiness gate detected before DOM / app access. (app-readiness-check-missing)`,
      hint: `Wrap main logic in DependencySystem.waitFor([...]) or app:ready.`,
      ruleId: 10
    });
  }
}

/**
 * 11) Central app.state Only - No direct mutation
 */
function checkAppStateMutation(ast, filePath, errors) {
  traverse(ast, {
    AssignmentExpression(pathNode) {
      const { left } = pathNode.node;

      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'MemberExpression' &&
        left.object.object.name === 'app' &&
        left.object.property.name === 'state'
      ) {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Direct mutation of app.state is not allowed. (app-state-direct-mutation)`,
          hint: `Example: Use app.state.get() to read values and appropriate setters for changes.`,
          node: pathNode.node,
          ruleId: 11
        });
      }
    }
  });
}

/**
 * 13) Navigation Service - Use navigationService.navigateTo
 */
function checkNavigationService(ast, filePath, errors) {
  traverse(ast, {
    AssignmentExpression(pathNode) {
      const { left } = pathNode.node;

      // Check for window.location assignments
      if (
        left.type === 'MemberExpression' &&
        left.object.name === 'window' &&
        (left.property.name === 'location' ||
         left.property.name === 'href')
      ) {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use navigationService.navigateTo() instead of direct window.location changes. (navigation-service-bypass)`,
          hint: `Example: navigationService.navigateTo('/new-route');`,
          node: pathNode.node,
          ruleId: 13
        });
      }
    },
    CallExpression(pathNode) {
      // Check for window.location.assign()
      if (
        pathNode.node.callee.type === 'MemberExpression' &&
        pathNode.node.callee.object.type === 'MemberExpression' &&
        pathNode.node.callee.object.object.name === 'window' &&
        pathNode.node.callee.object.property.name === 'location' &&
        pathNode.node.callee.property.name === 'assign'
      ) {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use navigationService.navigateTo() instead of window.location.assign(). (navigation-service-bypass)`,
          hint: `Example: navigationService.navigateTo('/new-route');`,
          node: pathNode.node,
          ruleId: 13
        });
      }
    },
    MemberExpression(pathNode) {
      // Check for window.location.href access
      if (
        pathNode.node.object.type === 'MemberExpression' &&
        pathNode.node.object.object.name === 'window' &&
        pathNode.node.object.property.name === 'location' &&
        pathNode.node.property.name === 'href' &&
        pathNode.parent.type === 'AssignmentExpression' &&
        pathNode.parent.left === pathNode.node
      ) {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use navigationService.navigateTo() instead of direct window.location.href assignment. (navigation-service-bypass)`,
          hint: `Example: navigationService.navigateTo('/new-route');`,
          node: pathNode.node,
          ruleId: 13
        });
      }
    }
  });
}

/**
 * 14) Single API Client
 */
function checkApiClientUsage(ast, filePath, errors) {
  traverse(ast, {
    NewExpression(pathNode) {
      if (pathNode.node.callee.name === 'XMLHttpRequest') {
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use apiClient instead of direct XMLHttpRequest. (api-client-bypass)`,
          hint: `Example: apiClient.get('/api/data').then(handleResponse);`,
          node: pathNode.node,
          ruleId: 14
        });
      }
    },

    CallExpression(pathNode) {
      // Check for fetch calls
      if (pathNode.node.callee.name === 'fetch') {
        // Allow fetch if it's inside a module named apiClient.js or similar
        if (filePath.includes('apiClient')) { // Basic check, can be made more robust
          return;
        }
        errors.push({
          filePath,
          line: pathNode.node.loc?.start.line,
          message: `Use apiClient instead of direct fetch calls. (api-client-bypass)`,
          hint: `Example: apiClient.post('/api/data', payload).then(handleResponse);`,
          node: pathNode.node,
          ruleId: 14
        });
      }
    }
  });
}

/**
 * 15) Notifier Factories
 */
function checkNotifyWithContextUsage(ast, filePath, errors) {
  let foundNotifyCall = false;
  let foundWithContextCall = false;
  let notifyCalls = [];

  traverse(ast, {
    CallExpression(pathNode) {
      const { callee } = pathNode.node;

      // Check for direct notify calls
      if (
        callee.type === 'MemberExpression' &&
        callee.object.name === 'notify' &&
        ['info', 'warn', 'error', 'success', 'debug', 'apiError', 'authWarn'].includes(callee.property.name)
      ) {
        foundNotifyCall = true;
        notifyCalls.push(pathNode);

        // Check if the second argument has module & context
        if (
          pathNode.node.arguments.length > 1 &&
          pathNode.node.arguments[1].type === 'ObjectExpression'
        ) {
          const props = pathNode.node.arguments[1].properties;
          const hasModule = props.some(p => p.key && p.key.name === 'module');
          const hasContext = props.some(p => p.key && p.key.name === 'context');
          const hasSource = props.some(p => p.key && p.key.name === 'source');

          if (!hasModule || !hasContext) {
            errors.push({
              filePath,
              line: pathNode.node.loc?.start.line,
              message: `notify calls should include both module and context properties. (contextual-notifier-factories)`,
              hint: `Example: notify.info('Message', { module: 'MyModule', context: 'myFunction', source: 'functionName' });`,
              node: pathNode.node,
              ruleId: 15
            });
          } else if (!hasSource) {
            // Just a warning for missing source
            errors.push({
              filePath,
              line: pathNode.node.loc?.start.line,
              message: `notify calls should ideally include source property for better tracing. (contextual-notifier-factories)`,
              hint: `Example: notify.info('Message', { module: 'MyModule', context: 'myFunction', source: 'functionName' });`,
              node: pathNode.node,
              ruleId: 15
            });
          }
        } else if (pathNode.node.arguments.length === 1) {
          // Only one argument (message) without metadata
          errors.push({
            filePath,
            line: pathNode.node.loc?.start.line,
            message: `notify calls should include metadata object with module and context properties. (contextual-notifier-factories)`,
            hint: `Example: notify.info('Message', { module: 'MyModule', context: 'myFunction', source: 'functionName' });`,
            node: pathNode.node,
            ruleId: 15
          });
        }
      }

      // Check for notify.withContext usage
      if (
        callee.type === 'MemberExpression' &&
        callee.object.name === 'notify' &&
        callee.property.name === 'withContext'
      ) {
        foundWithContextCall = true;

        // Check if it has module & context
        if (
          pathNode.node.arguments.length > 0 &&
          pathNode.node.arguments[0].type === 'ObjectExpression'
        ) {
          const props = pathNode.node.arguments[0].properties;
          const hasModule = props.some(p => p.key && p.key.name === 'module');
          const hasContext = props.some(p => p.key && p.key.name === 'context');

          if (!hasModule || !hasContext) {
            errors.push({
              filePath,
              line: pathNode.node.loc?.start.line,
              message: `notify.withContext should include both module and context properties. (contextual-notifier-factories)`,
              hint: `Example: const moduleNotify = notify.withContext({ module: 'MyModule', context: 'operations' });`,
              node: pathNode.node,
              ruleId: 15
            });
          }
        }
      }
    }
  });

  // If found multiple direct notify calls but no withContext usage, suggest using withContext
  if (foundNotifyCall && !foundWithContextCall && notifyCalls.length > 2) {
    errors.push({
      filePath,
      line: 1, // General file issue
      message: `Multiple notify calls (${notifyCalls.length}) without using notify.withContext to create module-scoped notifiers. (contextual-notifier-factories)`,
      hint: `Example:\n// Create once at module level\nconst moduleNotify = notify.withContext({ module: 'MyModule', context: 'operations' });\n\n// Then use throughout the module\nmoduleNotify.info('Operation started');\nmoduleNotify.success('Operation completed');`,
      ruleId: 15
    });
  }
}

/**
 * 16) Backend Event Logging
 */
function checkBackendEventLogging(ast, filePath, errors) {
  let foundBackendLogCall = false;
  traverse(ast, {
    CallExpression(pathNode) {
      if (
        pathNode.node.callee.type === 'MemberExpression' &&
        pathNode.node.callee.object.name === 'backendLogger' &&
        pathNode.node.callee.property.name === 'log'
      ) {
        foundBackendLogCall = true;
        pathNode.stop();
      }
    }
  });

  if (!foundBackendLogCall) {
    // This is a soft warning, as not all modules need backend logging.
    // Consider if this should be a stricter error based on project needs.
    // For now, let's not push an error to avoid false positives.
    /*
    errors.push({
      filePath,
      line: 1, // General file issue
      message: `No backendLogger.log call detected. Consider logging critical client events. (backend-event-logging-missing)`,
      hint: `Example: backendLogger.log({ level: 'info', message: 'User action', module: 'MyModule' });`,
      ruleId: 16
    });
    */
  }
}

/**
 * 12) Module Event Bus
 */
function checkModuleEventBus(ast, filePath, errors) {
  let foundEventTargetNew = false;
  traverse(ast, {
    NewExpression(pathNode) {
      if (pathNode.node.callee.name === 'EventTarget') {
        foundEventTargetNew = true;
        pathNode.stop();
      }
    }
  });

  let sendsCustomEvent = false;
  traverse(ast, {
    CallExpression(pathNode) {
        if (pathNode.node.callee.type === 'MemberExpression' &&
            pathNode.node.callee.property?.name === 'dispatchEvent') {
            // Further check if the event dispatched is a CustomEvent
            if (pathNode.node.arguments.length > 0 && pathNode.node.arguments[0].type === 'NewExpression' && pathNode.node.arguments[0].callee.name === 'CustomEvent') {
                 sendsCustomEvent = true;
                 pathNode.stop();
            }
        }
    }
  });

  if (sendsCustomEvent && !foundEventTargetNew) {
    errors.push({
      filePath,
      line: 1, // General file issue as it's about module structure
      message: `Custom events dispatched without a dedicated EventBus (new EventTarget()). (module-event-bus-missing)`,
      hint: `Instantiate and use a local EventTarget for module-specific events:\nconst MyModuleBus = new EventTarget();\nMyModuleBus.dispatchEvent(new CustomEvent('custom-event'));`,
      ruleId: 12
    });
  }
}


/**
 * 17) User Consent for Monitoring
 */
function checkUserConsent(ast, filePath, errors) {
  traverse(ast, {
    NewExpression(pathNode) {
      // Check for analytics services initialization without consent check
      const analyticsServices = ['GoogleAnalytics', 'Segment', 'Mixpanel', 'Sentry', 'LogRocket'];

      if (analyticsServices.includes(pathNode.node.callee.name)) {
        let hasConsentCheck = false;

        // Look for user consent check in the current or parent blocks
        let currentPath = pathNode.parentPath;
        while (currentPath && !hasConsentCheck) {
          if (currentPath.isIfStatement()) {
            currentPath.traverse({
              MemberExpression(innerPath) {
                if (
                  innerPath.node.object.name === 'user' &&
                  innerPath.node.property.name === 'hasConsent'
                ) {
                  hasConsentCheck = true;
                  innerPath.stop();
                }
              }
            });
          }
          currentPath = currentPath.parentPath;
        }

        if (!hasConsentCheck) {
          errors.push({
            filePath,
            line: pathNode.node.loc?.start.line,
            message: `Analytics/monitoring initialization without user consent check. (user-consent-check-missing)`,
            hint: `Example: if (user.hasConsent('analytics')) { initializeAnalytics(); }`,
            node: pathNode.node,
            ruleId: 17
          });
        }
      }
    }
  });
}

/**
 * Get line content from file
 */
function getLineContent(fullCode, lineNumber) {
  if (!fullCode || typeof lineNumber !== 'number' || lineNumber < 1) {
    return '';
  }
  const lines = fullCode.split(/\r?\n/);
  if (lineNumber > lines.length) {
    return '';
  }
  return lines[lineNumber - 1].trim();
}

/**
 * Run all checks on a single file.
 */
function analyzeFile(filePath, fullFileContent) {
  let ast;
  try {
    ast = parse(fullFileContent, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (err) {
    return [
      {
        filePath,
        message: `Failed to parse file: ${err.message}`,
      },
    ];
  }

  const errors = [];

  // Run all checks against the AST
  checkFactoryFunctionExportPattern(ast, filePath, errors);
  checkNoGlobalUsage(ast, filePath, errors);
  checkPureModuleContracts(ast, filePath, errors);
  checkEventListenerCleanup(ast, filePath, errors);
  checkErrorHandling(ast, filePath, errors);
  checkSanitizedInputs(ast, filePath, errors);
  checkCreateDebugToolsUsage(ast, filePath, errors);
  checkNotifyWithContextUsage(ast, filePath, errors);
  checkAppReadiness(ast, filePath, errors);
  checkAppStateMutation(ast, filePath, errors);
  checkNavigationService(ast, filePath, errors);
  checkApiClientUsage(ast, filePath, errors);
  checkBackendEventLogging(ast, filePath, errors);
  checkModuleEventBus(ast, filePath, errors);
  checkUserConsent(ast, filePath, errors);

  // Add actualLineContent to errors that have a line number
  errors.forEach(err => {
    if (err.line) {
      err.actualLineContent = getLineContent(fullFileContent, err.line);
    }
  });

  return errors;
}

/**
 * Map error types to guardrail numbers (1-17)
 */
function mapErrorTypeToGuardrail(errorType) {
  const mapping = {
    'factory-function-export-pattern': 1,
    'strict-dependency-injection': 2,
    'pure-imports': 3,
    'centralized-event-handling': 4,
    'event-context-tag-missing': 5,
    'notifications-via-di': 6,
    'debug-trace-usage': 7,
    'error-handling--context-rich-logging': 8,
    'dom--security-sanitized-inputs': 9,
    'app-readiness-check-missing': 10,
    'app-state-direct-mutation': 11,
    'module-event-bus-missing': 12,
    'navigation-service-bypass': 13,
    'api-client-bypass': 14,
    'contextual-notifier-factories': 15,
    'backend-event-logging-missing': 16,
    'user-consent-check-missing': 17
  };

  // Extract the error pattern from the message if not directly available
  if (!mapping[errorType]) {
    for (const [pattern, guardrailId] of Object.entries(mapping)) {
      if (errorType.includes(pattern)) {
        return guardrailId;
      }
    }
  }

  return mapping[errorType] || 0;
}

/**
 * Group errors by guardrail number
 */
function groupErrorsByGuardrail(errors) {
  const errorsByGuardrail = {};

  errors.forEach(error => {
    let guardrailId = error.ruleId; // Prefer direct ruleId

    if (guardrailId === undefined) { // Fallback to regex parsing if ruleId is missing
      const typeMatch = error.message.match(/\(([\w-]+)\)/);
      const errorType = typeMatch ? typeMatch[1] : 'unknown';
      guardrailId = mapErrorTypeToGuardrail(errorType);
    }

    if (!errorsByGuardrail[guardrailId]) {
      errorsByGuardrail[guardrailId] = [];
    }

    errorsByGuardrail[guardrailId].push(error);
  });

  return errorsByGuardrail;
}

/**
 * Get guardrail name by number
 */
function getGuardrailName(guardrailId) {
  const names = {
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
    0: "Other Issues"
  };

  return names[guardrailId] || `Unknown Guardrail (${guardrailId})`;
}

/**
 * Get guardrail description by number
 */
function getGuardrailDescription(guardrailId) {
  const descriptions = {
    1: "Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. *No top‑level logic.*",
    2: "Do **not** access `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions.",
    3: "Produce no side effects at import time; all initialization occurs inside the factory.",
    4: "Register listeners with `eventHandlers.trackListener(..., { context })` and remove them with `eventHandlers.cleanupListeners({ context })`.",
    5: "Supply a unique `context` string for every listener and notification.",
    6: "Replace `console` or `alert` calls with the injected `notify` utility (or `notify.withContext`). Maintain consistent metadata.",
    7: "Use `createDebugTools({ notify })` for performance timing and trace IDs; emit diagnostic messages through the same `notify` pipeline.",
    8: "Capture errors with `errorReporter.capture(err, { module, method, … })`, never leaking tokens or PII.",
    9: "Always call `sanitizer.sanitize()` before inserting user content into the DOM.",
    10: "Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.",
    11: "Read global authentication and initialization flags from `app.state`; do **not** mutate them directly.",
    12: "When broadcasting internal state, expose a dedicated `EventTarget` (e.g., `AuthBus`) so other modules can subscribe without tight coupling.",
    13: "Perform all route or URL changes via the injected `navigationService.navigateTo(...)`.",
    14: "Make every network request through `apiClient`; centralize headers, CSRF, and error handling.",
    15: "Create module‑scoped notifiers with `notify.withContext({ module, context })`. Always include module, context, and source properties in notifications.",
    16: "Log critical client events with `backendLogger.log({ level, message, module, … })`.",
    17: "Honor user opt‑out preferences before initializing analytics or error‑tracking SDKs.",
    0: "Other issues not directly related to the 17 guardrails."
  };

  return descriptions[guardrailId] || "No description available.";
}

/**
 * Simple string padding helper
 */
function pad(str, length, padChar = ' ') {
  return str + padChar.repeat(Math.max(0, length - str.length));
}

/**
 * Draw a simple box with ASCII characters
 */
function drawBox(title, width = 80) {
  const topBottom = '┌' + '─'.repeat(width - 2) + '┐';
  const bottomLine = '└' + '─'.repeat(width - 2) + '┘';
  const emptyLine = '│' + ' '.repeat(width - 2) + '│';

  // Center the title
  const titleStart = Math.floor((width - title.length - 2) / 2);
  const titleLine = '│' + ' '.repeat(titleStart) + title + ' '.repeat(width - 2 - titleStart - title.length) + '│';

  console.log(topBottom);
  console.log(emptyLine);
  console.log(titleLine);
  console.log(emptyLine);
  console.log(bottomLine);
  console.log('');
}

/**
 * Simple table for the summary
 */
function drawTable(rows, headers, colWidths) {
  // Draw the table header
  const headerRow = headers.map((header, i) => pad(header, colWidths[i])).join(' │ ');
  const separator = colWidths.map(width => '─'.repeat(width)).join('─┼─');

  console.log('┌─' + separator + '─┐');
  console.log('│ ' + headerRow + ' │');
  console.log('├─' + separator + '─┤');

  // Draw the table rows
  rows.forEach(row => {
    const formattedRow = row.map((cell, i) => pad(cell, colWidths[i])).join(' │ ');
    console.log('│ ' + formattedRow + ' │');
  });

  console.log('└─' + separator + '─┘');
  console.log('');
}

/**
 * CLI Entry Point
 */
function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.log('\nFrontend Guardrails Checker\n');
    console.log('Scans your JavaScript code for violations of frontend coding guardrails.\n');
    console.log('Usage:');
    console.log('  node guardrailChecker.js <file1.js> [file2.js...]\n');
    console.log('Example:');
    console.log('  node guardrailChecker.js src/**/*.js\n');
    process.exit(0);
  }

  let totalErrors = 0;
  let allFileErrors = [];

  // First collect all errors
  files.forEach((file) => {
    const absPath = path.resolve(file);
    const fileContent = readFileContent(absPath);
    if (!fileContent) {
      return;
    }

    const fileErrors = analyzeFile(absPath, fileContent);
    if (fileErrors.length) {
      totalErrors += fileErrors.length;
      allFileErrors.push({ filePath: absPath, errors: fileErrors });
    }
  });

  // Then format and output them
  if (totalErrors > 0) {
    allFileErrors.forEach(({ filePath, errors }) => {
      const fileName = path.basename(filePath);

      // Print file summary using ASCII art
      const title = `${SYMBOLS.shield} Frontend Guardrails: ${fileName}`;
      drawBox(title, 80);

      // Group errors by guardrail
      const errorsByGuardrail = groupErrorsByGuardrail(errors);

      // Print summary
      console.log('Summary');

      // Prepare the table data
      const tableHeaders = ['Guardrail', 'Violations'];
      const colWidths = [50, 10];
      const tableRows = Object.entries(errorsByGuardrail).map(([guardrailId, violations]) => {
        return [getGuardrailName(guardrailId), violations.length.toString()];
      });

      // Draw the table
      drawTable(tableRows, tableHeaders, colWidths);

      // Print detailed violations
      console.log('Detailed Violations\n');

      Object.entries(errorsByGuardrail).forEach(([guardrailId, violations]) => {
        const guardrailName = getGuardrailName(guardrailId);
        const guardrailDescription = getGuardrailDescription(guardrailId);

        console.log(`${SYMBOLS.lock} ${guardrailName}`);
        console.log(guardrailDescription);
        console.log('');

        // Group violations by their rule type (extracted from the message)
        const violationsByRule = {};
        violations.forEach(violation => {
          const typeMatch = violation.message.match(/\(([\w-]+)\)/);
          const ruleType = typeMatch ? typeMatch[1] : 'unknown';

          if (!violationsByRule[ruleType]) {
            violationsByRule[ruleType] = [];
          }
          violationsByRule[ruleType].push(violation);
        });

        // Print each rule type with its violations
        Object.entries(violationsByRule).forEach(([ruleType, ruleViolations]) => {
          // If there are multiple violations, summarize them
          if (ruleViolations.length > 1) {
            console.log(`Found ${ruleViolations.length} violations of rule: ${ruleType}`);
          }

          // Show all violation locations
          ruleViolations.forEach((violation, index) => {
            console.log(`Line ${violation.line}: ${violation.actualLineContent}`);
            console.log(`${SYMBOLS.error} Violation: ${violation.message.split('(')[0].trim()}`);

            // Only show the hint/example once per rule type (for the first violation)
            if (index === 0 && violation.hint) {
              console.log(`${SYMBOLS.light} Pattern:`);
              const hintLines = violation.hint.split('\n');
              hintLines.forEach(line => {
                console.log(`   ${line}`);
              });
            }

            console.log(''); // Add a blank line between violations
          });
        });
      });

      // Check for module size issues
      const highestLine = errors.reduce((max, err) =>
        err.line > max ? err.line : max, 0);

      if (highestLine > 600) {
        const warningTitle = `${SYMBOLS.warning} Module Size Violation: ${highestLine} lines`;
        drawBox(warningTitle, 80);

        console.log(`${SYMBOLS.pointer} File ${fileName} exceeds the 600 line limit. Modules over 600 lines are banished!`);
        console.log(`${SYMBOLS.pointer} Split this file into smaller modules to comply with the guardrails.`);
        console.log('');
      }
    });

    // Print summary of all files
    const summaryTitle = `${SYMBOLS.alert} Found ${totalErrors} guardrail violation(s) across ${allFileErrors.length} file(s)!`;
    drawBox(summaryTitle, 80);

    process.exitCode = 1;
  } else {
    const successTitle = `${SYMBOLS.success} No guardrail violations found!`;
    drawBox(successTitle, 60);
  }
}

// Run the script
main();
