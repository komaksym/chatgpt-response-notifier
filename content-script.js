(function initContentScript(root, factory) {
  const detectorCore =
    typeof module === 'object' && module.exports
      ? require('./detector-core.js')
      : root.ChatGPTNotifierCore;
  const domAdapter =
    typeof module === 'object' && module.exports
      ? require('./dom-adapter.js')
      : root.ChatGPTNotifierDomAdapter;
  const tabMarkerModule =
    typeof module === 'object' && module.exports
      ? require('./tab-marker.js')
      : root.ChatGPTNotifierTabMarker;

  const api = factory(detectorCore, domAdapter, tabMarkerModule);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierContent = api;

  if (
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    typeof chrome !== 'undefined' &&
    chrome.runtime
  ) {
    const existingMonitor = root.__chatgptNotifierMonitor;
    if (existingMonitor) {
      try {
        existingMonitor.stop?.();
      } catch (error) {
        console.warn('Could not stop the stale ChatGPT notifier monitor:', error);
      }
      root.__chatgptNotifierMonitor = null;
    }

    root.__chatgptNotifierMonitor = api.createMonitor({
      documentObject: document,
      windowObject: window,
      chromeObject: chrome,
      MutationObserverClass: MutationObserver
    });
    root.__chatgptNotifierMonitor.start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function contentFactory(detectorCore, domAdapter, tabMarkerModule) {
  const CONTENT_SCRIPT_VERSION = '0.8.8';
  const { createDetector } = detectorCore;
  const { collectSnapshot, isComposerInput, isSendControl } = domAdapter;
  const { createTabMarker } = tabMarkerModule;

  function createMonitor({
    documentObject,
    windowObject,
    chromeObject,
    stableMs = 1400,
    fallbackStableMs = 4500,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    MutationObserverClass,
    tabMarker = null
  }) {
    let detector = createDetector({ stableMs, fallbackStableMs });
    let currentUrl = windowObject.location.href;
    let observer = null;
    let immediateTimer = null;
    let settleTimer = null;
    let heartbeatTimer = null;
    let started = false;
    let lastSnapshot = null;
    let lastDispatch = null;
    let lastScanReason = 'not-started';
    let lastSubmissionAt = -Infinity;
    const resolvedTabMarker = tabMarker || createTabMarker({ documentObject, windowObject });

    function resetForRoute(url) {
      const submissionTimestamp = lastSubmissionAt;
      currentUrl = url;
      detector = createDetector({ stableMs, fallbackStableMs });
      if (now() - submissionTimestamp <= 10000) {
        detector.markUserSubmitted(submissionTimestamp);
      } else {
        lastSubmissionAt = -Infinity;
      }
      lastSnapshot = null;
      lastDispatch = null;
    }

    function failDispatch(event, error) {
      lastDispatch = {
        ok: false,
        error: error instanceof Error ? error.message : String(error || 'Extension runtime unavailable.'),
        event,
        timestamp: now()
      };
      stop();
    }

    function sendEvent(event) {
      const payload = {
        type: 'CHATGPT_EVENT',
        event,
        page: {
          title: documentObject.title || 'ChatGPT',
          url: windowObject.location.href
        }
      };
      const runtime = chromeObject?.runtime;

      if (!runtime?.sendMessage) {
        failDispatch(event, 'Extension runtime unavailable.');
        return;
      }

      try {
        runtime.sendMessage(payload, (response) => {
          const error = runtime.lastError;
          if (error) {
            lastDispatch = { ok: false, error: error.message, event, timestamp: now() };
            if (/context invalidated|receiving end does not exist|could not establish connection/i.test(error.message || '')) {
              stop();
            }
            return;
          }
          lastDispatch = {
            ok: Boolean(response?.ok),
            skipped: response?.skipped || null,
            error: response?.error || null,
            event,
            timestamp: now()
          };
        });
      } catch (error) {
        failDispatch(event, error);
      }
    }

    function syncHeartbeat() {
      if (!started) return;
      const state = detector.getState();
      const pending = state.awaitingResponse || state.generating;

      if (pending && heartbeatTimer === null) {
        heartbeatTimer = setIntervalFn(() => scan('heartbeat'), 2000);
      } else if (!pending && heartbeatTimer !== null) {
        clearIntervalFn(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function scan(reason = 'manual') {
      const url = windowObject.location.href;
      if (url !== currentUrl) {
        resetForRoute(url);
        reason = `${reason}:route-reset`;
      }

      resolvedTabMarker.sync();
      const snapshot = collectSnapshot(documentObject, windowObject, now());
      const events = detector.scan(snapshot);
      lastSnapshot = snapshot;
      lastScanReason = reason;
      events.forEach(sendEvent);
      syncHeartbeat();
      return events;
    }

    function scheduleScan(reason = 'mutation') {
      if (immediateTimer !== null) clearTimeoutFn(immediateTimer);
      if (settleTimer !== null) clearTimeoutFn(settleTimer);

      immediateTimer = setTimeoutFn(() => {
        immediateTimer = null;
        scan(reason);
      }, 80);

      settleTimer = setTimeoutFn(() => {
        settleTimer = null;
        scan(`${reason}:settled`);
      }, stableMs + 250);
    }

    function markSubmission(reason) {
      const timestamp = now();
      if (timestamp - lastSubmissionAt < 600) return;
      lastSubmissionAt = timestamp;
      detector.markUserSubmitted(timestamp);
      syncHeartbeat();
      lastScanReason = `submission:${reason}`;
      scheduleScan(`submission:${reason}`);
    }

    function clickListener(event) {
      const control = event?.target?.closest?.('button,[role="button"]') || event?.target;
      if (isSendControl(control)) markSubmission('click');
    }

    function keydownListener(event) {
      if (
        event?.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        isComposerInput(event.target)
      ) {
        markSubmission('enter');
      }
    }

    function submitListener(event) {
      const activeElement = documentObject.activeElement;
      const formHasComposer = Boolean(
        event?.target?.querySelector?.('textarea,[contenteditable="true"],[role="textbox"]')
      );
      if (formHasComposer || isComposerInput(activeElement)) {
        markSubmission('submit');
      }
    }

    function runtimeMessageListener(message, _sender, sendResponse) {
      if (message?.type === 'CHATGPT_NOTIFIER_MARK_TAB') {
        const marked = resolvedTabMarker.mark(message.eventType);
        sendResponse({ ok: true, marked, state: resolvedTabMarker.getState() });
        return false;
      }
      if (message?.type === 'CHATGPT_NOTIFIER_CLEAR_TAB_MARKER') {
        const cleared = resolvedTabMarker.clear();
        sendResponse({ ok: true, cleared, state: resolvedTabMarker.getState() });
        return false;
      }
      if (message?.type !== 'CHATGPT_NOTIFIER_PING') return false;
      sendResponse({
        ok: true,
        version: CONTENT_SCRIPT_VERSION,
        url: windowObject.location.href,
        title: documentObject.title || 'ChatGPT',
        state: detector.getState(),
        tabMarker: resolvedTabMarker.getState(),
        lastSnapshot,
        lastDispatch,
        lastScanReason
      });
      return false;
    }

    function start() {
      if (started) return;
      started = true;
      chromeObject.runtime.onMessage.addListener(runtimeMessageListener);
      resolvedTabMarker.start();
      documentObject.addEventListener?.('click', clickListener, true);
      documentObject.addEventListener?.('keydown', keydownListener, true);
      documentObject.addEventListener?.('submit', submitListener, true);
      scan('initial');
      if (!started) return;

      observer = new MutationObserverClass(() => scheduleScan('mutation'));
      observer.observe(documentObject.documentElement || documentObject.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'aria-label',
          'aria-disabled',
          'disabled',
          'data-message-author-role',
          'data-testid'
        ]
      });
    }

    function stop() {
      if (!started) return;
      started = false;
      observer?.disconnect();
      observer = null;
      if (immediateTimer !== null) clearTimeoutFn(immediateTimer);
      if (settleTimer !== null) clearTimeoutFn(settleTimer);
      if (heartbeatTimer !== null) clearIntervalFn(heartbeatTimer);
      immediateTimer = null;
      settleTimer = null;
      heartbeatTimer = null;
      resolvedTabMarker.stop();
      documentObject.removeEventListener?.('click', clickListener, true);
      documentObject.removeEventListener?.('keydown', keydownListener, true);
      documentObject.removeEventListener?.('submit', submitListener, true);
      try {
        chromeObject?.runtime?.onMessage?.removeListener?.(runtimeMessageListener);
      } catch (error) {
        console.warn('Could not remove stale ChatGPT notifier runtime listener:', error);
      }
    }

    function getDebug() {
      return {
        version: CONTENT_SCRIPT_VERSION,
        url: windowObject.location.href,
        title: documentObject.title || 'ChatGPT',
        state: detector.getState(),
        tabMarker: resolvedTabMarker.getState(),
        lastSnapshot,
        lastDispatch,
        lastScanReason
      };
    }

    return {
      version: CONTENT_SCRIPT_VERSION,
      start,
      stop,
      scan,
      scheduleScan,
      markSubmission,
      getDebug
    };
  }

  return { createMonitor, version: CONTENT_SCRIPT_VERSION };
});
