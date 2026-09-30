param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Run model acceptance only in the isolated desktop acceptance runner.'
}
$workspace = Join-Path $env:LOCALAPPDATA 'Microsoft/Power BI Desktop/AnalysisServicesWorkspaces'
$ports = @(Get-ChildItem $workspace -Filter 'msmdsrv.port.txt' -Recurse | Sort-Object LastWriteTime -Descending)
if ($ports.Count -ne 1) { throw 'Expected one isolated Power BI Desktop Analysis Services instance.' }
$port = (Get-Content $ports[0].FullName -Raw).Trim().Replace([string][char]0, '')
if ($port -notmatch '^\d{1,5}$') { throw 'The Desktop Analysis Services port is invalid.' }
$program = Join-Path $PSScriptRoot 'desktop-bi-model/bin/Release/net8.0/PartnerHub.DesktopModel.dll'
if (-not (Test-Path $program)) { throw 'Build the managed Microsoft ADOMD verifier before running Desktop acceptance.' }
& dotnet $program $port (Resolve-Path 'artifacts/desktop-bi/input/expected.json').Path $OutputDirectory (git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) {
  $result = Get-Content (Join-Path $OutputDirectory 'model-values.json') -Raw | ConvertFrom-Json
  throw "Desktop's loaded model did not match the fixture: $($result.error)"
}
