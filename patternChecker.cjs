#!/usr/bin/env node
/*
  patternChecker.cjs

  Scans your JavaScript code for violations of custom coding guidelines:
  1) Missing "export function createXYZ(...)" Factory Pattern
  2) Strict Dependency Injection (no direct usage of document/window/console)
  3) Event Listener & Cleanup
  4) Notifications via DI (no console or alert)
  5) Error Handling – context-rich logging with errorReporter.capture
  6) DOM Security – sanitized inputs only (innerHTML)
  7) Testing & Mockability – pure module contracts
  8) Optional: JSDoc & idiomatic modern JS (file-level doc comment)

  Usage:
    1) npm install --save-dev @babel/core @babel/parser @babel/traverse
    2) node patternChecker.cjs
*/

"use strict";

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * Read file contents safely.
 */
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`[Error] Unable to read file: ${filePath}\n`, err);
    return null;
  }
}

/**
 * 1) Factory Function Export Pattern
 */
function checkFactoryFunctionExportPattern(ast, filePath, errors) {
  let hasExportedCreate = false;

  traverse(ast, {
    ExportNamedDeclaration(pathNode) {
      const { declaration } = pathNode.node;
      if (declaration && declaration.type === 'FunctionDeclaration') {
        const fnName = declaration.id && declaration.id.name;
        if (fnName && fnName.startsWith('create')) {
          hasExportedCreate = true;
        }
      }
    },
  });

  if (!hasExportedCreate) {
    errors.push({
      filePath,
      message: `Missing "export function createXYZ(...)" pattern. (factory-function-export-pattern)`,
      hint: `Example:\n\nexport function createProjectManager(deps) {\n  if (!deps.DependencySystem) throw new Error('DependencySystem required');\n  return new ProjectManager(deps);\n}`
    });
  }
}

/**
 * 2) Strict DI (No Globals), 4) Notifications via DI
 */
function checkNoGlobalUsage(ast, filePath, errors) {
  traverse(ast, {
    MemberExpression(pathNode) {
      const { object } = pathNode.node;
      if (!object || !object.name) return;

      if (['document', 'window'].includes(object.name)) {
        errors.push({
          filePath,
          message: `Use injected dependencies instead of ${object.name}. (strict-dependency-injection)`,
          hint: `Example:\nconst el = domAPI.getElementById('something');`
        });
      } else if (object.name === 'console') {
        errors.push({
          filePath,
          message: `Do not use console.*; inject a notify or errorReporter instead. (notifications-via-di)`,
          hint: `Example:\nnotify.info('message', {...})`
        });
      }
    },
    CallExpression(pathNode) {
      if (pathNode.node.callee.name === 'alert') {
        errors.push({
          filePath,
          message: `Use injected notify utility instead of alert(). (notifications-via-di)`,
          hint: `Example:\nnotify.info('User message', {...})`
        });
      }
    }
  });
}

/**
 * 3) Event Listener & Cleanup Pattern
 */
function checkEventListenerCleanup(ast, filePath, errors) {
  let trackListenerCalled = false;
  let cleanupFound = false;
  let removeCallsInCleanup = false;

  traverse(ast, {
    CallExpression(pathNode) {
      const { callee } = pathNode.node;
      if (
        callee.type === 'MemberExpression' &&
        callee.object.name === 'eventHandlers' &&
        callee.property.name === 'trackListener'
      ) {
        trackListenerCalled = true;
      }
    },
    FunctionDeclaration(pathNode) {
      if (pathNode.node.id?.name === 'cleanup') {
        cleanupFound = true;
        let foundRemove = false;
        pathNode.traverse({
          CallExpression(innerPath) {
            if (innerPath.node.callee.property?.name === 'remove') {
              foundRemove = true;
            }
          },
        });
        removeCallsInCleanup = foundRemove;
      }
    },
  });

  if (trackListenerCalled && (!cleanupFound || !removeCallsInCleanup)) {
    errors.push({
      filePath,
      message: `Found eventHandlers.trackListener but no proper cleanup. (event-listener--cleanup-pattern)`,
      hint: `Example:\nfunction setupSidebarEvents({ eventHandlers }) {\n  const listeners = [];\n  listeners.push(eventHandlers.trackListener(...));\n  function cleanup() {\n    listeners.forEach(l => l.remove());\n    listeners.length = 0;\n  }\n  return { cleanup };\n}`
    });
  }
}

