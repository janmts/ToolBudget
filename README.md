# ToolBudget

SillyTavern UI extension that hard-limits the built-in Image Generation function tool to one call per user message (0 or 1).

## Install
1. Copy this repository folder into your SillyTavern `extensions/` directory.
2. Enable the extension in SillyTavern and reload.
3. Open the Extensions settings to configure the per-turn limit and debug panel.

## What It Does
- Enforces a per-chat budget stored in `chatMetadata`.
- Resets the budget on each user message.
- Prevents repeat image tool calls in the same user turn.

## Settings
- Max image tool calls per user message: `0` or `1`.
- Show debug panel: displays current budget state and detected tool info.
