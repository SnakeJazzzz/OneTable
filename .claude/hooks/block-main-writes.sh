#!/bin/bash
# Blocks destructive git operations on main/master branch.
# Reads tool input from stdin (JSON), exits 2 to block.

set -e

# Read JSON from stdin
INPUT=$(cat)

# Extract command (handles both Bash tool and others)
COMMAND=$(echo "$INPUT" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('tool_input', {}).get('command', ''))" 2>/dev/null || echo "")

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Patterns that modify history or state on main/master
DESTRUCTIVE_PATTERNS=(
  "git[[:space:]]+commit"
  "git[[:space:]]+add"
  "git[[:space:]]+push"
  "git[[:space:]]+merge"
  "git[[:space:]]+rebase"
  "git[[:space:]]+reset[[:space:]]+--hard"
  "git[[:space:]]+reset[[:space:]]+--soft"
  "git[[:space:]]+reset[[:space:]]+--mixed"
  "git[[:space:]]+revert"
  "git[[:space:]]+cherry-pick"
)

# Check if command targets main/master via checkout chain
TARGETS_MAIN=false
if echo "$COMMAND" | grep -qE "git[[:space:]]+checkout[[:space:]]+(main|master)"; then
  TARGETS_MAIN=true
fi

# Check if we're already on main/master
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  TARGETS_MAIN=true
fi

if [ "$TARGETS_MAIN" = "true" ]; then
  for pattern in "${DESTRUCTIVE_PATTERNS[@]}"; do
    if echo "$COMMAND" | grep -qE "$pattern"; then
      echo "BLOCKED: Destructive git operation on main/master branch detected." >&2
      echo "Command: $COMMAND" >&2
      echo "Current branch: $CURRENT_BRANCH" >&2
      echo "Create a feature branch first: git checkout -b feature/<name>" >&2
      exit 2
    fi
  done
fi

exit 0
