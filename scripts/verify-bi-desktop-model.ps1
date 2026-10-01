param([string]$OutputDirectory, [string]$ExpectedPath = 'artifacts/desktop-bi/input/expected.json')
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Run model acceptance only in the isolated desktop acceptance runner.'
}
$workspace = Join-Path $env:LOCALAPPDATA 'Microsoft/Power BI Desktop/AnalysisServicesWorkspaces'
$engineIds = @((Get-Process -Name msmdsrv -ErrorAction SilentlyContinue).Id)
$listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $engineIds }).LocalPort
$ports = @(Get-ChildItem $workspace -Filter 'msmdsrv.port.txt' -Recurse | Where-Object {
  $candidate = (Get-Content $_.FullName -Raw).Trim().Replace([string][char]0, '')
  $candidate -match '^\d{1,5}$' -and [int]$candidate -in $listening
})
if ($ports.Count -ne 1) { throw 'Expected one isolated Power BI Desktop Analysis Services instance.' }
$port = (Get-Content $ports[0].FullName -Raw).Trim().Replace([string][char]0, '')
if ($port -notmatch '^\d{1,5}$') { throw 'The Desktop Analysis Services port is invalid.' }
$program = Join-Path $PSScriptRoot 'desktop-bi-model/bin/Release/net8.0/PartnerHub.DesktopModel.dll'
if (-not (Test-Path $program)) { throw 'Build the managed Microsoft ADOMD verifier before running Desktop acceptance.' }
& dotnet $program $port (Resolve-Path $ExpectedPath).Path $OutputDirectory (git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) {
  $result = Get-Content (Join-Path $OutputDirectory 'model-values.json') -Raw | ConvertFrom-Json
  throw "Desktop's loaded model did not match the fixture: $($result.error)"
}
