(function initDetectorCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function detectorCoreFactory() {
  function createDetector({ stableMs = 1400, fallbackStableMs = Math.max(4000, stableMs * 3) } = {}) {
    let initialized = false;
    let generating = false;
    let awaitingResponse = false;
    let activityObserved = false;
    let submissionBaselinePending = false;
    let stopObservedSinceSubmission = false;
    let lastAssistantCount = 0;
    let lastUserCount = 0;
    let lastAssistantSignature = '';
    let lastContentChangeAt = null;
    let lastSubmissionAt = null;
    let lastActionFingerprint = null;
    let lastCompletedSignature = null;
    let lastSendVisible = false;
    let lastStopVisible = false;

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
      stopObservedSinceSubmission = false;
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

      if (!initialized) {
        initialized = true;
        lastAssistantCount = assistantCount;
        lastUserCount = userCount;
        lastAssistantSignature = assistantSignature;
        lastCompletedSignature = assistantSignature || null;
        lastActionFingerprint = actionFingerprint;
        lastSendVisible = sendVisible;
        lastStopVisible = stopVisible;

        if (stopVisible || (awaitingResponse && !sendVisible)) {
          awaitingResponse = true;
          generating = true;
          activityObserved = true;
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
      if (awaitingResponse && stopVisible) {
        stopObservedSinceSubmission = true;
      }

      const strongStartSignal =
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

      const idleFor = lastContentChangeAt === null ? 0 : now - lastContentChangeAt;
      const strongIdleSignal = !stopVisible && (sendVisible || hasAssistantSignal);
      const stableLongEnough = strongIdleSignal
        ? idleFor >= stableMs
        : !stopVisible && idleFor >= fallbackStableMs;
      const completionSignature = hasAssistantSignal ? assistantSignature : '';
      const lifecycleCompletionReady =
        stopObservedSinceSubmission &&
        !stopVisible &&
        sendVisible;
      const completionConfirmed = completionReady || lifecycleCompletionReady;

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
        stopObservedSinceSubmission = false;
        lastCompletedSignature = completionSignature;
        lastContentChangeAt = null;
      }

      lastAssistantCount = assistantCount;
      lastUserCount = userCount;
      lastAssistantSignature = assistantSignature;
      lastSendVisible = sendVisible;
      lastStopVisible = stopVisible;

      return events;
    }

    function getState() {
      return {
        initialized,
        generating,
        awaitingResponse,
        activityObserved,
        submissionBaselinePending,
        stopObservedSinceSubmission,
        lastAssistantCount,
        lastUserCount,
        lastAssistantSignature,
        lastContentChangeAt,
        lastSubmissionAt,
        lastActionFingerprint,
        lastSendVisible,
        lastStopVisible
      };
    }

    return { scan, markUserSubmitted, getState };
  }

  return { createDetector };
});
