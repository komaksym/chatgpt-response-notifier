const test = require('node:test');
const assert = require('node:assert/strict');
const { createMonitor } = require('../content-script.js');

function makeMonitorHarness() {
  let intervalStarts = 0;
  let intervalClears = 0;
  let nowValue = 1000;
  const documentObject = {
    title: 'ChatGPT',
    body: {},
    documentElement: {},
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const windowObject = {
    location: { href: 'https://chatgpt.com/c/test' },
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; }
  };
  const chromeObject = {
    runtime: {
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage(_payload, callback) { callback({ ok: true }); },
      lastError: null
    }
  };
  const tabMarker = {
    start() {}, stop() {}, sync() {}, getState() { return {}; }, mark() {}, clear() {}
  };
  const monitor = createMonitor({
    documentObject,
    windowObject,
    chromeObject,
    MutationObserverClass: class { observe() {} disconnect() {} },
    tabMarker,
    now: () => nowValue,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    setIntervalFn: () => { intervalStarts += 1; return 99; },
    clearIntervalFn: () => { intervalClears += 1; }
  });
  return {
    monitor,
    setNow(value) { nowValue = value; },
    intervalStarts: () => intervalStarts,
    intervalClears: () => intervalClears
  };
}

test('heartbeat is idle until a response is pending', () => {
  const harness = makeMonitorHarness();
  harness.monitor.start();

  assert.equal(harness.intervalStarts(), 0);

  harness.setNow(2000);
  harness.monitor.markSubmission('test');

  assert.equal(harness.intervalStarts(), 1);
  harness.monitor.stop();
});

test('heartbeat stops after the pending response completes', () => {
  let intervalStarts = 0;
  let intervalClears = 0;
  let nowValue = 1000;
  let phase = 'idle';

  function button(testId) {
    return {
      disabled: false,
      getAttribute(name) {
        if (name === 'data-testid') return testId;
        return null;
      }
    };
  }

  const sendButton = button('send-button');
  const stopButton = button('stop-button');
  const copyButton = button('copy-turn-action-button');
  const oldAssistant = {
    innerText: 'Old response.',
    textContent: 'Old response.',
    getAttribute: () => null,
    querySelector: () => copyButton,
    querySelectorAll: () => []
  };
  const newAssistant = {
    innerText: 'Fresh response.',
    textContent: 'Fresh response.',
    getAttribute: () => null,
    querySelector: () => phase === 'final' ? copyButton : null,
    querySelectorAll: () => []
  };

  const documentObject = {
    title: 'ChatGPT',
    body: {},
    documentElement: {},
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') {
        return phase === 'idle' ? [oldAssistant] : [oldAssistant, newAssistant];
      }
      if (selector === '[data-message-author-role="user"]') {
        return phase === 'idle' ? [{}] : [{}, {}];
      }
      if (selector === 'button,[role="button"]') {
        if (phase === 'generating') return [stopButton];
        return [sendButton];
      }
      return [];
    }
  };
  const windowObject = {
    location: { href: 'https://chatgpt.com/c/test' },
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; }
  };
  const chromeObject = {
    runtime: {
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage(_payload, callback) { callback({ ok: true }); },
      lastError: null
    }
  };
  const tabMarker = {
    start() {}, stop() {}, sync() {}, getState() { return {}; }, mark() {}, clear() {}
  };
  const monitor = createMonitor({
    documentObject,
    windowObject,
    chromeObject,
    stableMs: 100,
    fallbackStableMs: 300,
    MutationObserverClass: class { observe() {} disconnect() {} },
    tabMarker,
    now: () => nowValue,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    setIntervalFn: () => { intervalStarts += 1; return 99; },
    clearIntervalFn: () => { intervalClears += 1; }
  });

  monitor.start();
  monitor.markSubmission('test');
  assert.equal(intervalStarts, 1);

  phase = 'generating';
  nowValue = 1100;
  monitor.scan('test-generating');
  assert.equal(intervalClears, 0);

  phase = 'final';
  nowValue = 1300;
  monitor.scan('test-final');

  assert.equal(intervalClears, 1);
  monitor.stop();
});
