const MODULE = 'KBAPIService';

export function createKnowledgeBaseAPIService({ apiClient, logger } = {}) {
  if (typeof apiClient !== 'function') throw new Error(`[${MODULE}] Missing apiClient`);
  if (!logger) logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  const _get  = (url, opts = {}) => apiClient(url, { method: 'GET',    ...opts });
  const _post = (url, body, opts = {}) => apiClient(url, { method: 'POST',   body, ...opts });
  const _patch= (url, body, opts = {}) => apiClient(url, { method: 'PATCH',  body, ...opts });
  const _del  = (url, opts = {}) => apiClient(url, { method: 'DELETE', ...opts });

  return Object.freeze({
    toggleKnowledgeBase: (projectId, enable) => _post(`/api/projects/${projectId}/knowledge-bases/toggle`, { enable }),
    createKnowledgeBase : (projectId, payload) => _post(`/api/projects/${projectId}/knowledge-bases`, payload),
    updateKnowledgeBase : (projectId, kbId, payload) => _patch(`/api/projects/${projectId}/knowledge-bases/${kbId}`, payload),
    deleteKnowledgeBase : (projectId, kbId) => _del(`/api/projects/${projectId}/knowledge-bases/${kbId}`),

    reprocessFiles      : (projectId) => _post(`/api/projects/${projectId}/knowledge-base/reindex`, { force: true }),

    listFiles           : (projectId, kbId) => _get(`/api/projects/${projectId}/knowledge-bases/${kbId}/files`),
    deleteFile          : (projectId, kbId, fileId) => _del(`/api/projects/${projectId}/knowledge-bases/${kbId}/files/${fileId}`),

    getHealth           : (projectId, kbId, detailed = true) => _get(`/api/projects/${projectId}/knowledge-bases/${kbId}/status${detailed ? '?detailed=true' : ''}`),

    search              : (projectId, kbId, query, topK = 5) => {
      const path = kbId ? `/api/projects/${projectId}/knowledge-bases/${kbId}/search`
                        : `/api/projects/${projectId}/knowledge-bases/search`;
      return _post(path, { query, top_k: topK });
    },

    attachRepo          : (projectId, kbId, payload) => _post(`/api/projects/${projectId}/knowledge-bases/${kbId}/github/attach`, payload),
    detachRepo          : (projectId, kbId, repoUrl) => _post(`/api/projects/${projectId}/knowledge-bases/${kbId}/github/detach`, { repo_url: repoUrl })
  });
}

export { createKnowledgeBaseAPIService };
export default createKnowledgeBaseAPIService;