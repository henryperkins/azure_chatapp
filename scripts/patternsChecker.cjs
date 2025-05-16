#!/usr/bin/env node
/* eslint-env node */
/* global process */

/**
 * patternChecker.cjs – 2025-05-16
 * Enforces Frontend Code Guardrails (1-12) with the SAME rich CLI
 * output style you had previously (summary box, table, grouped details,
 * symbols, hints, and total-violation banner). Designed for CI use.
 */

"use strict";

/* ───────────────────────── Dependencies ───────────────────────── */
const fs       = require("fs");
const path     = require("path");
const { parse }  = require("@babel/parser");
const traverse = require("@babel/traverse").default;

/* ───────────────────────── Symbols ────────────────────────────── */
const SYM = {
  error:  "✖",
  warn:   "⚠",
  info:   "ℹ",
  ok:     "✓",
  shield: "🛡️",
  lock:   "🔒",
  alert:  "🚨",
  lamp:   "💡",
  bullet: "•",
};

/* ───────────────────────── Guardrail Maps ─────────────────────── */
const RULE_NAME = {
  1: "Factory Function Export",
  2: "Strict Dependency Injection",
  3: "Pure Imports",
  4: "Centralised Event Handling",
  5: "Context Tags",
  6: "Sanitize All User HTML",
  7: "domReadinessService Only",
  8: "Central app.state Only",
  9: "Module Event Bus",
 10: "Navigation Service",
 11: "Single API Client",
 12: "Logger / Observability",
 0 : "Other Issues",
};

const RULE_DESC = {
  1: "Export `createXyz` factory, validate deps, expose cleanup, no top-level code.",
  2: "No direct globals or direct service imports; inject via DI.",
  3: "No side-effects at import time; all logic inside the factory.",
  4: "Use `eventHandlers.trackListener` + `cleanupListeners` only.",
  5: "Every listener and log must include a `{ context }` tag.",
  6: "Always call `sanitizer.sanitize()` before inserting user HTML.",
  7: "DOM/app readiness handled *only* by DI-injected domReadinessService.",
  8: "Never mutate `app.state` directly; use dedicated setters.",
  9: "Dispatch custom events through a dedicated `EventTarget` bus.",
 10:"All routing via DI-injected `navigationService.navigateTo()`.",
 11:"All network calls via DI-injected `apiClient`.",
 12:"No `console.*`; all logs via DI logger and include context.",
};

/* ───────────────────────── Helper Utilities ───────────────────── */
const read = f => fs.readFileSync(f,"utf8");
const splitLines = code => code.split(/\r?\n/);
const getLine = (code,n)=>splitLines(code)[n-1]??"";

function mergeVisitors (...visitors) {
  /** Result shape:
   *   {
   *     Identifier()        -> chained fn
   *     Program: { enter()  -> chained fn,  exit() -> chained fn }
   *   }
   */
  const merged = {};

  visitors.forEach(v => {
    if (!v) return;

    Object.entries(v).forEach(([key, val]) => {
      // ── Case 1: key → function
      if (typeof val === "function") {
        (merged[key] ??= []).push(val);
        return;
      }

      // ── Case 2: key → { enter, exit }
      if (val && typeof val === "object") {
        Object.entries(val).forEach(([phase, fn]) => {
          if (typeof fn !== "function") return;
          (merged[key] ??= {});
          (merged[key][phase] ??= []).push(fn);
        });
      }
    });
  });

  // Wrap arrays into caller functions Babel expects
  Object.entries(merged).forEach(([key, val]) => {
    if (Array.isArray(val)) {
      const chain = val;
      merged[key] = path => chain.forEach(f => f(path));
    } else if (val && typeof val === "object") {
      ["enter", "exit"].forEach(phase => {
        if (Array.isArray(val[phase])) {
          const chain = val[phase];
          val[phase] = path => chain.forEach(f => f(path));
        }
      });
    }
  });

  return merged;
}

const hasProp=(objExpr,prop)=>
  objExpr?.properties?.some(p=>
    (p.key.type==="Identifier"   && p.key.name  ===prop)||
    (p.key.type==="StringLiteral"&& p.key.value===prop)
  );

