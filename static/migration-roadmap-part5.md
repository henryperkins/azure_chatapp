p### Dependency Provider Context

**src/core/DependenciesProvider.tsx**:
```tsx
import React, { createContext, useContext, useMemo } from "react";
import { createApiClient } from "@/core/apiClient";
import { createNotify } from "@/core/notify";
import { createBrowserService } from "@/core/browserService";
import type { DomAPI } from "@/core/domAPI";
import type { ApiClient } from "@/core/apiClient";
import type { NotifyContextual } from "@/core/notify";
import type { BrowserService } from "@/core/browserService";
import type { ErrorReporter } from "@/core/errorReporting";

export interface Deps {
  apiClient: ApiClient;
  notify: NotifyContextual;
  browserService: BrowserService;
  domAPI: DomAPI; // thin wrapper used only by legacy shims
  errorReporter: ErrorReporter;
}

// Internal context - not exported
const DepsContext = createContext<Deps | null>(null);

// Configuration for creating dependencies
interface DependenciesProviderProps {
  children: React.ReactNode;
  legacyDomApi: DomAPI; // injected once for bridge code
  errorReporter?: ErrorReporter;
  appConfig?: Record<string, any>;
}

export const DependenciesProvider: React.FC<DependenciesProviderProps> = ({
  children,
  legacyDomApi,
  errorReporter,
  appConfig = {}
}) => {
  // Build dependencies once - never recreate them on render
  const deps = useMemo<Deps>(() => {
    // Set up global utils (simplified for example)
    const globalUtils = {
      shouldSkipDedup: () => false,
      isAbsoluteUrl: (url: string) => /^https?:\/\//.test(url),
      stableStringify: (obj: any) => JSON.stringify(obj),
    };

    // Set up auth module getter
    const getAuthModule = () => ({
      getCSRFToken: () => document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || null
    });

    // Create the actual dependency services
    const browserService = createBrowserService();
    const notify = createNotify({ module: "global" });

    // Create API client with all dependencies it needs
    const apiClient = createApiClient({
      APP_CONFIG: appConfig,
      globalUtils,
      getAuthModule,
      browserService,
      notify,
      errorReporter
    });

    return {
      apiClient,
      notify,
      browserService,
      domAPI: legacyDomApi,
      errorReporter: errorReporter || {
        capture: (err, metadata) => console.error('Error captured:', err, metadata)
      }
    };
  }, [legacyDomApi, errorReporter, appConfig]);

  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
};

// Typed hook for consuming dependencies
export function useDeps(): Deps {
  const ctx = useContext(DepsContext);
  if (!ctx) throw new Error("useDeps must be used within <DependenciesProvider>");
  return ctx;
}
```

### Legacy Bridge for Hybrid Operation

**src/legacy/legacyBridge.ts**:
```typescript
import { DependencySystem } from './DependencySystem';

// Import legacy JS modules (with type definitions) to register them
import './modules/projectManager';
import './modules/eventHandlers';
import './modules/auth';
// ...other legacy modules

// This function initializes the legacy modules and wires them together
export async function initializeLegacyBridge(): Promise<void> {
  return new Promise((resolve) => {
    // Create temporary DOM node for the global event listener
    const initListener = () => {
      DependencySystem.modules.delete('_initBridgeListener');
      resolve();
    };

    // Register initialization listener
    DependencySystem.modules.set('_initBridgeListener', initListener);

    // Initialize legacy modules
    DependencySystem.initialize({
      debug: true,
      onReady: () => {
        console.info('Legacy dependency system initialized');
        DependencySystem.modules.get('_initBridgeListener')?.();
      }
    });
  });
}

// Access to legacy systems for React components that need them
export function getLegacyModule<T>(moduleName: string): T | null {
  return DependencySystem.modules.get(moduleName) as T || null;
}
