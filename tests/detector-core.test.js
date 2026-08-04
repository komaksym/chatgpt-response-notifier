const test = require('node:test');
const assert = require('node:assert/strict');
const { createDetector } = require('../detector-core.js');

function snapshot({
  now,
  userCount = 0,
  assistantCount = 0,
  assistantSignature = '',
  assistantText = '',
  conversationSignature = '',
  sendVisible = true,
  stopVisible = false
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
    actionFingerprint: null,
    actionLabel: null
  };
}

test('does not notify when an existing conversation hydrates after opening it', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  assert.deepEqual(detector.scan(snapshot({ now: 0 })), []);
  assert.deepEqual(
    detector.scan(snapshot({
      now: 10,
      userCount: 1,
      conversationSignature: 'historical-user'
    })),
    []
  );
  assert.deepEqual(
    detector.scan(snapshot({
      now: 20,
      userCount: 1,
      assistantCount: 1,
      assistantSignature: 'historical-assistant',
      assistantText: 'A response the user already viewed.',
      conversationSignature: 'historical-complete'
    })),
    []
  );
  assert.deepEqual(
    detector.scan(snapshot({
      now: 200,
      userCount: 1,
      assistantCount: 1,
      assistantSignature: 'historical-assistant',
      assistantText: 'A response the user already viewed.',
      conversationSignature: 'historical-complete'
    })),
    []
  );
});

test('still notifies after an explicit local submission completes', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  detector.scan(snapshot({ now: 0 }));
  detector.markUserSubmitted(10);
  detector.scan(snapshot({
    now: 20,
    userCount: 1,
    conversationSignature: 'new-user',
    sendVisible: false,
    stopVisible: true
  }));
  detector.scan(snapshot({
    now: 40,
    userCount: 1,
    assistantCount: 1,
    assistantSignature: 'new-assistant',
    assistantText: 'Fresh response.',
    conversationSignature: 'new-complete',
    sendVisible: false,
    stopVisible: true
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 200,
      userCount: 1,
      assistantCount: 1,
      assistantSignature: 'new-assistant',
      assistantText: 'Fresh response.',
      conversationSignature: 'new-complete'
    })),
    [{ type: 'response_complete', message: 'Fresh response.' }]
  );
});
