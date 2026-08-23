const test = require('node:test');
const assert = require('node:assert/strict');
const { createMonitor } = require('../content-script.js');

function turn(text, completed = false) {
  const content = { innerText: text, textContent: text };
  return {
    innerText: text,
    textContent: text,
    querySelector: (selector) =>
      completed && selector === 'button[data-testid="copy-turn-action-button"]'
        ? { disabled: false }
        : null,
    querySelectorAll: (selector) =>
      selector.includes('.markdown') || selector.includes('.whitespace-pre-wrap')
        ? [content]
        : []
  };
}

test('stops cleanly when the extension runtime disappears before dispatch', () => {
  let now = 0;
  let observerDisconnected = false;
  let markerStopped = false;
  const removedEvents = [];
  const users = [turn('Old prompt.')];
  const assistants = [turn('Old response.', true)];
  const documentObject = {
    title: 'ChatGPT',
    body: {},
    documentElement: {},
    addEventListener() {},
    removeEventListener(type) { removedEvents.push(type); },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '[data-turn="assistant"]') return assistants;
      if (selector === '[data-turn="user"]') return users;
      if (selector === 'button,[role="button"]') return [];
      return [];
    }
  };
  const windowObject = {
    location: { href: 'https://chatgpt.com/c/test' },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    }
  };
  const chromeObject = {
    runtime: {
      onMessage: {
        addListener() {},
        removeListener() {}
      },
      sendMessage(_message, callback) { callback({ ok: true }); },
      lastError: null
    }
  };
  const tabMarker = {
    start() {},
    stop() { markerStopped = true; },
    sync() {},
    getState() { return {}; }
  };
  const monitor = createMonitor({
    documentObject,
    windowObject,
    chromeObject,
    stableMs: 0,
    fallbackStableMs: 0,
    now: () => now,
    MutationObserverClass: class {
      observe() {}
      disconnect() { observerDisconnected = true; }
    },
    tabMarker,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {}
  });

  monitor.start();
  now = 10;
  monitor.markSubmission('test');
  users.push(turn('New prompt.'));
  assistants.push(turn('Fresh response.', true));
  chromeObject.runtime = undefined;
  now = 20;

  assert.doesNotThrow(() => monitor.scan('runtime-invalidated'));
  assert.equal(observerDisconnected, true);
  assert.equal(markerStopped, true);
  assert.deepEqual(removedEvents.sort(), ['click', 'keydown', 'submit']);
  assert.equal(monitor.getDebug().lastDispatch?.ok, false);
});
