(() => {
  'use strict';

  const EXTENSION_KEY = 'image_tool_budget';
  const LIMIT_PER_TURN = 1;

  const getContextSafe = () => {
    if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
      return null;
    }
    try {
      return SillyTavern.getContext();
    } catch (_err) {
      return null;
    }
  };

  const ctx = getContextSafe();
  if (!ctx) {
    console.warn('[ImageToolBudget] SillyTavern context not available.');
    return;
  }

  if (ctx.__imageToolBudgetWrapped) {
    return;
  }
  ctx.__imageToolBudgetWrapped = true;

  const imageToolNames = new Set();
  let inMemoryState = { used: 0 };

  const getState = () => {
    const liveCtx = getContextSafe() || ctx;
    if (!liveCtx.chatMetadata) {
      return inMemoryState;
    }
    if (!liveCtx.chatMetadata[EXTENSION_KEY]) {
      liveCtx.chatMetadata[EXTENSION_KEY] = { used: 0 };
    }
    return liveCtx.chatMetadata[EXTENSION_KEY];
  };

  const saveState = async () => {
    const liveCtx = getContextSafe() || ctx;
    if (typeof liveCtx.saveMetadata === 'function') {
      try {
        await liveCtx.saveMetadata();
      } catch (err) {
        console.warn('[ImageToolBudget] saveMetadata failed', err);
      }
    }
  };

  const toText = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    try {
      return String(value);
    } catch (_err) {
      return '';
    }
  };

  const looksLikeImageToolName = (name) => {
    const text = toText(name).toLowerCase();
    if (!text) return false;
    if (text.includes('image generation')) return true;
    if (text.includes('image') && (text.includes('generate') || text.includes('generation') || text.includes('create'))) {
      return true;
    }
    if (text.includes('generate_image') || text.includes('image_generate') || text.includes('imagegen')) {
      return true;
    }
    return false;
  };

  const looksLikeImageToolDef = (def) => {
    if (!def || typeof def !== 'object') return false;
    const haystack = [def.name, def.displayName, def.description]
      .map((v) => toText(v))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack) return false;
    if (haystack.includes('image generation')) return true;
    if (haystack.includes('image') && (haystack.includes('generate') || haystack.includes('generation') || haystack.includes('create'))) {
      return true;
    }
    return false;
  };

  const isUserMessage = (m) => {
    if (!m || typeof m !== 'object') return false;
    return (
      m.is_user === true ||
      m.isUser === true ||
      m.role === 'user' ||
      m.sender === 'user' ||
      m.name === 'user'
    );
  };

  const extractToolName = (m) => {
    if (!m || typeof m !== 'object') return '';
    const direct =
      m.tool_name ||
      m.toolName ||
      m.name ||
      m.function_name ||
      m.functionName ||
      (m.extra && (m.extra.tool_name || m.extra.toolName || m.extra.function_name || m.extra.functionName || m.extra.tool)) ||
      (m.tool_call && (m.tool_call.name || (m.tool_call.function && m.tool_call.function.name))) ||
      (Array.isArray(m.tool_calls) && m.tool_calls[0] && (m.tool_calls[0].name || (m.tool_calls[0].function && m.tool_calls[0].function.name))) ||
      '';
    return toText(direct);
  };

  const isToolCallMessage = (m) => {
    if (!m || typeof m !== 'object') return false;
    if (m.is_tool === true || m.isTool === true) return true;
    if (m.role === 'tool' || m.role === 'function') return true;
    if (m.tool_call || m.tool_calls) return true;
    if (m.type === 'tool' || m.type === 'function') return true;
    if (m.extra && (m.extra.tool || m.extra.tool_name || m.extra.functionName || m.extra.function_name)) return true;
    return false;
  };

  const countImageToolCallsSinceLastUser = (chat) => {
    if (!Array.isArray(chat) || chat.length === 0) return 0;
    let lastUserIndex = -1;
    for (let i = chat.length - 1; i >= 0; i -= 1) {
      if (isUserMessage(chat[i])) {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex < 0) return 0;
    let count = 0;
    for (let i = lastUserIndex + 1; i < chat.length; i += 1) {
      const msg = chat[i];
      if (!isToolCallMessage(msg)) continue;
      const toolName = extractToolName(msg);
      if (toolName && (imageToolNames.has(toolName) || looksLikeImageToolName(toolName))) {
        count += 1;
      }
    }
    return count;
  };

  const getUsedByHistory = () => {
    const liveCtx = getContextSafe() || ctx;
    const chat = liveCtx.chat || (getContextSafe() && getContextSafe().chat);
    return countImageToolCallsSinceLastUser(chat);
  };

  const markUsed = async () => {
    const state = getState();
    state.used = 1;
    await saveState();
  };

  const resetBudget = async () => {
    const state = getState();
    state.used = 0;
    await saveState();
  };

  const registerMessageReset = () => {
    const liveCtx = getContextSafe() || ctx;
    const { eventSource, event_types } = liveCtx;
    if (!eventSource || !event_types) return;

    const eventName =
      event_types.MESSAGE_SENT ||
      event_types.USER_MESSAGE_SENT ||
      event_types.MESSAGE_CREATED;

    if (!eventName) return;

    eventSource.on(eventName, (data) => {
      if (!data || isUserMessage(data) || data.role === 'user' || data.sender === 'user') {
        resetBudget();
      }
    });
  };

  registerMessageReset();

  const originalRegister = typeof ctx.registerFunctionTool === 'function'
    ? ctx.registerFunctionTool.bind(ctx)
    : null;

  if (!originalRegister) {
    console.warn('[ImageToolBudget] registerFunctionTool not found.');
    return;
  }

  ctx.registerFunctionTool = (def) => {
    const isImageTool = looksLikeImageToolDef(def);

    if (!isImageTool) {
      return originalRegister(def);
    }

    if (def && def.name) {
      imageToolNames.add(def.name);
    }

    console.log('[ImageToolBudget] Detected image tool:', {
      name: def?.name,
      displayName: def?.displayName,
      description: def?.description,
    });

    const originalShouldRegister = def.shouldRegister;
    def.shouldRegister = () => {
      let should = true;
      if (typeof originalShouldRegister === 'function') {
        try {
          should = originalShouldRegister();
        } catch (err) {
          console.warn('[ImageToolBudget] shouldRegister error', err);
          should = true;
        }
      }
      if (!should) return false;

      const state = getState();
      const usedByHistory = getUsedByHistory();
      const used = Math.max(state.used || 0, usedByHistory);
      return used < LIMIT_PER_TURN;
    };

    const originalAction = def.action;
    def.action = async (args, ...rest) => {
      await markUsed();
      if (typeof originalAction === 'function') {
        return originalAction.call(def, args, ...rest);
      }
      return '';
    };

    return originalRegister(def);
  };
})();
