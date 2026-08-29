const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMonitor, version: CONTENT_SCRIPT_VERSION } = require('../content-script.js');

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

test('replaces an existing monitor when recovery scripts are injected', () => {
  let stopped = false;
  const existingMonitor = {
    version: CONTENT_SCRIPT_VERSION,
    stop() { stopped = true; }
  };
  const { context, runtimeListenerCount } = loadContentScriptWithExistingMonitor(existingMonitor);

  assert.equal(stopped, true);
  assert.notEqual(context.__chatgptNotifierMonitor, existingMonitor);
  assert.equal(context.__chatgptNotifierMonitor.version, CONTENT_SCRIPT_VERSION);
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


test('PING exposes text-free streamTrace lifecycle state', () => {
  let runtimeListener = null;
  const windowListeners = new Map();
  const documentObject = {
    title: 'ChatGPT',
    body: {},
    documentElement: {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const windowObject = {
    location: { href: 'https://chatgpt.com/c/test' },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type) { windowListeners.delete(type); },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    }
  };
  const chromeObject = {
    runtime: {
      onMessage: {
        addListener(listener) { runtimeListener = listener; },
        removeListener() {}
      },
      sendMessage(_message, callback) { callback({ ok: true }); },
      lastError: null
    }
  };
  const tabMarker = {
    start() {},
    stop() {},
    sync() {},
    getState() { return {}; }
  };
  const monitor = createMonitor({
    documentObject,
    windowObject,
    chromeObject,
    MutationObserverClass: class { observe() {} disconnect() {} },
    tabMarker
  });

  monitor.start();
  const lifecycleListener = windowListeners.get('__chatgpt_notifier_stream_lifecycle__');
  assert.equal(typeof lifecycleListener, 'function');

  lifecycleListener({
    detail: JSON.stringify({
      type: 'started',
      at: 100,
      requestId: '7',
      responseText: 'must-not-leak'
    })
  });
  lifecycleListener({
    detail: JSON.stringify({
      type: 'first_chunk',
      at: 110,
      requestId: '7',
      responseText: 'must-not-leak'
    })
  });
  lifecycleListener({
    detail: JSON.stringify({
      type: 'terminal',
      at: 200,
      requestId: '7',
      responseText: 'must-not-leak'
    })
  });

  let response = null;
  runtimeListener({ type: 'CHATGPT_NOTIFIER_PING' }, {}, (value) => { response = value; });

  assert.equal(response.ok, true);
  assert.equal(response.version, CONTENT_SCRIPT_VERSION);
  assert.deepEqual(response.streamTrace.events, [
    { type: 'started', at: 100, requestId: '7' },
    { type: 'first_chunk', at: 110, requestId: '7' },
    { type: 'terminal', at: 200, requestId: '7' }
  ]);
  assert.equal(response.streamTrace.lastTerminalAt, 200);
  assert.deepEqual(response.streamTrace.activeRequestIds, []);
  assert.equal(JSON.stringify(response.streamTrace).includes('must-not-leak'), false);

  monitor.stop();
});
