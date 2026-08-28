const test = require('node:test');
const assert = require('node:assert/strict');
const { createDetector } = require('../detector-core.js');

function snapshot({ now, assistantBusy, sendVisible, stopVisible }) {
  return {
    now,
    userCount: 2,
    assistantCount: 2,
    lastAssistantSignature: 'reasoning',
    lastAssistantText: 'I need to inspect this first.',
    sendVisible,
    stopVisible,
    completionReady: false,
    assistantBusy,
    actionFingerprint: null,
    actionLabel: null
  };
}

test('does not complete reasoning when Stop disappears and Send returns while assistant stays busy', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 1000 });

  detector.scan({
    now: 0,
    userCount: 1,
    assistantCount: 1,
    lastAssistantSignature: 'old',
    lastAssistantText: 'Old response.',
    sendVisible: true,
    stopVisible: false,
    completionReady: true,
    assistantBusy: false,
    actionFingerprint: null,
    actionLabel: null
  });
  detector.markUserSubmitted(10);

  detector.scan(snapshot({
    now: 20,
    assistantBusy: true,
    sendVisible: false,
    stopVisible: true
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 120,
      assistantBusy: true,
      sendVisible: true,
      stopVisible: false
    })),
    []
  );

  assert.deepEqual(
    detector.scan(snapshot({
      now: 400,
      assistantBusy: true,
      sendVisible: true,
      stopVisible: false
    })),
    []
  );
});
