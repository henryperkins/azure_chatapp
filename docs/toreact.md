# Comprehensive Guide for Migrating from JavaScript to React with TypeScript

## 1. Current Architecture Analysis

The current implementation uses a modular JavaScript approach with several architectural patterns worth examining before we plan our migration to React and TypeScript.

### Key Architectural Aspects

#### Dependency Injection and Module System

The application uses a manually implemented dependency injection system where components receive their dependencies through factory functions:

```javascript
// Example from knowledgeBaseSearchHandler.js
export function createKnowledgeBaseSearchHandler(ctx) {
  const notify = ctx.notify;

  // Methods implemented using dependencies from ctx
  function searchKnowledgeBase(query) {
    // Uses ctx.apiRequest, ctx.state, etc.
  }

  return {
    searchKnowledgeBase,
    debouncedSearch,
    triggerSearch,
    // Other public methods
  };
}
```

Dependencies are registered through a global `DependencySystem` and retrieved with utility functions:

```javascript
const eventHandlers = getDep("eventHandlers");
```

#### State Management

State is managed through mutable objects passed between components:

```javascript
// Modifying state directly
ctx.state.isSearching = true;
ctx.state.searchCache.set(cacheKey, results);

// Reading state
if (ctx.state.isSearching) return;
```

#### DOM Manipulation

The application uses a DOM abstraction layer, avoiding direct `document` references but still performing direct DOM manipulation:

```javascript
// Creating elements
const item = ctx.domAPI.createElement("div");
item.className = "card card-compact bg-base-100 shadow-md";

// Updating DOM
resultsContainer.appendChild(item);
resultsSection.classList.toggle("hidden", !show);

// Setting innerHTML safely
ctx._safeSetInnerHTML(item, `<div class="card-body p-3">...</div>`);
```

#### Event Handling

Events are managed through a custom handler system that supports tracking and cleanup:

```javascript
ctx.eventHandlers.trackListener(item, "click", () => _showResultDetail(res));
this.eventHandlers.cleanupListeners({ context: MODULE });
```

## 2. Migration Roadmap

### Phase 1: Project Setup and Configuration (1-2 weeks)

#### Create React TypeScript Project Structure

1. **Initialize React TypeScript project**

```bash
npx create-react-app azure-chatapp-react --template typescript
# OR
yarn create vite azure-chatapp-react --template react-ts
```

2. **Setup `tsconfig.json` for Incremental Adoption**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,               /* Allow JavaScript files to be included */
    "checkJs": true,               /* Type-check JavaScript files */
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,                /* Enable all strict type checking options */
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "module": "esnext",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": "./src",
    "paths": {                     /* Path aliases for cleaner imports */
      "@components/*": ["components/*"],
      "@hooks/*": ["hooks/*"],
      "@utils/*": ["utils/*"],
      "@services/*": ["services/*"],
      "@contexts/*": ["contexts/*"],
      "@types/*": ["types/*"]
    },
    "incremental": true,           /* Enable incremental compilation */
    "noImplicitAny": false,        /* Initially allow implicit any to ease migration */
    "strictNullChecks": false      /* Initially disable strict null checks */
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

3. **Project Folder Structure**

```
src/
├── components/           # React components
│   ├── common/           # Shared components
│   ├── knowledge-base/   # Knowledge base related components
│   └── project/          # Project related components
├── contexts/             # React context providers
│   ├── AppContext.tsx    # Main application context
│   └── DependencyContext.tsx # For DI replacement
├── hooks/                # Custom React hooks
│   ├── useAPI.ts         # API request hook
│   └── useKnowledgeBase.ts # Knowledge base operations hook
├── services/             # Service layer
│   ├── api.ts            # API client
│   └── notification.ts   # Notification service
├── types/                # TypeScript type definitions
│   ├── api.ts            # API related types
│   ├── knowledge-base.ts # Knowledge base types
│   └── common.ts         # Shared types
└── utils/                # Utility functions
    ├── dom.ts            # DOM utilities
    └── formatting.ts     # Data formatting utilities
```

### Phase 2: Type Definition and Core Abstractions (2-3 weeks)

#### 1. Define Key TypeScript Types

Create type definitions for core entities and dependencies:

```typescript
// src/types/knowledge-base.ts
export interface SearchResult {
  score: number;
  text: string;
  metadata?: {
    file_name?: string;
  };
  file_info?: {
    filename?: string;
    file_type?: string;
  };
}

export interface KnowledgeBaseState {
  isSearching: boolean;
  knowledgeBase: KnowledgeBase | null;
  searchCache: Map<string, SearchResult[]>;
}

export interface KnowledgeBaseConfig {
  minQueryLength: number;
  maxQueryLength: number;
  searchDebounceTime: number;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  is_active: boolean;
  embedding_model?: string;
  stats?: {
    total_size_bytes?: number;
    file_count?: number;
    chunk_count?: number;
    unprocessed_files?: number;
  };
  repo_url?: string;
  branch?: string;
  file_paths?: string[];
}
```