// ────────────── NEW: Shared util for collecting DI param names ─────────────
function collectDIParamNamesFromParam(param, namesSet) {
  if (!param) return;
  if (param.type === "ObjectPattern") {
    param.properties.forEach(pr => {
      if (pr.type === "Property") {
        if (pr.value && pr.value.type === "AssignmentPattern" && pr.key)
          namesSet.add(pr.key.name || pr.key.value);
        else if (pr.key)
          namesSet.add(pr.key.name || pr.key.value);
      }
    });
  }
}
function collectDIParamNamesFromParams(params, namesSet) {
  (params||[]).forEach(param=>collectDIParamNamesFromParam(param, namesSet));
}
/* Factory to create error objects with hint support */
function E(file,line,ruleId,msg,hint=""){return{file,line,ruleId,message:msg,hint};}

/* ───────────────────────── Visitors (Guardrails) ─────────────── */

/* 1. Factory Function Export */
function vFactory(err, file) {
  let found = false, cleanup = false, depCheck = false;
  let factoryLine = 1;

  return {
    ExportNamedDeclaration(p) {
      const d = p.node.declaration;
      if (!d || d.type !== "FunctionDeclaration") return;
      const name = d.id?.name || "";
      if (!/^create[A-Z]/.test(name)) return;
      found = true;
      factoryLine = d.loc.start.line;

      if (!d.params.length)
        err.push(E(file, d.loc.start.line, 1, `${name} must accept 'deps'.`,
          `export function ${name}(deps){ /* ... */ }`));

      // Loosened: any throw for missing dependency counts
      p.traverse({
        ThrowStatement(q) {
          // Only count throws that are inside an if (!dep) or similar
          let parent = q.parentPath;
          while (parent && parent.node && parent.node.type !== "IfStatement" && parent.parentPath) {
            parent = parent.parentPath;
          }
          // Look for: if ( ... ) { throw new Error('Missing ...') }
          if (parent && parent.node && parent.node.type === "IfStatement") {
            const test = parent.node.test;
            // Look for !something or typeof something !==
            if (
              (test.type === "UnaryExpression" && test.operator === "!" && test.argument.type === "Identifier") ||
              (test.type === "BinaryExpression" && test.operator === "===" && (
                (test.left.type === "UnaryExpression" && test.left.operator === "typeof") ||
                (test.right.type === "UnaryExpression" && test.right.operator === "typeof")
              ))
            ) {
              // If error message matches "Missing ..."
              if (
                q.node.argument &&
                q.node.argument.type === "NewExpression" &&
                q.node.argument.callee.name === "Error" &&
                q.node.argument.arguments.length &&
                q.node.argument.arguments[0].type === "StringLiteral" &&
                /^Missing\b/.test(q.node.argument.arguments[0].value)
              ) {
                depCheck = true;
              }
            }
          }
        }
      });
    },
    FunctionDeclaration(p) {
      if (["cleanup", "teardown"].includes(p.node.id?.name)) cleanup = true;
    },
    Program: { exit() {
      if (!found)
        err.push(E(file, 1, 1, "Missing factory export.", "export function createXyz(deps){…}"));
      if (found && !depCheck)
        err.push(E(file, factoryLine, 1, "Factory must validate deps.", "throw new Error('Missing …')"));
      if (found && !cleanup)
        err.push(E(file, factoryLine, 1, "Factory must expose cleanup API.", "function cleanup() { … }"));
    } }
  };
}

