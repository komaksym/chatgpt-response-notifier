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
      conversationSignature: 'new-complete',
      completionReady: true
    })),
    [{ type: 'response_complete', message: 'Fresh response.' }]
  );
});

test('infers a new submission when a user message is appended to an established conversation', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  detector.scan(snapshot({
    now: 0,
    userCount: 1,
    assistantCount: 1,
    assistantSignature: 'old-assistant',
    assistantText: 'Old response.',
    conversationSignature: 'old-complete'
  }));
  detector.scan(snapshot({
    now: 1000,
    userCount: 2,
    assistantCount: 1,
    assistantSignature: 'old-assistant',
    assistantText: 'Old response.',
    conversationSignature: 'new-user'
  }));
  detector.scan(snapshot({
    now: 1100,
    userCount: 2,
    assistantCount: 2,
    assistantSignature: 'new-assistant',
    assistantText: 'Fresh response.',
    conversationSignature: 'new-complete'
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 1300,
      userCount: 2,
      assistantCount: 2,
      assistantSignature: 'new-assistant',
      assistantText: 'Fresh response.',
      conversationSignature: 'new-complete',
      completionReady: true
    })),
    [{ type: 'response_complete', message: 'Fresh response.' }]
  );
});

test('does not complete on stable reasoning text before the final response action appears', () => {
  const detector = createDetector({ stableMs: 100, fallbackStableMs: 300 });

  detector.scan(snapshot({
    now: 0,
    userCount: 1,
    assistantCount: 1,
    assistantSignature: 'old-assistant',
    assistantText: 'Old response.',
    conversationSignature: 'old-complete',
    completionReady: true
  }));
  detector.markUserSubmitted(10);

  detector.scan(snapshot({
    now: 20,
    userCount: 2,
    assistantCount: 1,
    assistantSignature: 'old-assistant',
    assistantText: 'Old response.',
    conversationSignature: 'new-user',
    sendVisible: false,
    stopVisible: true
  }));

  detector.scan(snapshot({
    now: 40,
    userCount: 2,
    assistantCount: 2,
    assistantSignature: 'reasoning-sentence',
    assistantText: 'I need to inspect the edge cases first.',
    conversationSignature: 'reasoning-sentence-visible',
    sendVisible: false,
    stopVisible: false,
    completionReady: false
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 400,
      userCount: 2,
      assistantCount: 2,
      assistantSignature: 'reasoning-sentence',
      assistantText: 'I need to inspect the edge cases first.',
      conversationSignature: 'reasoning-sentence-visible',
      sendVisible: false,
      stopVisible: false,
      completionReady: false
    })),
    []
  );

  detector.scan(snapshot({
    now: 500,
    userCount: 2,
    assistantCount: 2,
    assistantSignature: 'final-answer',
    assistantText: 'Here is the final answer.',
    conversationSignature: 'final-answer-visible',
    sendVisible: true,
    stopVisible: false,
    completionReady: false
  }));

  assert.deepEqual(
    detector.scan(snapshot({
      now: 650,
      userCount: 2,
      assistantCount: 2,
      assistantSignature: 'final-answer',
      assistantText: 'Here is the final answer.',
      conversationSignature: 'final-answer-visible',
      sendVisible: true,
      stopVisible: false,
      completionReady: true
    })),
    [{ type: 'response_complete', message: 'Here is the final answer.' }]
  );
});