#### 2. Create Service Layer for API Requests

```typescript
// src/services/api.ts
import { SearchResult } from '@types/knowledge-base';

export async function searchKnowledgeBase(
  projectId: string,
  query: string,
  topK: number
): Promise<SearchResult[]> {
  try {
    const response = await fetch(`/api/projects/${projectId}/knowledge-bases/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, top_k: topK })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data.results || [];
  } catch (error) {
    console.error('Search knowledge base failed:', error);
    throw error;
  }
}
```

#### 3. Create Context for Dependency Injection

```typescript
// src/contexts/DependencyContext.tsx
import React, { createContext, useContext, ReactNode } from 'react';
import { NotificationService } from '@services/notification';

interface DependencyContextType {
  notify: NotificationService;
  validateUUID: (id: string) => boolean;
  formatBytes: (bytes: number) => string;
  formatDate: (date: string | Date) => string;
  fileIcon: (fileType: string) => string;
}

const DependencyContext = createContext<DependencyContextType | null>(null);

export function DependencyProvider({
  children,
  services
}: {
  children: ReactNode;
  services: DependencyContextType;
}) {
  return (
    <DependencyContext.Provider value={services}>
      {children}
    </DependencyContext.Provider>
  );
}

export function useDependencies() {
  const context = useContext(DependencyContext);
  if (!context) {
    throw new Error('useDependencies must be used within a DependencyProvider');
  }
  return context;
}
```

### Phase 3: React Hook Replacements for Core Functionality (2-3 weeks)

#### Convert Knowledge Base Search to a React Hook

```typescript
// src/hooks/useKnowledgeSearch.ts
import { useState, useCallback, useRef } from 'react';
import { searchKnowledgeBase } from '@services/api';
import { useDependencies } from '@contexts/DependencyContext';
import { SearchResult } from '@types/knowledge-base';

interface UseKnowledgeSearchProps {
  projectId: string;
  debounceTime?: number;
  minQueryLength?: number;
  maxQueryLength?: number;
}