/* 2. Strict Dependency Injection */
function vDI(err,file){
  const bannedG=["window","document"];
  const bannedS=["apiClient","logger","domReadinessService","navigationService"];
  const diParams=new Set();
  const referenced=new Set();

  // Patch: inspect all param forms, including ExportNamedDeclaration+Function/Arrow
  function collectDIProps(param) {
    if (!param) return;
    if (param.type === "ObjectPattern") {
      param.properties.forEach(pr => {
        // handles shorthand or AssignmentPattern (with default)
        const keyNode = pr.key || (pr.value && pr.value.left);
        if (!keyNode) return;
        const name = keyNode.name || keyNode.value;
        if (name) diParams.add(name);
      });
    }
  }

  return {
    ImportDeclaration(p){
      const src=p.node.source.value;
      bannedS.forEach(s=>{
        if(src.includes(s))
          err.push(E(file,p.node.loc.start.line,2,`Importing '${s}' directly is forbidden – inject via DI.`));
      });
    },
    VariableDeclarator(p){
      if(p.node.id.type==="ObjectPattern")
        collectDIProps(p.node.id);
      if(p.node.init?.callee?.name==="require"){
        const val=p.node.init.arguments?.[0]?.value||"";
        bannedS.forEach(s=>{
          if(val.includes(s))
            err.push(E(file,p.node.loc.start.line,2,`require('${s}') is forbidden – inject via DI.`));
        });
      }
    },
    FunctionDeclaration(p){
      p.node.params.forEach(collectDIProps);
    },
    FunctionExpression(p){
      p.node.params.forEach(collectDIProps);
    },
    ArrowFunctionExpression(p){
      p.node.params.forEach(collectDIProps);
    },
    ExportNamedDeclaration(p){
      const d = p.node.declaration;
      if (d && (d.type === "FunctionDeclaration" || d.type === "ArrowFunctionExpression"))
        d.params.forEach(collectDIProps);
    },
    CallExpression(p) {
      if(p.node.callee.type==="Identifier" && bannedS.includes(p.node.callee.name))
        referenced.add(p.node.callee.name);
    },
    MemberExpression(p){
      const obj=p.node.object;
      if(obj.type==="Identifier"&&bannedG.includes(obj.name))
        err.push(E(file,p.node.loc.start.line,2,`Use injected abstractions instead of global ${obj.name}.`));
      if(obj.name && bannedS.includes(obj.name))
        referenced.add(obj.name);
    },
    Program:{exit(){
      referenced.forEach(s=>{
        if(!diParams.has(s))
          err.push(E(file,1,2,`'${s}' used but not provided via DI param.`));
      });
    }}
  };
}

/* 3. Pure Imports */
function vPure(err,file){
  return{
    Program:{exit(p){
      p.node.body.forEach(n=>{
        if(
          n.type==="ImportDeclaration"||
          (n.type==="ExpressionStatement"&&n.expression.value==="use strict")||
          n.type==="ExportNamedDeclaration"
        ) return;
        err.push(E(file,n.loc.start.line,3,"Top-level logic found – move inside factory."));
      });
    }}
  };
}

/* 4 & 5. Event Handling + Context */
function vEvent(err, file, isAppJs) {
  const ctx = { track: false, cleanup: false };
  return {
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type === "MemberExpression" && c.object.name === "eventHandlers") {
        if (c.property.name === "trackListener") {
          ctx.track = true;
          const last = p.node.arguments.at(-1);
          if (!(last?.type === "ObjectExpression" && hasProp(last, "context"))) {
            err.push(E(file, p.node.loc.start.line, 5, "Missing { context } in trackListener.",
                       "eventHandlers.trackListener(btn,'click',handler,{ context:'sidebar' })"));
          } else {
            // Additional check: ensure context is a string literal
            const contextProp = last.properties.find(
              (pr) => (pr.key.name === "context" || pr.key.value === "context")
            );
            if (contextProp && contextProp.value.type !== "StringLiteral") {
              err.push(E(file, p.node.loc.start.line, 5, "context should be a string literal."));
            }
          }
        }
        if (c.property.name === "cleanupListeners") ctx.cleanup = true;
      }
      if (c.type === "MemberExpression" && c.property.name === "addEventListener") {
        // Exception for bootstrap DOMContentLoaded in app.js
        if (isAppJs &&
            c.object.name === "doc" &&
            p.node.arguments[0]?.value === "DOMContentLoaded") {
          return; // Skip this violation for bootstrap
        }
        err.push(E(file, p.node.loc.start.line, 4, "Use eventHandlers.trackListener instead of addEventListener."));
      }
    },
    Program: { exit() {
      if (ctx.track && !ctx.cleanup)
        err.push(E(file, 1, 4, "trackListener used but no cleanupListeners call."));
    }}
  };
}

