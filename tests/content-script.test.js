const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  assert.equal(context.__chatgptNotifierMonitor.version, '0.8.2');
  assert.equal(runtimeListenerCount, 1);
  context.__chatgptNotifierMonitor.stop();
});
