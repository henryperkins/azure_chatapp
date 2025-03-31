/**
 * Centralized knowledge base state management
 */
class KnowledgeBaseState {
  constructor() {
    this._cache = new Map();
  }

  async verifyKB(projectId) {
    try {
      // Check cache first
      if (this._cache.has(projectId)) {
        return { ...this._cache.get(projectId), fromCache: true };
      }

      // Verify with backend
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-base-status`,
        "GET"
      );

      // Cache result
      this._cache.set(projectId, response.data);
      return response.data;
    } catch (error) {
      console.error('KB verification failed:', error);
      return { 
        exists: false, 
        isActive: false,
        error: error.response?.status === 404 ? 'ENDPOINT_NOT_FOUND' : 'API_ERROR'
      };
    }
  }

  invalidateCache(projectId) {
    this._cache.delete(projectId);
  }

  /**
   * Check if KB should be recommended for these files
   * @param {File[]} files
   * @returns {boolean}
   */
  shouldRecommendForFiles(files) {
    const dismissed = localStorage.getItem('kbRecommendDismissed');
    if (dismissed && Date.now() - dismissed < 86400000) { // 24 hours
      return false;
    }
    return files.some(f => f.type.match(/text|pdf|doc|markdown/i));
  }

  /**
   * Check if KB recommendation should be shown
   * @param {string} projectId
   * @param {File[]} files
   * @returns {Promise<boolean>}
   */
  async shouldRecommendKB(projectId, files) {
    try {
      const kbState = await this.verifyKB(projectId);
      if (kbState.exists) return false;
      
      // Only recommend for text-based files
      return files.some(f =>
        f.type.match(/text|pdf|doc|markdown/i)
      );
    } catch (error) {
      console.error('KB recommendation check failed:', error);
      return false;
    }
  }
}

// Singleton instance
window.knowledgeBaseState = new KnowledgeBaseState();