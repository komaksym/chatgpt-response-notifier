const enabledElement = document.querySelector('#enabled');
const soundEnabledElement = document.querySelector('#sound-enabled');
const tabMarkerEnabledElement = document.querySelector('#tab-marker-enabled');
const soundVolumeElement = document.querySelector('#sound-volume');
const soundVolumeValueElement = document.querySelector('#sound-volume-value');
const permissionElement = document.querySelector('#permission');
const monitoredTabsElement = document.querySelector('#monitored-tabs');
const lastEventElement = document.querySelector('#last-event');
const lastEventDetailsElement = document.querySelector('#last-event-details');
const resultElement = document.querySelector('#details');
const testSoundButton = document.querySelector('#test-sound-button');
const testButton = document.querySelector('#test-button');
const captureDiagnosticsButton = document.querySelector('#capture-diagnostics-button');
const copyDiagnosticsButton = document.querySelector('#copy-diagnostics-button');
const repairMonitorsButton = document.querySelector('#repair-monitors-button');

let latestDiagnosticsText = '';

const CHATGPT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const DEFAULT_SOUND_VOLUME = 0.7;

function runtimeError() {
  return chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
}

function clampVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

function updateVolumeUi() {
  const volume = Math.round(clampVolume(Number(soundVolumeElement.value) / 100) * 100);
  soundVolumeValueElement.value = `${volume}%`;
  soundVolumeElement.disabled = !soundEnabledElement.checked;
  soundVolumeElement.closest('.volume-row')?.classList.toggle('disabled', !soundEnabledElement.checked);
}

function formatTime(timestamp) {
  if (!timestamp) return 'Unknown time';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function readPermissionLevel() {
  chrome.notifications.getPermissionLevel((level) => {
    const error = runtimeError();
    permissionElement.textContent = error ? 'Error' : level;
    if (error) resultElement.textContent = `Permission check failed: ${error}`;
  });
}

function readSettingsAndLastEvent() {
  chrome.storage.local.get({
    enabled: true,
    soundEnabled: true,
    soundVolume: DEFAULT_SOUND_VOLUME,
    tabMarkerEnabled: true,
    lastEvent: null
  }, (values) => {
    const error = runtimeError();
    if (error) {
      resultElement.textContent = `Storage read failed: ${error}`;
      return;
    }

    enabledElement.checked = values.enabled !== false;
    soundEnabledElement.checked = values.soundEnabled !== false;
    tabMarkerEnabledElement.checked = values.tabMarkerEnabled !== false;
    soundVolumeElement.value = String(Math.round(clampVolume(values.soundVolume) * 100));
    updateVolumeUi();

    const event = values.lastEvent;
    if (!event) {
      lastEventElement.textContent = 'None yet';
      lastEventDetailsElement.textContent = 'Send a new ChatGPT message to test detection.';
      return;
    }

    lastEventElement.textContent =
      event.type === 'action_required' ? 'Action required' : 'Response completed';
    lastEventDetailsElement.textContent = `${formatTime(event.timestamp)} · ${event.pageTitle || 'ChatGPT'}`;
  });
}

function pingTab(tab) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: 'CHATGPT_NOTIFIER_PING' }, (response) => {
      const error = runtimeError();
      resolve({
        tab,
        connected: !error && Boolean(response?.ok),
        error,
        response
      });
    });
  });
}

function ensureMonitors() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'ENSURE_MONITORS' }, (response) => {
      const error = runtimeError();
      resolve(error ? { ok: false, error } : response || { ok: false, error: 'No response' });
    });
  });
}

function describeTab(item, index) {
  const title = item.tab.title || `ChatGPT tab ${index + 1}`;
  if (!item.connected) {
    return `${index + 1}. ${title}\n   disconnected · ${item.error || 'no monitor response'}`;
  }

  const response = item.response || {};
  const state = response.state || {};
  const snapshot = response.lastSnapshot || {};
  return [
    `${index + 1}. ${title}`,
    `   v${response.version || '?'} · assistant/user ${snapshot.assistantCount ?? '?'}/${snapshot.userCount ?? '?'}`,
    `   send ${snapshot.sendVisible ? 'yes' : 'no'} · stop ${snapshot.stopVisible ? 'yes' : 'no'} · awaiting ${state.awaitingResponse ? 'yes' : 'no'} · generating ${state.generating ? 'yes' : 'no'}`,
    state.compatibilityIssue ? `   completion detection: ${state.compatibilityIssue}` : null,
    `   last scan: ${response.lastScanReason || 'unknown'}`
  ].filter(Boolean).join('\n');
}

