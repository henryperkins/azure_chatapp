## Phase 3 (cont.): Knowledge Base UI (components)

### Step 3: Knowledge Base React Components

**src/features/kb/components/KnowledgeBaseSearch.tsx**

```tsx
import React, { useState, useCallback, useEffect } from 'react';
import { useKbSearch } from '../hooks/useKbSearch';
import type { KbResult } from '../types';
import { useDeps } from '@/core/DependenciesProvider';
import { useDebounce } from '@/utils/hooks';

interface KnowledgeBaseSearchProps {
  projectId: string;
  onResultSelect?: (result: KbResult) => void;
}

export const KnowledgeBaseSearch: React.FC<KnowledgeBaseSearchProps> = ({
  projectId,
  onResultSelect
}) => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const debouncedQuery = useDebounce(query, 300);
  const { notify } = useDeps();

  const searchMutation = useKbSearch(projectId);

  // Fire search when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim().length >= 2) {
      searchMutation.mutate({ query: debouncedQuery, topK });
    }
  }, [debouncedQuery, topK, searchMutation]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    []
  );

  const handleTopKChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setTopK(Number(e.target.value)),
    []
  );

  const handleResultClick = useCallback(
    (result: KbResult) => {
      onResultSelect?.(result) ??
        notify.info('Result clicked. Implement detail modal.', {
          context: 'KnowledgeBaseSearch'
        });
    },
    [onResultSelect, notify]
  );

  return (
    <div className="kb-search">
      <div className="kb-search-controls flex gap-2">
        <input
          className="input input-bordered flex-1"
          placeholder="Search knowledge base…"
          value={query}
          onChange={handleInputChange}
        />
        <select className="select" value={topK} onChange={handleTopKChange}>
          {[3, 5, 10, 20].map(v => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>

      {/* loading */}
      {searchMutation.isPending && (
        <p className="text-sm mt-2">Searching knowledge base…</p>
      )}

      {/* no results */}
      {searchMutation.isSuccess &&
        searchMutation.data?.length === 0 &&
        debouncedQuery && (
          <p className="text-sm mt-2">No results for “{debouncedQuery}”.</p>
        )}

      {/* results */}
      {searchMutation.isSuccess && searchMutation.data?.length > 0 && (
        <ul className="mt-3 space-y-2">
          {searchMutation.data.map(r => (
            <KbResultCard key={r.id} result={r} onClick={() => handleResultClick(r)} />
          ))}
        </ul>
      )}

      {/* error */}
      {searchMutation.isError && (
        <p className="text-error mt-2">Search failed. Please retry.</p>
      )}
    </div>
  );
};

interface CardProps {
  result: KbResult;
  onClick: () => void;
}
const KbResultCard: React.FC<CardProps> = ({ result, onClick }) => {
  const scorePct = Math.round(result.score * 100);
  return (
    <li
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' ? onClick() : null)}
      onClick={onClick}
      className="card bg-base-200 p-3 hover:bg-base-300 cursor-pointer"
    >
      <div className="flex justify-between">
        <span className="font-medium truncate">
          {result.file_info?.filename || result.metadata?.file_name || 'Unknown source'}
        </span>
        <span className="badge">{scorePct}%</span>
      </div>
      <p className="text-sm line-clamp-3 mt-1">{result.text}</p>
    </li>
  );
};
```

**src/utils/hooks/useDebounce.ts**

```typescript
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
```

---

## Phase 4: File-Rename & Extension Matrix

| Original File                               | New Path & Extension       | Notes                                  |
|---------------------------------------------|----------------------------|----------------------------------------|
| static/js/utils/apiClient.js                | src/core/apiClient.ts      | Converted to factory w/ DI + types     |
| static/js/utils/notify.js                   | src/core/notify.ts         | Exposes `createNotify`                 |
| static/js/utils/domAPI.js                   | src/core/domAPI.ts         | Slim wrapper, only for legacy bridge   |
| static/js/utils/browserService.js           | src/core/browserService.ts | Pure helper, browser abstractions      |
| static/js/knowledgeBaseSearchHandler.js     | **deleted** (logic now in hooks/components) | Imperative logic replaced              |
| static/js/knowledgeBaseManager.js           | src/features/kb/legacyManager.ts | Optional shim until fully migrated     |
| …                                           | …                          | See “migration-matrix.xlsx” for full list |

During each rename run `git mv`, then enable `allowJs` in `tsconfig` for untouched files and incrementally flip them to `.ts`.

---

## Phase 5: Imperative DOM → React Declarative

1. Wrap each DOM root (sidebar, dashboard, KB search, etc.) in a React mounting point `<div id="react-mount-sidebar"/>`.
2. For every `domAPI.replaceChildren` call create an equivalent component rendering the same HTML.
   • Example: `renderSidebarMenu()` → `<SidebarMenu items={…}/>`
3. Replace global event listeners with component-scoped handlers or context-level event bus.
   • Use `useEffect` for subscription + cleanup.
4. Gradually shrink legacy handlers: keep them but internally call React bridge functions until fully removed.

---

## Phase 6: Testing Strategy

| Layer           | Tooling                              | Approach                                                                                     |
|-----------------|--------------------------------------|----------------------------------------------------------------------------------------------|
| Unit            | Vitest + @testing-library/react-hooks | Assert pure functions (utils) and hooks (e.g., `useKbSearch` mock `apiClient`)               |
| Component       | @testing-library/react               | Mount components with mocked dependencies via `<DependenciesProvider …>`                     |
| Integration     | React Testing Library + MSW          | Stub network; render pages end-to-end inside MemoryRouter                                    |
| E2E             | Playwright                           | Run against Vite dev server; ensure legacy + React flows remain green                        |
| Lint/Types      | ESLint (typescript-eslint) + tsc     | CI step fails on any `tsc --noEmit` error                                                    |

Refactor existing Jest tests to Vitest with `vitest-codemod`, adjust assertions, and point to new React components. Legacy Cypress tests can remain until Playwright parity is confirmed.

CI pipeline:
```yaml
- run: npm ci
- run: npm run lint
- run: npm run typecheck
- run: npm run test:unit
- run: npm run test:e2e -- --headed --reporter=junit
```

---

## Phase 7: Roll-out Plan

1. **Week 1–2** – Foundation setup (Vite, TS, DI provider).
2. **Week 3–4** – Utilities & hooks converted, legacy bridge in place.
3. **Week 5–6** – Knowledge-base UI fully React; sidebar & dashboard start migration.
4. **Week 7–8** – Remove imperative handlers, drop `domAPI` except for rare cases.
5. **Week 9** – All files `.ts/.tsx`, strict type-checking on.
6. **Week 10** – Delete legacy bridge, celebrate.
