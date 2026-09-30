using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AnalysisServices.AdomdClient;

// This executable reads the actual model loaded and refreshed by Desktop. It
// never processes the BIM itself and never connects to an external server.
if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" || args.Length != 4)
    throw new InvalidOperationException("Use the isolated Windows Desktop runner: port, fixture, output, commit.");
if (!int.TryParse(args[0], out var port) || port < 1 || port > 65535)
    throw new InvalidOperationException("Invalid local Analysis Services port.");
using var fixture = JsonDocument.Parse(File.ReadAllText(args[1]));
var expected = fixture.RootElement;
if (!expected.GetProperty("syntheticData").GetBoolean()
    || expected.GetProperty("productionDataRead").GetBoolean()
    || expected.GetProperty("externalPublication").GetBoolean())
    throw new InvalidOperationException("Only the synthetic offline fixture is permitted.");
var checks = new List<object>();
var report = new Dictionary<string, object?> {
    ["commit"] = args[3], ["syntheticData"] = true,
    ["source"] = "Power BI Desktop local Analysis Services queried with Microsoft's ADOMD.NET client",
    ["passed"] = false, ["checks"] = checks
};
try
{
    using var discovery = new AdomdConnection($"Data Source=localhost:{port};Connect Timeout=15;");
    discovery.Open();
    var catalogs = ReadRows(discovery, "SELECT CATALOG_NAME FROM $SYSTEM.DBSCHEMA_CATALOGS");
    if (catalogs.Count != 1) throw new InvalidOperationException("Expected one report in the isolated Desktop instance.");
    var catalog = Convert.ToString(catalogs[0]["CATALOG_NAME"], CultureInfo.InvariantCulture);
    using var connection = new AdomdConnection($"Data Source=localhost:{port};Initial Catalog={catalog};Connect Timeout=15;");
    connection.Open();
    checks.Add(new { name = "Connected to the report loaded by Power BI Desktop", passed = true });
    foreach (var page in expected.GetProperty("pages").EnumerateArray())
    {
        var pageId = page.GetProperty("id").GetString()!;
        var title = page.GetProperty("title").GetString()!;
        foreach (var table in page.GetProperty("tables").EnumerateArray())
        {
            var name = table.GetProperty("name").GetString()!;
            var actual = ReadRows(connection, "EVALUATE " + Identifier(name));
            if (actual.Count != table.GetProperty("rows").GetInt32())
                throw new InvalidOperationException($"The refreshed {name} row count differs from the fixture.");
            var remaining = new List<Dictionary<string, object?>>(actual);
            var columns = table.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("key").GetString()!).ToArray();
            foreach (var record in table.GetProperty("records").EnumerateArray())
            {
                var index = remaining.FindIndex(row => columns.All(column => row.TryGetValue(column, out var cell) && Same(cell, JsonValue(record.GetProperty(column)))));
                if (index < 0) throw new InvalidOperationException($"A source value is missing from the refreshed {name} table.");
                remaining.RemoveAt(index);
            }
            checks.Add(new { name = $"Refreshed source rows: {name}", rows = actual.Count, passed = true });
        }
        foreach (var metric in page.GetProperty("metrics").EnumerateArray())
        {
            var name = title + ": " + metric.GetProperty("label").GetString();
            var table = Identifier(pageId + "_metrics");
            var key = metric.GetProperty("key").GetString()!.Replace("\"", "\"\"");
            var query = "EVALUATE ROW(\"value\", [" + name.Replace("]", "]]")
                + "], \"display\", CALCULATE(MAX(" + table + "[display_value]), " + table + "[metric] = \"" + key + "\"))";
            var rows = ReadRows(connection, query);
            if (rows.Count != 1) throw new InvalidOperationException("A DAX measure did not return exactly one row.");
            object? value = JsonValue(metric.GetProperty("value"));
            string? display = null;
            var format = metric.GetProperty("format").GetString();
            if (value is not null)
            {
                var raw = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                value = format is "money" or "percent" ? raw / 100 : raw;
                display = format switch {
                    "money" => ((double)value).ToString("#,0.00", CultureInfo.InvariantCulture) + " " + expected.GetProperty("currency").GetString(),
                    "percent" => raw.ToString("0.0", CultureInfo.InvariantCulture) + "%",
                    _ => ((double)value).ToString("#,0.##", CultureInfo.InvariantCulture)
                };
            }
            if (!Same(rows[0]["value"], value) || !Same(rows[0]["display"], display))
                throw new InvalidOperationException($"The loaded {name} measure or display units differ from the fixture.");
            checks.Add(new { name = $"Loaded DAX measure and display units: {name}", value = rows[0]["value"], display = rows[0]["display"], passed = true });
        }
    }
    report["passed"] = true;
    Console.WriteLine($"Verified {checks.Count} actual Desktop model checks.");
}
catch (Exception error)
{
    report["error"] = error.Message;
    Console.Error.WriteLine("Desktop model verification: " + error.Message);
    Environment.ExitCode = 1;
}
finally
{
    report["completedAt"] = DateTimeOffset.UtcNow.ToString("O");
    Directory.CreateDirectory(args[2]);
    File.WriteAllText(Path.Combine(args[2], "model-values.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
}

static string Identifier(string value) => "'" + value.Replace("'", "''") + "'";
static object? JsonValue(JsonElement value) => value.ValueKind switch {
    JsonValueKind.Null => null,
    JsonValueKind.String => value.GetString(),
    JsonValueKind.Number => value.GetDouble(),
    _ => throw new InvalidOperationException("Unexpected fixture cell type.")
};
static bool Same(object? actual, object? expected)
{
    if (expected is null) return actual is null || actual is DBNull;
    if (expected is string text) return actual is string value && string.Equals(value, text, StringComparison.Ordinal);
    return actual is not null && actual is not DBNull && Math.Abs(Convert.ToDouble(actual, CultureInfo.InvariantCulture) - Convert.ToDouble(expected, CultureInfo.InvariantCulture)) <= 0.0000001;
}
static List<Dictionary<string, object?>> ReadRows(AdomdConnection connection, string query)
{
    using var command = connection.CreateCommand();
    command.CommandText = query;
    command.CommandTimeout = 30;
    using var reader = command.ExecuteReader();
    var rows = new List<Dictionary<string, object?>>();
    while (reader.Read())
    {
        var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < reader.FieldCount; index++)
        {
            var name = Regex.Replace(reader.GetName(index), @"^.*\[([^\]]+)\]$", "$1");
            row[name] = reader.IsDBNull(index) ? null : reader.GetValue(index);
        }
        rows.Add(row);
    }
    return rows;
}
