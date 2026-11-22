# فحص للقراءة فقط: هل على جهازك PostgreSQL أو Docker أو WSL جاهز؟ لا يثبّت ولا يغيّر شيئًا. شغّليه وأرسلي لي الناتج.
#   powershell -ExecutionPolicy Bypass -File tests\sql\detect-postgres.ps1
Write-Host "--- psql في PATH"
Get-Command psql -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
Write-Host "--- مجلدات PostgreSQL المعتادة"
Get-ChildItem "C:\Program Files\PostgreSQL" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
Write-Host "--- خدمات Windows باسم postgres"
Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*postgres*" } | Select-Object Name, Status
Write-Host "--- Docker"
docker --version 2>$null
Write-Host "--- WSL"
wsl -l -v 2>$null
Write-Host "--- Node وGit"
node -v 2>$null; git --version 2>$null
Write-Host "انتهى. (إن كانت كل الأقسام فارغة فاتبعي الخيار 1 في docs/phase5/WINDOWS_RUN_GUIDE.md)"
