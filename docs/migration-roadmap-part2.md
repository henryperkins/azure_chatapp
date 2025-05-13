### Example: knowledgeBaseSearchHandler.js
This module demonstrates the current architecture's approaches:

1. Accepts context from parent component: `createKnowledgeBaseSearchHandler(ctx)`
2. Validates dependencies before operation: `if (!ctx.DependencySystem) throw new Error(...)`
3. Creates scoped notification context: `notify = ctx.notify.withContext({...})`
4. Uses debounced search with local cache: `debouncedSearch = ctx._debounce(searchKnowledgeBase, ...)`
5. DOM updates through safe wrappers: `ctx._safeSetInnerHTML(...)`
6. Event tracking with named contexts: `ctx.eventHandlers.trackListener(..., { context: ... })`

## Migration Approach

We'll follow these principles to ensure smooth, incremental migration:

1. **Gradual Type Safety**: Add TypeScript incrementally, starting with core utilities
2. **Parallel Operation**: Keep old and new systems running in parallel during transition
3. **Feature Parity**: Ensure each migrated component maintains identical functionality
4. **Clean Architecture**: Move toward React hooks and context instead of imperative DOM updates
5. **Type-First Design**: Define interfaces before implementation
6. **Progressive Enhancement**: Replace modules individually, maintaining compatibility
7. **Test-Driven Approach**: Create tests for existing functionality before migration

## Phase 0: Foundation Setup

### Setup Modern Toolchain
```bash
# Install core dependencies
npm install react react-dom react-router-dom
npm install -D vite typescript @types/react @types/react-dom
npm install @tanstack/react-query @tanstack/react-query-devtools
npm install -D vitest @testing-library/react @testing-library/jest-dom

# Setup TypeScript
npx tsc --init
```

### Project Structure Preparation

```bash
# Create src directories
mkdir -p src/core src/features/kb/components src/features/kb/hooks src/features/kb/types
mkdir -p src/features/projects src/features/chat src/layout
mkdir -p src/types src/utils

# Create legacy bridge directory
mkdir -p src/legacy
```

### Create Basic Configuration Files

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "esModuleInterop": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    /* Path aliases */
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@legacy/*": ["src/legacy/*"],
      "@core/*": ["src/core/*"],
      "@features/*": ["src/features/*"],
      "@layout/*": ["src/layout/*"],
      "@types/*": ["src/types/*"],
      "@utils/*": ["src/utils/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
