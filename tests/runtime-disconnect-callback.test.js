const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApi() {
  let scans = 0;
  const context = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ChatGPTNotifierCore: {
      createDetector() {
        return {
          scan() {
            scans += 1;
            return scans === 1 ? [] : [{ type: 'response_complete', message: 'done' }];
          },
          getState() { return {}; },
          markUserSubmitted() {}
        };
      }
    },
    ChatGPTNotifierDomAdapter: {
      collectSnapshot() { return {}; },
      isComposerInput() { return false; },
      isSendControl() { return false; }
    },
    ChatGPTNotifierTabMarker: { createTabMarker() { throw new Error('use injected marker'); } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8'), context);
  return context.ChatGPTNotifierContent;
}

test('stops the monitor when sendMessage reports a disconnected runtime', () => {
  const api = loadApi();
  let observerDisconnected = false;
  let markerStopped = false;
  const chromeObject = {
    runtime: {
      onMessage: { addListener() {}, removeListener() {} },
      lastError: null,
      sendMessage(_payload, callback) {
        this.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        callback();
        this.lastError = null;
      }
    }
  };
  const documentObject = {
    title: 'ChatGPT', body: {}, documentElement: {},
    addEventListener() {}, removeEventListener() {}
  };
  const marker = {
    start() {}, stop() { markerStopped = true; }, sync() {}, getState() { return {}; }
  };
  const monitor = api.createMonitor({
    documentObject,
    windowObject: { location: { href: 'https://chatgpt.com/c/test' } },
    chromeObject,
    MutationObserverClass: class { observe() {} disconnect() { observerDisconnected = true; } },
    tabMarker: marker
  });

  monitor.start();
  monitor.scan('disconnect');

  assert.equal(observerDisconnected, true);
  assert.equal(markerStopped, true);
  assert.match(monitor.getDebug().lastDispatch.error, /receiving end does not exist/i);
});