/* 6. Sanitize HTML */
function vSanitize(err,file){
  const bad=["innerHTML","outerHTML"];
  const isSanitize=n=>n.type==="CallExpression"&&(
      n.callee.name==="sanitize"||
      (n.callee.type==="MemberExpression"&&n.callee.property.name==="sanitize"));
  return{
    AssignmentExpression(p){
      const l=p.node.left;
      if(l.type==="MemberExpression"&&bad.includes(l.property.name)){
        if(!isSanitize(p.node.right)&&!(p.node.right.type==="StringLiteral"&&p.node.right.value===""))
          err.push(E(file,p.node.loc.start.line,6,`.${l.property.name} without sanitizer.sanitize().`));
      }
    },
    CallExpression(p){
      const c=p.node.callee;
      if(c.type==="MemberExpression"&&c.property.name==="insertAdjacentHTML"){
        if(!isSanitize(p.node.arguments[1]))
          err.push(E(file,p.node.loc.start.line,6,"insertAdjacentHTML without sanitizer.sanitize()."));
      }
    }
  };
}

/* 7. domReadinessService */
function vReadiness(err, file, isAppJs) {
  let ok = false;
  const bootstrapWaitForLines = new Set(); // Track initial bootstrap waitFor lines

  if (isAppJs) {
    // Initial DependencySystem.waitFor in app.js bootstrap is allowed
    // We'll collect these line numbers during analysis
  }

  return {
    ImportDeclaration(p) {
      if (p.node.source.value.includes("domReadinessService")) {
        // Allow direct import in app.js for service creation
        if (isAppJs) return;

        err.push(E(file, p.node.loc.start.line, 7, "Do NOT import domReadinessService – inject via DI."));
      }
    },
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type === "MemberExpression") {
        // Check for DependencySystem.waitFor
        if (c.object.name === "DependencySystem" && c.property.name === "waitFor") {
          // For app.js, only flag DependencySystem.waitFor after domReadinessService is registered
          if (isAppJs) {
            // This is a simplified approach. If we could track actual registration, that would be better.
            // Instead, we'll allow the first occurrence only and flag subsequent ones.
            if (bootstrapWaitForLines.size === 0) {
              bootstrapWaitForLines.add(p.node.loc.start.line);
              return;
            }
          }

          err.push(E(file, p.node.loc.start.line, 7, "Legacy DependencySystem.waitFor() is banned."));
        }

        // Check for manual readiness listeners
        if (c.property.name === "addEventListener") {
          const ev = p.node.arguments[0];

          // Exception for bootstrap DOMContentLoaded in app.js
          if (isAppJs &&
            c.object.name === "doc" &&
            ev?.value === "DOMContentLoaded") {
            return; // Skip this violation for bootstrap
          }

          if (ev?.value === "app:ready" || ev?.value === "DOMContentLoaded")
            err.push(E(file, p.node.loc.start.line, 7, "Manual readiness listeners are banned."));
        }

        // allowed methods
        if (c.object.name === "domReadinessService" &&
          ["waitForEvent", "dependenciesAndElements"].includes(c.property.name))
          ok = true;
      }
    },
    Program: {
      exit(path) {
        // For app.js, don't require domReadinessService usage if it's the one creating it
        if (!ok && !isAppJs) {
          err.push(E(file, 1, 7, "No domReadinessService.waitForEvent/dependenciesAndElements call detected."));
        }

        if (!isAppJs) {
          let diParamSet = new Set();
          let factoryLine = 1;
          path.traverse({
            FunctionDeclaration(fdPath) {
              if (/^create[A-Z]/.test(fdPath.node.id?.name)) {
                factoryLine = fdPath.node.loc.start.line;
                // Collect destructured DI params (e.g. export function createX({ domReadinessService }) { ... })
                collectDIParamNamesFromParams(fdPath.node.params, diParamSet);

                // Now, ALSO check destructuring inside the body: const { domReadinessService } = deps;
                fdPath.traverse({
                  VariableDeclarator(vdPath) {
                    if (
                      vdPath.node.id.type === 'ObjectPattern' &&
                      vdPath.node.init &&
                      vdPath.node.init.name === 'deps'
                    ) {
                      vdPath.node.id.properties.forEach(pr => {
                        if (pr.key && pr.key.name === 'domReadinessService') {
                          diParamSet.add('domReadinessService');
                        }
                      });
                    }
                  }
                });
              }
            }
          });
          if (!diParamSet.has("domReadinessService")) {
            err.push(E(file, factoryLine, 7, "Missing domReadinessService in DI param."));
          }
        }
      }
    }
  };
}

