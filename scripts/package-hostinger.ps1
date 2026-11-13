param([string]$ApiOrigin = '')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($ApiOrigin) {
  $taskApi = [Uri]$ApiOrigin
  if ($taskApi.Scheme -ne 'https' -or $taskApi.AbsolutePath -ne '/' -or $taskApi.UserInfo -or $taskApi.Query -or $taskApi.Fragment) { throw 'ApiOrigin must be an HTTPS origin without /api, credentials or query.' }
  $ApiOrigin = $taskApi.GetLeftPart([UriPartial]::Authority)
}
Push-Location $taskRoot
try {
  & npm.cmd --workspace apps/frontend run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
  $taskDist = Join-Path $taskRoot 'apps/frontend/dist/frontend/browser'
  if (!(Test-Path -LiteralPath (Join-Path $taskDist 'index.html'))) { throw 'Angular production output not found.' }
  Copy-Item -LiteralPath (Join-Path $taskRoot 'deploy/hostinger/.htaccess') -Destination (Join-Path $taskDist '.htaccess')
  $taskConfig = 'window.OCONSULTOR_CONFIG = Object.freeze({apiOrigin:' + (ConvertTo-Json $ApiOrigin -Compress) + '});'
  [IO.File]::WriteAllText((Join-Path $taskDist 'assets/app-config.js'), $taskConfig, [Text.UTF8Encoding]::new($false))
  $taskFiles = @(Get-ChildItem -LiteralPath $taskDist -Force)
  if (Get-ChildItem -LiteralPath $taskDist -Recurse -Force | Where-Object { $_.Name -match '^\.env|\.map$|^ngrok\.yml$' }) { throw 'Unexpected private or debugging file in output.' }
  $taskOutput = Join-Path $taskRoot 'artifacts/hostinger'
  New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
  $taskZip = Join-Path $taskOutput 'o-consultor-frontend.zip'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Add-Type -AssemblyName System.IO.Compression
  # Build a fresh archive without deleting an existing publication package.
  if (Test-Path -LiteralPath $taskZip) { $taskZip = Join-Path $taskOutput ('o-consultor-frontend-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip') }
  $taskArchive = [IO.Compression.ZipFile]::Open($taskZip, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($taskFile in (Get-ChildItem -LiteralPath $taskDist -File -Force -Recurse)) {
      $taskEntry = $taskFile.FullName.Substring($taskDist.Length).TrimStart([char[]]'\/').Replace('\','/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive,$taskFile.FullName,$taskEntry,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $taskArchive.Dispose() }
  Write-Output ('Package: ' + $taskZip)
  if (!$ApiOrigin) { Write-Warning 'Before upload, set apiOrigin in assets/app-config.js to the public HTTPS backend origin.' }
} finally { Pop-Location }
