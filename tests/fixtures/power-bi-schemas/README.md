# Power BI format validation

The JSON files in this directory are unmodified, public Microsoft JSON Schemas retrieved from `developer.microsoft.com` on 30 September 2026. `index.json` maps each canonical schema URL to its local file. They cover PBIP, PBIR, semantic-model properties, report/page/visual definitions and the referenced query and formatting formats.

The native export tests use these independent schemas offline, so a network failure cannot silently skip format validation. The schemas validate interchange structure; application tests separately check permissions, source values, model references, currency calculations and dashboard geometry. They do not substitute for running Power BI Desktop or publishing a report in the Microsoft service.
