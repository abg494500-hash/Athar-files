#!/bin/sh
# نفس run-sql-tests.ps1 لنظام Linux/macOS. محلي فقط. الاستعمال من جذر المشروع: PGPASSWORD=... sh tests/sql/run-sql-tests.sh
set -u
H=${PGHOST:-localhost}; P=${PGPORT:-5432}; U=${PGUSER:-postgres}
case "$H" in localhost|127.0.0.1|::1|/*) ;; *) echo "مرفوض: خادم محلي فقط"; exit 2;; esac
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T="$ROOT/tests/sql"; D="$ROOT/database"
DRAFT="$ROOT/database/004_upload_tables.sql"; OUT="$T/results"; mkdir -p "$OUT"
PS="psql -h $H -p $P -U $U -X -q"; fail=0
for run in a b c d; do
  db="athar_test_$run"; log="$OUT/$db.log"; : > "$log"
  echo "=== $db ==="
  $PS -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $db" -c "create database $db" || exit 2
  if [ $run = a ]; then files="$T/00_bootstrap.sql $D/001_schema.sql $D/002_integrity.sql $D/003_rls.sql"; test="$T/10_security_003.sql"
  elif [ $run = b ]; then files="$T/00_bootstrap.sql $D/001_schema.sql $D/002_integrity.sql $D/003_rls.sql $DRAFT"; test="$T/20_sessions_004.sql"
  elif [ $run = c ]; then files="$T/00_bootstrap.sql $D/001_schema.sql $D/002_integrity.sql $D/003_rls.sql $DRAFT $D/005_staff_accounts.sql"; test="$T/25_staff_accounts_005.sql"
  else files="$T/00_bootstrap.sql $D/001_schema.sql $D/002_integrity.sql $D/003_rls.sql $DRAFT $D/005_staff_accounts.sql $D/006_teacher_sessions.sql $D/007_server_additions.sql"; test="$T/35_server_additions_006_007.sql"; fi
  ok=1
  for f in $files; do
    if $PS -d $db -v ON_ERROR_STOP=1 -f "$f" >> "$log" 2>&1; then echo "OK    $(basename "$f")"; else echo "FAIL  تطبيق $f فشل (انظر $log)"; ok=0; fail=$((fail+1)); break; fi
  done
  [ $ok = 1 ] || continue
  $PS -d $db -v ON_ERROR_STOP=0 -f "$test" >> "$log" 2>&1
  p=$(grep -c "PASS " "$log"); b=$(grep -c "FAIL " "$log"); echo "$db : PASS=$p FAIL=$b"; grep "FAIL " "$log"; fail=$((fail+b))
  $PS -d postgres -c "drop database $db" >/dev/null
done
[ $fail -eq 0 ] && echo "كل الاختبارات نجحت" || { echo "انتهى بإخفاقات: $fail"; exit 1; }
