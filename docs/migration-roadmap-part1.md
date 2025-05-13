# Frontend Migration Roadmap: JavaScript to React + TypeScript

This document outlines a comprehensive, phased approach to migrating our current JavaScript frontend to a modern React + TypeScript architecture. The plan preserves our existing dependency injection approach while leveraging React's component hierarchy and TanStack Query for server state management.

## Table of Contents

- [Existing Architecture Analysis](#existing-architecture-analysis)
- [Migration Approach](#migration-approach)
- [Phase 0: Foundation Setup](#phase-0-foundation-setup)
- [Phase 1: Core TypeScript Utilities](#phase-1-core-typescript-utilities)
- [Phase 2: React App Shell & DI System](#phase-2-react-app-shell--di-system)
- [Phase 3: Knowledge Base UI](#phase-3-knowledge-base-ui)
- [Phase 4: Project, Chat & Sidebar Components](#phase-4-project-chat--sidebar-components)
- [Phase 5: Teardown Legacy Code](#phase-5-teardown-legacy-code)
- [Folder Structure](#folder-structure)
- [TypeScript Configuration](#typescript-configuration)
- [Testing Strategy](#testing-strategy)
- [Code Examples](#code-examples)

## Existing Architecture Analysis

Our current frontend architecture follows a factory-based dependency injection pattern where components are initialized with their dependencies. Key characteristics include:

### Data Flow
- **Factory Pattern**: Modules export factory functions (`createKnowledgeBaseComponent`, `createChatManager`, etc.) that accept dependencies and return component instances
- **Event Bus**: Components communicate via DOM CustomEvents (`projectsLoaded`, `authStateChanged`, etc.)
- **API Wrapper**: Centralized `apiClient.js` handles requests, CSRF tokens, and error reporting

### Dependency Injection
- A `DependencySystem` singleton acts as a central registry for modules
- Components validate dependencies in constructors, with clear error messages for missing deps
- Named contexts for event listeners via `trackListener(el, event, handler, { context: MODULE_CONTEXT })`
- Module-scoped notifiers created with `notify.withContext({ context:'module', module:'Module' })`

### DOM Interaction
- DOM elements accessed via injected `domAPI` abstraction, not direct document references
- Element access follows pattern: `reqEl(key, selector)` or `domAPI.getElementById(id)`
- Safety via `_safeSetInnerHTML` wrapper for sanitization

### State Management
- Internal component state (`this.state = { ... }`) not shared outside component boundaries
- Local caching of repeated API calls (search results, project lists)
- Server as source of truth for most data
