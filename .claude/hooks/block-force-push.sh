#!/bin/bash
# Blocks git push --force / --force-with-lease on any branch.

set -e

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('tool_input', {}).get('command', ''))" 2>/dev/null || echo "")

if [ -z "$COMMAND" ]; then
  exit 0
fi

if echo "$COMMAND" | grep -qE "git[[:space:]]+push.*(--force|--force-with-lease|[[:space:]]-f([[:space:]]|$))"; then
  echo "BLOCKED: git push --force is not allowed." >&2
  echo "Command: $COMMAND" >&2
  echo "If you genuinely need to force-push, do it manually outside Claude Code." >&2
  exit 2
fi

exit 0
