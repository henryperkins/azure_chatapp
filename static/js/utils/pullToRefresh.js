export function createPullToRefresh({
  element, onRefresh,
  eventHandlers, domAPI, browserService,
  threshold = 70, ctx = 'pull-to-refresh'
}) {
  if (!element || element.dataset.ptrBound === '1') return;
  element.dataset.ptrBound = '1';

  let startY = 0;
  let currentY = 0;
  let isPulling = false;
  let refreshTriggered = false;

  // Create pull indicator element if not present
  let pullIndicator = domAPI.getElementById?.('pullToRefreshIndicator_' + (element.id || ''));
  if (!pullIndicator) {
    pullIndicator = domAPI.createElement('div');
    pullIndicator.id = 'pullToRefreshIndicator_' + (element.id || Math.random().toString(36).slice(2));
    pullIndicator.className = 'pull-indicator';
    domAPI.setInnerHTML(pullIndicator, `
      <div class="mobile-loading-indicator"></div>
      <span class="ml-2">Pull to refresh</span>
    `);
    if (element.parentElement) {
      domAPI.insertBefore(element.parentElement, pullIndicator, element.parentElement.firstChild);
    } else {
      domAPI.appendChild(element, pullIndicator);
    }
  }

  function reset() {
    domAPI.setStyle(pullIndicator, 'transform', 'translateY(-50px)');
    domAPI.removeClass(pullIndicator, 'visible');
    isPulling = false;
    refreshTriggered = false;
  }

  // Touch start handler
  const handleTouchStart = (e) => {
    if (element.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      isPulling = true;
    }
  };

  // Touch move handler
  const handleTouchMove = (e) => {
    if (!isPulling) return;

    currentY = e.touches[0].clientY;
    const pullDistance = currentY - startY;

    if (pullDistance > 0) {
      const pullPercent = Math.min(pullDistance / 100, 1);
      domAPI.setStyle(pullIndicator, 'transform', `translateY(${pullDistance / 2}px)`);
      if (pullDistance > 20) {
        domAPI.addClass(pullIndicator, 'visible');
      }
      if (pullDistance > threshold && !refreshTriggered) {
        domAPI.setInnerHTML(pullIndicator, `
          <div class="mobile-loading-indicator"></div>
          <span class="ml-2">Release to refresh</span>
        `);
      }
      e.preventDefault();
    }
  };

  // Touch end handler
  const handleTouchEnd = (e) => {
    if (!isPulling) return;

    const pullDistance = currentY - startY;

    if (pullDistance > threshold) {
      refreshTriggered = true;
      domAPI.setInnerHTML(pullIndicator, `
        <div class="mobile-loading-indicator animate-spin"></div>
        <span class="ml-2">Refreshing...</span>
      `);
      Promise.resolve(onRefresh?.()).finally(() => {
        browserService.setTimeout(reset, 1000);
      });
    } else {
      reset();
    }
  };

  eventHandlers.trackListener(
    element,
    'touchstart',
    handleTouchStart,
    { context: ctx }
  );
  eventHandlers.trackListener(
    element,
    'touchmove',
    handleTouchMove,
    { context: ctx }
  );
  eventHandlers.trackListener(
    element,
    'touchend',
    handleTouchEnd,
    { context: ctx }
  );

  return {
    cleanup() {
      eventHandlers.cleanupListeners({ context: ctx });
      element.dataset.ptrBound = '';
    }
  };
}
