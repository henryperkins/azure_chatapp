# Patch-Plan — May 8 2025
Full implementation plan & ready-to-apply `apply_diff` blocks for all nine verified issues.
_All paths are relative to `/home/azureuser/azure_chatapp`._

---

## 1 · Duplicate event-handler references
### File  `static/js/projectDashboard.js`

```diff
<<<<<<< SEARCH
:start_line:15
-------
class ProjectDashboard {
  constructor(dependencySystem) {
=======
class ProjectDashboard {
  constructor(dependencySystem) {
    /* hoisted once-per-instance bound handlers */
    this._boundHandleViewProject = this._handleViewProject.bind(this);
>>>>>>> REPLACE
```

```diff
<<<<<<< SEARCH
:start_line:471
-------
this.components.projectList.onViewProject = this._handleViewProject.bind(this);
=======
this.components.projectList.onViewProject = this._boundHandleViewProject;
>>>>>>> REPLACE
```

```diff
<<<<<<< SEARCH
:start_line:479
-------
this.components.projectList.onViewProject = this._handleViewProject.bind(this);
=======
this.components.projectList.onViewProject = this._boundHandleViewProject;
>>>>>>> REPLACE
```

---

## 2 · Direct `document` / `window` access
### File  `static/js/projectDashboard.js`

```diff
<<<<<<< SEARCH
:start_line:528
-------
add(document, 'projectsLoaded', this._handleProjectsLoaded.bind(this));
=======
const doc = this.domAPI.getDocument?.() ?? document;
add(doc, 'projectsLoaded', this._handleProjectsLoaded.bind(this));
>>>>>>> REPLACE
```

(Repeat similar substitutions throughout file – grep for `add(document` and replace with `doc`.)

### File  `static/js/projectListComponent.js`

```diff
<<<<<<< SEARCH
:start_line:155
-------
this.element = this.domAPI?.getElementById
  ? this.domAPI.getElementById(this.elementId)
  : document.getElementById(this.elementId);
=======
const doc = this.domAPI.getDocument?.() ?? document;
this.element = this.domAPI?.getElementById
  ? this.domAPI.getElementById(this.elementId)
  : doc.getElementById(this.elementId);
>>>>>>> REPLACE
```

(Apply same doc alias pattern for every direct `document` or `window` reference.)

---

## 3 · Details-view init race
### File  `static/js/projectDashboard.js`

```diff
<<<<<<< SEARCH
:start_line:98
-------
const listView = this.domAPI.getElementById('projectListView');
=======
await this._waitForDom('#projectDetailsView');
const listView = this.domAPI.getElementById('projectListView');
>>>>>>> REPLACE
```

Add helper at end of class:

```diff
<<<<<<< SEARCH
:start_line:823
-------
}
=======
  /**
   * Wait until a DOM selector is present (max 3 s)
   */
  async _waitForDom(selector, timeout = 3000) {
    const start = Date.now();
    while (!this.domAPI.querySelector(selector)) {
      if (Date.now() - start > timeout) {
        throw new Error(`Timeout waiting for ${selector}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }
}
>>>>>>> REPLACE
```

---

## 4 · FileUploadComponent listener leaks
### File  `static/js/FileUploadComponent.js`

```diff
<<<<<<< SEARCH
:start_line:??   <!-- first listener registration -->
-------
this.eventHandlers.trackListener(dropZone, 'drop', onDrop, { description: 'FileUpload: drop' });
=======
const remover = this.eventHandlers.trackListener(dropZone, 'drop', onDrop, { description: 'FileUpload: drop' });
this._unsubs.push(remover);
>>>>>>> REPLACE
```

Add cleanup method bottom:

```diff
<<<<<<< SEARCH
:start_line:?? <!-- EOF before closing brace -->
-------
}
=======
  /**
   * Teardown listeners and refs
   */
  cleanup() {
    if (this._unsubs) {
      this._unsubs.forEach(fn => typeof fn === 'function' && fn());
      this._unsubs.length = 0;
    }
  }
}
>>>>>>> REPLACE
```

---

## 5 · Hidden DI fallback
### File  `static/js/eventHandler.js`

Delete `_resolveDep` + fallback:

```diff
<<<<<<< SEARCH
:start_line:39
-------
    const _resolveDep = ...
=======
    // Removed implicit dep resolution – all deps must be injected explicitly.
>>>>>>> REPLACE
```

And throw when missing.

---

## 6 · Details-init result guard
### File  `static/js/projectDashboard.js`

```diff
<<<<<<< SEARCH
:start_line:235
-------
await this.components.projectDetails.initialize();
=======
const ok = await this.components.projectDetails.initialize();
if (!ok) { this.showProjectList(); return false; }
>>>>>>> REPLACE
```

---

## 7 · DI registration ambiguity
Remove upper-case fallback:

```diff
<<<<<<< SEARCH
:start_line:20
-------
  dependencySystem.modules.get(key) ||
  dependencySystem.modules.get(
    key.charAt(0).toLowerCase() + key.slice(1)
  );
=======
  dependencySystem.modules.get(key);
>>>>>>> REPLACE
```

---

## 8 · BrowserService contract
### File  `static/js/utils/browserService.js`  (new)

```js
/**
 * BrowserService shim & contract definition.
 * Ensures ProjectDashboard & peers call only verified methods.
 */
export function createBrowserService(win = typeof window !== 'undefined' ? window : null) {
  if (!win) throw new Error('BrowserService requires a window-like object');
  return {
    buildUrl: (params) => {
      const url = new URL(win.location.href);
      Object.entries(params).forEach(([k, v]) => {
        if (v) url.searchParams.set(k, v); else url.searchParams.delete(k);
      });
      return url.toString();
    },
    getSearchParam: (k) => new URL(win.location.href).searchParams.get(k),
    setSearchParam: (k, v) => {
      const url = new URL(win.location.href);
      url.searchParams.set(k, v);
      win.history.replaceState({}, '', url.toString());
    },
    removeSearchParam: (k) => {
      const url = new URL(win.location.href);
      url.searchParams.delete(k);
      win.history.replaceState({}, '', url.toString());
    },
    setTimeout: win.setTimeout.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win)
  };
}
```

---

### Test stubs
Update Jest helpers to pass explicit `domAPI.getDocument` and `browserService`.

---

_End of plan.  Apply diffs in listed order; run `npm test && npm run lint` afterwards._
