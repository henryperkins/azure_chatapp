/**
 * authUI.js — Authentication and Auth Modal UI enhancements.
 * Responsible for modular auth-related UI logic previously in inline scripts or eventHandler.js.
 * DI required: domAPI, eventHandlers, notify
 */

export function createAuthUI({ domAPI, eventHandlers, notify }) {
  if (!domAPI) throw new Error('[authUI] domAPI is required');
  if (!eventHandlers) throw new Error('[authUI] eventHandlers is required');
  if (!notify) throw new Error('[authUI] notify is required');

  /**
   * Initializes modal tab interaction within any modal dialogs.
   */
  function setupModalTabs() {
    const tabContainers = domAPI.querySelectorAll('.modal-tabs');
    tabContainers.forEach(container => {
      const tabs = domAPI.querySelectorAll(container, '.tab-link');
      const tabPanels = domAPI.querySelectorAll(container, '.tab-panel');

      tabs.forEach((tab, index) => {
        eventHandlers.trackListener(tab, 'click', (e) => {
          domAPI.preventDefault(e);
          tabs.forEach(t => domAPI.removeClass(t, 'active'));
          tabPanels.forEach(p => domAPI.addClass(p, 'hidden'));
          domAPI.addClass(tab, 'active');
          if (tabPanels[index]) domAPI.removeClass(tabPanels[index], 'hidden');
        }, { description: `Modal Tab ${index}`, module: 'authUI', context: 'modalTabs' });
      });

      // Activate first tab by default
      if (tabs.length > 0) domAPI.addClass(tabs[0], 'active');
      if (tabPanels.length > 0) domAPI.removeClass(tabPanels[0], 'hidden');
      for (let i = 1; i < tabPanels.length; i++) domAPI.addClass(tabPanels[i], 'hidden');
    });
  }

  /**
   * Stub: Client-side password validation and UI feedback.
   * Replace/extend as needed for real auth logic.
   */
  function setupPasswordValidation() {
    // Example: Add code for live password matching/validity markers
    // (Bare for now, as in most existing inline scripts)
  }

  function init() {
    setupModalTabs();
    setupPasswordValidation();
    notify.info('[authUI] authUI initialized', { group: true, context: 'authUI', module: 'authUI', source: 'init' });
  }

  return {
    init,
    setupModalTabs,
    setupPasswordValidation
  };
}
