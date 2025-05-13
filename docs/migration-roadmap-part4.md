3. **domAPI.ts**
```typescript
// src/core/domAPI.ts
export interface DomAPI {
  getDocument(): Document;
  querySelector: (selector: string, parent?: Element | Document) => Element | null;
  querySelectorAll: (selector: string, parent?: Element | Document) => NodeListOf<Element>;
  getElementById: (id: string) => HTMLElement | null;
  createElement: (tag: string) => HTMLElement;
  appendChild: (parent: Element | Document, child: Element) => void;
  replaceChildren: (element: Element, ...nodes: (Node | string)[]) => void;
  setInnerHTML: (element: Element, html: string) => void;
  addClass: (element: Element | null, className: string) => void;
  removeClass: (element: Element | null, className: string) => void;
  setTextContent: (element: Element | null, text: string) => void;
  preventDefault: (event: Event) => void;
  dispatchEvent: (target: Document | Element, event: Event) => void;
}

export function createDomAPI(): DomAPI {
  return {
    getDocument: () => document,
    querySelector: (selector, parent = document) => parent.querySelector(selector),
    querySelectorAll: (selector, parent = document) => parent.querySelectorAll(selector),
    getElementById: (id) => document.getElementById(id),
    createElement: (tag) => document.createElement(tag),
    appendChild: (parent, child) => parent.appendChild(child),
    replaceChildren: (element, ...nodes) => {
      element.textContent = '';
      nodes.forEach(node => {
        if (typeof node === 'string') {
          element.appendChild(document.createTextNode(node));
        } else {
          element.appendChild(node);
        }
      });
    },
    setInnerHTML: (element, html) => {
      element.innerHTML = html;
    },
    addClass: (element, className) => element?.classList.add(className),
    removeClass: (element, className) => element?.classList.remove(className),
    setTextContent: (element, text) => {
      if (element) element.textContent = text;
    },
    preventDefault: (event) => event.preventDefault(),
    dispatchEvent: (target, event) => target.dispatchEvent(event),
  };
}
```

4. **errorReporting.ts**
```typescript
// src/core/errorReporting.ts
export interface ErrorCapture {
  module: string;
  method?: string;
  source?: string;
  context?: string;
  originalError?: unknown;
  [key: string]: any;
}

export interface ErrorReporter {
  capture(error: unknown, metadata: ErrorCapture): void;
}

export function maybeCapture(
  reporter: ErrorReporter | null | undefined,
  error: unknown,
  metadata: ErrorCapture
): void {
  if (reporter?.capture) {
    reporter.capture(error, metadata);
  }
}
```

## Phase 2: React App Shell & DI System

We'll now build the React app shell and adapt our DI system to work with React's component tree.

### App Shell

**src/App.tsx**:
```tsx
import React, { useState, useEffect } from 'react';
import { DependenciesProvider } from '@/core/DependenciesProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createDomAPI } from '@core/domAPI';
import { AppRoutes } from '@/routes';

// Legacy compatibility - acts as a bridge to the class-based modules
import { initializeLegacyBridge } from '@legacy/legacyBridge';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: 1,
    },
  },
});

function App() {
  const [isLegacyBridgeReady, setLegacyBridgeReady] = useState(false);

  useEffect(() => {
    // Initialize the legacy compatibility layer
    initializeLegacyBridge().then(() => {
      setLegacyBridgeReady(true);
    });
  }, []);

  if (!isLegacyBridgeReady) {
    return <div className="loading">Initializing application...</div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <DependenciesProvider legacyDomApi={createDomAPI()}>
        <AppRoutes />
      </DependenciesProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