function queryChatGptTabs() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ url: CHATGPT_URLS }, (tabs) => {
      const error = runtimeError();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(tabs);
    });
  });
}

function diagnosticTab(item) {
  const response = item.response || {};
  const state = response.state || {};
  const snapshot = response.lastSnapshot || {};
  return {
    tab: {
      id: item.tab.id,
      title: item.tab.title || null,
      url: item.tab.url || null,
      active: Boolean(item.tab.active),
      windowId: item.tab.windowId
    },
    connected: item.connected,
    error: item.error || null,
    version: response.version || null,
    state: {
      awaitingResponse: Boolean(state.awaitingResponse),
      generating: Boolean(state.generating),
      activityObserved: Boolean(state.activityObserved),
      assistantBusyObservedSinceSubmission: Boolean(state.assistantBusyObservedSinceSubmission),
      stopObservedSinceSubmission: Boolean(state.stopObservedSinceSubmission),
      compatibilityIssue: state.compatibilityIssue || null
    },
    lastSnapshot: {
      assistantCount: snapshot.assistantCount ?? null,
      userCount: snapshot.userCount ?? null,
      lastAssistantSignature: snapshot.lastAssistantSignature ?? null,
      lastAssistantText: snapshot.lastAssistantText ?? null,
      sendVisible: snapshot.sendVisible ?? null,
      stopVisible: snapshot.stopVisible ?? null,
      completionReady: snapshot.completionReady ?? null,
      assistantBusy: snapshot.assistantBusy ?? null,
      actionFingerprint: snapshot.actionFingerprint ?? null,
      actionLabel: snapshot.actionLabel ?? null
    },
    lastDispatch: response.lastDispatch || null,
    lastScanReason: response.lastScanReason || null
  };
}

async function refreshTabStatus({ repair = false } = {}) {
  monitoredTabsElement.textContent = 'Checking…';
  const injection = repair ? await ensureMonitors() : null;

  try {
    const tabs = await queryChatGptTabs();
    const results = await Promise.all(tabs.map(pingTab));
    const connected = results.filter((item) => item.connected);
    monitoredTabsElement.textContent = `${connected.length}/${tabs.length} connected`;

    if (tabs.length === 0) {
      resultElement.textContent = 'No open ChatGPT tabs.';
      return;
    }

    const summary = connected.length === tabs.length
      ? `Monitoring all ${connected.length} ChatGPT tab${connected.length === 1 ? '' : 's'}.`
      : `${connected.length} of ${tabs.length} ChatGPT tabs are connected.`;
    const injectionLine = repair
      ? injection?.ok
        ? `Monitor repair: ${injection.injectedTabs}/${injection.totalTabs} tabs injected.`
        : `Monitor repair failed: ${injection?.error || 'Unknown error'}`
      : 'Passive check only; no monitors were injected.';

    resultElement.textContent = [
      summary,
      injectionLine,
      '',
      ...results.map(describeTab)
    ].join('\n');
  } catch (error) {
    monitoredTabsElement.textContent = 'Error';
    resultElement.textContent = `Could not list ChatGPT tabs: ${error.message}`;
  }
}

async function captureDiagnostics() {
  captureDiagnosticsButton.disabled = true;
  copyDiagnosticsButton.disabled = true;
  resultElement.textContent = 'Capturing existing monitor state without repair or tab activation…';

  try {
    const tabs = await queryChatGptTabs();
    const results = await Promise.all(tabs.map(pingTab));
    const connected = results.filter((item) => item.connected);
    monitoredTabsElement.textContent = `${connected.length}/${tabs.length} connected`;

    const diagnostics = {
      capturedAt: new Date().toISOString(),
      mode: 'passive-no-repair',
      tabs: results.map(diagnosticTab)
    };
    latestDiagnosticsText = JSON.stringify(diagnostics, null, 2);
    resultElement.textContent = latestDiagnosticsText;
    copyDiagnosticsButton.disabled = false;
  } catch (error) {
    latestDiagnosticsText = '';
    resultElement.textContent = `Diagnostic capture failed: ${error.message}`;
  } finally {
    captureDiagnosticsButton.disabled = false;
  }
}

