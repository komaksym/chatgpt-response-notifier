const MONITOR_RECOVERY_ALARM = 'chatgpt-notifier-monitor-recovery';

function isChatGPTPageUrl(url) {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(String(url || ''));
}

function scheduleMonitorRecovery() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create(MONITOR_RECOVERY_ALARM, { periodInMinutes: 1 });
}

scheduleMonitorRecovery();
ensureMonitors().catch((error) => {
  console.warn('Could not ensure ChatGPT monitors on service-worker start:', error);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['enabled', 'soundEnabled', 'soundVolume', 'tabMarkerEnabled'], (values) => {
    if (chrome.runtime.lastError) return;
    const defaults = {};
    if (typeof values.enabled !== 'boolean') defaults.enabled = true;
    if (typeof values.soundEnabled !== 'boolean') defaults.soundEnabled = true;
    if (!Number.isFinite(Number(values.soundVolume))) defaults.soundVolume = DEFAULT_SOUND_VOLUME;
    if (typeof values.tabMarkerEnabled !== 'boolean') defaults.tabMarkerEnabled = values.enabled !== false;
    if (Object.keys(defaults).length > 0) chrome.storage.local.set(defaults);
  });
  scheduleMonitorRecovery();
  ensureMonitors().catch((error) => {
    console.error('Could not inject ChatGPT monitors after install:', error);
  });
});

chrome.runtime.onStartup?.addListener(() => {
  scheduleMonitorRecovery();
  ensureMonitors().catch((error) => {
    console.error('Could not inject ChatGPT monitors on startup:', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.type === TEST_NOTIFICATION) {
    operation = runNotificationTest();
  } else if (message?.type === TEST_SOUND) {
    operation = runSoundTest();
  } else if (message?.type === ENSURE_MONITORS) {
    operation = ensureMonitors();
  } else if (message?.type === CHATGPT_EVENT) {
    operation = handleChatGPTEvent(message, sender);
  } else {
    return false;
  }

  operation
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        stage: 'exception',
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

chrome.notifications.onClicked.addListener((notificationId) => {
  focusNotificationSource(notificationId).catch((error) => {
    console.error('Could not focus ChatGPT tab:', error);
  });
});

chrome.notifications.onClosed?.addListener((notificationId) => {
  cancelNotificationClear(notificationId);
});

chrome.tabs?.onActivated?.addListener(({ tabId }) => {
  clearTabMarker(tabId).catch((error) => {
    console.warn('Could not clear marker from activated tab:', error);
  });
});

chrome.windows?.onFocusChanged?.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || !Number.isInteger(windowId)) return;
  tabsQuery({ active: true, windowId })
    .then((tabs) => Promise.all(tabs.map((tab) => clearTabMarker(tab.id))))
    .catch((error) => {
      console.warn('Could not clear marker from focused window:', error);
    });
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name !== MONITOR_RECOVERY_ALARM) return;
  ensureMonitors().catch((error) => {
    console.warn('Could not recover ChatGPT monitors:', error);
  });
});

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo?.status !== 'complete') return;
  if (!isChatGPTPageUrl(tab?.url)) return;
  ensureMonitor(tabId).catch((error) => {
    console.warn('Could not ensure ChatGPT monitor after tab update:', error);
  });
});
