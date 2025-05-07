## Centralization Plan for domAPI.js and browserService.js

### 1. __domAPI.js – The Canonical DOM Interface__

- __All DOM-related helpers (selectors, node creation, event wiring, innerHTML) belong here.__
- Ensure all functions optionally support an injected `documentObject` and `windowObject`.
- Remove all duplicate definitions of DOM helpers from `globalUtils.js` and any similar utility module; import and DI domAPI everywhere.
- The only allowed way to interact with the DOM in "modern-class" code should be via domAPI methods.

#### __Include in domAPI.js:__

- getElementById
- querySelector/querySelectorAll
- createElement/appendChild/replaceChildren
- setInnerHTML (with sanitizer, if needed)
- addEventListener/removeEventListener (for both document/global and elements)
- dispatchEvent
- getBody, getDocumentElement, getActiveElement, getScrollingElement

---

### 2. __browserService.js – The Canonical Browser/Window/Storage Interface__

- __All browser APIs (window.location, window.history, localStorage, setTimeout, requestAnimationFrame, etc) belong here.__
- Enforce injected `windowObject` for all calls; never reference global `window` except as a default for local testing or in the module's default arg.
- Remove storage and browser access from `globalUtils.js` and let it import/DI `browserService.js` as needed.
- This is the *only* way to work with localStorage/cookies/history/timers in modern DI code.

#### __Include in browserService.js:__

- Storage: getItem, setItem, removeItem, clear, key, length
- Navigation: buildUrl, getSearchParam, setSearchParam, removeSearchParam
- History: replace/push state, getLocationHref
- Timing: setTimeout, requestAnimationFrame
- FormData, fetch wrappers (DI for SSR/test/mockability)
- Miscellaneous browser APIs as needed

---

### 3. __How to Refactor__

- __Step 1:__ Move or rewrite all DOM helpers to domAPI.js. Anything redundant in globalUtils.js should delegate to domAPI.
- __Step 2:__ Consolidate storage/browser/timer helpers in browserService.js. Remove these from globalUtils.js, and let globalUtils.js import from browserService.js if it needs these features.
- __Step 3:__ Wherever code previously imported helpers from globalUtils.js (for DOM or window), change those imports/usages to domAPI and browserService (injection preferred).
- __Step 4:__ For SSR-safe and test scenarios, always inject `documentObject` and `windowObject` into domAPI/browserService and ensure downstream code is DI-strict.
- __Step 5:__ Update test, storybook, and SSR code to mock domAPI/browserService with their injected object patterns.

---

## Why This Pattern?

- __No redundancy__: One way to do every common task.
- __SSR/test safety__: All core APIs can be stubbed/mocked/injected.
- __Maintainability__: All future enhancement, fixes, or instrumenting (e.g. for logging, analytics) happens in ONE place for the whole codebase.
- __Clarity__: All developers know to import domAPI and browserService, not copy-paste a random utility pattern.

---

### Example Usage After Refactor

```js
// In a component:
import { createDomAPI } from './utils/domAPI.js';
import { createBrowserService } from './utils/browserService.js';

const domAPI = createDomAPI({ documentObject: document, windowObject: window });
const browserService = createBrowserService({ windowObject: window });

// Use everywhere, via DI:
domAPI.getElementById('foo');
browserService.setItem('key', 'value');
```

---

## Next Steps

1. Move/copy all DOM helpers into `domAPI.js` and all browser/storage helpers into `browserService.js`.
2. Rewrite or remove redundant/legacy implementations in `globalUtils.js`, `projectDashboardUtils.js`, and any other utility files.
3. Update all imports in the codebase to use the central module.
4. Enforce DI access in all new/revised code (i.e., no more direct `document` or `window` usage outside domAPI/browserService).

---

This will dramatically improve codebase quality, reduce bugs, and make the developer experience clearer and faster.