/* 8. app.state */
function vState(err,file){
  return{
    AssignmentExpression(p){
      const l=p.node.left;
      if(l.type==="MemberExpression"&&
         l.object.type==="MemberExpression"&&
         l.object.object.name==="app"&&
         l.object.property.name==="state")
        err.push(E(file,p.node.loc.start.line,8,"Direct mutation of app.state is forbidden."));
    }
  };
}

/* 9. Module Event Bus */
function vBus(err,file){
  let bus=false,ce=false;
  return{
    NewExpression(p){ if(p.node.callee.name==="EventTarget") bus=true; },
    CallExpression(p){
      const c=p.node.callee;
      if(c.type==="MemberExpression"&&c.property.name==="dispatchEvent") ce=true;
    },
    Program:{exit(){
      if(ce&&!bus) err.push(E(file,1,9,"Custom events dispatched without dedicated EventTarget."));
    }}
  };
}

/* 10. Navigation Service */
function vNav(err,file){
  return{
    AssignmentExpression(p){
      const l=p.node.left;
      if(l.type==="MemberExpression"&&l.object.name==="window"&&l.property.name==="location")
        err.push(E(file,p.node.loc.start.line,10,"Use navigationService.navigateTo(...) instead of window.location."));
    },
    CallExpression(p){
      const c=p.node.callee;
      if(c.type==="MemberExpression"&&
         c.object.type==="MemberExpression"&&
         c.object.object.name==="window"&&
         c.object.property.name==="location")
        err.push(E(file,p.node.loc.start.line,10,"Use navigationService.navigateTo(...)."));
    }
  };
}

/* 11. Single API Client */
function vAPI(err,file){
  return{
    NewExpression(p){
      if(p.node.callee.name==="XMLHttpRequest")
        err.push(E(file,p.node.loc.start.line,11,"Use apiClient (DI) instead of XMLHttpRequest."));
    },
    CallExpression(p){
      if(p.node.callee.name==="fetch")
        err.push(E(file,p.node.loc.start.line,11,"Use apiClient (DI) instead of fetch."));
    }
  };
}

/* 12. Logger / Observability */
function vLog(err, file, isAppJs) {
  let diLogger = false;

  function scanParams(list) {
    list.forEach(param => {
      if (param && param.type === "ObjectPattern") {
        param.properties.forEach(pr => {
          const key = pr.key?.name || pr.key?.value ||
                      pr.value?.left?.name;
          if (key === "logger") diLogger = true;
        });
      }
    });
  }

  return {
    ImportDeclaration(p) {
      if (p.node.source.value.includes("logger")) {
        // Allow direct logger import in app.js for bootstrapping
        if (isAppJs) return;

        err.push(E(file, p.node.loc.start.line, 12, "Importing 'logger' directly is forbidden – inject via DI."));
      }
    },
    VariableDeclarator(p) {
      if (p.node.id.type === "ObjectPattern") {
        p.node.id.properties.forEach(pr => {
          const key = pr.key?.name || pr.key?.value || pr.value?.left?.name;
          if (key === "logger") diLogger = true;
        });
      }
    },
    FunctionDeclaration(p) { scanParams(p.node.params); },
    FunctionExpression(p) { scanParams(p.node.params); },
    ArrowFunctionExpression(p) { scanParams(p.node.params); },
    ExportNamedDeclaration(p) {
      const d = p.node.declaration;
      if (d && (d.type === "FunctionDeclaration" || d.type === "ArrowFunctionExpression"))
          scanParams(d.params);
    },
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type === "MemberExpression" && c.object.name === "console")
        err.push(E(file, p.node.loc.start.line, 12, "console.* is forbidden – use DI logger."));
      // Accept logger.withContext({}) factory as a valid logger usage
      if (c.type === "MemberExpression" && c.object.name === "logger" && c.property.name === "withContext") {
        return;
      }
      if (c.type === "MemberExpression" && c.object.name === "logger") {
        const last = p.node.arguments.at(-1);
        if (!(last?.type === "ObjectExpression" && hasProp(last, "context")))
          err.push(E(file, p.node.loc.start.line, 12, "logger call missing { context } meta."));
      }
    },
    Program: { exit() {
      // Don't require DI logger in app.js which creates the logger
      if (!diLogger && !isAppJs)
        err.push(E(file, 1, 12, "Logger not injected via DI param in factory."));
    }}
  };
}

