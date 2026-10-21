/**
 * Register before page scripts attach window-capture shortcuts. The main bundle
 * still defers DOM work to document_idle to avoid disrupting page hydration.
 * Inactive/disabled frames have no subscribers and leave every event alone.
 */
window.VSC = window.VSC || {};

if (!window.VSC.keyboardDispatcher) {
  const handlers = new Set();
  const dispatch = (event) => {
    for (const handler of handlers) {
      handler(event);
    }
  };
  window.addEventListener('keydown', dispatch, true);
  window.addEventListener('keyup', dispatch, true);
  window.addEventListener('mousedown', dispatch, true);
  window.addEventListener('mouseup', dispatch, true);
  window.addEventListener('auxclick', dispatch, true);
  window.VSC.keyboardDispatcher = {
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
