const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWorker({ tabActive = false, windowFocused = true } = {}) {
  let notificationOptions = null;
  const context = {
    console,
    Date,
    runtimeError: () => null,
    chrome: {
      windows: {
        get(_windowId, callback) {
          callback({ focused: windowFocused });
        }
      }
    },
    tabsGet: async () => ({ active: tabActive, windowId: 1 }),
    storageGet: async () => ({
      enabled: true,
      soundEnabled: false,
      tabMarkerEnabled: false
    }),
    storageSet: async () => {},
    markSourceTab: async () => ({ ok: true }),
    createNotification: async (_id, options) => {
      notificationOptions = options;
      return 'notification-id';
    },
    scheduleNotificationClear: () => {},
    playNotificationSound: async () => ({ ok: true })
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../service-worker/part3.js'), 'utf8'),
    context
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../service-worker/part4.js'), 'utf8'),
    context
  );

  return {
    context,
    getNotificationOptions: () => notificationOptions
  };
}

test('response notification heading includes the conversation title', async () => {
  const { context, getNotificationOptions } = loadWorker();

  await context.handleChatGPTEvent(
    {
      event: { type: 'response_complete', message: 'The response preview.' },
      page: {
        title: 'ChatGPT Notifier Customization',
        url: 'https://chatgpt.com/c/test'
      }
    },
    {
      tab: {
        id: 42,
        title: 'Fallback title',
        url: 'https://chatgpt.com/c/test'
      }
    }
  );

  assert.equal(
    getNotificationOptions().title,
    'Response ready · ChatGPT Notifier Customization'
  );
});

test('action notification heading includes the conversation title', async () => {
  const { context, getNotificationOptions } = loadWorker();

  await context.handleChatGPTEvent(
    {
      event: { type: 'action_required', message: 'Action needed: Allow' },
      page: {
        title: 'Deploy production app',
        url: 'https://chatgpt.com/c/test'
      }
    },
    {
      tab: {
        id: 42,
        title: 'Fallback title',
        url: 'https://chatgpt.com/c/test'
      }
    }
  );

  assert.equal(
    getNotificationOptions().title,
    'Action needed · Deploy production app'
  );
});


test('does not suppress a hidden source page even if tab APIs transiently report it active and focused', async () => {
  const { context, getNotificationOptions } = loadWorker({
    tabActive: true,
    windowFocused: true
  });

  const result = await context.handleChatGPTEvent(
    {
      event: { type: 'response_complete', message: 'Finished in the background.' },
      page: {
        title: 'Background task',
        url: 'https://chatgpt.com/c/test',
        visibilityState: 'hidden'
      }
    },
    {
      tab: {
        id: 42,
        title: 'Background task',
        url: 'https://chatgpt.com/c/test'
      }
    }
  );

  assert.equal(result.skipped, undefined);
  assert.equal(result.notificationId, 'notification-id');
  assert.ok(getNotificationOptions());
});
