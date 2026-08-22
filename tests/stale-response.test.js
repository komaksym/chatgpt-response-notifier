const test = require('node:test');
const assert = require('node:assert/strict');
const { createDetector } = require('../detector-core.js');

function snapshot({
  now,
  userCount = 1,
  assistantCount = 1,
  assistantSignature = 'old-assistant',
  assistantText = 'Yesterday response.',
  conversationSignature = 'old-complete',
  sendVisible = true,
  stopVisible = false,
  completionReady = false
}) {
  return {
    now,
    userCount,
    assistantCount,
    lastAssistantSignature: assistantSignature,
    lastAssistantText: assistantText,
    conversationSignature,
    conversationTail: assistantText,
    sendVisible,
    stopVisible,
    completionReady,
    actionFingerprint: null,
    actionLabel: null
  };
}

test('does not report the pre-submission assistant response as the new completion', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  assert.deepEqual(detector.scan(snapshot({ now: 0 })), []);

  detector.markUserSubmitted(10);
  assert.deepEqual(
    detector.scan(snapshot({
      now: 20,
      userCount: 2,
      conversationSignature: 'new-user',
      sendVisible: false
    })),
    []
  );

  assert.deepEqual(
    detector.scan(snapshot({
      now: 150,
      userCount: 2,
      conversationSignature: 'new-user'
    })),
    []
  );

  detector.scan(snapshot({
    now: 200,
    userCount: 2,
    assistantCount: 2,
    assistantSignature: 'new-assistant',
    assistantText: 'Today response.',
    conversationSignature: 'new-complete',
    stopVisible: true,
    sendVisible: false
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 350,
      userCount: 2,
      assistantCount: 2,
      assistantSignature: 'new-assistant',
      assistantText: 'Today response.',
      conversationSignature: 'new-complete',
      completionReady: true
    })),
    [{ type: 'response_complete', message: 'Today response.' }]
  );
});
