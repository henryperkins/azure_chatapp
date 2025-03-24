/**
 * animationUtils.js
 * Small utility module for animations and transitions
 */

const AnimationUtils = {
  /**
   * Animate a counter from start to end value
   */
  animateCounter(element, start, end, duration = 500) {
    if (!element) return;
    
    const startTime = performance.now();
    const update = (timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = Math.floor(progress * (end - start) + start);
      
      element.textContent = value.toLocaleString();
      
      if (progress < 1) requestAnimationFrame(update);
    };
    
    requestAnimationFrame(update);
  },
  
  /**
   * Animate a progress bar
   */
  animateProgress(element, start, end, duration = 500) {
    if (!element) return;
    
    const startTime = performance.now();
    const update = (timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = start + (progress * (end - start));
      
      element.style.width = `${value}%`;
      
      if (progress < 1) requestAnimationFrame(update);
    };
    
    requestAnimationFrame(update);
  }
};

// Export the module
window.AnimationUtils = AnimationUtils;