const test = require('node:test');
const assert = require('node:assert/strict');
const { collectSnapshot } = require('../dom-adapter.js');

const windowObject = {
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
};

test('collectSnapshot does not serialize the whole conversation root', () => {
  const content = {
    innerText: 'Fresh final response.',
    textContent: 'Fresh final response.'
  };
  const copyButton = { disabled: false, getAttribute: () => null };
  const assistant = {
    querySelector: (selector) => selector.includes('copy-turn-action-button') ? copyButton : null,
    querySelectorAll: (selector) => selector.includes('.markdown') ? [content] : [],
    getAttribute: () => null
  };
  const root = {};
  Object.defineProperty(root, 'innerText', {
    get() { throw new Error('whole conversation text was read'); }
  });
  Object.defineProperty(root, 'textContent', {
    get() { throw new Error('whole conversation text was read'); }
  });
  const documentObject = {
    body: root,
    querySelector: (selector) => selector === 'main' ? root : null,
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') return [assistant];
      if (selector === '[data-message-author-role="user"]') return [{}];
      if (selector === 'button,[role="button"]') return [];
      return [];
    }
  };

  const snapshot = collectSnapshot(documentObject, windowObject, 123);

  assert.equal(snapshot.lastAssistantText, 'Fresh final response.');
  assert.equal(snapshot.completionReady, true);
  assert.equal('conversationSignature' in snapshot, false);
  assert.equal('conversationTail' in snapshot, false);
});
