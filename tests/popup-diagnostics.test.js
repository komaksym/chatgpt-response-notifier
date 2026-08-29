const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');

function functionSlice(name, nextName) {
  const start = popupSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? popupSource.indexOf(`async function ${nextName}(`, start + 1) : popupSource.length;
  return popupSource.slice(start, end === -1 ? popupSource.length : end);
}

test('popup exposes separate non-mutating capture and explicit repair actions', () => {
  assert.match(popupHtml, /id="capture-diagnostics-button"/);
  assert.match(popupHtml, /id="copy-diagnostics-button"/);
  assert.match(popupHtml, /id="repair-monitors-button"/);

  const capture = functionSlice('captureDiagnostics', 'repairMonitors');
  assert.doesNotMatch(capture, /ensureMonitors\s*\(/);
  assert.match(capture, /queryChatGptTabs\s*\(/);
  assert.match(capture, /pingTab/);

  const repair = functionSlice('repairMonitors');
  assert.match(repair, /ensureMonitors\s*\(/);
});

test('popup startup is passive and does not auto-repair monitors', () => {
  const startup = popupSource.slice(popupSource.lastIndexOf('readPermissionLevel();'));
  assert.doesNotMatch(startup, /ensureMonitors\s*\(/);
  assert.doesNotMatch(startup, /repairMonitors\s*\(/);
  assert.match(startup, /refreshTabStatus\(\{ repair: false \}\)/);
});

test('diagnostic JSON keeps the state needed to classify background misses', () => {
  for (const field of [
    'awaitingResponse',
    'generating',
    'activityObserved',
    'assistantBusyObservedSinceSubmission',
    'stopObservedSinceSubmission',
    'compatibilityIssue',
    'assistantCount',
    'userCount',
    'lastAssistantSignature',
    'sendVisible',
    'stopVisible',
    'completionReady',
    'assistantBusy',
    'lastDispatch',
    'lastScanReason',
    'streamTrace',
    'serviceWorker',
    'notificationId'
  ]) {
    assert.match(popupSource, new RegExp(field), `diagnostics should include ${field}`);
  }
});


test('diagnostic capture omits assistant response text', () => {
  const diagnostic = popupSource.slice(
    popupSource.indexOf('function diagnosticTab('),
    popupSource.indexOf('function readServiceWorkerLastEvent(')
  );
  assert.doesNotMatch(diagnostic, /lastAssistantText/);
});
