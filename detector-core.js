(function initDetectorCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function detectorCoreFactory() {
  function createDetector({ stableMs = 1400, fallbackStableMs = Math.max(10000, stableMs * 6) } = {}) {
    let initialized = false;
    let generating = false;
    let awaitingResponse = false;
    let activityObserved = false;
    let submissionBaselinePending = false;
    let assistantBusyObservedSinceSubmission = false;
    let stopObservedSinceSubmission = false;
    let compatibilityIssue = null;
    let lastAssistantCount = 0;
    let lastUserCount = 0;
    let lastAssistantSignature = '';
    let lastContentChangeAt = null;
    let lastSubmissionAt = null;
    let lastActionFingerprint = null;
    let lastCompletedSignature = null;
    let lastSendVisible = false;
    let lastStopVisible = false;
    let lastAssistantBusy = false;

    function actionEvent(snapshot) {
      return {
        type: 'action_required',
        message: snapshot.actionLabel || 'ChatGPT is waiting for your action.'
      };
    }

    function markUserSubmitted(timestamp = Date.now()) {
      awaitingResponse = true;
      generating = false;
      activityObserved = false;
      submissionBaselinePending = true;
      assistantBusyObservedSinceSubmission = false;
      stopObservedSinceSubmission = false;
      compatibilityIssue = null;
      lastContentChangeAt = null;
      lastSubmissionAt = Number.isFinite(timestamp) ? timestamp : Date.now();
    }

    function scan(snapshot) {
      const events = [];
      const now = Number.isFinite(snapshot.now) ? snapshot.now : Date.now();
      const assistantCount = snapshot.assistantCount || 0;
      const userCount = snapshot.userCount || 0;
      const assistantSignature = snapshot.lastAssistantSignature || '';
      const assistantText = snapshot.lastAssistantText || '';
      const actionFingerprint = snapshot.actionFingerprint || null;
      const sendVisible = Boolean(snapshot.sendVisible);
      const stopVisible = Boolean(snapshot.stopVisible);
      const completionReady = Boolean(snapshot.completionReady);
      const assistantBusy = Boolean(snapshot.assistantBusy);
      const streamActive = Boolean(snapshot.streamActive);
      const streamLastStartedAt = Number.isFinite(snapshot.streamLastStartedAt)
        ? snapshot.streamLastStartedAt
        : null;
      const streamLastTerminalAt = Number.isFinite(snapshot.streamLastTerminalAt)
        ? snapshot.streamLastTerminalAt
        : null;

      if (!initialized) {
        initialized = true;
        lastAssistantCount = assistantCount;
        lastUserCount = userCount;
        lastAssistantSignature = assistantSignature;
        lastCompletedSignature = assistantSignature || null;
        lastActionFingerprint = actionFingerprint;
        lastSendVisible = sendVisible;
        lastStopVisible = stopVisible;
        lastAssistantBusy = assistantBusy;

        if (assistantBusy || stopVisible || (awaitingResponse && !sendVisible)) {
          awaitingResponse = true;
          generating = true;
          activityObserved = true;
          assistantBusyObservedSinceSubmission = assistantBusy;
          stopObservedSinceSubmission = stopVisible;
          lastContentChangeAt = now;
        }

        if (actionFingerprint) {
          events.push(actionEvent(snapshot));
        }

        return events;
      }

      if (actionFingerprint && actionFingerprint !== lastActionFingerprint) {
        events.push(actionEvent(snapshot));
      }
      lastActionFingerprint = actionFingerprint;

      const userAdded = userCount > lastUserCount;
      const assistantAdded = assistantCount > lastAssistantCount;
      const assistantChanged = Boolean(assistantSignature) && assistantSignature !== lastAssistantSignature;
      const hasAssistantSignal = assistantCount > 0 && Boolean(assistantSignature);
      const hadEstablishedAssistant = lastAssistantCount > 0 && Boolean(lastAssistantSignature);

      if (userAdded && !awaitingResponse && hadEstablishedAssistant) {
        markUserSubmitted(now);
      }

      submissionBaselinePending = false;
      if (awaitingResponse && assistantBusy) {
        assistantBusyObservedSinceSubmission = true;
      }
      if (awaitingResponse && stopVisible) {
        stopObservedSinceSubmission = true;
      }

      const strongStartSignal =
        (assistantBusy && !lastAssistantBusy) ||
        (stopVisible && !lastStopVisible) ||
        (awaitingResponse && !sendVisible && lastSendVisible) ||
        (assistantAdded && awaitingResponse) ||
        (assistantChanged && awaitingResponse);

      if (strongStartSignal) {
        if (stopVisible && !lastStopVisible) awaitingResponse = true;
        generating = true;
        activityObserved = true;
        lastContentChangeAt = now;
      }

      if (awaitingResponse && activityObserved && hasAssistantSignal) {
        compatibilityIssue = assistantBusyObservedSinceSubmission || completionReady || stopObservedSinceSubmission
          ? null
          : 'completion-signal-unknown';
      }

      const idleFor = lastContentChangeAt === null ? 0 : now - lastContentChangeAt;
      const busyCompletionReady = assistantBusyObservedSinceSubmission && !assistantBusy;
      const strongCompletionReady = !assistantBusy && (completionReady || busyCompletionReady);
      const lifecycleCompletionReady =
        stopObservedSinceSubmission &&
        !stopVisible &&
        sendVisible &&
        !assistantBusy;
      const streamTerminalAfterSubmission =
        lastSubmissionAt !== null &&
        !streamActive &&
        streamLastTerminalAt !== null &&
        streamLastTerminalAt >= lastSubmissionAt &&
        (streamLastStartedAt === null || streamLastStartedAt <= streamLastTerminalAt);
      const streamLifecycleCompletionReady =
        stopObservedSinceSubmission &&
        !stopVisible &&
        !assistantBusy &&
        streamTerminalAfterSubmission;
      const fallbackCompletionReady =
        (lifecycleCompletionReady || streamLifecycleCompletionReady) &&
        idleFor >= fallbackStableMs;
      const completionConfirmed = strongCompletionReady || fallbackCompletionReady;
      const stableLongEnough = strongCompletionReady
        ? idleFor >= stableMs || streamTerminalAfterSubmission
        : fallbackCompletionReady;
      const completionSignature = hasAssistantSignal ? assistantSignature : '';

      if (
        generating &&
        awaitingResponse &&
        activityObserved &&
        completionConfirmed &&
        stableLongEnough &&
        completionSignature &&
        completionSignature !== lastCompletedSignature
      ) {
        events.push({
          type: 'response_complete',
          message: assistantText || 'Your ChatGPT response is ready.'
        });
        generating = false;
        awaitingResponse = false;
        activityObserved = false;
        assistantBusyObservedSinceSubmission = false;
        stopObservedSinceSubmission = false;
        compatibilityIssue = null;
        lastCompletedSignature = completionSignature;
        lastContentChangeAt = null;
      }

      lastAssistantCount = assistantCount;
      lastUserCount = userCount;
      lastAssistantSignature = assistantSignature;
      lastSendVisible = sendVisible;
      lastStopVisible = stopVisible;
      lastAssistantBusy = assistantBusy;

      return events;
    }

    function getState() {
      return {
        initialized,
        generating,
        awaitingResponse,
        activityObserved,
        submissionBaselinePending,
        assistantBusyObservedSinceSubmission,
        stopObservedSinceSubmission,
        compatibilityIssue,
        lastAssistantCount,
        lastUserCount,
        lastAssistantSignature,
        lastContentChangeAt,
        lastSubmissionAt,
        lastActionFingerprint,
        lastSendVisible,
        lastStopVisible,
        lastAssistantBusy
      };
    }

    return { scan, markUserSubmitted, getState };
  }

  return { createDetector };
});
