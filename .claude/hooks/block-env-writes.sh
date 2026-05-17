#!/bin/bash
# Blocks any write operation to .env* files.

set -e

INPUT=$(cat)

# Extract file path from various tool inputs (Write, Edit, MultiEdit, str_replace, create_file)
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {})
    # Try common keys
    for key in ['file_path', 'path', 'filepath', 'filename']:
        if key in ti:
            print(ti[key])
            break
except: pass
" 2>/dev/null || echo "")

# Also check Bash commands that write to env files
COMMAND=$(echo "$INPUT" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('tool_input', {}).get('command', ''))" 2>/dev/null || echo "")

# Patterns that match .env files
if [ -n "$FILE_PATH" ]; then
  if echo "$FILE_PATH" | grep -qE "(^|/)\.env($|\.|/)"; then
    echo "BLOCKED: Write to .env file detected: $FILE_PATH" >&2
    echo "Env files must be created manually by the developer. Never commit them." >&2
    exit 2
  fi
fi

if [ -n "$COMMAND" ]; then
  # Patterns: writing to .env via redirection, cp, mv, tee, etc.
  if echo "$COMMAND" | grep -qE "(>|>>|tee[[:space:]]+).*\.env"; then
    echo "BLOCKED: Bash command writes to .env file." >&2
    echo "Command: $COMMAND" >&2
    exit 2
  fi
  if echo "$COMMAND" | grep -qE "(cp|mv)[[:space:]]+[^[:space:]]+[[:space:]]+.*\.env"; then
    echo "BLOCKED: Bash command copies/moves to .env file." >&2
    echo "Command: $COMMAND" >&2
    exit 2
  fi
fi

exit 0
