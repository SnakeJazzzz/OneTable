#!/bin/bash
# Blocks rm -rf with absolute paths outside the repo, /tmp, /var/tmp.

set -e

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('tool_input', {}).get('command', ''))" 2>/dev/null || echo "")

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Match: rm with -r/-rf/-fr/-R (recursive) AND -f
# Pattern catches: rm -rf, rm -fr, rm -r -f, rm -f -r, rm --recursive --force, etc.
if echo "$COMMAND" | grep -qE "\brm[[:space:]]+([^[:space:]|;&]+[[:space:]]+)*(-[rRfF]+|--recursive|--force)"; then
  # Extract absolute paths
  ABS_PATHS=$(echo "$COMMAND" | grep -oE "(^|[[:space:]])/[^[:space:]'\"|;&]+" || echo "")
  
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  
  if [ -n "$ABS_PATHS" ]; then
    while IFS= read -r path; do
      path=$(echo "$path" | xargs)  # trim whitespace
      [ -z "$path" ] && continue
      
      # Allow /tmp and /var/tmp
      if [[ "$path" == /tmp/* ]] || [ "$path" = "/tmp" ] || [[ "$path" == /var/tmp/* ]] || [ "$path" = "/var/tmp" ]; then
        continue
      fi
      
      # Allow paths inside repo
      if [ -n "$REPO_ROOT" ] && [[ "$path" == "$REPO_ROOT"* ]]; then
        continue
      fi
      
      echo "BLOCKED: rm -rf with absolute path outside repo detected." >&2
      echo "Command: $COMMAND" >&2
      echo "Path: $path" >&2
      echo "Allowed: paths inside the repo, /tmp, /var/tmp." >&2
      exit 2
    done <<< "$ABS_PATHS"
  fi
fi

exit 0
