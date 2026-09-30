param([ValidateSet('power-bi', 'tableau')][string]$Platform)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Run desktop acceptance in an isolated Windows Actions runner.'
}
$out = Join-Path (Get-Location) "artifacts/desktop-bi/$Platform"
New-Item -ItemType Directory -Force $out | Out-Null
$tools = Get-Content scripts/desktop-bi-tools.json -Raw | ConvertFrom-Json
$tool = $tools.$Platform
$checks = [System.Collections.Generic.List[object]]::new()
$report = [ordered]@{
  platform = $Platform
  commit = (git rev-parse HEAD)
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  application = $tool.name
  applicationVersion = $tool.version
  syntheticData = $true
  productionDataRead = $false
  externalPublication = $false
  checks = $checks
  desktopAcceptanceCompleted = $false
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PartnerHubDesktop {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
'@
function Capture-Screen([string]$Name) {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
    $bitmap.Save((Join-Path $out "$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
function Get-AppWindow {
  $processes = @(Get-Process -Name $script:processName -ErrorAction SilentlyContinue | Sort-Object @{ Expression = { $_.MainWindowTitle -like '*VS PartnerHub*' }; Descending = $true })
  foreach ($process in $processes) {
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
      return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    }
  }
  return $null
}
function Read-Controls($Window) {
  if ($null -eq $Window) { return @() }
  $elements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $result = @()
  foreach ($element in $elements) {
    try {
      $current = $element.Current
      if ($current.Name) {
        $result += [pscustomobject]@{ name = $current.Name; type = $current.ControlType.ProgrammaticName; enabled = $current.IsEnabled; offscreen = $current.IsOffscreen; element = $element }
      }
    } catch {}
  }
  return $result
}
function Save-Controls([string]$Name, $Controls) {
  @($Controls | Select-Object name, type, enabled, offscreen) | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out "$Name.json") -Encoding UTF8
}
function Invoke-Control($Control) {
  $pattern = $null
  if ($Control.element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke(); return $true
  }
  if ($Control.element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    $pattern.Select(); return $true
  }
  return $false
}
try {
  $installer = Join-Path $env:RUNNER_TEMP "partnerhub-$Platform-setup.exe"
  if (-not (Test-Path $installer) -or (Get-FileHash $installer -Algorithm SHA256).Hash -ne $tool.sha256) {
    Write-Host "Downloading official $($tool.name) $($tool.version)."
    & curl.exe --fail --location --retry 2 --max-time 600 --output $installer $tool.url
    if ($LASTEXITCODE -ne 0) { throw "The official installer download failed with code $LASTEXITCODE." }
  }
  if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $tool.sha256) { throw 'Official installer checksum does not match the pinned manifest.' }
  $signature = Get-AuthenticodeSignature $installer
  if ($signature.Status -ne 'Valid') { throw 'The official installer signature is not valid.' }
  if ($env:GITHUB_OUTPUT) { Add-Content $env:GITHUB_OUTPUT 'installer_verified=true' }
  $checks.Add(@{ name = 'Official installer hash and Authenticode signature'; passed = $true })
  $arguments = if ($Platform -eq 'power-bi') { @('-quiet', '-norestart', 'ACCEPT_EULA=1', 'DISABLE_UPDATE_NOTIFICATION=1') } else { @('-quiet', '-norestart', 'ACCEPTEULA=1', 'SKIPAPPLICATIONLAUNCH=1') }
  $arguments += @('-log', ('"' + (Join-Path $out 'installer.log') + '"'))
  Write-Host 'Installer verified; starting the desktop installation.'
  $installed = Start-Process $installer -ArgumentList $arguments -PassThru
  # Start-Process -Wait also waits for updater/application descendants. Wait for
  # the actual installer process, whose exit code is the installation result.
  if (-not $installed.WaitForExit(480000)) {
    Capture-Screen 'installer-timeout'
    $installed.Kill()
    throw 'The official desktop installer exceeded eight minutes; inspect installer.log.'
  }
  if ($installed.ExitCode -notin @(0, 3010)) { throw "Desktop installation failed with code $($installed.ExitCode)." }
  Write-Host "Desktop installation completed with code $($installed.ExitCode)."
  if ($Platform -eq 'power-bi') {
    $application = Join-Path $env:ProgramFiles 'Microsoft Power BI Desktop/bin/PBIDesktop.exe'
    $script:processName = 'PBIDesktop'
    $workbook = (Resolve-Path 'artifacts/desktop-bi/input/power-bi/VS PartnerHub.pbip').Path
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1'
  } else {
    $application = (Get-ChildItem (Join-Path $env:ProgramFiles 'Tableau') -Filter tabreader.exe -Recurse | Select-Object -First 1).FullName
    $script:processName = 'tabreader'
    $workbook = (Resolve-Path 'artifacts/desktop-bi/input/VS-PartnerHub-Tableau.twbx').Path
  }
  if (-not (Test-Path $application)) { throw 'Installed desktop executable was not found.' }
  $checks.Add(@{ name = 'Desktop application installed'; passed = $true })
  Start-Process $application -ArgumentList ('"' + $workbook + '"') | Out-Null
  $deadline = (Get-Date).AddSeconds(180)
  $refreshed = $false
  $controls = @()
  do {
    Start-Sleep -Seconds 3
    $window = Get-AppWindow
    if ($null -eq $window) { continue }
    [PartnerHubDesktop]::ShowWindow([IntPtr]$window.Current.NativeWindowHandle, 3) | Out-Null
    [PartnerHubDesktop]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle) | Out-Null
    $controls = @(Read-Controls $window)
    Save-Controls 'latest-controls' $controls
    Capture-Screen 'latest-screen'
    if ($controls.name -contains 'Issues were found') { throw 'Power BI Desktop rejected the report project. Inspect the retained error dialog.' }
    foreach ($label in @('Not now', 'Continue without signing in', 'Apply changes')) {
      $action = $controls | Where-Object { $_.name -eq $label -and $_.enabled -and -not $_.offscreen } | Select-Object -First 1
      if ($action) { Invoke-Control $action | Out-Null }
    }
    if ($Platform -eq 'power-bi' -and -not $refreshed) {
      $refresh = $controls | Where-Object { $_.name -eq 'Refresh' -and $_.enabled -and -not $_.offscreen } | Select-Object -First 1
      if ($refresh -and (Invoke-Control $refresh)) { $refreshed = $true; Write-Host 'Requested snapshot refresh in Power BI Desktop.' }
    }
    $titles = @((Get-Content artifacts/desktop-bi/input/expected.json -Raw | ConvertFrom-Json).pages.title)
    $found = @($titles | Where-Object { $controls.name -contains $_ })
    if ($found.Count -eq 8 -and ($Platform -ne 'power-bi' -or $refreshed)) { break }
  } while ((Get-Date) -lt $deadline)
  if ($null -eq $window) { throw 'The desktop application did not open a window.' }
  $report.windowTitle = $window.Current.Name
  $report.snapshotRefreshRequested = $refreshed
  $report.visibleDashboardTitles = @($titles | Where-Object { $controls.name -contains $_ })
  $checks.Add(@{ name = 'Workbook opened in the installed desktop application'; passed = $true })
  if ($report.visibleDashboardTitles.Count -ne 8) { throw 'All eight dashboard tabs were not available. Inspect the retained application screenshot and control tree.' }
  $checks.Add(@{ name = 'Eight dashboard tabs are exposed by the actual desktop application'; passed = $true })
  if ($Platform -eq 'power-bi') {
    # Refresh runs asynchronously. Model validation must inspect its loaded data,
    # including all rows, numeric units and preserved blanks, before UI acceptance.
    $modelDeadline = (Get-Date).AddSeconds(90)
    $modelReady = $false
    do {
      try {
        & ./scripts/verify-bi-desktop-model.ps1 -OutputDirectory $out
        $modelReady = $true
      } catch {
        if ((Get-Date) -ge $modelDeadline) { throw }
        Start-Sleep -Seconds 3
      }
    } until ($modelReady)
    $checks.Add(@{ name = 'Desktop refreshed source rows, DAX values and display units match the offline fixture'; passed = $true })
  }
  foreach ($title in $titles) {
    $control = $controls | Where-Object { $_.name -eq $title } | Select-Object -First 1
    if (-not (Invoke-Control $control)) { throw "Desktop tab selection is unavailable for $title." }
    Start-Sleep -Seconds 3
    Capture-Screen ($title -replace '[^a-zA-Z0-9]+', '-')
    $controls = @(Read-Controls (Get-AppWindow))
    Save-Controls ($title -replace '[^a-zA-Z0-9]+', '-') $controls
    if ($Platform -eq 'power-bi') {
      $page = (Get-Content artifacts/desktop-bi/input/expected.json -Raw | ConvertFrom-Json).pages | Where-Object { $_.title -eq $title }
      & node scripts/verify-bi-desktop-render.mjs $page.id
      if ($LASTEXITCODE -ne 0) { throw "The actual Desktop visuals did not pass for $title." }
    }
  }
  $checks.Add(@{ name = 'Every dashboard can be selected and has a retained desktop screenshot'; passed = $true })
  $report.desktopAcceptanceCompleted = $Platform -eq 'power-bi'
  if ($Platform -ne 'power-bi') { $report.remainingValidation = 'Review rendered Tableau visuals and loaded values before claiming desktop acceptance.' }
} catch {
  $checks.Add(@{ name = 'Desktop workbook verification'; passed = $false; error = $_.Exception.Message })
  $report.error = $_.Exception.Message
  Capture-Screen 'failure'
  Write-Error $_ -ErrorAction Continue
  $script:failed = $true
} finally {
  $report.completedAt = (Get-Date).ToUniversalTime().ToString('o')
  $report | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $out 'report.json') -Encoding UTF8
  if ($Platform -eq 'power-bi') {
    & node scripts/verify-bi-desktop-render.mjs diagnostics
    $workspace = Join-Path $env:LOCALAPPDATA 'Microsoft/Power BI Desktop/AnalysisServicesWorkspaces'
    if (Test-Path $workspace) {
      Get-ChildItem $workspace -Filter '*.port.txt' -Recurse | ForEach-Object { @{ file = $_.Name; port = (Get-Content $_.FullName -Raw).Trim() } } | ConvertTo-Json | Set-Content (Join-Path $out 'analysis-services.json') -Encoding UTF8
    }
  }
  Write-Host "Desktop evidence saved to $out."
}
if ($script:failed) { exit 1 }
