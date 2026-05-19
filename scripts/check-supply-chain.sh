#!/bin/bash
echo "Checking for Mini Shai-Hulud infection markers..."
INFECTED=0
[ -f ~/Library/LaunchAgents/com.user.gh-token-monitor.plist ] && echo "❌ INFECTED: gh-token-monitor daemon" && INFECTED=1
[ -f ~/.claude/router_runtime.js ] && echo "❌ INFECTED: router_runtime.js" && INFECTED=1
[ -f ~/.vscode/setup.mjs ] && echo "❌ INFECTED: setup.mjs" && INFECTED=1
[ $INFECTED -eq 1 ] && exit 1
echo "✅ Clean — no infection markers detected"