/**
 * 5) Error Handling – Context-Rich Logging
 */
function checkErrorHandling(ast, filePath, errors) {
  traverse(ast, {
    CatchClause(pathNode) {
      let hasErrorCapture = false;
      pathNode.traverse({
        CallExpression(innerPath) {
          const { callee } = innerPath.node;
          if (
            callee.type === 'MemberExpression' &&
            callee.object.name === 'errorReporter' &&
            callee.property.name === 'capture'
          ) {
            hasErrorCapture = true;
          }
        },
      });
      if (!hasErrorCapture) {
        errors.push({
          filePath,
          message: `No errorReporter.capture found in catch block. (error-handling--context-rich-logging)`,
          hint: `Example:\ntry {\n  // ...\n} catch (err) {\n  errorReporter.capture(err, {\n    module: '...',\n    method: '...',\n  });\n  throw err;\n}`
        });
      }
    },
  });
}

/**
 * 6) DOM Security – Sanitized Inputs Only
 */
function checkSanitizedInputs(ast, filePath, errors) {
  traverse(ast, {
    AssignmentExpression(pathNode) {
      const { left, right } = pathNode.node;
      if (
        left.type === 'MemberExpression' &&
        left.property.name === 'innerHTML'
      ) {
        const isSanitizedCall =
          right.type === 'CallExpression' &&
          right.callee.object?.name === 'sanitizer' &&
          right.callee.property?.name === 'sanitize';

        if (!isSanitizedCall) {
          errors.push({
            filePath,
            message: `Setting .innerHTML without sanitizer.sanitize(...) detected. (dom--security-sanitized-inputs)`,
            hint: `Example:\nconst safeHtml = sanitizer.sanitize(userHtml);\nel.innerHTML = safeHtml;`
          });
        }
      }
    },
  });
}

/**
 * 7) Testing & Mockability – Pure Module Contracts
 * No top-level side effects.
 */
function checkPureModuleContracts(ast, filePath, errors) {
  ast.program.body.forEach((node) => {
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type !== 'Literal'
    ) {
      errors.push({
        filePath,
        message: `Found top-level side effect; factor into createXYZ function. (testing--pure-module-contracts)`,
        hint: `Move side effects into a createXYZ(...) or similar function.`
      });
    }
  });
}

/**
 * 8) Optional Check: JSDoc at file-level
 */
function checkJSDoc(ast, filePath, errors, fileContent) {
  const trimmed = fileContent.trimStart();
  if (!trimmed.startsWith('/**')) {
    errors.push({
      filePath,
      message: `Missing file-level JSDoc comment at top. (recommended)`,
      hint: `Example:\n/**\n * My Module Description\n * @param {Object} deps - dependencies\n * @returns {Object}\n */`
    });
  }
}

/**
 * Run all checks on a single file.
 */
function analyzeFile(filePath) {
  const code = readFileContent(filePath);
  if (!code) return [];

  let ast;
  try {
    ast = parse(code, {
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
  checkFactoryFunctionExportPattern(ast, filePath, errors);
  checkNoGlobalUsage(ast, filePath, errors);
  checkEventListenerCleanup(ast, filePath, errors);
  checkErrorHandling(ast, filePath, errors);
  checkSanitizedInputs(ast, filePath, errors);
  checkPureModuleContracts(ast, filePath, errors);
  checkJSDoc(ast, filePath, errors, code);

  return errors;
}

/**
 * CLI Entry
 */
function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.log(
      'Usage:\n  node patternChecker.cjs <file1.js> [file2.js...]\n\n  Example:\n  node patternChecker.cjs src/**/*.js'
    );
    process.exit(0);
  }

  let totalErrors = 0;

  files.forEach((file) => {
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      console.error(`[Error] File not found: ${absPath}`);
      return;
    }

    const fileErrors = analyzeFile(absPath);
    if (fileErrors.length) {
      fileErrors.forEach((err) => {
        totalErrors++;
        console.log(`${err.filePath}:`);
        console.log(`  [Violation] ${err.message}`);
        if (err.hint) {
          console.log(`  [Hint] ${err.hint}`);
        }
        console.log('');
      });
    }
  });

  if (totalErrors > 0) {
    console.log(`\nFound ${totalErrors} violation(s).`);
    process.exitCode = 1;
  } else {
    console.log('No pattern violations found.');
  }
}

main();
