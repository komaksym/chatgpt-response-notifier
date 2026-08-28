const test = require('node:test');
const assert = require('node:assert/strict');
const { collectSnapshot } = require('../dom-adapter.js');
const { createDetector } = require('../detector-core.js');

function messageTurn(text, completed = false) {
  const content = { innerText: text, textContent: text };
  return {
    innerText: text,
    textContent: text,
    querySelector: (selector) =>
      completed && selector === 'button[data-testid="copy-turn-action-button"]'
        ? { disabled: false }
        : null,
    querySelectorAll: (selector) =>
      selector.includes('.markdown') || selector.includes('[data-message-content]')
        ? [content]
        : []
  };
}

function thinkingTurn(label = 'Thinking…') {
  return {
    innerText: label,
    textContent: label,
    getAttribute: (name) => name === 'data-turn' ? 'assistant' : null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

test('does not complete a response while the new assistant turn is only thinking', () => {
  const users = [messageTurn('Old prompt.')];
  const assistants = [messageTurn('Old response.')];
  const root = {
    innerText: 'Old prompt. Old response.',
    textContent: 'Old prompt. Old response.'
  };
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
  detector.markUserSubmitted(1000);

  users.push(messageTurn('New prompt.'));
  root.innerText = root.textContent = 'Old prompt. Old response. New prompt.';
  assert.deepEqual(detector.scan(collectSnapshot(documentObject, windowObject, 1010)), []);

  assistants.push(thinkingTurn());
  root.innerText = root.textContent = 'Old prompt. Old response. New prompt. Thinking…';
  assert.deepEqual(detector.scan(collectSnapshot(documentObject, windowObject, 1100)), []);

  assert.deepEqual(detector.scan(collectSnapshot(documentObject, windowObject, 2000)), []);

  assistants[1] = messageTurn('Fresh response.', true);
  root.innerText = root.textContent = 'Old prompt. Old response. New prompt. Fresh response.';
  assert.deepEqual(detector.scan(collectSnapshot(documentObject, windowObject, 2100)), []);

  assert.deepEqual(
    detector.scan(collectSnapshot(documentObject, windowObject, 2300)),
    [{ type: 'response_complete', message: 'Fresh response.' }]
  );
});
