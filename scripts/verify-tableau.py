"""Validate generated TWBX files with Tableau's Document API, not our XML writer.

This is package/data acceptance. It deliberately does not claim Desktop rendering.
Install scripts/tableau-validation-requirements.txt in an isolated Python environment.
"""

import csv
import hashlib
import io
import json
import re
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path, PurePosixPath
from lxml import etree
from tableaudocumentapi import Workbook


def verify(filename):
    path = Path(filename).resolve()
    checks = []
    result = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "file": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "parser": "tableaudocumentapi 0.11 / lxml",
        "desktopRenderingTested": False,
        "externalPublicationTested": False,
        "checks": checks,
    }
    try:
        with zipfile.ZipFile(path) as archive:
            for entry in archive.infolist():
                name = PurePosixPath(entry.filename)
                assert not name.is_absolute() and ".." not in name.parts
                assert "\\" not in entry.filename
                assert entry.external_attr >> 16 & 0o170000 != 0o120000
            assert archive.testzip() is None
            manifest = json.loads(archive.read("manifest.json"))
            snapshot = json.loads(archive.read("Data/analytics.json"))
            xml = archive.read(manifest["workbook"])
            assert b"<!DOCTYPE" not in xml and b"<!ENTITY" not in xml
            root = etree.fromstring(xml, etree.XMLParser(resolve_entities=False, no_network=True))
            workbook = Workbook(str(path))
            assert workbook.dashboards == [view["title"] for view in snapshot["views"]]
            assert len(workbook.worksheets) == len(set(workbook.worksheets))
            assert len(workbook.datasources) == len(manifest["datasets"])
            checks.append({"name": "Tableau Document API reads the packaged dashboards, worksheets and datasources", "passed": True})

            original = {
                "partnerhub_" + view["id"] + "_" + table["id"]: table
                for view in snapshot["views"] for table in view["tables"] if table["columns"]
            }
            assert set(original) == {source.name for source in workbook.datasources}
            for source in workbook.datasources:
                assert source.connections and all(connection.dbclass == "textscan" for connection in source.connections)
                assert all(not connection.server and not connection.username for connection in source.connections)
                table = original[source.name]
                for column in table["columns"]:
                    field = source.fields["[" + column["key"] + "]"]
                    expected = "string" if column["format"] == "text" else "integer" if column["format"] == "number" else "real"
                    assert field.datatype == expected
            checks.append({"name": "Original fields retain explicit types and only local text-file connections", "passed": True})

            for dataset in manifest["datasets"]:
                node = root.find("./datasources/datasource[@name='" + dataset["source"] + "']")
                connection = node.find(".//connection[@class='textscan']")
                relative = PurePosixPath(connection.get("directory")) / connection.get("filename")
                assert relative.as_posix() == dataset["file"]
                assert relative.parts[0] == "Data"
                content = archive.read(dataset["file"]).decode("utf-8-sig")
                reader = csv.DictReader(io.StringIO(content, newline=""))
                assert reader.fieldnames == [column["key"] for column in dataset["columns"]]
                rows = list(reader)
                table = original[dataset["source"]]
                assert len(rows) == len(table["rows"]) == dataset["rows"]
                for row, expected in zip(rows, table["rows"]):
                    for column in table["columns"]:
                        value = expected.get(column["key"])
                        actual = row[column["key"]]
                        if value is None:
                            assert actual == ""
                        elif isinstance(value, (int, float)):
                            assert Decimal(actual) == Decimal(str(value))
                        else:
                            safe = "'" + value if re.match(r"^\s*[=+@\-\t\r]", value) else value
                            assert actual == safe
                    assert row["period_start"] == snapshot["from"]
                    assert row["period_end"] == snapshot["to"]
                    assert row["snapshot_at"] == snapshot["generatedAt"]
                    assert row["measurement_scope"] == table["scope"]
            checks.append({"name": "All relative CSV sources match the snapshot row for row, including units, nulls and scope", "passed": True})

            names = set(workbook.worksheets)
            for dependency in root.findall(".//worksheets/worksheet/table/view/datasource-dependencies"):
                assert dependency.get("datasource") in original
            for dashboard in root.findall("./dashboards/dashboard"):
                for zone in dashboard.findall(".//zone[@name]"):
                    assert zone.get("name") in names
            checks.append({"name": "Every dashboard panel and worksheet source resolves inside the package", "passed": True})

        with tempfile.TemporaryDirectory(prefix="partnerhub-tableau-") as directory:
            destination = Path(directory) / "roundtrip.twbx"
            workbook.save_as(str(destination))
            reopened = Workbook(str(destination))
            assert reopened.dashboards == workbook.dashboards
            assert reopened.worksheets == workbook.worksheets
            with zipfile.ZipFile(destination) as archive:
                assert json.loads(archive.read("Data/analytics.json")) == snapshot
                for dataset in manifest["datasets"]:
                    assert dataset["file"] in archive.namelist()
        checks.append({"name": "Tableau Document API saves and reopens the workbook with its packaged source data", "passed": True})
        result["dashboards"] = len(workbook.dashboards)
        result["worksheets"] = len(workbook.worksheets)
        result["datasources"] = len(workbook.datasources)
    except Exception as error:
        checks.append({"name": "Tableau package acceptance", "passed": False, "error": str(error) or type(error).__name__})
        raise
    finally:
        output = path.with_suffix(".validation.json")
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scripts/verify-tableau.py <workbook.twbx> [more.twbx]")
    for name in sys.argv[1:]:
        verify(name)
