(() => {
  'use strict';

  const EXTENSION_KEY = 'image_tool_budget';
  const SETTINGS_KEY = 'image_tool_budget';
  const DEFAULT_SETTINGS = Object.freeze({
    limitPerTurn: 1,
    showDebugPanel: true,
  });
  const KNOWN_IMAGE_TOOL_NAMES = new Set(['GenerateImage']);

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

  const imageToolNames = new Set(KNOWN_IMAGE_TOOL_NAMES);
  const patchedToolNames = new Set();
  let inMemoryState = { used: 0 };
  let inMemorySettings = { limitPerTurn: 1, showDebugPanel: true };

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

  const cloneSettings = (settings) => {
    if (typeof structuredClone === 'function') {
      return structuredClone(settings);
    }
    return JSON.parse(JSON.stringify(settings));
  };

  const getSettings = () => {
    const liveCtx = getContextSafe() || ctx;
    if (!liveCtx.extensionSettings) {
      return inMemorySettings;
    }
    if (!liveCtx.extensionSettings[SETTINGS_KEY]) {
      liveCtx.extensionSettings[SETTINGS_KEY] = cloneSettings(DEFAULT_SETTINGS);
    }
    const settings = liveCtx.extensionSettings[SETTINGS_KEY];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!Object.hasOwn(settings, key)) {
        settings[key] = DEFAULT_SETTINGS[key];
      }
    }
    return settings;
  };

  const saveSettings = () => {
    const liveCtx = getContextSafe() || ctx;
    if (typeof liveCtx.saveSettingsDebounced === 'function') {
      liveCtx.saveSettingsDebounced();
    }
  };

  const clampLimit = (value) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return DEFAULT_SETTINGS.limitPerTurn;
    if (parsed <= 0) return 0;
    return 1;
  };

  const getLimitPerTurn = () => {
    const settings = getSettings();
    return clampLimit(settings.limitPerTurn);
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
    if (KNOWN_IMAGE_TOOL_NAMES.has(name)) return true;
    if (text === 'generateimage' || text === 'generate image') return true;
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
    if (def.name && KNOWN_IMAGE_TOOL_NAMES.has(def.name)) return true;
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

  const getSettingsContainer = ($) => {
    const candidates = [
      '#extensions_settings',
      '#extensions_settings_container',
      '#extensions-settings',
      '.extensions_settings',
    ];
    for (const selector of candidates) {
      const node = $(selector);
      if (node && node.length) return node;
    }
    return null;
  };

  const renderDebugPanel = () => {
    const $ = window.jQuery || window.$;
    if (!$) return;
    const panel = $('#image-tool-budget-debug-panel');
    const dataNode = $('#image-tool-budget-debug-data');
    if (!panel.length || !dataNode.length) return;
    const settings = getSettings();
    const show = !!settings.showDebugPanel;
    panel.toggle(show);
    if (!show) return;

    const state = getState();
    const usedByHistory = getUsedByHistory();
    const used = typeof usedByHistory === 'number' ? usedByHistory : (state.used || 0);
    const limit = getLimitPerTurn();
    const knownTools = Array.from(imageToolNames).join(', ') || '(none detected yet)';
    const patchedTools = Array.from(patchedToolNames).join(', ') || '(none patched yet)';

    const lines = [
      `Limit per turn: ${limit}`,
      `Used (metadata): ${state.used || 0}`,
      `Used by history: ${typeof usedByHistory === 'number' ? usedByHistory : 'n/a'}`,
      `Effective used: ${used}`,
      `Known image tool names: ${knownTools}`,
      `Patched tool instances: ${patchedTools}`,
    ];

    dataNode.text(lines.join('\n'));
  };

  const initSettingsUI = () => {
    const $ = window.jQuery || window.$;
    if (!$) {
      console.warn('[ImageToolBudget] jQuery not available for settings UI.');
      return;
    }

    if ($('#image-tool-budget-settings').length) {
      renderDebugPanel();
      return;
    }

    const container = getSettingsContainer($);
    if (!container) {
      console.warn('[ImageToolBudget] Could not find extensions settings container.');
      return;
    }

    const settings = getSettings();
    const html = `
      <div id="image-tool-budget-settings" class="image-tool-budget-settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>Image Tool Budget</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <label for="image-tool-budget-limit">Max image tool calls per user message</label>
            <select id="image-tool-budget-limit" class="text_pole">
              <option value="1">1 (default)</option>
              <option value="0">0 (disable image tool)</option>
            </select>
            <label class="checkbox_label" for="image-tool-budget-debug-toggle">
              <input type="checkbox" id="image-tool-budget-debug-toggle" />
              <span>Show debug panel</span>
            </label>
            <div id="image-tool-budget-debug-panel" class="marginTop5">
              <div class="standoutHeader inline-drawer-header">Debug</div>
              <pre id="image-tool-budget-debug-data" class="marginTop5"></pre>
              <button type="button" id="image-tool-budget-refresh" class="menu_button">Refresh</button>
            </div>
          </div>
        </div>
      </div>
    `;

    container.append(html);

    $('#image-tool-budget-limit').val(String(clampLimit(settings.limitPerTurn)));
    $('#image-tool-budget-debug-toggle').prop('checked', !!settings.showDebugPanel);

    $('#image-tool-budget-limit').on('change', (event) => {
      const nextValue = clampLimit(event.target.value);
      settings.limitPerTurn = nextValue;
      saveSettings();
      renderDebugPanel();
    });

    $('#image-tool-budget-debug-toggle').on('change', (event) => {
      settings.showDebugPanel = !!event.target.checked;
      saveSettings();
      renderDebugPanel();
    });

    $('#image-tool-budget-refresh').on('click', () => {
      renderDebugPanel();
    });

    renderDebugPanel();
  };

  const registerSettingsUI = () => {
    const liveCtx = getContextSafe() || ctx;
    const { eventSource, event_types } = liveCtx;
    if (eventSource && event_types && event_types.APP_READY) {
      eventSource.on(event_types.APP_READY, initSettingsUI);
      return;
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      initSettingsUI();
    } else {
      window.addEventListener('DOMContentLoaded', initSettingsUI);
    }
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

  const countImageInvocationsFromMessage = (m) => {
    if (!m || typeof m !== 'object') return 0;
    const invocations = m.extra && m.extra.tool_invocations;
    if (!Array.isArray(invocations) || invocations.length === 0) return 0;
    let count = 0;
    for (const invocation of invocations) {
      const name = toText(invocation?.name || invocation?.displayName);
      if (looksLikeImageToolName(name)) {
        count += 1;
      }
    }
    return count;
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
      const invocationCount = countImageInvocationsFromMessage(msg);
      if (invocationCount > 0) {
        count += invocationCount;
        continue;
      }
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
    if (!Array.isArray(chat)) return null;
    return countImageToolCallsSinceLastUser(chat);
  };

  const getEffectiveUsed = () => {
    const state = getState();
    const usedByHistory = getUsedByHistory();
    if (typeof usedByHistory === 'number') {
      return usedByHistory;
    }
    return state.used || 0;
  };

  const syncStateWithHistory = async () => {
    const usedByHistory = getUsedByHistory();
    if (typeof usedByHistory !== 'number') return;
    const state = getState();
    if ((state.used || 0) !== usedByHistory) {
      state.used = usedByHistory;
      await saveState();
      renderDebugPanel();
    }
  };

  const scheduleSyncState = () => {
    syncStateWithHistory();
    setTimeout(syncStateWithHistory, 150);
    setTimeout(syncStateWithHistory, 500);
  };

  const markUsed = async () => {
    const state = getState();
    state.used = 1;
    await saveState();
    renderDebugPanel();
  };

  const resetBudget = async () => {
    const state = getState();
    state.used = 0;
    await saveState();
    renderDebugPanel();
  };

  const registerToolCallEvents = () => {
    const liveCtx = getContextSafe() || ctx;
    const { eventSource, event_types } = liveCtx;
    if (!eventSource || !event_types) return;
    const eventName = event_types.TOOL_CALLS_PERFORMED;
    if (!eventName) return;

    eventSource.on(eventName, (invocations) => {
      if (!Array.isArray(invocations)) return;
      for (const invocation of invocations) {
        const name = toText(invocation?.name || invocation?.displayName);
        if (looksLikeImageToolName(name)) {
          markUsed();
          break;
        }
      }
    });
  };

  const registerChatSync = () => {
    const liveCtx = getContextSafe() || ctx;
    const { eventSource, event_types } = liveCtx;
    if (!eventSource || !event_types) return;

    const onSync = () => {
      scheduleSyncState();
    };

    const eventNames = [
      event_types.CHAT_CHANGED,
      event_types.CHAT_CREATED,
      event_types.SETTINGS_LOADED,
      event_types.EXTENSION_SETTINGS_LOADED,
      event_types.APP_READY,
    ].filter(Boolean);

    for (const eventName of eventNames) {
      eventSource.on(eventName, onSync);
    }
  };

  const registerMessageReset = () => {
    const liveCtx = getContextSafe() || ctx;
    const { eventSource, event_types } = liveCtx;
    if (!eventSource || !event_types) return;

    const resolveMessageFromArgs = (...args) => {
      if (!args || args.length === 0) return null;
      const first = args[0];
      const chat = liveCtx.chat;
      if (typeof first === 'number' && Array.isArray(chat)) {
        return chat[first];
      }
      if (typeof first === 'string' && Array.isArray(chat)) {
        const idx = Number(first);
        if (!Number.isNaN(idx)) return chat[idx];
      }
      if (first && typeof first === 'object') {
        return first;
      }
      return null;
    };

    const onUserMessage = (...args) => {
      const candidate = resolveMessageFromArgs(...args) || (liveCtx.chat && liveCtx.chat[liveCtx.chat.length - 1]);
      if (candidate && (isUserMessage(candidate) || candidate.role === 'user' || candidate.sender === 'user')) {
        resetBudget();
      }
    };

    const eventNames = [
      event_types.MESSAGE_SENT,
      event_types.USER_MESSAGE_RENDERED,
      event_types.USER_MESSAGE_SENT,
      event_types.MESSAGE_CREATED,
    ].filter(Boolean);

    for (const eventName of eventNames) {
      eventSource.on(eventName, onUserMessage);
    }
  };

  const getToolManager = () => {
    const liveCtx = getContextSafe() || ctx;
    return liveCtx.ToolManager || globalThis.ToolManager || null;
  };

  const patchToolInstance = (tool) => {
    if (!tool || tool.__imageToolBudgetPatched) return false;
    const toolInfo = typeof tool.toFunctionOpenAI === 'function' ? tool.toFunctionOpenAI() : null;
    const name = toText(toolInfo?.function?.name);
    const displayName = toText(tool.displayName);
    if (!looksLikeImageToolName(name) && !looksLikeImageToolName(displayName)) {
      return false;
    }

    tool.__imageToolBudgetPatched = true;
    patchedToolNames.add(name || displayName || '(unknown)');
    if (name) {
      imageToolNames.add(name);
    }

    const originalShouldRegister = typeof tool.shouldRegister === 'function' ? tool.shouldRegister.bind(tool) : null;
    tool.shouldRegister = async () => {
      let should = true;
      if (originalShouldRegister) {
        try {
          should = await originalShouldRegister();
        } catch (err) {
          console.warn('[ImageToolBudget] tool.shouldRegister error', err);
          should = true;
        }
      }
      if (!should) return false;

      const state = getState();
    const usedByHistory = getUsedByHistory();
    const used = typeof usedByHistory === 'number' ? usedByHistory : (state.used || 0);
    const limit = getLimitPerTurn();
      return used < limit;
    };

    const originalInvoke = typeof tool.invoke === 'function' ? tool.invoke.bind(tool) : null;
    tool.invoke = async (parameters) => {
      const state = getState();
    const usedByHistory = getUsedByHistory();
    const used = typeof usedByHistory === 'number' ? usedByHistory : (state.used || 0);
    const limit = getLimitPerTurn();
      if (used >= limit) {
        console.warn('[ImageToolBudget] Blocked image tool invoke (limit reached).', { used, limit });
        return `Image tool call blocked: limit ${limit} per user message.`;
      }

      await markUsed();
      if (originalInvoke) {
        return originalInvoke(parameters);
      }
      return '';
    };

    return true;
  };

  const patchExistingTools = () => {
    const toolManager = getToolManager();
    if (!toolManager || !toolManager.tools) return;
    let patched = 0;
    for (const tool of toolManager.tools) {
      if (patchToolInstance(tool)) {
        patched += 1;
      }
    }
    if (patched > 0) {
      renderDebugPanel();
    }
  };

  const scheduleToolPatch = () => {
    let attempts = 0;
    const maxAttempts = 15;
    const timer = setInterval(() => {
      attempts += 1;
      patchExistingTools();
      if (attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 750);
  };

  registerMessageReset();
  registerSettingsUI();
  registerToolCallEvents();
  registerChatSync();
  scheduleSyncState();
  patchExistingTools();
  scheduleToolPatch();

  const wrapRegisterFunctionTool = (registerFn, sourceLabel) => {
    if (typeof registerFn !== 'function') return null;

    return (def) => {
      if (def && def.__imageToolBudgetWrapped) {
        return registerFn(def);
      }
      const isImageTool = looksLikeImageToolDef(def);

      if (!isImageTool) {
        return registerFn(def);
      }

      if (def && def.name) {
        imageToolNames.add(def.name);
      }

      if (def) {
        def.__imageToolBudgetWrapped = true;
      }

      console.log('[ImageToolBudget] Detected image tool:', {
        source: sourceLabel,
        name: def?.name,
        displayName: def?.displayName,
        description: def?.description,
      });
      renderDebugPanel();

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
    const used = typeof usedByHistory === 'number' ? usedByHistory : (state.used || 0);
    const limit = getLimitPerTurn();
        return used < limit;
      };

      const originalAction = def.action;
      def.action = async (args, ...rest) => {
        const state = getState();
      const usedByHistory = getUsedByHistory();
      const used = typeof usedByHistory === 'number' ? usedByHistory : (state.used || 0);
      const limit = getLimitPerTurn();
        if (used >= limit) {
          console.warn('[ImageToolBudget] Blocked image tool call (limit reached).', { used, limit });
          return `Image tool call blocked: limit ${limit} per user message.`;
        }

        await markUsed();
        if (typeof originalAction === 'function') {
          return originalAction.call(def, args, ...rest);
        }
        return '';
      };

      return registerFn(def);
    };
  };

  const wrapInvokeFunctionTool = (invokeFn) => {
    if (typeof invokeFn !== 'function') return null;

    return async (name, parameters, ...rest) => {
      const toolName = toText(name);
      if (looksLikeImageToolName(toolName)) {
        const state = getState();
        const usedByHistory = getUsedByHistory();
        const used = typeof usedByHistory === 'number' ? usedByHistory : (state.used || 0);
        const limit = getLimitPerTurn();
        if (used >= limit) {
          console.warn('[ImageToolBudget] Blocked image tool invocation (limit reached).', { used, limit });
          return `Image tool call blocked: limit ${limit} per user message.`;
        }
      }
      return invokeFn(name, parameters, ...rest);
    };
  };

  const originalRegister = typeof ctx.registerFunctionTool === 'function'
    ? ctx.registerFunctionTool.bind(ctx)
    : null;

  if (!originalRegister) {
    console.warn('[ImageToolBudget] registerFunctionTool not found.');
  } else {
    ctx.registerFunctionTool = wrapRegisterFunctionTool(originalRegister, 'context');
  }

  const toolManager = getToolManager();
  if (toolManager && toolManager.registerFunctionTool) {
    const toolRegister = toolManager.registerFunctionTool.bind(toolManager);
    toolManager.registerFunctionTool = wrapRegisterFunctionTool(toolRegister, 'ToolManager');
  } else {
    console.warn('[ImageToolBudget] ToolManager.registerFunctionTool not found.');
  }

  if (toolManager && toolManager.invokeFunctionTool) {
    const toolInvoke = toolManager.invokeFunctionTool.bind(toolManager);
    toolManager.invokeFunctionTool = wrapInvokeFunctionTool(toolInvoke);
  } else {
    console.warn('[ImageToolBudget] ToolManager.invokeFunctionTool not found.');
  }
})();
