param(
  [Parameter(Mandatory = $true)]
  [string]$PostgresPassword
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$encodedPassword = [uri]::EscapeDataString($PostgresPassword)
$databaseUrl = "postgresql://postgres:$encodedPassword@localhost:5432/olist_ml_audit?schema=public"

if (-not (Test-Path $psql)) {
  throw "psql.exe nao encontrado em $psql"
}

function Update-EnvFile($path) {
  $content = Get-Content -LiteralPath $path -Raw
  $content = $content -replace 'DATABASE_URL="[^"]+"', "DATABASE_URL=`"$databaseUrl`""
  Set-Content -LiteralPath $path -Value $content -Encoding UTF8
}

Update-EnvFile (Join-Path $root ".env")
Update-EnvFile (Join-Path $root "apps\backend\.env")

$env:PGPASSWORD = $PostgresPassword
$databaseExists = & $psql -h localhost -p 5432 -U postgres -d postgres -w -tAc "SELECT 1 FROM pg_database WHERE datname = 'olist_ml_audit';"
if ($databaseExists -ne "1") {
  & $psql -h localhost -p 5432 -U postgres -d postgres -w -c 'CREATE DATABASE olist_ml_audit;'
}

$env:DATABASE_URL = $databaseUrl

npm.cmd --workspace apps/backend run prisma:migrate
if ($LASTEXITCODE -ne 0) {
  Write-Host "Prisma migrate falhou; aplicando migration inicial via psql."
  & $psql -h localhost -p 5432 -U postgres -d olist_ml_audit -w -f (Join-Path $root "apps\backend\prisma\migrations\20260817141000_init\migration.sql")
}

npm.cmd run seed
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
