const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPart2({ pingBehavior }) {
  let executeCount = 0;
  let lastError = null;
  const context = {
    console,
    Error,
    CONTENT_SCRIPT_FILES: ['content-script.js'],
    CHATGPT_URLS: ['https://chatgpt.com/*'],
    MARK_TAB: 'mark',
    CLEAR_TAB_MARKER: 'clear',
    runtimeError() {
      return lastError ? new Error(lastError) : null;
    },
    chrome: {
      tabs: {
        query(_query, callback) { callback([{ id: 7 }]); },
        sendMessage(tabId, message, callback) {
          const result = pingBehavior({ tabId, message, executeCount });
          lastError = result?.error || null;
          callback(result?.response);
          lastError = null;
        }
      },
      scripting: {
        executeScript(_details, callback) {
          executeCount += 1;
          lastError = null;
          callback();
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'service-worker', 'part2.js'), 'utf8'),
    context
  );
  return { context, getExecuteCount: () => executeCount };
}

test('keeps a healthy existing monitor instead of reinjecting it', async () => {
  const { context, getExecuteCount } = loadPart2({
    pingBehavior: () => ({ response: { ok: true, version: '0.8.8' } })
  });

  const result = await context.ensureMonitors();

  assert.equal(getExecuteCount(), 0);
  assert.equal(result.connectedTabs, 1);
  assert.equal(result.injectedTabs, 0);
  assert.equal(result.failures.length, 0);
});

test('injects a disconnected tab and verifies the new monitor', async () => {
  const { context, getExecuteCount } = loadPart2({
    pingBehavior: ({ executeCount }) => executeCount === 0
      ? { error: 'Receiving end does not exist.' }
      : { response: { ok: true, version: '0.8.8' } }
  });

  const result = await context.ensureMonitors();

  assert.equal(getExecuteCount(), 1);
  assert.equal(result.connectedTabs, 1);
  assert.equal(result.injectedTabs, 1);
  assert.equal(result.failures.length, 0);
});

test('reports a failed injection when the monitor still does not answer', async () => {
  const { context, getExecuteCount } = loadPart2({
    pingBehavior: () => ({ error: 'Receiving end does not exist.' })
  });

  const result = await context.ensureMonitors();

  assert.equal(getExecuteCount(), 1);
  assert.equal(result.ok, false);
  assert.equal(result.connectedTabs, 0);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /did not establish a connection/i);
});