export function useKnowledgeSearch({
  projectId,
  debounceTime = 300,
  minQueryLength = 3,
  maxQueryLength = 100
}: UseKnowledgeSearchProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasResults, setHasResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchCache = useRef(new Map<string, SearchResult[]>());
  const searchTimer = useRef<number | null>(null);

  const { notify } = useDependencies();

  const clearSearch = useCallback(() => {
    setResults([]);
    setHasResults(false);
  }, []);

  const search = useCallback(
    async (query: string, topK: number = 5) => {
      const trimmed = query.trim();

      // Validate query
      if (
        !trimmed ||
        trimmed.length < minQueryLength ||
        trimmed.length > maxQueryLength
      ) {
        clearSearch();
        return;
      }

      // Check if already searching
      if (isSearching) return;

      const cacheKey = `${projectId}-${trimmed}-${topK}`;

      // Check cache
      if (searchCache.current.has(cacheKey)) {
        const cachedResults = searchCache.current.get(cacheKey)!;
        setResults(cachedResults);
        setHasResults(cachedResults.length > 0);
        return;
      }

      setIsSearching(true);
      setError(null);

      try {
        const searchResults = await searchKnowledgeBase(projectId, trimmed, topK);
        searchCache.current.set(cacheKey, searchResults);
        setResults(searchResults);
        setHasResults(searchResults.length > 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        notify.error('Search failed. Please try again.', {
          source: 'useKnowledgeSearch',
          originalError: err
        });
      } finally {
        setIsSearching(false);
      }
    },
    [projectId, isSearching, minQueryLength, maxQueryLength, clearSearch, notify]
  );

  const debouncedSearch = useCallback(
    (query: string, topK: number = 5) => {
      if (searchTimer.current) {
        window.clearTimeout(searchTimer.current);
      }
      searchTimer.current = window.setTimeout(() => {
        search(query, topK);
      }, debounceTime);
    },
    [search, debounceTime]
  );

  return {
    results,
    isSearching,
    hasResults,
    error,
    search,
    debouncedSearch,
    clearSearch
  };
}
```

### Phase 4: Component Implementation (3-4 weeks)

#### Knowledge Base Search Component

```tsx
// src/components/knowledge-base/KnowledgeBaseSearch.tsx
import React, { useState, useCallback, useRef } from 'react';
import { useKnowledgeSearch } from '@hooks/useKnowledgeSearch';
import { SearchResult } from '@types/knowledge-base';
import { useDependencies } from '@contexts/DependencyContext';
import './KnowledgeBaseSearch.css';

interface KnowledgeBaseSearchProps {
  projectId: string;
}

export function KnowledgeBaseSearch({ projectId }: KnowledgeBaseSearchProps) {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const { formatBytes, fileIcon } = useDependencies();

  const {
    results,
    isSearching,
    hasResults,
    debouncedSearch,
    search
  } = useKnowledgeSearch({
    projectId,
    minQueryLength: 3,
    maxQueryLength: 100,
    debounceTime: 300
  });

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      debouncedSearch(value, topK);
    },
    [debouncedSearch, topK]
  );

  const handleSearch = useCallback(() => {
    search(query, topK);
  }, [search, query, topK]);

  const showResultDetail = useCallback((result: SearchResult) => {
    setSelectedResult(result);
    modalRef.current?.showModal();
  }, []);

  const hideResultDetail = useCallback(() => {
    modalRef.current?.close();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  const useInConversation = useCallback((result: SearchResult) => {
    const filename = result.metadata?.file_name || "the knowledge base";
    const refText = `Referring to content from "${filename}":\n\n> ${result.text.trim()}\n\nBased on this, `;

    // Find chat input and update it
    const chatInput = document.getElementById("chatUIInput") as HTMLTextAreaElement ||
                      document.getElementById("projectChatInput") as HTMLTextAreaElement ||
                      document.getElementById("chatInput") as HTMLTextAreaElement ||
                      document.querySelector('textarea[placeholder*="Send a message"]');

    if (chatInput) {
      const current = chatInput.value.trim();
      chatInput.value = current ? `${current}\n\n${refText}` : refText;
      chatInput.focus();
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      hideResultDetail();
    }
  }, [hideResultDetail]);

  const getBadgeClass = useCallback((scorePct: number) => {
    if (scorePct >= 80) return "badge-success";
    if (scorePct >= 60) return "badge-warning";
    return "badge-ghost";
  }, []);

  return (
    <div className="knowledge-base-search">
      <div className="search-container mb-4">
        <div className="input-group">
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder="Search knowledge base..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={isSearching}
          >
            {isSearching ? (
              <span className="loading loading-spinner loading-xs"></span>
            ) : (
              "Search"
            )}
          </button>
        </div>
        <div className="flex items-center justify-end mt-1">
          <label className="label">
            <span className="label-text mr-2">Results:</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
          >
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
          </select>
        </div>
      </div>

      {isSearching && (
        <div className="flex justify-center items-center p-4 text-base-content/70">
          <span className="loading loading-dots loading-md mr-2"></span>
          <span>Searching knowledge base...</span>
        </div>
      )}

      {!isSearching && results.length > 0 && (
        <div className="search-results">
          {results.map((result, index) => {
            const fileInfo = result.file_info || {};
            const filename = fileInfo.filename || result.metadata?.file_name || "Unknown source";
            const scorePct = Math.round((result.score || 0) * 100);
            const badgeClass = getBadgeClass(scorePct);

            return (
              <div
                key={`result-${index}`}
                className="card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow mb-3 cursor-pointer border border-base-300"
                role="button"
                tabIndex={0}
                onClick={() => showResultDetail(result)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showResultDetail(result);
                  }
                }}
              >
                <div className="card-body p-3">
                  <div className="card-title text-sm justify-between items-center mb-1">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-lg">{fileIcon(fileInfo.file_type || '')}</span>
                      <span className="truncate" title={filename}>{filename}</span>
                    </div>
                    <div className={`badge ${badgeClass} badge-sm`} title={`Relevance: ${scorePct}%`}>
                      {scorePct}%
                    </div>
                  </div>
                  <p className="text-xs text-base-content/80 kb-line-clamp-3 mb-2">
                    {result.text || "No content available."}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isSearching && query && !results.length && (
        <div className="no-results p-4 text-center border rounded-lg">
          <p>No results found. Try different keywords or check your spelling.</p>
        </div>
      )}

      <dialog ref={modalRef} className="modal">
        <div className="modal-box">
          <h3 className="font-bold text-lg">
            {selectedResult?.file_info?.filename || selectedResult?.metadata?.file_name || "Result Detail"}
          </h3>
          <div className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-base-content/70">
                Source: {selectedResult?.file_info?.filename || selectedResult?.metadata?.file_name || "Unknown"}
              </span>
              <span className={`badge ${getBadgeClass(Math.round((selectedResult?.score || 0) * 100))}`}>
                {Math.round((selectedResult?.score || 0) * 100)}%
              </span>
            </div>
            <div className="mt-2 p-3 bg-base-200 rounded-lg whitespace-pre-wrap">
              {selectedResult?.text || "No content available."}
            </div>
          </div>
          <div className="modal-action">
            <button
              className="btn btn-primary"
              onClick={() => selectedResult && useInConversation(selectedResult)}
            >
              Use in Chat
            </button>
            <button className="btn" onClick={hideResultDetail}>Close</button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={hideResultDetail}>close</button>
        </form>
      </dialog>
    </div>
  );
}
```

### Phase 5: Main Component Integration (2-3 weeks)

#### Knowledge Base Component

```tsx
// src/components/knowledge-base/KnowledgeBase.tsx
import React, { useState, useEffect } from 'react';
import { KnowledgeBaseSearch } from './KnowledgeBaseSearch';
import { KnowledgeBaseFilesList } from './KnowledgeBaseFilesList';
import { KnowledgeBaseSettings } from './KnowledgeBaseSettings';
import { useKnowledgeBase } from '@hooks/useKnowledgeBase';
import { KnowledgeBase as KnowledgeBaseType } from '@types/knowledge-base';
import { useDependencies } from '@contexts/DependencyContext';

interface KnowledgeBaseComponentProps {
  projectId: string;
  isVisible?: boolean;
}

export function KnowledgeBaseComponent({
  projectId,
  isVisible = true
}: KnowledgeBaseComponentProps) {
  const {
    knowledgeBase,
    isLoading,
    error,
    toggleActive,
    reprocessFiles,
    refreshKnowledgeBaseInfo
  } = useKnowledgeBase(projectId);

  const [activeTab, setActiveTab] = useState<'search' | 'files' | 'settings'>('search');
  const { notify } = useDependencies();

  useEffect(() => {
    if (isVisible && projectId) {
      refreshKnowledgeBaseInfo();
    }
  }, [projectId, isVisible, refreshKnowledgeBaseInfo]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="knowledge-base-container p-4">
      {!knowledgeBase ? (
        <div className="kb-inactive-state">
          <div className="alert alert-info shadow-lg">
            <div>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current flex-shrink-0 w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span>No Knowledge Base configured for this project</span>
            </div>
            <div className="flex-none">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setActiveTab('settings')}
              >
                Setup Knowledge Base
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="kb-active-state">
          <div className="kb-header flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-bold">{knowledgeBase.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`badge ${knowledgeBase.is_active ? 'badge-success' : 'badge-error'}`}>
                  {knowledgeBase.is_active ? 'Active' : 'Inactive'}
                </span>
                <label className="label cursor-pointer">
                  <span className="label-text mr-2">Enable</span>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={knowledgeBase.is_active}
                    onChange={(e) => toggleActive(e.target.checked)}
                  />
                </label>
              </div>
            </div>
            <div>
              <button
                className="btn btn-sm btn-outline mr-2"
                onClick={() => reprocessFiles()}
                disabled={!knowledgeBase.is_active || !(knowledgeBase.stats?.file_count ?? 0)}
                title={!knowledgeBase.is_active ? "Knowledge Base must be active." :
                      !(knowledgeBase.stats?.file_count ?? 0) ? "No files to reprocess." :
                      "Reprocess files."}
              >
                Reprocess Files
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setActiveTab('settings')}
              >
                Settings
              </button>
            </div>
          </div>

          <div className="tabs tabs-boxed mb-4">
            <a
              className={`tab ${activeTab === 'search' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              Search
            </a>
            <a
              className={`tab ${activeTab === 'files' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              Files
            </a>
            <a
              className={`tab ${activeTab === 'settings' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </a>
          </div>

          {activeTab === 'search' && (
            <KnowledgeBaseSearch projectId={projectId} />
          )}

          {activeTab === 'files' && (
            <KnowledgeBaseFilesList
              projectId={projectId}
              knowledgeBaseId={knowledgeBase.id}
            />
          )}

          {activeTab === 'settings' && (
            <KnowledgeBaseSettings
              projectId={projectId}
              knowledgeBase={knowledgeBase}
              onUpdate={refreshKnowledgeBaseInfo}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

### Phase 6: API and Notification Services (1-2 weeks)

#### API Service with TypeScript

```typescript
// src/services/api.ts
import { KnowledgeBase, SearchResult } from '@types/knowledge-base';

interface ApiOptions {
  method?: string;
  body?: any;
  params?: Record<string, string>;
  skipCache?: boolean;
}

interface ApiResponse<T> {
  data: T;
  status: number;
  statusText: string;
}

export class ApiService {
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: ApiOptions = {}): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      body,
      params,
      skipCache = false
    } = options;

    // Construct URL with params if any
    let url = `${this.baseUrl}${endpoint}`;
    if (params) {
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        queryParams.append(key, value);
      });
      url += `?${queryParams.toString()}`;
    }

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin'
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    if (skipCache) {
      fetchOptions.cache = 'no-store';
    }

    // Make request
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      // Extract error message if possible
      let errorMessage: string;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || `API error: ${response.status}`;
      } catch (e) {
        errorMessage = `API error: ${response.status} ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return {
      data,
      status: response.status,
      statusText: response.statusText
    };
  }

  // Knowledge Base API methods
  async getKnowledgeBase(projectId: string): Promise<KnowledgeBase | null> {
    try {
      const response = await this.request<{knowledge_base: KnowledgeBase}>(
        `/api/projects/${projectId}`
      );
      return response.data.knowledge_base || null;
    } catch (error) {
      console.error('Error fetching knowledge base:', error);
      return null;
    }
  }

  async searchKnowledgeBase(
    projectId: string,
    query: string,
    topK: number
  ): Promise<SearchResult[]> {
    const response = await this.request<{results: SearchResult[]}>(
      `/api/projects/${projectId}/knowledge-bases/search`,
      {
        method: 'POST',
        body: { query, top_k: topK }
      }
    );
    return response.data.results || [];
  }

  async toggleKnowledgeBase(
    projectId: string,
    knowledgeBaseId: string,
    isActive: boolean
  ): Promise<void> {
    await this.request<void>(
      `/api/projects/${projectId}/knowledge-bases/${knowledgeBaseId}/toggle`,
      {
        method: 'POST',
        body: { is_active: isActive }
      }
    );
  }

  async reprocessKnowledgeBase(projectId: string, knowledgeBaseId: string): Promise<void> {
    await this.request<void>(
      `/api/projects/${projectId}/knowledge-bases/${knowledgeBaseId}/reprocess`,
      { method: 'POST' }
    );
  }
}

// Export singleton instance
export const api = new ApiService();
```

#### Notification Service

```typescript
// src/services/notification.ts
type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'debug';

interface NotificationOptions {
  context?: string;
  module?: string;
  source?: string;
  group?: boolean;
  timeout?: number;
  extra?: Record<string, any>;
  originalError?: Error | unknown;
}

export class NotificationService {
  private domAPI: any; // Would be replaced with actual DOM API type
  private notificationHandler: any; // Would be replaced with actual notification handler type

  constructor(domAPI: any, notificationHandler: any) {
    this.domAPI = domAPI;
    this.notificationHandler = notificationHandler;
  }

  private showNotification(msg: string, type: NotificationType, options: NotificationOptions = {}) {
    // Call the notification handler
    if (this.notificationHandler && typeof this.notificationHandler.show === 'function') {
      this.notificationHandler.show(msg, type, options);
    } else {
      // Fallback to console
      console[type === 'error' ? 'error' :
              type === 'warning' ? 'warn' :
              type === 'debug' ? 'debug' : 'log'](
        `[${options.context || 'app'}:${options.source || 'unknown'}] ${msg}`,
        options.extra || {}
      );
    }
  }

  info(msg: string, options: NotificationOptions = {}) {
    this.showNotification(msg, 'info', options);
  }

  success(msg: string, options: NotificationOptions = {}) {
    this.showNotification(msg, 'success', options);
  }

  warning(msg: string, options: NotificationOptions = {}) {
    this.showNotification(msg, 'warning', options);
  }

  warn(msg: string, options: NotificationOptions = {}) {
    this.showNotification(msg, 'warning', options);
  }

  error(msg: string, options: NotificationOptions = {}) {
    this.showNotification(msg, 'error', options);
  }

  debug(msg: string, options: NotificationOptions = {}) {
    this.showNotification(msg, 'debug', options);
  }

  withContext(contextOptions: NotificationOptions): NotificationService {
    // Create a new instance with context options pre-applied
    const contextualService = new NotificationService(this.domAPI, this.notificationHandler);

    // Override methods to include context
    const methods: (keyof NotificationService)[] = ['info', 'success', 'warning', 'warn', 'error', 'debug'];
    methods.forEach(method => {
      const originalMethod = contextualService[method] as Function;
      contextualService[method] = (msg: string, options: NotificationOptions = {}) => {
        originalMethod.call(contextualService, msg, {
          ...contextOptions,
          ...options,
          extra: {
            ...(contextOptions.extra || {}),
            ...(options.extra || {})
          }
        });
      };
    });

    return contextualService;
  }
}

// Factory function to create notification service
export function createNotificationService(domAPI: any, notificationHandler: any) {
  return new NotificationService(domAPI, notificationHandler);
}
```

### Phase 7: Root Component and Entry Point (1-2 weeks)

```tsx
// src/App.tsx
import React, { useState, useEffect } from 'react';
import { DependencyProvider } from '@contexts/DependencyContext';
import { KnowledgeBaseComponent } from '@components/knowledge-base/KnowledgeBase';
import { createNotificationService } from '@services/notification';
import { api } from '@services/api';
import './App.css';

// Import utils
import { formatBytes, formatDate, fileIcon } from '@utils/formatting';
import { validateUUID } from '@utils/validation';

// Create services
const notificationHandler = window.notificationHandler; // Get from global scope initially
const domAPI = {
  createElement: (tag: string) => document.createElement(tag),
  getElementById: (id: string) => document.getElementById(id),
  querySelector: (selector: string, parent?: Element) =>
    parent ? parent.querySelector(selector) : document.querySelector(selector)
};

const notify = createNotificationService(domAPI, notificationHandler);

function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Dependencies to pass down through context
  const dependencies = {
    notify,
    validateUUID,
    formatBytes,
    formatDate,
    fileIcon,
    api
  };

  useEffect(() => {
    // Listen for authentication state changes
    const handleAuthChange = (event: CustomEvent) => {
      setIsAuthenticated(!!event.detail?.authenticated);
    };

    document.addEventListener('authStateChanged', handleAuthChange as EventListener);
    return () => {
      document.removeEventListener('authStateChanged', handleAuthChange as EventListener);
    };
  }, []);

  useEffect(() => {
    // Get current project ID from URL or other source
    const getCurrentProjectId = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const id = urlParams.get('projectId');
      return validateUUID(id || '') ? id : null;
    };

    setProjectId(getCurrentProjectId());

    // Listen for route changes
    const handleRouteChange = () => {
      setProjectId(getCurrentProjectId());
    };

    window.addEventListener('popstate', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, []);

  return (
    <DependencyProvider services={dependencies}>
      <div className="app">
        {isAuthenticated && projectId && (
          <KnowledgeBaseComponent
            projectId={projectId}
            isVisible={true}
          />
        )}
      </div>
    </DependencyProvider>
  );
}

export default App;
```

### Phase 8: Incremental Migration and Co-existence Strategy (Ongoing)

To allow gradual migration, we'll need a bridge between the existing JavaScript modules and the new React components:

```tsx
// src/bridge/KnowledgeBaseBridge.ts
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/App';

// Create a bridge to the existing code
export class KnowledgeBaseBridge {
  private rootElement: HTMLElement | null = null;
  private reactRoot: ReactDOM.Root | null = null;

  constructor(containerId: string) {
    this.rootElement = document.getElementById(containerId);
  }

  mount() {
    if (!this.rootElement) {
      console.error('Cannot mount React: container element not found');
      return;
    }

    this.reactRoot = ReactDOM.createRoot(this.rootElement);
    this.reactRoot.render(React.createElement(App));
  }

  unmount() {
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  }
}

// Make it available on window for existing code to use
declare global {
  interface Window {
    KnowledgeBaseBridge: typeof KnowledgeBaseBridge;
  }
}

window.KnowledgeBaseBridge = KnowledgeBaseBridge;
```

## Testing Strategy

### 1. Unit Testing

Use Jest and React Testing Library for unit tests:

```typescript
// src/hooks/__tests__/useKnowledgeSearch.test.tsx
import { renderHook, act, waitFor } from '@testing-library/react';
import { useKnowledgeSearch } from '@hooks/useKnowledgeSearch';
import { DependencyProvider } from '@contexts/DependencyContext';
import { searchKnowledgeBase } from '@services/api';

// Mock API
jest.mock('@services/api', () => ({
  searchKnowledgeBase: jest.fn()
}));

const mockNotify = {
  info: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

const wrapper = ({ children }) => (
  <DependencyProvider services={{ notify: mockNotify, validateUUID: () => true }}>
    {children}
  </DependencyProvider>
);

describe('useKnowledgeSearch hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useKnowledgeSearch({
      projectId: '123e4567-e89b-12d3-a456-426614174000'
    }), { wrapper });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.hasResults).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should search and update results', async () => {
    const mockResults = [{ text: 'Test result', score: 0.8 }];
    (searchKnowledgeBase as jest.Mock).mockResolvedValue(mockResults);

    const { result } = renderHook(() => useKnowledgeSearch({
      projectId: '123e4567-e89b-12d3-a456-426614174000'
    }), { wrapper });

    act(() => {
      result.current.search('test query');
    });

    expect(result.current.isSearching).toBe(true);

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
    });

    expect(searchKnowledgeBase).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
      'test query',
      5
    );
    expect(result.current.results).toEqual(mockResults);
    expect(result.current.hasResults).toBe(true);
  });

  it('should handle search errors', async () => {
    const error = new Error('API error');
    (searchKnowledgeBase as jest.Mock).mockRejectedValue(error);

    const { result } = renderHook(() => useKnowledgeSearch({
      projectId: '123e4567-e89b-12d3-a456-426614174000'
    }), { wrapper });

    act(() => {
      result.current.search('test query');
    });

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
    });

    expect(result.current.error).toBe('API error');
    expect(mockNotify.error).toHaveBeenCalled();
  });
});
```

### 2. Component Testing

```tsx
// src/components/knowledge-base/__tests__/KnowledgeBaseSearch.test.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KnowledgeBaseSearch } from '../KnowledgeBaseSearch';
import { DependencyProvider } from '@contexts/DependencyContext';
import * as apiHooks from '@hooks/useKnowledgeSearch';

// Mock the custom hook
jest.mock('@hooks/useKnowledgeSearch', () => ({
  useKnowledgeSearch: jest.fn()
}));

describe('KnowledgeBaseSearch component', () => {
  const mockSearch = jest.fn();
  const mockDebouncedSearch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock hook implementation
    (apiHooks.useKnowledgeSearch as jest.Mock).mockReturnValue({
      results: [],
      isSearching: false,
      hasResults: false,
      error: null,
      search: mockSearch,
      debouncedSearch: mockDebouncedSearch,
      clearSearch: jest.fn()
    });
  });

  const renderWithDependencies = (ui: React.ReactElement) => {
    const mockDeps = {
      notify: {
        info: jest.fn(),
        success: jest.fn(),
        warning: jest.fn(),
        error: jest.fn()
      },
      fileIcon: () => '📄',
      formatBytes: (bytes: number) => `${bytes} bytes`,
      formatDate: (date: string) => date
    };

    return render(
      <DependencyProvider services={mockDeps}>
        {ui}
      </DependencyProvider>
    );
  };

  it('should render search input and button', () => {
    renderWithDependencies(<KnowledgeBaseSearch projectId="test-project" />);

    expect(screen.getByPlaceholderText(/search knowledge base/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('should call debounced search on input change', () => {
    renderWithDependencies(<KnowledgeBaseSearch projectId="test-project" />);

    const input = screen.getByPlaceholderText(/search knowledge base/i);
    fireEvent.change(input, { target: { value: 'test query' } });

    expect(mockDebouncedSearch).toHaveBeenCalledWith('test query', 5);
  });

  it('should call search directly when button is clicked', () => {
    renderWithDependencies(<KnowledgeBaseSearch projectId="test-project" />);

    const input = screen.getByPlaceholderText(/search knowledge base/i);
    fireEvent.change(input, { target: { value: 'direct search' } });

    const button = screen.getByRole('button', { name: /search/i });
    fireEvent.click(button);

    expect(mockSearch).toHaveBeenCalledWith('direct search', 5);
  });

  it('should display loading state when searching', () => {
    // Override the mock to simulate searching state
    (apiHooks.useKnowledgeSearch as jest.Mock).mockReturnValue({
      results: [],
      isSearching: true,
      hasResults: false,
      error: null,
      search: mockSearch,
      debouncedSearch: mockDebouncedSearch,
      clearSearch: jest.fn()
    });

    renderWithDependencies(<KnowledgeBaseSearch projectId="test-project" />);

    expect(screen.getByText(/searching knowledge base/i)).toBeInTheDocument();
  });

  it('should display search results when available', () => {
    // Override the mock to include results
    (apiHooks.useKnowledgeSearch as jest.Mock).mockReturnValue({
      results: [
        {
          text: 'This is a test result',
          score: 0.85,
          file_info: { filename: 'test.pdf', file_type: 'pdf' }
        }
      ],
      isSearching: false,
      hasResults: true,
      error: null,
      search: mockSearch,
      debouncedSearch: mockDebouncedSearch,
      clearSearch: jest.fn()
    });

    renderWithDependencies(<KnowledgeBaseSearch projectId="test-project" />);

    expect(screen.getByText('This is a test result')).toBeInTheDocument();
    expect(screen.getByText('test.pdf')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });
});
```

### 3. End-to-End Testing

Use Playwright to test the application end-to-end:

```typescript
// e2e/knowledge-base.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Knowledge Base Component', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to a project page
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Wait for login to complete and redirect
    await page.waitForURL('/projects');

    // Navigate to a specific project
    await page.click('text=Test Project');
    await page.waitForSelector('#knowledgeBaseContainer');
  });

  test('should be able to search knowledge base', async ({ page }) => {
    // Ensure knowledge base component is visible
    await expect(page.locator('.knowledge-base-container')).toBeVisible();

    // Type in search input
    await page.fill('input[placeholder="Search knowledge base..."]', 'test query');
    await page.click('button:has-text("Search")');

    // Wait for search results
    await page.waitForSelector('.search-results');

    // Verify results appear
    const resultCards = page.locator('.search-results .card');
    await expect(resultCards).toHaveCount.greaterThan(0);

    // Click on a result
    await resultCards.first().click();

    // Verify modal appears
    await expect(page.locator('dialog[open]')).toBeVisible();

    // Click "Use in Chat" button
    await page.click('button:has-text("Use in Chat")');

    // Verify modal closes
    await expect(page.locator('dialog[open]')).not.toBeVisible();

    // Verify content was added to chat input
    const chatInput = page.locator('textarea[placeholder*="Send a message"]');
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toContain('Referring to content from');
  });
});
```

### 4. Regression Testing Script

As we migrate components, we need to ensure functionality is not lost:

```typescript
// scripts/compareComponentBehavior.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * This script compares the behavior of original JS components against
 * the new React TypeScript components by taking screenshots and
 * running functional tests in parallel
 */
async function compareComponentBehavior(componentName) {
  const browser = await chromium.launch();

  // Create contexts for original and new versions
  const originalContext = await browser.newContext();
  const newContext = await browser.newContext();

  const originalPage = await originalContext.newPage();
  const newPage = await newContext.newPage();

  // Navigate to test pages
  await originalPage.goto(`http://localhost:8000/test-original.html?component=${componentName}`);
  await newPage.goto(`http://localhost:3000/test-react.html?component=${componentName}`);

  // Wait for components to load
  await originalPage.waitForSelector('.component-ready');
  await newPage.waitForSelector('.component-ready');

  // Take initial screenshots
  const screenshotPath = path.join(__dirname, '../comparison-results');
  if (!fs.existsSync(screenshotPath)) {
    fs.mkdirSync(screenshotPath, { recursive: true });
  }

  await originalPage.screenshot({ path: `${screenshotPath}/${componentName}-original-initial.png` });
  await newPage.screenshot({ path: `${screenshotPath}/${componentName}-react-initial.png` });

  // Perform component-specific tests
  if (componentName === 'knowledge-base-search') {
    // Test search functionality
    for (const page of [originalPage, newPage]) {
      // Type search query
      await page.fill('input[placeholder*="Search knowledge base"]', 'test query');
      await page.click('button:has-text("Search")');

      // Wait for results
      await page.waitForSelector('.search-results');
    }

    // Take screenshots of search results
    await originalPage.screenshot({ path: `${screenshotPath}/${componentName}-original-results.png` });
    await newPage.screenshot({ path: `${screenshotPath}/${componentName}-react-results.png` });

    // Check result count
    const originalResultCount = await originalPage.locator('.search-results .card').count();
    const newResultCount = await newPage.locator('.search-results .card').count();

    console.log(`Original results: ${originalResultCount}, New results: ${newResultCount}`);
    if (originalResultCount !== newResultCount) {
      console.warn(`⚠️ Result counts differ: Original=${originalResultCount}, React=${newResultCount}`);
    }
  }

  await browser.close();
  console.log(`Comparison for ${componentName} completed. Check ${screenshotPath} for results.`);
}

// Run the test for specific components
const componentsToTest = [
  'knowledge-base-search',
  'knowledge-base'
];

(async () => {
  for (const component of componentsToTest) {
    console.log(`Comparing behavior for ${component}...`);
    await compareComponentBehavior(component);
  }
})();
```

## Recommended Migration Workflow Summary

1. **Preparatory Work: 2-3 weeks**
   - Setup TypeScript configuration and React project
   - Define key types (interfaces, types) for the domain model
   - Select migration order - start with leaf components first

2. **Phase 1 - Infrastructure: 2-3 weeks**
   - Create core React contexts for dependency injection
   - Implement service adapters (API, notification)
   - Set up testing infrastructure

3. **Phase 2 - Utility and Hooks: 2-3 weeks**
   - Convert utility functions to TypeScript
   - Build React hooks equivalent to factory functions
   - Write tests for hooks and utilities

4. **Phase 3 - Component Migration: 4-6 weeks**
   - Migrate smaller components first
   - Implement key shared components
   - Replace direct DOM manipulation with React patterns

5. **Phase 4 - Integration and Testing: 2-3 weeks**
   - Integrate components with the original app
   - Implement bridge layer for incremental adoption
   - Run visual and functional regression tests

6. **Phase 5 - Refinement: 2-3 weeks**
   - Replace DOM event system with React event handling
   - Enable stricter TypeScript checks
   - Clean up any remaining technical debt

## Files to Rename

Here's a list of key files that need to be migrated from `.js` to `.ts`/`.tsx`:

```
static/js/knowledgeBaseSearchHandler.js → src/hooks/useKnowledgeSearch.ts
static/js/knowledgeBaseManager.js → src/services/knowledgeBaseService.ts
static/js/knowledgeBaseComponent.js → src/components/knowledge-base/KnowledgeBase.tsx
static/js/eventHandler.js → src/services/eventService.ts
static/js/projectDashboard.js → src/components/project/ProjectDashboard.tsx
static/js/projectDashboardUtils.js → src/utils/projectUtils.ts
static/js/FileUploadComponent.js → src/components/common/FileUpload.tsx
static/js/notification-handler.js → src/services/notification.ts
static/js/app.js → src/App.tsx
```

## Conclusion

This migration strategy allows for a gradual transition from vanilla JavaScript to React with TypeScript while maintaining the existing functionality. The approach focuses on:

1. **Preserving the existing dependency injection pattern** by translating it to React's context system
2. **Incrementally converting components** by starting with leaf components and working up the tree
3. **Maintaining feature parity** through comprehensive testing at each stage
4. **Enabling strict typing gradually** to catch issues early without blocking progress

By following this roadmap, you can achieve a modern, type-safe React codebase that preserves the maintainability and separation of concerns from the original application while gaining the benefits of React's declarative approach and TypeScript's type safety.

Similar code found with 2 license types
