/**
 * Lightweight knowledge base status checker
 */
class KnowledgeBaseState {
  constructor() {
    // No caching needed - ChatManager handles context
  }

  /**
   * Verify knowledge base status for a project
   * @param {string} projectId - Project ID to check
   * @returns {Promise<{exists: boolean, isActive: boolean}>}
   */
  async verifyKB(projectId) {
    try {
      const response = await window.app.apiRequest(
        `/api/projects/${projectId}/knowledge-base-status`,
        "GET"
      );
      return response.data || { exists: false, isActive: false };
    } catch (error) {
      console.error('KB verification failed:', error);
      return { exists: false, isActive: false };
    }
  }

  /**
   * Check if KB should be recommended for these files
   * @param {File[]} files - Files to check
   * @returns {boolean}
   */
  shouldRecommendForFiles(files) {
    // Check if user dismissed recommendation recently
    const dismissed = localStorage.getItem('kbRecommendDismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 86400000) {
      return false;
    }

    // Only recommend for text-based files
    return files.some(f =>
      f.type.match(/text|pdf|doc|markdown/i)
    );
  }

  /**
   * Check if KB recommendation should be shown
   * @param {string} projectId - Project ID
   * @param {File[]} files - Files to check
   * @returns {Promise<boolean>}
   */
  async shouldRecommendKB(projectId, files) {
    const [kbState, hasTextFiles] = await Promise.all([
      this.verifyKB(projectId),
      this.shouldRecommendForFiles(files)
    ]);

    return !kbState.exists && hasTextFiles;
  }
}

// Singleton instance
window.knowledgeBaseState = new KnowledgeBaseState();
