const test = require('node:test');
const assert = require('node:assert/strict');
const { collectSnapshot } = require('../dom-adapter.js');
const { createDetector } = require('../detector-core.js');

function turn(text) {
  const content = { innerText: text, textContent: text };
  return {
    innerText: text,
    textContent: text,
    querySelectorAll: (selector) =>
      selector.includes('.markdown') || selector.includes('.whitespace-pre-wrap')
        ? [content]
        : []
  };
}

test('detects a completed response through current data-turn markup', () => {
  const users = [turn('Old prompt.')];
  const assistants = [turn('Old response.')];
  const root = { innerText: 'Old prompt. Old response.', textContent: 'Old prompt. Old response.' };
  const documentObject = {
    body: root,
    querySelector: (selector) => selector === 'main' ? root : null,
    querySelectorAll(selector) {
      if (selector === '[data-turn="assistant"]') return assistants;
      if (selector === '[data-turn="user"]') return users;
      if (selector === 'button,[role="button"]') return [];
      return [];
    }
  };
  const windowObject = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  };
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  detector.scan(collectSnapshot(documentObject, windowObject, 0));

  users.push(turn('New prompt.'));
  root.innerText = root.textContent = 'Old prompt. Old response. New prompt.';
  detector.scan(collectSnapshot(documentObject, windowObject, 1000));

  assistants.push(turn('Fresh response.'));
  root.innerText = root.textContent = 'Old prompt. Old response. New prompt. Fresh response.';
  detector.scan(collectSnapshot(documentObject, windowObject, 1100));

  assert.deepEqual(
    detector.scan(collectSnapshot(documentObject, windowObject, 1300)),
    [{ type: 'response_complete', message: 'Fresh response.' }]
  );
});
