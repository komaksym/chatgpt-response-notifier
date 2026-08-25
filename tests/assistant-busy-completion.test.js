const test = require('node:test');
const assert = require('node:assert/strict');
const { createDetector } = require('../detector-core.js');
const { collectSnapshot } = require('../dom-adapter.js');

function snapshot({
  now,
  userCount = 0,
  assistantCount = 0,
  assistantSignature = '',
  assistantText = '',
  sendVisible = true,
  stopVisible = false,
  completionReady = false,
  assistantBusy = false
}) {
  return {
    now,
    userCount,
    assistantCount,
    lastAssistantSignature: assistantSignature,
    lastAssistantText: assistantText,
    sendVisible,
    stopVisible,
    completionReady,
    assistantBusy,
    actionFingerprint: null,
    actionLabel: null
  };
}

test('background completion can finish from assistant busy true to false without Copy or control lifecycle', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  detector.scan(snapshot({
    now: 0,
    userCount: 1,
    assistantCount: 1,
    assistantSignature: 'old',
    assistantText: 'Old response.',
    completionReady: true
  }));
  detector.markUserSubmitted(10);

  detector.scan(snapshot({
    now: 20,
    userCount: 2,
    assistantCount: 2,
    assistantSignature: 'draft',
    assistantText: 'Draft response.',
    assistantBusy: true,
    sendVisible: false,
    stopVisible: true
  }));
  detector.scan(snapshot({
    now: 120,
    userCount: 2,
    assistantCount: 2,
    assistantSignature: 'final',
    assistantText: 'Final response.',
    assistantBusy: false,
    sendVisible: false,
    stopVisible: true
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 260,
      userCount: 2,
      assistantCount: 2,
      assistantSignature: 'final',
      assistantText: 'Final response.',
      assistantBusy: false,
      sendVisible: false,
      stopVisible: true
    })),
    [{ type: 'response_complete', message: 'Final response.' }]
  );
});

test('reasoning does not complete when Stop disappears and Send returns while assistant is still busy', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  detector.scan(snapshot({
    now: 0,
    userCount: 1,
    assistantCount: 1,
    assistantSignature: 'old',
    assistantText: 'Old response.',
    completionReady: true
  }));
  detector.markUserSubmitted(10);

  detector.scan(snapshot({
    now: 20,
    userCount: 2,
    assistantCount: 2,
    assistantSignature: 'reasoning',
    assistantText: 'I need to inspect this first.',
    assistantBusy: true,
    sendVisible: false,
    stopVisible: true
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 120,
      userCount: 2,
      assistantCount: 2,
      assistantSignature: 'reasoning',
      assistantText: 'I need to inspect this first.',
      assistantBusy: true,
      sendVisible: true,
      stopVisible: false
    })),
    []
  );
});

test('DOM snapshot exposes aria-busy from the active assistant node', () => {
  const content = {
    innerText: 'Working response.',
    textContent: 'Working response.'
  };
  const assistant = {
    innerText: 'Working response.',
    textContent: 'Working response.',
    getAttribute(name) {
      if (name === 'aria-busy') return 'true';
      return null;
    },
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector.includes('.markdown') ? [content] : [];
    }
  };
  const root = {
    innerText: 'Prompt Working response.',
    textContent: 'Prompt Working response.'
  };
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
  const windowObject = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  };

  const result = collectSnapshot(documentObject, windowObject, 1);
  assert.equal(result.assistantBusy, true);
});

test('DOM snapshot falls back to aria-busy on the outer conversation turn', () => {
  const content = {
    innerText: 'Working response.',
    textContent: 'Working response.'
  };
  const wrapper = {
    getAttribute(name) {
      if (name === 'aria-busy') return 'true';
      return null;
    }
  };
  const assistant = {
    innerText: 'Working response.',
    textContent: 'Working response.',
    getAttribute: () => null,
    closest(selector) {
      return selector.includes('[data-turn="assistant"]') ? wrapper : null;
    },
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector.includes('.markdown') ? [content] : [];
    }
  };
  const root = {
    innerText: 'Prompt Working response.',
    textContent: 'Prompt Working response.'
  };
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
  const windowObject = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  };

  const result = collectSnapshot(documentObject, windowObject, 1);
  assert.equal(result.assistantBusy, true);
});
