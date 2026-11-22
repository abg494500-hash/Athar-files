#!/bin/sh
# PostgreSQL محلي مؤقت لاختبارات SQL والطبقة الخادمية (Linux/macOS). **ليس Supabase ولا يتصل بأي شبكة** (socket محلي فقط).
# الاستعمال من جذر المشروع:
#   sh scripts/local-pg.sh start     # ينشئ مجلد بيانات مؤقتًا ويشغّل الخادم، ثم يطبع أوامر التصدير
#   eval "$(sh scripts/local-pg.sh env)"
#   sh tests/sql/run-sql-tests.sh && sh scripts/node-test-runner/run.sh
#   sh scripts/local-pg.sh stop
# إن كنتِ root (حاويات): يرفض PostgreSQL التشغيل كـroot، فيُنشأ مستخدم pgtest تلقائيًا ويُشغَّل به.
# يحتاج ثنائيات PostgreSQL (initdb وpg_ctl وpsql) في PATH أو تحت /usr/lib/postgresql/*/bin.
set -eu
BASE=${ATHAR_PG_BASE:-${TMPDIR:-/tmp}/athar-pg}
PORT=${ATHAR_PG_PORT:-54329}
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$BIN" ] && PATH="$BIN:$PATH"
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -c "PATH=$PATH; $*"; else sh -c "$*"; fi; }
case "${1:-}" in
  start)
    command -v initdb >/dev/null || { echo "initdb غير موجود: ثبّتي PostgreSQL 15+"; exit 2; }
    if [ "$(id -u)" = 0 ]; then id pgtest >/dev/null 2>&1 || useradd -m pgtest; BASE=/home/pgtest/athar-pg; fi
    mkdir -p "$BASE/run"; [ "$(id -u)" = 0 ] && chown -R pgtest:pgtest "$BASE"
    [ -d "$BASE/data" ] || as_pg "initdb -D $BASE/data -U postgres --auth=trust -E UTF8 >/dev/null"
    as_pg "pg_ctl -D $BASE/data -o \"-p $PORT -k $BASE/run -c listen_addresses=''\" -l $BASE/log -w start" >/dev/null
    echo "تم. الآن: eval \"\$(sh scripts/local-pg.sh env)\"" ;;
  env)
    [ "$(id -u)" = 0 ] && BASE=/home/pgtest/athar-pg
    echo "export PGHOST=$BASE/run PGPORT=$PORT PGUSER=postgres ATHAR_TEST_PG=$BASE/run ATHAR_TEST_PG_PORT=$PORT" ;;
  stop)
    [ "$(id -u)" = 0 ] && BASE=/home/pgtest/athar-pg
    as_pg "pg_ctl -D $BASE/data -m fast stop" ;;
  *) echo "الاستعمال: sh scripts/local-pg.sh start|env|stop"; exit 2 ;;
esac
