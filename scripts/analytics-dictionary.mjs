import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

// Documentation comes from a new, empty schema. Never inspect or seed an
// operator's database, and never include row values or integration credentials.
const directory = await mkdtemp(path.join(tmpdir(), "partnerhub-dictionary-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "",
  DEMO_MODE: "false",
  SQLITE_PATH: path.join(directory, "schema.sqlite"),
  UPLOAD_DIR: path.join(directory, "uploads"),
  SMTP_HOST: "",
  RESEND_API_KEY: "",
  GEMINI_API_KEY: "",
});
const { db, migrate } = await import("../server/db.ts");
const { csv } = await import("../server/records.ts");
const { payloadSchemas } = await import("../server/record-service.ts");
const { buildAnalytics, analyticsFilters } =
  await import("../server/analytics.ts");
const { defaultPermissions, moduleDefinitions } =
  await import("../shared/domain.ts");
const { formFields } = await import("../src/lib/form-definitions.ts");
const { INTERNAL_ORG_ID } = await import("../server/config.ts");
const sources = {
  executive: "organizations; records; documents",
  partners: "organizations",
  procurement: "records; record_invitations",
  performance: "records; record_invitations; organizations; audit_logs",
  recruitment: "records",
  finance: "records",
  compliance:
    "documents; organizations; settings; master_data; document_policies",
  support: "records; audit_logs",
};
const logical = {
  records:
    "Requirement; RFQ; Quotation; PurchaseOrder; Delivery; Contract; Invoice; Payment; Product; Service; Candidate; Interview; Engagement; Timesheet; Milestone; DemoRequest; PerformanceReview; SupportTicket",
  record_invitations: "RFQInvitation; RecruitmentAssignment",
  line_items: "RFQItem; QuotationItem; POItem; InvoiceItem; ContractItem",
  receipts: "GoodsReceipt; ServiceAcceptance",
  receipt_lines:
    "AcceptedQuantity; RejectedQuantity; PurchaseOrderLineEvidence",
  proposal_evaluations: "RFPTechnicalAssessment; CommercialAssessment",
  bank_accounts: "BuyerBankAccount",
  statement_imports: "BankStatementImport",
  bank_transactions: "BankStatementEntry",
  reconciliation_allocations: "PaymentMatch; ReconciliationReversal",
  record_versions: "QuotationRevision; ContractAmendment; RecordVersion",
  users: "User",
  organizations: "Organization",
  roles: "Role; Permission",
  documents: "Document; DocumentVersion; ComplianceReview",
  audit_logs: "AuditLog; VerificationCase; ApprovalHistory",
  contacts: "Contact; AuthorizedRepresentative",
};
try {
  await migrate();
  const tables = await db.raw(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
  );
  const dictionary = [
    [
      "table",
      "logical_entities",
      "field",
      "data_type",
      "nullable",
      "default",
      "primary_key",
      "foreign_reference",
      "access",
      "description",
    ],
  ];
  for (const { name } of tables) {
    const info = await db.raw("pragma table_info(??)", [name]);
    const keys = await db.raw("pragma foreign_key_list(??)", [name]);
    for (const column of info) {
      const foreign = keys.find((key) => key.from === column.name);
      const privateField =
        /password|token_hash|csrf|encrypted|otp_hash|code_hash|secret|ip_hash|session/i.test(
          column.name,
        ) ||
        [
          "auth_tokens",
          "sessions",
          "integration_settings",
          "email_outbox",
        ].includes(name);
      dictionary.push([
        name,
        logical[name] || name,
        column.name,
        column.type,
        !column.notnull && !column.pk,
        column.dflt_value ?? "",
        !!column.pk,
        foreign ? `${foreign.table}.${foreign.to}` : "",
        privateField
          ? "Server only / authorized operator metadata"
          : "Authorized module and organization scope",
        column.name === "amount_minor"
          ? "Integer minor currency units; never sum across currencies"
          : column.name.endsWith("_at")
            ? "UTC timestamp"
            : column.name === "payload"
              ? "Validated module-specific JSON; see payload-field-dictionary.csv"
              : column.name === "permissions"
                ? "Module-to-action mapping; organization types narrow external roles"
                : "",
      ]);
    }
  }
  const payloadRows = [
    [
      "module",
      "field",
      "label",
      "json_type",
      "required_by_schema",
      "constraints",
      "access",
    ],
  ];
  for (const [kind, schema] of Object.entries(payloadSchemas)) {
    const json = z.toJSONSchema(schema, {
      unrepresentable: "any",
      io: "input",
    });
    for (const [key, property] of Object.entries(json.properties || {})) {
      payloadRows.push([
        kind,
        key,
        formFields[kind].find((field) => field.key === key)?.label || key,
        property.type || (property.anyOf ? "union" : "value"),
        (json.required || []).includes(key),
        JSON.stringify(property),
        `${moduleDefinitions[kind].label} permission plus record relationships; workflow checks also apply`,
      ]);
    }
  }
  const report = await buildAnalytics(
    {
      id: "dictionary",
      name: "Schema documentation",
      email: "",
      role: "super_admin",
      internal: true,
      email_verified: false,
      organization_id: INTERNAL_ORG_ID,
      organization: null,
      permissions: defaultPermissions.super_admin,
    },
    analyticsFilters.parse({}),
  );
  const kpis = [
    [
      "report",
      "metric",
      "label",
      "format",
      "measurement_scope",
      "definition",
      "source_tables",
      "currency_rule",
    ],
  ];
  const datasets = [
    [
      "report",
      "dataset",
      "measurement_scope",
      "field",
      "label",
      "format",
      "source_tables",
    ],
  ];
  for (const view of report.views) {
    for (const metric of view.metrics)
      kpis.push([
        view.id,
        metric.key,
        metric.label,
        metric.format,
        metric.scope,
        metric.definition,
        sources[view.id],
        metric.format === "money"
          ? "Selected currency; integer minor units"
          : "Counts include all permitted currencies; no currency conversion",
      ]);
    for (const table of view.tables)
      for (const column of table.columns)
        datasets.push([
          view.id,
          table.id,
          table.scope,
          column.key,
          column.label,
          column.format,
          sources[view.id],
        ]);
  }
  await mkdir("docs/dictionaries", { recursive: true });
  for (const [filename, rows] of Object.entries({
    "database-dictionary.csv": dictionary,
    "payload-field-dictionary.csv": payloadRows,
    "kpi-dictionary.csv": kpis,
    "report-datasets.csv": datasets,
  }))
    await writeFile(
      path.join("docs/dictionaries", filename),
      csv(rows).replaceAll("\r\n", "\n"),
    );
  console.log(
    `Documented ${tables.length} tables, ${payloadRows.length - 1} payload fields, ${kpis.length - 1} KPI definitions and ${report.views.length} report views. No business data was used.`,
  );
} finally {
  await db.destroy();
  await rm(directory, { recursive: true, force: true });
}
