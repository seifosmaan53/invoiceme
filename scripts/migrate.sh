#!/bin/bash
# Automated database migration script
# Usage: ./migrate.sh [run|revert|generate <name>]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"

cd "$BACKEND_DIR"

ACTION="${1:-run}"

case "$ACTION" in
  run)
    echo "🔄 Running database migrations..."
    npm run migration:run
    echo "✅ Migrations completed successfully"
    ;;
  revert)
    echo "⏪ Reverting last migration..."
    npm run migration:revert
    echo "✅ Migration reverted successfully"
    ;;
  generate)
    if [ -z "$2" ]; then
      echo "❌ Error: Migration name required"
      echo "Usage: ./migrate.sh generate <MigrationName>"
      exit 1
    fi
    echo "📝 Generating migration: $2"
    npm run migration:generate -- -n "$2"
    echo "✅ Migration generated: migrations/$(date +%Y%m%d%H%M%S)_$2.ts"
    ;;
  *)
    echo "❌ Unknown action: $ACTION"
    echo "Usage: ./migrate.sh [run|revert|generate <name>]"
    exit 1
    ;;
esac

