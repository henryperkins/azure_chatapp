# Refactor Plan – Inject `modelConfig` into `createSidebar`

## 1&nbsp;&nbsp;Problem Statement
ESLint error:

```
212:7  error  'modelConfig' is not defined  no-undef
```

File [`static/js/sidebar.js`](static/js/sidebar.js) calls
`modelConfig.renderQuickConfig(panel)` inside `maybeRenderModelConfig()` without importing or injecting `modelConfig`.
This breaches repository guardrails:

* **Strict Dependency Injection** – no globals.
* **Factory Function Export** – no hidden dependencies.

## 2&nbsp;&nbsp;Root Cause
When `createSidebar` was migrated to the DI–factory pattern, the
`modelConfig` helper was overlooked. Other modules already acquire
`modelConfig` via `DependencySystem` or constructor injection.

## 3&nbsp;&nbsp;Goals
| ID | Goal |
|----|------|
| G1 | Eliminate linter error / undefined global |
| G2 | Conform to DI guardrails |
| G3 | Preserve existing public APIs (`createSidebar`, `SidebarBus`, etc.) |
| G4 | Minimal ripple change (only sidebar + bootstrap) |

## 4&nbsp;&nbsp;Change Set
1. **`static/js/sidebar.js`**
   * Extend factory signature:
     ```js
     export function createSidebar({ ..., modelConfig = null, ... })
     ```
   * Add validation:
     ```js
     if (!modelConfig || typeof modelConfig.renderQuickConfig !== 'function') {
       throw new Error('[Sidebar] DI modelConfig with renderQuickConfig() is required.');
     }
     ```
     (Or fallback-friendly if we prefer optional.)
   * Replace direct reference in `maybeRenderModelConfig()`:
     ```js
     modelConfig.renderQuickConfig(panel);
     ```

2. **`static/js/app.js`** (bootstrap)
   * When constructing the sidebar, inject the existing `modelConfigInstance`
     ```
     const sidebar = createSidebar({
       ...,
       modelConfig: modelConfigInstance,
     });
     ```
   * No other changes needed—`modelConfigInstance` is already produced and
     registered in `DependencySystem`.

3. **TypeDoc / JSDoc update** – document new parameter in factory JSDoc.

4. **Unit / Manual Tests**
   * CI eslint now passes.
   * In browser: open sidebar → click ⚙️ gear → model quick-config renders.

## 5&nbsp;&nbsp;Risk & Mitigation
| Risk | Mitigation |
|------|------------|
| Consumers calling `createSidebar` without the new param | Validation throws clear error; only `app.js` creates sidebar. |
| Typo in DI param wiring | Covered by ESLint + runtime validation. |

## 6&nbsp;&nbsp;Rollback
Revert commit or remove the new param and re-enable the previous global,
though that would re-introduce guardrail violations.

---

Prepared May&nbsp;19,&nbsp;2025
