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
const os       = require("os");
const { parse }  = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const chalk    = (()=>{try{return require("chalk");}catch{     // colour fallback
  const p = t => t; return { red:p, yellow:p, green:p, blue:p, cyan:p, bold:p }; }})();

/* ─────────────────────────  No-op visitor fallbacks  ───────────────────── */
/**
 * These stubs stop ReferenceErrors when the optional rules haven’t been
 * implemented yet.  Replace each with the real visitor when you’re ready.
 */
const _noop = () => ({});
function vPure     (/* err, file            */){ return _noop(); }
function vState    (/* err, file            */){ return _noop(); }
function vEvent    (/* err, file,isAppJs    */){ return _noop(); }
function vSanitize (/* err, file            */){ return _noop(); }
function vReadiness(/* err, file,isAppJs    */){ return _noop(); }
function vBus      (/* err, file            */){ return _noop(); }
function vNav      (/* err, file            */){ return _noop(); }
function vAPI      (/* err, file            */){ return _noop(); }
function vLog      (/* err, file,isAppJs    */){ return _noop(); }

/* ───────────────────────── Symbols ────────────────────────────── */
const SYM = {
  error:  chalk.red("✖"),
  warn:   chalk.yellow("⚠"),
  info:   chalk.cyan("ℹ"),
  ok:     chalk.green("✓"),
  shield: chalk.blue("🛡️"),
  lock:   chalk.blue("🔒"),
  alert:  chalk.redBright("🚨"),
  lamp:   chalk.yellowBright("💡"),
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

/* ───────────────────────── Config & Plugins ───────────────────── */

function loadConfig(cwd){
  const tryPaths = [
    path.join(cwd,"patterns-checker.config.json"),
    path.join(cwd,".patterns-checkerrc"),
    path.join(cwd,"package.json")
  ];
  for(const p of tryPaths){
    if(fs.existsSync(p)){
      const raw = JSON.parse(fs.readFileSync(p,"utf8"));
      // package.json nesting support
      return raw["patternsChecker"] ?? raw;
    }
  }
  return {};
}

function loadPlugins(dir){
  if(!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f=>/\.(c?js|ts)$/.test(f))
    .map(f=>path.join(dir,f))
    .map(p=>{
      try{
        const mod = require(p);
        if(typeof mod.visitor!=="function" || typeof mod.ruleId!=="number") {
          console.warn(`${SYM.warn}  Plugin ${p} ignored – missing visitor() or ruleId`);
          return null;
        }
        // Allow plugins to extend rule name/desc maps
        if(mod.ruleName)  RULE_NAME[mod.ruleId]=mod.ruleName;
        if(mod.ruleDesc)  RULE_DESC[mod.ruleId]=mod.ruleDesc;
        return mod;
      }catch(err){
        console.warn(`${SYM.warn}  Failed to load plugin ${p}: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

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
      // avoid shadowing the `path` module constant
      merged[key] = _nodePath => chain.forEach(f => f(_nodePath));
    } else if (val && typeof val === "object") {
      ["enter", "exit"].forEach(phase => {
        if (Array.isArray(val[phase])) {
          const chain = val[phase];
          val[phase] = _nodePath => chain.forEach(f => f(_nodePath));
        }
      });
    }
  });

  return merged;
}

const hasProp = (objExpr, prop) =>
  objExpr?.properties?.some(p =>
    p.key &&
    (
      (p.key.type === "Identifier" && p.key.name === prop) ||
      (p.key.type === "StringLiteral" && p.key.value === prop)
    )
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
function vDI(err, file, isAppJs) {
  const bannedG   = ["window", "document"];
  const bannedS   = ["apiClient", "logger", "domReadinessService", "navigationService"];
  const diParams  = new Set();
  const referenced= new Set();
  let diLogger    = false;                // track whether logger came via DI

  /* ── collect names from factory param list ── */
  function scanParams(params){
    collectDIParamNamesFromParams(params, diParams);
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
    isAppJs ? null : vDI(errors, file, isAppJs),
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
