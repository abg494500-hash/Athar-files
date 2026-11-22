# تشغيل اختبارات SQL المحلية على Windows (PowerShell). لا اتصال إلا بخادم PostgreSQL المحلي. ينشئ قاعدتين مؤقتتين ويحذفهما:
#   athar_test_a (001-003 + اختبارات الأمان)   athar_test_b (001-004 + اختبارات الجلسات)
#   athar_test_c (001-005 + حسابات المسؤولين)  athar_test_d (001-007 + اختبارات 006/007: جلسات المعلمات وlog_audit_as وحارس الأرشيف)
# الاستعمال من جذر المشروع:
#   $env:PGPASSWORD = "كلمة مرور postgres المحلية"
#   powershell -ExecutionPolicy Bypass -File tests\sql\run-sql-tests.ps1
param(
  [string]$Psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe",
  [string]$DbHost = "localhost",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [switch]$Keep
)
$ErrorActionPreference = "Continue"  # إشعارات psql تُكتب على stderr؛ نعتمد $LASTEXITCODE لا الاستثناءات
if ($DbHost -notin @("localhost","127.0.0.1","::1")) { throw "مرفوض: يُسمح بخادم محلي فقط (وُجد $DbHost)." }
if (-not (Test-Path $Psql)) { throw "psql غير موجود في $Psql. ثبّتي PostgreSQL (انظر docs/phase5/WINDOWS_RUN_GUIDE.md) أو مرّري -Psql." }
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$out = Join-Path $PSScriptRoot "results"; New-Item -ItemType Directory -Force $out | Out-Null
function Run-Psql([string]$Db, [string]$File, [string]$Log) {
  & $Psql -h $DbHost -p $Port -U $User -d $Db -X -q -v ON_ERROR_STOP=0 -f $File *> $Log
}
function Admin([string]$Sql) { & $Psql -h $DbHost -p $Port -U $User -d postgres -X -q -v ON_ERROR_STOP=1 -c $Sql; if ($LASTEXITCODE -ne 0) { throw "فشل الاتصال/الأمر الإداري: $Sql (تحققي من PGPASSWORD والمنفذ)" } }
function Apply-Strict([string]$Db, [string]$File, [string]$Log) {
  & $Psql -h $DbHost -p $Port -U $User -d $Db -X -q -v ON_ERROR_STOP=1 -f $File *>> $Log
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL  تطبيق $File فشل (انظر $Log)" -ForegroundColor Red; return $false }
  Write-Host "OK    طُبِّق $(Split-Path $File -Leaf)"; return $true
}
$d = Join-Path $root "database"; $t = $PSScriptRoot
$draft = Join-Path $root "database\004_upload_tables.sql"
$s005 = Join-Path $root "database\005_staff_accounts.sql"
$s006 = Join-Path $root "database\006_teacher_sessions.sql"
$s007 = Join-Path $root "database\007_server_additions.sql"
$fail = 0
foreach ($run in @(
  @{ Db="athar_test_a"; Apply=@("$t\00_bootstrap.sql","$d\001_schema.sql","$d\002_integrity.sql","$d\003_rls.sql"); Test="$t\10_security_003.sql" },
  @{ Db="athar_test_b"; Apply=@("$t\00_bootstrap.sql","$d\001_schema.sql","$d\002_integrity.sql","$d\003_rls.sql",$draft); Test="$t\20_sessions_004.sql" },
  @{ Db="athar_test_c"; Apply=@("$t\00_bootstrap.sql","$d\001_schema.sql","$d\002_integrity.sql","$d\003_rls.sql",$draft,$s005); Test="$t\25_staff_accounts_005.sql" },
  @{ Db="athar_test_d"; Apply=@("$t\00_bootstrap.sql","$d\001_schema.sql","$d\002_integrity.sql","$d\003_rls.sql",$draft,$s005,$s006,$s007); Test="$t\35_server_additions_006_007.sql" })) {
  $db = $run.Db
  if ($db -notmatch '^athar_test_[abcd]$') { throw "اسم قاعدة غير متوقع" }
  $log = Join-Path $out "$db.log"; Remove-Item $log -ErrorAction SilentlyContinue
  Write-Host "=== $db ===" -ForegroundColor Cyan
  Admin "drop database if exists $db"; Admin "create database $db"
  $ok = $true
  foreach ($f in $run.Apply) { if (-not (Apply-Strict $db $f $log)) { $ok = $false; break } }
  if (-not $ok) { $fail++; continue }
  Run-Psql $db $run.Test $log
  $pass = (Select-String -Path $log -Pattern "PASS " -SimpleMatch).Count
  $bad  = Select-String -Path $log -Pattern "FAIL " -SimpleMatch
  Write-Host "$db : PASS=$pass FAIL=$($bad.Count)"
  $bad | ForEach-Object { Write-Host $_.Line -ForegroundColor Red }
  $fail += $bad.Count
  if (-not $Keep) { Admin "drop database $db" }
}
Write-Host "السجلات الكاملة: $out"
if ($fail -gt 0) { Write-Host "انتهى بإخفاقات: $fail" -ForegroundColor Red; exit 1 } else { Write-Host "كل الاختبارات نجحت" -ForegroundColor Green }
