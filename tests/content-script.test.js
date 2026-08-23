const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMonitor } = require('../content-script.js');

function loadContentScriptWithExistingMonitor(existingMonitor) {
  const runtimeListeners = [];
  const documentObject = {
    title: 'ChatGPT',
    head: { appendChild() {} },
    body: {},
    documentElement: {},
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    createElement() { return { remove() {} }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const windowObject = {
    location: { href: 'https://chatgpt.com/c/test' },
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    }
  };
  const chromeObject = {
    runtime: {
      onMessage: {
        addListener(listener) { runtimeListeners.push(listener); },
        removeListener() {}
      },
      sendMessage(_message, callback) {
        callback({ ok: true });
      },
      lastError: null
    }
  };
  const context = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentObject,
    window: windowObject,
    chrome: chromeObject,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    __chatgptNotifierMonitor: existingMonitor
  };

  vm.createContext(context);
  for (const file of ['detector-core.js', 'page-utils.js', 'dom-adapter.js', 'tab-marker.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8'),
    context
  );

  return { context, runtimeListenerCount: runtimeListeners.length };
}

test('replaces a stale page monitor after the extension is reloaded', () => {
  let stopped = false;
  const { context, runtimeListenerCount } = loadContentScriptWithExistingMonitor({
    stop() { stopped = true; }
  });

  assert.equal(stopped, true);
  assert.equal(context.__chatgptNotifierMonitor.version, '0.8.5');
  assert.equal(runtimeListenerCount, 1);
  context.__chatgptNotifierMonitor.stop();
});

test('fully detaches a monitor when its extension runtime is already invalidated', () => {
  const removedEvents = [];
  let markerStopped = false;
  let observerDisconnected = false;
  const documentObject = {
    title: 'ChatGPT',
    body: {},
    documentElement: {},
    addEventListener() {},
    removeEventListener(type) { removedEvents.push(type); },
    querySelector() { return null; },
    querySelectorAll() { return []; }
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
        removeListener() {
          throw new Error('Extension context invalidated.');
        }
      },
      sendMessage() {},
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
    MutationObserverClass: class {
      observe() {}
      disconnect() { observerDisconnected = true; }
    },
    tabMarker,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });

  monitor.start();

  assert.doesNotThrow(() => monitor.stop());
  assert.equal(observerDisconnected, true);
  assert.equal(markerStopped, true);
  assert.deepEqual(removedEvents.sort(), ['click', 'keydown', 'submit']);
});
