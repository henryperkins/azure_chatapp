**vite.config.ts**:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@legacy': path.resolve(__dirname, './src/legacy'),
      '@core': path.resolve(__dirname, './src/core'),
      '@features': path.resolve(__dirname, './src/features'),
      '@layout': path.resolve(__dirname, './src/layout'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
});
```

## Phase 1: Core TypeScript Utilities

### Strategy
Create strongly-typed versions of core utilities with minimal logic changes. We'll migrate utilities first because they're the foundation for other components.

### Files to Convert

1. **apiClient.ts**
```typescript
// src/core/apiClient.ts
import { maybeCapture } from '@core/errorReporting';
import type { ErrorReporter } from '@core/errorReporting';
import type { NotifyContextual } from '@core/notify';

interface ApiClientDeps {
  APP_CONFIG: {
    BASE_API_URL?: string;
    DEBUG?: boolean;
    TIMEOUTS?: {
      API_REQUEST?: number;
    };
  };
  globalUtils: {
    shouldSkipDedup: (url: string) => boolean;
    isAbsoluteUrl: (url: string) => boolean;
    stableStringify: (obj: any) => string;
  };
  getAuthModule: () => {
    getCSRFToken: () => string | null;
  } | null;
  browserService: {
    normaliseUrl: (url: string) => string;
    fetch?: typeof fetch;
    windowObject?: {
      AbortController?: typeof AbortController;
    };
  };
  notify: NotifyContextual;
  errorReporter?: ErrorReporter;
}

export type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string | number | boolean>;
  signal?: AbortSignal;
};

export type ApiClient = (url: string, opts?: ApiRequestOptions, skipCache?: boolean) => Promise<any>;

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const { APP_CONFIG, globalUtils, getAuthModule, browserService, notify, errorReporter } = deps;
  const pending = new Map<string, Promise<any>>();
  const BASE_URL = APP_CONFIG?.BASE_API_URL || '';

  return async function apiRequest(url: string, opts: ApiRequestOptions = {}, skipCache = false): Promise<any> {
    const method = (opts.method || "GET").toUpperCase();

    // Rest of implementation preserved but with proper typing
    // This preserves existing logic while adding type safety

    return {}; // Simplified for example
  };
}
```

2. **notify.ts**
```typescript
// src/core/notify.ts
export interface NotifyOptions {
  group?: boolean;
  context?: string;
  module?: string;
  source?: string;
  originalError?: unknown;
  extra?: Record<string, any>;
}

export interface NotifyMethod {
  (message: string, options?: NotifyOptions): void;
}

export interface NotifyContextual {
  debug: NotifyMethod;
  info: NotifyMethod;
  warn: NotifyMethod;
  error: NotifyMethod;
  success: NotifyMethod;
  withContext(ctx: { context?: string; module?: string }): NotifyContextual;
}

export function createNotify(baseContext: { module: string }): NotifyContextual {
  const methods = ['debug', 'info', 'warn', 'error', 'success'] as const;

  // Create base notifier
  const notifier = methods.reduce((acc, method) => {
    acc[method] = (message: string, options: NotifyOptions = {}) => {
      // Implementation preserved but with type safety
      console[method === 'success' ? 'info' : method](message, {
        ...baseContext,
        ...options,
      });
    };
    return acc;
  }, {} as Record<typeof methods[number], NotifyMethod>) as NotifyContextual;

  // Add context creator method
  notifier.withContext = (ctx) => {
    return createNotify({ ...baseContext, ...ctx });
  };

  return notifier;
}
