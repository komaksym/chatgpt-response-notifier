const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EVENT_NAME,
  install,
  isConversationRequest
} = require('../network-probe.js');

function makeRoot(fetchImpl) {
  const events = [];
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  return {
    root: {
      location: { href: 'https://chatgpt.com/' },
      fetch: fetchImpl,
      CustomEvent,
      dispatchEvent(event) {
        events.push(event);
      }
    },
    events
  };
}

function streamingResponse(chunks) {
  let index = 0;
  return {
    clone() {
      return {
        body: {
          getReader() {
            return {
              async read() {
                if (index >= chunks.length) return { done: true, value: undefined };
                const value = chunks[index];
                index += 1;
                return { done: false, value };
              },
              releaseLock() {}
            };
          }
        }
      };
    }
  };
}

test('matches only POST ChatGPT conversation requests', () => {
  const root = { location: { href: 'https://chatgpt.com/' } };

  assert.equal(isConversationRequest(root, '/backend-api/conversation', { method: 'POST' }), true);
  assert.equal(isConversationRequest(root, '/backend-api/f/conversation', { method: 'post' }), true);
  assert.equal(isConversationRequest(root, '/backend-api/foo/conversation/123', { method: 'POST' }), true);
  assert.equal(isConversationRequest(root, '/backend-api/conversation', { method: 'GET' }), false);
  assert.equal(isConversationRequest(root, '/backend-api/conversations', { method: 'POST' }), false);
  assert.equal(
    isConversationRequest(root, 'https://example.com/backend-api/conversation', { method: 'POST' }),
    false
  );
});

test('records only started, first_chunk, terminal lifecycle metadata', async () => {
  const secret = Buffer.from('super-secret-response-text');
  const response = streamingResponse([secret, Buffer.from('second chunk')]);
  const { root, events } = makeRoot(async () => response);

  assert.equal(install(root), true);
  const returned = await root.fetch('/backend-api/conversation', { method: 'POST' });
  assert.equal(returned, response);

  await new Promise((resolve) => setImmediate(resolve));

  const lifecycle = events
    .filter((event) => event.type === EVENT_NAME)
    .map((event) => JSON.parse(event.detail));

  assert.deepEqual(lifecycle.map((event) => event.type), ['started', 'first_chunk', 'terminal']);
  for (const event of lifecycle) {
    assert.deepEqual(Object.keys(event).sort(), ['at', 'requestId', 'type']);
  }
  assert.equal(JSON.stringify(lifecycle).includes('super-secret-response-text'), false);
});

test('records error lifecycle without serializing the error or response body', async () => {
  const { root, events } = makeRoot(async () => {
    throw new Error('secret network failure text');
  });

  install(root);
  await assert.rejects(
    root.fetch('/backend-api/f/conversation', { method: 'POST' }),
    /secret network failure text/
  );

  const lifecycle = events.map((event) => JSON.parse(event.detail));
  assert.deepEqual(lifecycle.map((event) => event.type), ['started', 'error']);
  assert.equal(JSON.stringify(lifecycle).includes('secret network failure text'), false);
});

test('probe source never reads or decodes response chunk contents', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'network-probe.js'), 'utf8');
  assert.doesNotMatch(source, /result\.value/);
  assert.doesNotMatch(source, /TextDecoder/);
  assert.doesNotMatch(source, /\.text\s*\(/);
  assert.doesNotMatch(source, /\.json\s*\(/);
});