async function repairMonitors() {
  repairMonitorsButton.disabled = true;
  const injection = await ensureMonitors();
  if (!injection?.ok) {
    resultElement.textContent = `Monitor repair failed: ${injection?.error || 'Unknown error'}`;
    repairMonitorsButton.disabled = false;
    return;
  }
  await refreshTabStatus({ repair: false });
  resultElement.textContent = [
    `Monitor repair: ${injection.injectedTabs}/${injection.totalTabs} tabs injected.`,
    '',
    resultElement.textContent
  ].join('\n');
  repairMonitorsButton.disabled = false;
}

async function copyDiagnostics() {
  if (!latestDiagnosticsText) return;
  try {
    await navigator.clipboard.writeText(latestDiagnosticsText);
    copyDiagnosticsButton.textContent = 'Copied';
  } catch (error) {
    resultElement.textContent = [
      latestDiagnosticsText,
      '',
      `Clipboard copy failed: ${error.message}. Select the JSON above and copy it manually.`
    ].join('\n');
  }
}

function sendTestNotification() {
  testButton.disabled = true;
  resultElement.textContent = 'Sending a diagnostic notification…';

  chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' }, (response) => {
    testButton.disabled = false;
    const error = runtimeError();
    if (error) {
      resultElement.textContent = `Service worker message failed: ${error}`;
      return;
    }
    if (!response?.ok) {
      resultElement.textContent = `Notification failed: ${response?.error || 'Unknown error'}`;
      return;
    }
    permissionElement.textContent = response.permissionLevel;
    resultElement.textContent = [
      'Test notification created by Chrome.',
      `ID: ${response.notificationId}`,
      `Registered: ${response.registeredByChrome}`
    ].join('\n');
  });
}

function sendTestSound() {
  testSoundButton.disabled = true;
  resultElement.textContent = 'Playing the packaged chime…';

  chrome.runtime.sendMessage({ type: 'TEST_SOUND' }, (response) => {
    testSoundButton.disabled = false;
    const error = runtimeError();
    if (error) {
      resultElement.textContent = `Sound message failed: ${error}`;
      return;
    }
    if (!response?.ok) {
      resultElement.textContent = `Sound failed: ${response?.error || 'Unknown error'}`;
      return;
    }
    resultElement.textContent = `Packaged chime played at ${Math.round(response.volume * 100)}% volume.`;
  });
}

enabledElement.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabledElement.checked }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save setting: ${error}`
      : enabledElement.checked
        ? 'Desktop notifications enabled.'
        : 'Desktop notifications disabled; tab markers and chimes keep their own settings.';
  });
});


tabMarkerEnabledElement.addEventListener('change', () => {
  chrome.storage.local.set({ tabMarkerEnabled: tabMarkerEnabledElement.checked }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save tab marker setting: ${error}`
      : tabMarkerEnabledElement.checked
        ? 'Finished ChatGPT tabs will be highlighted until opened.'
        : 'Tab highlighting disabled.';
  });
});

soundEnabledElement.addEventListener('change', () => {
  updateVolumeUi();
  chrome.storage.local.set({ soundEnabled: soundEnabledElement.checked }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save sound setting: ${error}`
      : soundEnabledElement.checked
        ? 'Custom chime enabled.'
        : 'Custom chime disabled; normal system notification sound may still play.';
  });
});

soundVolumeElement.addEventListener('input', updateVolumeUi);
soundVolumeElement.addEventListener('change', () => {
  const soundVolume = clampVolume(Number(soundVolumeElement.value) / 100);
  chrome.storage.local.set({ soundVolume }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save volume: ${error}`
      : `Chime volume set to ${Math.round(soundVolume * 100)}%.`;
  });
});

testSoundButton.addEventListener('click', sendTestSound);
testButton.addEventListener('click', sendTestNotification);
captureDiagnosticsButton.addEventListener('click', captureDiagnostics);
copyDiagnosticsButton.addEventListener('click', copyDiagnostics);
repairMonitorsButton.addEventListener('click', repairMonitors);

readPermissionLevel();
readSettingsAndLastEvent();
refreshTabStatus({ repair: false });
