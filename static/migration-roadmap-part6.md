## Phase 3: Knowledge Base UI

In this phase, we'll convert the Knowledge Base UI to React components, focusing on state management with React hooks.

### Step 1: Define Types

**src/features/kb/types/index.ts**:
```typescript
export interface KbSearchParams {
  query: string;
  topK: number;
}

export interface KbFile {
  id: string;
  name: string;
  file_type: string;
  size: number;
  created_at: string;
  updated_at: string;
  is_processed: boolean;
}

export interface KbResult {
  id: string;
  text: string;
  score: number;
  file_info?: {
    filename: string;
    file_type: string;
  };
  metadata?: {
    file_name: string;
  };
}

export interface KnowledgeBase {
  id: string;
  name: string;
  project_id: string;
  is_active: boolean;
  embedding_model: string;
  version: string;
  last_used: string | null;
  stats: {
    file_count: number;
    chunk_count: number;
    unprocessed_files: number;
  }
}
```

### Step 2: Build React Hooks

**src/features/kb/hooks/useKbSearch.ts**:
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDeps } from '@/core/DependenciesProvider';
import type { KbSearchParams, KbResult } from '@/features/kb/types';

export function useKbSearch(projectId: string) {
  const { apiClient, notify } = useDeps();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['kb', 'search', projectId],
    mutationFn: async ({ query, topK }: KbSearchParams): Promise<KbResult[]> => {
      if (!query.trim() || query.length < 2) {
        return [];
      }

      try {
        const response = await apiClient(`/api/projects/${projectId}/knowledge-bases/search`, {
          method: "POST",
          body: { query, top_k: topK }
        });

        return Array.isArray(response?.data?.results)
          ? response.data.results
          : [];
      } catch (error) {
        notify.error("Search failed. Please try again.", {
          context: "kbSearch",
          source: "useKbSearch",
          originalError: error
        });
        throw error;
      }
    },
    onError: (error) => {
      notify.error(`Search operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        context: 'kbSearch',
        source: 'useKbSearch',
        originalError: error
      });
    }
  });
}
```

**src/features/kb/hooks/useKbStatus.ts**:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDeps } from '@/core/DependenciesProvider';
import type { KnowledgeBase } from '@/features/kb/types';

export function useKbStatus(projectId: string) {
  const { apiClient, notify } = useDeps();
  const queryClient = useQueryClient();

  // Get KB status
  const { data: kb, isLoading, error } = useQuery({
    queryKey: ['kb', 'status', projectId],
    queryFn: async (): Promise<KnowledgeBase | null> => {
      try {
        const response = await apiClient(`/api/projects/${projectId}/knowledge-bases`, {
          method: "GET"
        });

        // Handle various response formats
        const kbData = response?.data?.knowledge_base ??
                      response?.knowledge_base ??
                      (response?.id ? response : null);

        return kbData;
      } catch (error: any) {
        // Special case for "Project has no knowledge base"
        if (error?.message?.includes('Project has no knowledge base')) {
          return null; // Not an error, just doesn't exist yet
        }
        throw error;
      }
    },
    enabled: !!projectId
  });

  // Toggle KB active state
  const toggleMutation = useMutation({
    mutationFn: async (isActive: boolean): Promise<void> => {
      if (!kb) {
        // Create KB if it doesn't exist
        await apiClient(`/api/projects/${projectId}/knowledge-bases`, {
          method: "POST",
          body: {
            name: "Project Knowledge Base",
            is_active: isActive
          }
        });
      } else {
        // Update existing KB
        await apiClient(`/api/projects/${projectId}/knowledge-bases/${kb.id}`, {
          method: "PATCH",
          body: { is_active: isActive }
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb', 'status', projectId] });
      notify.success(`Knowledge base ${kb ? 'updated' : 'created'} successfully`, {
        context: 'kbStatus'
      });
    },
    onError: (error) => {
      notify.error(`Failed to ${kb ? 'update' : 'create'} knowledge base`, {
        context: 'kbStatus',
        originalError: error
      });
    }
  });

  return {
    kb,
    isLoading,
    error,
    toggleKbActive: toggleMutation.mutate
  };
}
