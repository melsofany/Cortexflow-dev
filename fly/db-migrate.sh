#!/bin/bash
set -e

export FLYCTL_INSTALL="/home/runner/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

echo "=== Running CortexFlow Database Migrations ==="

if [ -z "$DATABASE_URL" ]; then
    echo "Fetching DATABASE_URL from fly secrets..."
    DATABASE_URL=$(flyctl secrets list --app cortexflow-api --json 2>/dev/null | python3 -c "
import sys, json
secrets = json.load(sys.stdin)
for s in secrets:
    if s.get('Name') == 'DATABASE_URL':
        print(s.get('Digest', ''))
        break
" 2>/dev/null || echo "")
fi

if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL not found. Make sure the database is attached."
    exit 1
fi

export DATABASE_URL

echo "Running Drizzle schema push..."
cd /home/runner/workspace
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db push

echo "=== Database migrations complete ==="