/* 12-b. Error logging in catch blocks & event handlers                */
function vErrorLog(err,file){
  const handledFns=new Set();          // safeHandler(...) CallExpressions
  const trackHandlers=new Set();       // handler by ref passed to trackListener

  return{
    /* mark safeHandler wrappers */
    CallExpression(p){
      if(p.node.callee.name==="safeHandler"){
        handledFns.add(p.node); // store the CallExpression node itself (the wrapper)
      }
      /* collect event-handler arg */
      const c=p.node.callee;
      if(c.type==="MemberExpression"&&c.object.name==="eventHandlers"&&c.property.name==="trackListener"){
        const handler=p.node.arguments[2];
        if(handler) trackHandlers.add(handler);
      }
    },

    /* every catch must logger.error(err, { context }) */
    CatchClause(p){
      const errId=p.node.param?.name;
      let logged=false;
      p.traverse({
        CallExpression(q){
          const cal=q.node.callee;
          if(cal.type==="MemberExpression"&&cal.object.name==="logger"&&cal.property.name==="error"){
            // Accept error variable in any arg position:
            if(q.node.arguments.some(a=>a.type==="Identifier" && a.name===errId)) logged=true;
          }
        }
      });
      if(!logged)
        err.push(E(file,p.node.loc.start.line,12,"Caught errors must be re-logged via logger.error(...).",
           "logger.error('context msg', err, { context:'Module' })"));
    },

    Program:{exit(){
      // Compare handlers to see if any are safeHandler wrappers by location in code
      trackHandlers.forEach(h=>{
        const isWrapped = [...handledFns].some(wrap =>
          wrap === h ||
          (
            wrap.loc && h.loc &&
            wrap.loc.start.line === h.loc.start.line &&
            wrap.loc.start.column === h.loc.start.column
          )
        );
        if(!isWrapped)
          err.push(E(file,h.loc.start.line,12,"Event handler must be wrapped by safeHandler(...).",
            "eventHandlers.trackListener(btn,'click', safeHandler(handler,'click'),{ context:'btn' })"));
      });
    }}
  };
}

/* ───────────────────────── Analyzer ─────────────────────────── */
function analyze(file, code) {
  const errors = [];
  // Check if this is app.js or contains the bootstrap exception marker
  const isAppJs = /\/app\.js$/.test(file) ||
                  code.includes('WARNING: BOOTSTRAP EXCEPTION');

  let ast;
  try {
    ast = parse(code, { sourceType: "module",
      plugins: ["jsx", "typescript", "classProperties", "decorators-legacy", "dynamicImport", "optionalChaining", "nullishCoalescingOperator"] });
  } catch(e) {
    return [E(file, 1, 0, `Parse error: ${e.message}`)];
  }

  // Apply all visitors, passing isAppJs flag to those that need exceptions
  traverse(ast, mergeVisitors(
    // Skip these for app.js
    isAppJs ? null : vFactory(errors, file),
    isAppJs ? null : vDI(errors, file),
    isAppJs ? null : vPure(errors, file),
    isAppJs ? null : vState(errors, file),

    // Always apply these, but with app.js-specific modifications
    vEvent(errors, file, isAppJs),
    vSanitize(errors, file),
    vReadiness(errors, file, isAppJs),
    vBus(errors, file),
    vNav(errors, file),
    vAPI(errors, file),
    vLog(errors, file, isAppJs),
    vErrorLog(errors, file)
  ));

  errors.forEach(e => e.actualLine = getLine(code, e.line));
  return errors;
}

