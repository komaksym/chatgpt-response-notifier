(function initDomAdapter(root, factory) {
  const pageUtils =
    typeof module === 'object' && module.exports
      ? require('./page-utils.js')
      : root.ChatGPTNotifierPageUtils;
  const api = factory(pageUtils);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierDomAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function domAdapterFactory(utils) {
  const { normalizeText, hashText, isActionLabel, summarizeActionLabels } = utils;

  function elementLabel(element) {
    return normalizeText(
      element?.innerText ||
        element?.textContent ||
        element?.getAttribute?.('aria-label') ||
        element?.getAttribute?.('title') ||
        element?.getAttribute?.('data-testid') ||
        ''
    );
  }

  function controlIdentity(element) {
    return normalizeText([
      element?.getAttribute?.('data-testid'),
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.innerText,
      element?.textContent
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function isVisible(element, windowObject) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) {
      return false;
    }

    try {
      const style = windowObject?.getComputedStyle?.(element);
      if (!style) return true;
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        String(style.opacity) !== '0'
      );
    } catch {
      return true;
    }
  }

  function isSendControl(element) {
    if (!element) return false;
    const identity = controlIdentity(element);
    return (
      /(^|\s)send-button(\s|$)/.test(identity) ||
      /(^|\s)composer-submit-button(\s|$)/.test(identity) ||
      /(^|\s)send( message| prompt)?(\s|$)/.test(identity)
    );
  }

  function isStopControl(element) {
    if (!element) return false;
    const identity = controlIdentity(element);
    return (
      /(^|\s)stop-button(\s|$)/.test(identity) ||
      /(^|\s)stop( generating| streaming| response)?(\s|$)/.test(identity)
    );
  }

  function isComposerInput(element) {
    if (!element) return false;
    const directTag = String(element.tagName || '').toUpperCase();
    if (directTag === 'TEXTAREA' || element.isContentEditable) return true;
    const role = element.getAttribute?.('role');
    if (role === 'textbox') return true;
    return Boolean(
      element.closest?.('textarea,[contenteditable="true"],[role="textbox"]')
    );
  }

  function conversationRoot(documentObject) {
    return (
      documentObject.querySelector?.('main') ||
      documentObject.querySelector?.('[role="main"]') ||
      documentObject.body ||
      documentObject.documentElement ||
      null
    );
  }

  function turnNodes(documentObject, role) {
    const nodes = [];
    const seen = new Set();
    const selectors = [
      '[data-message-author-role="' + role + '"]',
      '[data-turn="' + role + '"]',
      '[data-author-role="' + role + '"]',
      '[data-role="' + role + '"]'
    ];

    for (const [index, selector] of selectors.entries()) {
      for (const node of Array.from(documentObject.querySelectorAll(selector))) {
        if (
          index > 0 &&
          node.querySelectorAll?.('[data-message-author-role="' + role + '"]').length
        ) {
          continue;
        }
        if (seen.has(node)) continue;
        seen.add(node);
        nodes.push(node);
      }
    }
    return nodes;
  }

  function longestNormalizedText(elements) {
    let longest = '';
    for (const element of elements) {
      for (const value of [element?.innerText, element?.textContent]) {
        const text = normalizeText(value);
        if (text.length > longest.length) longest = text;
      }
    }
    return longest;
  }

  function assistantText(element) {
    if (!element) return '';
    const contentNodes = Array.from(
      element.querySelectorAll?.(
        '[data-message-content], .markdown, .whitespace-pre-wrap, [class~="prose"]'
      ) || []
    );
    const contentText = longestNormalizedText(contentNodes);
    if (contentText) return contentText;

    // Reliability-first fallback: if ChatGPT changes its inner answer wrapper,
    // use the assistant turn's rendered text instead of treating the answer as empty.
    return longestNormalizedText([element]);
  }

  function assistantBusy(element) {
    if (!element) return false;
    if (element.getAttribute?.('aria-busy') === 'true') return true;

    const turn = element.closest?.(
      '[data-turn="assistant"], [data-testid^="conversation-turn-"]'
    );
    return Boolean(turn && turn !== element && turn.getAttribute?.('aria-busy') === 'true');
  }

  function finalResponseAction(element) {
    if (!element) return null;
    const selector = 'button[data-testid="copy-turn-action-button"]';
    const direct = element.querySelector?.(selector);
    if (direct) return direct;

    const turn = element.closest?.(
      '[data-turn="assistant"], [data-testid^="conversation-turn-"]'
    );
    if (!turn || turn === element) return null;
    return turn.querySelector?.(selector) || null;
  }

  function preview(value, maxLength = 220) {
    const text = normalizeText(value);
    if (text.length <= maxLength) return text;

    const slice = text.slice(0, maxLength - 1);
    const lastSpace = slice.lastIndexOf(' ');
    const cutoff = lastSpace >= Math.floor(maxLength * 0.65) ? lastSpace : slice.length;
    return `${slice.slice(0, cutoff).trimEnd()}…`;
  }

  function collectSnapshot(documentObject, windowObject, now = Date.now()) {
    let assistantNodes = turnNodes(documentObject, 'assistant');
    const userNodes = turnNodes(documentObject, 'user');
    const buttons = Array.from(documentObject.querySelectorAll('button,[role="button"]'));

    if (assistantNodes.length === 0) {
      const root = conversationRoot(documentObject);
      assistantNodes = Array.from(
        root?.querySelectorAll?.(
          '[data-message-content], .markdown, .whitespace-pre-wrap, [class~="prose"]'
        ) || []
      );
    }

    const lastAssistant = assistantNodes.at(-1);
    const fullAssistantText = assistantText(lastAssistant);
    const lastAssistantText = preview(fullAssistantText);
    const completionAction = finalResponseAction(lastAssistant);
    const completionReady = Boolean(
      completionAction &&
      completionAction.disabled !== true &&
      completionAction.getAttribute?.('aria-disabled') !== 'true'
    );
    const assistantBusyNow = assistantBusy(lastAssistant);

    const visibleButtons = buttons.filter((button) => isVisible(button, windowObject));
    const stopVisible = visibleButtons.some(isStopControl);
    const sendVisible = visibleButtons.some(isSendControl);

    const actionLabels = [...new Set(
      visibleButtons
        .filter((button) => !button.disabled)
        .map(elementLabel)
        .filter(isActionLabel)
    )];
    const actionFingerprint = actionLabels.length
      ? actionLabels.map((label) => label.toLowerCase()).sort().join('|')
      : null;

    return {
      now,
      stopVisible,
      sendVisible,
      completionReady,
      assistantBusy: assistantBusyNow,
      assistantCount: assistantNodes.length,
      userCount: userNodes.length,
      lastAssistantSignature: fullAssistantText ? hashText(fullAssistantText) : '',
      lastAssistantText,
      actionFingerprint,
      actionLabel: actionFingerprint ? summarizeActionLabels(actionLabels) : null
    };
  }

  return {
    collectSnapshot,
    elementLabel,
    isVisible,
    isSendControl,
    isStopControl,
    isComposerInput,
    conversationRoot
  };
});
