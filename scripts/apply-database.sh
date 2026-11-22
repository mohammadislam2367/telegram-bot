#!/usr/bin/env bash
# =============================================================================
# Anime Click Ultimate — apply database files in the correct order
#
# usage:
#   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
#   ./scripts/apply-database.sh
#
# DATABASE_URL را از Supabase → Project Settings → Database → Connection string بگیرید.
# این اسکریپت schema/policies/seed را اجرا می‌کند؛ cron.sql را بعد از deploy توابع
# و ثبت SCHEDULER_SECRET در Vault به‌صورت جداگانه اجرا کنید.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_DIR="$ROOT_DIR/supabase/database"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found. Install PostgreSQL client tools." >&2
  exit 1
fi

for file in schema.sql policies.sql seed.sql; do
  echo "→ applying $file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$DB_DIR/$file"
done

echo "✓ schema, policies and seed applied"
echo "→ next: deploy functions, then run supabase/database/cron.sql (see docs/DEPLOYMENT.md)"
