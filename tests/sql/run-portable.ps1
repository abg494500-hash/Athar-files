# يشغّل PostgreSQL محمولًا مؤقتًا (بلا تثبيت ولا خدمة ولا تعديل للسجل) ثم اختبارات SQL ثم يوقفه ويحذف بياناته المؤقتة.
# المتطلب: فكّ ملف «binaries» الرسمي لـPostgreSQL 16 لنظام Windows في أي مجلد (مثل C:\tools\pgsql) ثم:
#   powershell -ExecutionPolicy Bypass -File tests\sql\run-portable.ps1 -PgBin "C:\tools\pgsql\bin"
# يستخدم المنفذ 54329 على localhost فقط وبيانات في %TEMP%\athar-pg ويُحذف بعد الانتهاء. **لم يُجرَّب على Windows بعد.**
param([Parameter(Mandatory=$true)][string]$PgBin, [int]$Port = 54329)
$ErrorActionPreference = "Continue"
foreach ($e in "initdb.exe","pg_ctl.exe","psql.exe") { if (-not (Test-Path (Join-Path $PgBin $e))) { throw "لم أجد $e في $PgBin" } }
$data = Join-Path $env:TEMP "athar-pg"
if (Test-Path $data) { throw "المجلد $data موجود؛ احذفيه يدويًا أولًا (لن أحذف شيئًا لم أنشئه في هذا التشغيل)." }
& (Join-Path $PgBin "initdb.exe") -D $data -U postgres -A trust -E UTF8 --locale=C
if ($LASTEXITCODE -ne 0) { throw "initdb فشل" }
& (Join-Path $PgBin "pg_ctl.exe") -D $data -l (Join-Path $env:TEMP "athar-pg.log") -o "-p $Port -c listen_addresses=localhost" -w start
if ($LASTEXITCODE -ne 0) { throw "pg_ctl start فشل (انظر $env:TEMP\athar-pg.log)" }
try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-sql-tests.ps1") -Psql (Join-Path $PgBin "psql.exe") -Port $Port -User postgres
  $code = $LASTEXITCODE
} finally {
  & (Join-Path $PgBin "pg_ctl.exe") -D $data -m fast stop
  Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
}
exit $code