/* ───────────────────────── CLI Drawing Helpers ──────────────── */
function pad(s,l){return s+" ".repeat(Math.max(0,l-s.length));}
function drawBox(title,w=80){
  const top="┌"+"─".repeat(w-2)+"┐";
  const side="│";
  const empty=side+" ".repeat(w-2)+side;
  const mid=side+pad("",Math.floor((w-2-title.length)/2))+title+
            pad("",Math.ceil((w-2-title.length)/2))+side;
  console.log(`${top}\n${empty}\n${mid}\n${empty}\n└${"─".repeat(w-2)}┘\n`);
}
function drawTable(rows,hdr,widths){
  const headerRow=hdr.map((h,i)=>pad(h,widths[i])).join(" │ ");
  const sep=widths.map(w=>"─".repeat(w)).join("─┼─");
  console.log("┌─"+sep+"─┐");
  console.log("│ "+headerRow+" │");
  console.log("├─"+sep+"─┤");
  rows.forEach(r=>console.log("│ "+r.map((c,i)=>pad(c,widths[i])).join(" │ ")+" │"));
  console.log("└─"+sep+"─┘\n");
}

function groupByRule(errs){
  const g={};
  errs.forEach(e=>(g[e.ruleId]??=[]).push(e));
  return g;
}

/* ───────────────────────── Main CLI ─────────────────────────── */
(function main(){
  const argv=process.argv.slice(2);
  const ruleFilterArg=argv.find(a=>a.startsWith("--rule="));
  const ruleFilter=ruleFilterArg?parseInt(ruleFilterArg.split("=")[1],10):null;
  const files=argv.filter(a=>!a.startsWith("--"));
  if(!files.length){
    console.log("\nFrontend Pattern Checker\nUsage: node patternChecker.cjs [--rule=N] <file1.js> …\n");
    process.exit(0);
  }

  let total=0,report=[];
  files.forEach(f=>{
    const abs=path.resolve(f);
    if(!fs.existsSync(abs)){console.error(`${SYM.error} File not found: ${abs}`);return;}
    const code=read(abs);
    let errs=analyze(abs,code);
    if(ruleFilter) errs=errs.filter(e=>e.ruleId===ruleFilter);
    if(errs.length){total+=errs.length;report.push({file:abs,errs});}
  });

  if(!total){
    drawBox(`${SYM.ok} No pattern violations found!`,60);
    return;
  }

  report.forEach(({file,errs})=>{
    drawBox(`${SYM.shield} Frontend Patterns: ${path.basename(file)}`,80);
    const grouped=groupByRule(errs);
    drawTable(
      Object.entries(grouped).map(([id,v])=>[`${id}. ${RULE_NAME[id]}`,String(v.length)]),
      ["Pattern","Violations"],[55,10]);

    console.log("Detailed Violations\n");
    Object.entries(grouped).forEach(([id,vList])=>{
      console.log(`${SYM.lock} ${RULE_NAME[id]}\n${RULE_DESC[id]}\n`);
      vList.forEach((v,i)=>{
        console.log(`Line ${v.line}: ${v.actualLine}`);
        console.log(`${SYM.error} ${v.message}`);
        if(i===0&&v.hint){
          console.log(`${SYM.lamp} Pattern:`);
          v.hint.split("\n").forEach(l=>console.log("   "+l));
        }
        console.log("");
      });
    });
  });
  drawBox(`${SYM.alert} Found ${total} pattern violation(s)!`,80);
  process.exit(1);
})();
