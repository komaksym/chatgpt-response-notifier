(function initNetworkProbe(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function networkProbeFactory() {
  const EVENT_NAME = '__chatgpt_notifier_stream_lifecycle__';
  const INSTALL_KEY = '__chatgptNotifierNetworkProbeInstalled__';
  const ALLOWED_EVENT_TYPES = new Set(['started', 'first_chunk', 'terminal', 'error']);

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return String(input || '');
  }

  function requestMethod(input, init) {
    const method = init?.method || input?.method || 'GET';
    return String(method).toUpperCase();
  }

  function isConversationRequest(root, input, init) {
    if (requestMethod(input, init) !== 'POST') return false;

    let url;
    try {
      url = new URL(requestUrl(input), root?.location?.href || 'https://chatgpt.com/');
    } catch (_error) {
      return false;
    }

    if (!['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) return false;
    return /^\/backend-api\/(?:[^/]+\/)*conversation(?:\/|$)/.test(url.pathname);
  }

  function emitLifecycle(root, payload) {
    if (!ALLOWED_EVENT_TYPES.has(payload?.type)) return;
    const safePayload = {
      type: payload.type,
      at: Number.isFinite(payload.at) ? payload.at : Date.now(),
      requestId: String(payload.requestId || '')
    };
    root.dispatchEvent(new root.CustomEvent(EVENT_NAME, {
      detail: JSON.stringify(safePayload)
    }));
  }

  function observeResponse(root, response, requestId, emit = emitLifecycle) {
    let reader;
    try {
      const clone = response?.clone?.();
      reader = clone?.body?.getReader?.();
    } catch (_error) {
      emit(root, { type: 'error', at: Date.now(), requestId });
      return;
    }

    if (!reader) {
      emit(root, { type: 'terminal', at: Date.now(), requestId });
      return;
    }

    void (async () => {
      let firstChunkSeen = false;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) {
            emit(root, { type: 'terminal', at: Date.now(), requestId });
            return;
          }
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            emit(root, { type: 'first_chunk', at: Date.now(), requestId });
          }
        }
      } catch (_error) {
        emit(root, { type: 'error', at: Date.now(), requestId });
      } finally {
        try {
          reader.releaseLock?.();
        } catch (_error) {
          // Best-effort cleanup only.
        }
      }
    })();
  }

  function install(root) {
    if (!root?.fetch || root[INSTALL_KEY]) return false;

    try {
      Object.defineProperty(root, INSTALL_KEY, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch (_error) {
      root[INSTALL_KEY] = true;
    }

    const originalFetch = root.fetch;
    let sequence = 0;

    root.fetch = function chatgptNotifierFetch(input, init) {
      if (!isConversationRequest(root, input, init)) {
        return originalFetch.apply(this, arguments);
      }

      sequence += 1;
      const requestId = String(sequence);
      emitLifecycle(root, { type: 'started', at: Date.now(), requestId });

      let result;
      try {
        result = originalFetch.apply(this, arguments);
      } catch (error) {
        emitLifecycle(root, { type: 'error', at: Date.now(), requestId });
        throw error;
      }

      return Promise.resolve(result).then(
        (response) => {
          observeResponse(root, response, requestId);
          return response;
        },
        (error) => {
          emitLifecycle(root, { type: 'error', at: Date.now(), requestId });
          throw error;
        }
      );
    };

    return true;
  }

  return {
    EVENT_NAME,
    install,
    isConversationRequest,
    observeResponse
  };
});
