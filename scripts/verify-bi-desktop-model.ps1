param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Run model acceptance only in the isolated desktop acceptance runner.'
}
$expected = Get-Content artifacts/desktop-bi/input/expected.json -Raw | ConvertFrom-Json
if (-not $expected.syntheticData -or $expected.productionDataRead -or $expected.externalPublication) {
  throw 'Desktop model acceptance requires the synthetic offline fixture.'
}
Add-Type -AssemblyName System.Data
$result = [ordered]@{
  commit = (git rev-parse HEAD)
  syntheticData = $true
  source = 'The running Power BI Desktop local Analysis Services model'
  passed = $false
  checks = [System.Collections.Generic.List[object]]::new()
}
$connection = $null
function New-ModelConnection([string]$Port, [string]$Catalog) {
  # Desktop installs the Microsoft OLAP provider. Query its actual running
  # engine; reading model.bim again would not prove the snapshot was loaded.
  $builder = New-Object System.Data.OleDb.OleDbConnectionStringBuilder
  $builder['Provider'] = 'MSOLAP'
  $builder['Data Source'] = "localhost:$Port"
  $builder['Connect Timeout'] = 15
  $builder['Integrated Security'] = 'SSPI'
  if ($Catalog) { $builder['Initial Catalog'] = $Catalog }
  $client = New-Object System.Data.OleDb.OleDbConnection($builder.ConnectionString)
  $client.Open()
  return $client
}
function Read-ModelRows([string]$Query) {
  $command = $script:connection.CreateCommand()
  $command.CommandText = $Query
  $command.CommandTimeout = 30
  $reader = $null
  try {
    $reader = $command.ExecuteReader()
    $rows = [System.Collections.Generic.List[object]]::new()
    while ($reader.Read()) {
      $row = [ordered]@{}
      for ($index = 0; $index -lt $reader.FieldCount; $index++) {
        $name = $reader.GetName($index) -replace '^.*\[([^\]]+)\]$', '$1'
        $row[$name] = if ($reader.IsDBNull($index)) { $null } else { $reader.GetValue($index) }
      }
      $rows.Add([pscustomobject]$row)
    }
    return $rows.ToArray()
  } finally {
    if ($reader) { $reader.Dispose() }
    $command.Dispose()
  }
}
function Assert-Value($Actual, $ExpectedValue, [string]$Label) {
  if ($null -eq $ExpectedValue) {
    if ($null -ne $Actual -and $Actual -isnot [DBNull]) { throw "${Label}: missing evidence was not preserved as blank." }
  } elseif ($ExpectedValue -is [string]) {
    if ($Actual -cne $ExpectedValue) { throw "${Label}: the loaded text differs from the fixture." }
  } elseif ($null -eq $Actual -or [Math]::Abs([double]$Actual - [double]$ExpectedValue) -gt 0.0000001) {
    throw "${Label}: the loaded numeric value differs from the fixture."
  }
}
try {
  if (-not (Test-Path 'Registry::HKEY_CLASSES_ROOT\MSOLAP')) {
    # Some Desktop installers keep their OLAP provider private to the app.
    # Register that signed Microsoft binary in this disposable runner only.
    $provider = Join-Path $env:ProgramFiles 'Microsoft Power BI Desktop/bin/msolap.dll'
    if (-not (Test-Path $provider) -or (Get-AuthenticodeSignature $provider).Status -ne 'Valid') {
      throw 'A signed Microsoft OLAP provider is required for the loaded-model checks.'
    }
    $registration = Start-Process (Join-Path $env:WINDIR 'System32/regsvr32.exe') -ArgumentList @('/s', ('"' + $provider + '"')) -PassThru
    if (-not $registration.WaitForExit(15000) -or $registration.ExitCode -ne 0) { throw 'The installed Microsoft OLAP provider could not be registered.' }
  }
  $workspace = Join-Path $env:LOCALAPPDATA 'Microsoft/Power BI Desktop/AnalysisServicesWorkspaces'
  $portFiles = @(Get-ChildItem $workspace -Filter 'msmdsrv.port.txt' -Recurse | Sort-Object LastWriteTime -Descending)
  if ($portFiles.Count -ne 1) { throw 'Expected one isolated Power BI Desktop Analysis Services instance.' }
  $port = (Get-Content $portFiles[0].FullName -Raw).Trim().Replace([string][char]0, '')
  if ($port -notmatch '^\d{1,5}$') { throw 'The Desktop Analysis Services port is invalid.' }
  $script:connection = New-ModelConnection $port ''
  $catalogs = @(Read-ModelRows 'SELECT CATALOG_NAME FROM $SYSTEM.DBSCHEMA_CATALOGS')
  if ($catalogs.Count -ne 1) { throw 'Expected one report model in the isolated Desktop instance.' }
  $catalog = [string]$catalogs[0].CATALOG_NAME
  $script:connection.Dispose()
  $script:connection = New-ModelConnection $port $catalog
  $result.checks.Add(@{ name = 'Connected to the report loaded by Power BI Desktop'; passed = $true })
  foreach ($page in $expected.pages) {
    foreach ($table in $page.tables) {
      $tableIdentifier = "'" + $table.name.Replace("'", "''") + "'"
      $actualRows = @(Read-ModelRows "EVALUATE $tableIdentifier")
      if ($actualRows.Count -ne $table.rows) { throw "The refreshed $($table.name) has $($actualRows.Count) rows; expected $($table.rows)." }
      # DAX does not guarantee source order. Match complete source rows, removing
      # each match so duplicate rows cannot disguise a missing record.
      $remaining = [System.Collections.Generic.List[object]]::new()
      foreach ($record in $actualRows) { $remaining.Add($record) }
      foreach ($record in $table.records) {
        $found = -1
        for ($index = 0; $index -lt $remaining.Count; $index++) {
          $matches = $true
          foreach ($column in $table.columns) {
            try { Assert-Value $remaining[$index].($column.key) $record.($column.key) $table.name } catch { $matches = $false; break }
          }
          if ($matches) { $found = $index; break }
        }
        if ($found -lt 0) { throw "A source row or value is missing from the refreshed $($table.name) table." }
        $remaining.RemoveAt($found)
      }
      $result.checks.Add(@{ name = "Refreshed source rows: $($table.name)"; rows = $actualRows.Count; passed = $true })
    }
    foreach ($metric in $page.metrics) {
      $name = ($page.title + ': ' + $metric.label).Replace(']', ']]')
      $metricTable = "'" + ($page.id + '_metrics').Replace("'", "''") + "'"
      $key = '"' + $metric.key.Replace('"', '""') + '"'
      $query = 'EVALUATE ROW("value", [' + $name + '], "display", CALCULATE(MAX(' + $metricTable + '[display_value]), ' + $metricTable + '[metric] = ' + $key + '))'
      $values = @(Read-ModelRows $query)
      if ($values.Count -ne 1) { throw 'A DAX measure did not return exactly one result.' }
      $value = $metric.value
      $display = $null
      if ($null -ne $value) {
        if ($metric.format -in @('money', 'percent')) { $value = [double]$value / 100 }
        $culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
        $display = switch ($metric.format) {
          'money' { ([double]$value).ToString('#,0.00', $culture) + ' ' + $expected.currency }
          'percent' { ([double]$metric.value).ToString('0.0', $culture) + '%' }
          default { ([double]$value).ToString('#,0.##', $culture) }
        }
      }
      Assert-Value $values[0].value $value $name
      Assert-Value $values[0].display $display $name
      $result.checks.Add(@{ name = "Loaded DAX measure and display units: $name"; value = $values[0].value; display = $values[0].display; passed = $true })
    }
  }
  $result.passed = $true
} catch {
  $result.error = $_.Exception.Message
  throw
} finally {
  if ($script:connection) { $script:connection.Dispose() }
  $result.completedAt = (Get-Date).ToUniversalTime().ToString('o')
  $result | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $OutputDirectory 'model-values.json') -Encoding UTF8
}
Write-Host "Verified $($result.checks.Count) loaded-model checks against Power BI Desktop."
