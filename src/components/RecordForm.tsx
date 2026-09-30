import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  Info,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import {
  formFields,
  parentLabels,
  type FieldDef,
} from "../lib/form-definitions";
import {
  Button,
  Field,
  FormError,
  Input,
  Loading,
  Modal,
  useToast,
} from "./ui";
import {
  label,
  moduleDefinitions,
  type Module,
  type WorkRecord,
  type LineItem,
} from "../../shared/domain";
import { money } from "../lib/format";
const emptyItem = (): LineItem => ({
  name: "",
  specification: "",
  quantity: 1,
  unit: "units",
  unit_price: 0,
  tax: 18,
  discount: 0,
});
const localDatetime = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export default function RecordForm({
  kind,
  record,
  onClose,
  parentId,
  draft,
}: {
  kind: Module;
  record?: WorkRecord;
  onClose: () => void;
  parentId?: string;
  draft?: { title: string; payload: Record<string, any>; items?: LineItem[] };
}) {
  const { user } = useAuth(),
    toast = useToast(),
    navigate = useNavigate(),
    client = useQueryClient();
  const lookups = useApi<any>(`/lookups?kind=${kind}`),
    settings = useApi<any>("/admin/settings");
  const masterData = useApi<any>("/master-data");
  const [title, setTitle] = useState(record?.title || draft?.title || ""),
    [parent, setParent] = useState(record?.parent_id || parentId || ""),
    [partner, setPartner] = useState(record?.partner_org_id || ""),
    [buyer, setBuyer] = useState(record?.buyer_org_id || ""),
    [currency, setCurrency] = useState(record?.currency || "INR");
  const [payload, setPayload] = useState<Record<string, any>>(() =>
    Object.fromEntries(
      formFields[kind].map((f) => [
        f.key,
        record?.payload[f.key] ??
          draft?.payload[f.key] ??
          (kind === "candidates" &&
          ["offer_date", "joining_date"].includes(f.key)
            ? ""
            : (f.default ??
              (f.type === "checkbox" ? false : f.type === "number" ? 0 : ""))),
      ]),
    ),
  );
  const [items, setItems] = useState<LineItem[]>(
      record?.items ||
        draft?.items ||
        (["rfqs", "requirements", "quotations"].includes(kind)
          ? [emptyItem()]
          : []),
    ),
    [invitations, setInvitations] = useState<string[]>(
      record?.invitations || [],
    );
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const [inviteSearch, setInviteSearch] = useState("");
  const buyerSide = user!.internal || user!.organization?.type === "client";
  const source = lookups.data?.parents?.find(
    (r: WorkRecord) => r.id === parent,
  );
  const linkedItems = ["orders", "invoices"].includes(kind),
    quoteItems = kind === "quotations";
  const set = (key: string, value: any) =>
    setPayload((p) => ({ ...p, [key]: value }));
  const chooseParent = (id: string) => {
    setParent(id);
    const row = lookups.data?.parents.find((r: WorkRecord) => r.id === id) as
      WorkRecord | undefined;
    if (!row) return;
    setCurrency(row.currency);
    setPartner(row.partner_org_id || "");
    setBuyer(row.buyer_org_id || "");
    if (
      [
        "rfqs",
        "orders",
        "invoices",
        "quotations",
        "deliveries",
        "payments",
        "demos",
      ].includes(kind)
    )
      setTitle(
        kind === "deliveries"
          ? `Delivery · ${row.title}`
          : kind === "payments"
            ? `Payment · ${row.title}`
            : row.title,
      );
    if (["rfqs", "orders", "invoices", "quotations"].includes(kind))
      setItems(
        (row.items || []).map(({ id: _id, ...item }) => ({
          ...item,
          ...(kind === "quotations" ? { unit_price: 0 } : {}),
        })),
      );
    setPayload((p) => {
      const result = { ...p };
      for (const key of [
        "description",
        "category",
        "location",
        "delivery_address",
        "payment_terms",
        "terms",
      ])
        if (formFields[kind].some((f) => f.key === key) && row.payload[key])
          result[key] = row.payload[key];
      if (kind === "quotations" && row.payload.required_date)
        result.delivery_date = row.payload.required_date;
      if (kind === "orders" && row.payload.delivery_date)
        result.delivery_date = row.payload.delivery_date;
      if (kind === "demos") {
        result.contact_name = user!.name;
        result.contact_email = user!.email;
      }
      return result;
    });
  };
  useEffect(() => {
    if (!record && parentId && lookups.data) chooseParent(parentId);
  }, [lookups.data, parentId]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const normalized = { ...payload };
      for (const f of formFields[kind]) {
        if (f.type === "datetime-local" && normalized[f.key])
          normalized[f.key] = new Date(normalized[f.key]).toISOString();
        if (f.type === "number")
          normalized[f.key] = Number(normalized[f.key] || 0);
      }
      if (
        record?.payload.delivery_charges !== undefined &&
        ["orders", "invoices", "contracts"].includes(kind)
      )
        normalized.delivery_charges = record.payload.delivery_charges;
      if (kind === "candidates" && !buyerSide)
        for (const key of ["offer_date", "offer_compensation", "joining_date"])
          delete normalized[key];
      if (kind === "catalog" && !normalized.unit) normalized.unit = "units";
      const result = await api<WorkRecord>(
        `/records/${kind}${record ? `/${record.id}` : ""}`,
        {
          method: record ? "PATCH" : "POST",
          body: JSON.stringify({
            title,
            parent_id: parent || null,
            partner_org_id: partner || null,
            buyer_org_id: buyer || null,
            currency,
            payload: normalized,
            items:
              [
                "requirements",
                "rfqs",
                "quotations",
                "orders",
                "invoices",
                "contracts",
              ].includes(kind) &&
              !(
                kind === "requirements" &&
                normalized.requirement_type === "hiring"
              )
                ? items.map(({ id: _id, ...i }) => i)
                : [],
            invitations,
            ...(record ? { version: record.version } : {}),
            note,
          }),
        },
      );
      await client.invalidateQueries();
      toast(
        `${moduleDefinitions[kind].singular} ${record ? "updated" : "created"} successfully.`,
      );
      onClose();
      navigate(`/app/${kind}/${result.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const renderField = (f: FieldDef) => {
    if (f.hiring && payload.requirement_type !== "hiring") return null;
    if (
      kind === "candidates" &&
      [
        "offer_date",
        "offer_compensation",
        "bgv_status",
        "joining_date",
      ].includes(f.key) &&
      !buyerSide
    )
      return null;
    if (
      kind === "tickets" &&
      ["assigned_team", "resolution"].includes(f.key) &&
      !user!.internal
    )
      return null;
    if (
      kind === "demos" &&
      ["scheduled_at", "meeting_link"].includes(f.key) &&
      !record
    )
      return null;
    if (f.type === "checkbox")
      return (
        <label className={`check-label ${f.full ? "span-2" : ""}`} key={f.key}>
          <input
            type="checkbox"
            name={f.key}
            checked={Boolean(payload[f.key])}
            onChange={(e) => set(f.key, e.target.checked)}
            required={f.required}
          />
          <span>{f.label}</span>
        </label>
      );
    return (
      <Field
        key={f.key}
        label={f.label}
        required={f.required}
        hint={f.hint}
        className={f.full ? "span-2" : ""}
      >
        {f.type === "textarea" ? (
          <textarea
            className="input"
            name={f.key}
            rows={3}
            value={payload[f.key] || ""}
            onChange={(e) => set(f.key, e.target.value)}
            required={f.required}
          />
        ) : f.type === "select" ||
          (f.key === "category" && kind !== "tickets") ? (
          <select
            className="input"
            name={f.key}
            value={payload[f.key] || ""}
            onChange={(e) => set(f.key, e.target.value)}
            required={f.required}
          >
            {!f.default && (
              <option value="">Select a {f.label.toLowerCase()}</option>
            )}
            {(
              f.options ||
              masterData.data?.category?.map((c: any) => c.label) ||
              settings.data?.categories ||
              []
            ).map((option: string) => (
              <option key={option} value={option}>
                {label(option)}
              </option>
            ))}
          </select>
        ) : (
          <Input
            name={f.key}
            list={
              f.key === "unit"
                ? "record-master-units"
                : f.key === "certifications"
                  ? "record-master-certifications"
                  : undefined
            }
            type={f.type || "text"}
            value={
              f.type === "datetime-local" && payload[f.key]?.includes("Z")
                ? localDatetime(payload[f.key])
                : (payload[f.key] ?? "")
            }
            onChange={(e) =>
              set(
                f.key,
                f.type === "number"
                  ? e.target.value === ""
                    ? ""
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
            required={f.required}
            min={f.type === "number" ? 0 : undefined}
            step={f.type === "number" ? "any" : undefined}
          />
        )}
      </Field>
    );
  };
  const eligiblePartners = (lookups.data?.partners || []).filter(
    (p: any) =>
      p.id !== user!.organization_id &&
      (kind === "requirements" && payload.requirement_type === "hiring"
        ? ["recruitment", "staffing"].includes(p.type)
        : !["client", "recruitment", "staffing"].includes(p.type)),
  );
  const subtotal =
    items.reduce(
      (sum, i) =>
        sum +
        i.quantity *
          i.unit_price *
          (1 - i.discount / 100) *
          (1 + i.tax / 100) *
          100,
      0,
    ) +
    Number(payload.delivery_charges || source?.payload.delivery_charges || 0) *
      100;
  return (
    <Modal
      title={`${record ? "Edit" : "New"} ${moduleDefinitions[kind].singular.toLowerCase()}`}
      description={
        record
          ? `${record.number} · Changes are recorded in the audit trail.`
          : moduleDefinitions[kind].description
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <FormError error={error || lookups.error} />
          {lookups.isPending ? (
            <Loading />
          ) : (
            <>
              <div className="form-grid">
                {parentLabels[kind] && (
                  <Field
                    label={parentLabels[kind]!}
                    required={!["rfqs", "contracts"].includes(kind)}
                    className="span-2"
                  >
                    <select
                      className="input"
                      name="parent_id"
                      value={parent}
                      disabled={Boolean(record)}
                      required={!["rfqs", "contracts"].includes(kind)}
                      onChange={(e) => chooseParent(e.target.value)}
                    >
                      <option value="">
                        {["rfqs", "contracts"].includes(kind)
                          ? "Create without a linked record"
                          : "Choose a record"}
                      </option>
                      {record?.parent_id &&
                        !lookups.data?.parents.some(
                          (p: WorkRecord) => p.id === record.parent_id,
                        ) && (
                          <option value={record.parent_id}>
                            {record.parent_number || record.parent_id}
                          </option>
                        )}
                      {lookups.data?.parents.map((r: WorkRecord) => (
                        <option key={r.id} value={r.id}>
                          {r.number} · {r.title}
                        </option>
                      ))}
                    </select>
                    {!lookups.data?.parents.length &&
                      !record &&
                      !["rfqs", "contracts"].includes(kind) && (
                        <small className="text-amber">
                          No eligible records yet. Complete the preceding
                          workflow stage first.
                        </small>
                      )}
                  </Field>
                )}
                <Field
                  label={
                    kind === "candidates"
                      ? "Candidate full name"
                      : kind === "catalog"
                        ? "Product / service name"
                        : "Title"
                  }
                  required
                  className={
                    ["tickets", "candidates", "interviews"].includes(kind)
                      ? "span-2"
                      : ""
                  }
                >
                  <Input
                    name="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    minLength={3}
                    maxLength={200}
                    required
                    placeholder={
                      kind === "tickets"
                        ? "How can we help?"
                        : "Give this record a clear, helpful name"
                    }
                  />
                </Field>
                {!["tickets", "candidates", "interviews"].includes(kind) && (
                  <Field label="Currency">
                    <select
                      className="input"
                      name="currency"
                      value={currency}
                      disabled={Boolean(
                        source &&
                        [
                          "orders",
                          "invoices",
                          "payments",
                          "quotations",
                        ].includes(kind),
                      )}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {["INR", "USD", "EUR", "GBP"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                )}
                {((kind === "contracts" && !parent) ||
                  (user!.internal &&
                    ["quotations", "candidates"].includes(kind))) && (
                  <Field
                    label={
                      kind === "contracts" && !buyerSide
                        ? "Client / buyer"
                        : "Partner organization"
                    }
                    required
                    className="span-2"
                  >
                    <select
                      className="input"
                      value={
                        kind === "contracts" && !buyerSide ? buyer : partner
                      }
                      onChange={(e) =>
                        kind === "contracts" && !buyerSide
                          ? setBuyer(e.target.value)
                          : setPartner(e.target.value)
                      }
                      required
                      disabled={Boolean(record)}
                    >
                      <option value="">Choose a verified organization</option>
                      {lookups.data?.partners
                        .filter((p: any) =>
                          kind === "contracts" && !buyerSide
                            ? p.type === "client"
                            : kind === "candidates"
                              ? ["recruitment", "staffing"].includes(p.type)
                              : p.type !== "client",
                        )
                        .map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.legal_name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {formFields[kind].map(renderField)}
                <datalist id="record-master-units">
                  {masterData.data?.unit?.map((v: any) => (
                    <option key={v.id} value={v.label} />
                  ))}
                </datalist>
                <datalist id="record-master-certifications">
                  {masterData.data?.certification?.map((v: any) => (
                    <option key={v.id} value={v.label} />
                  ))}
                </datalist>
              </div>
              {["rfqs", "requirements"].includes(kind) && (
                <section className="form-section">
                  <h3>
                    {kind === "requirements" &&
                    payload.requirement_type === "hiring"
                      ? "Assign recruitment partners"
                      : "Invite verified partners"}
                  </h3>
                  <p>
                    Selected organizations can view and respond when you
                    publish.
                  </p>
                  <Input
                    placeholder="Find a partner…"
                    aria-label="Filter partner invitations"
                    value={inviteSearch}
                    onChange={(e) => setInviteSearch(e.target.value)}
                  />
                  <div className="invite-checklist">
                    {eligiblePartners
                      .filter((p: any) =>
                        p.legal_name
                          .toLowerCase()
                          .includes(inviteSearch.toLowerCase()),
                      )
                      .map((p: any) => (
                        <label key={p.id}>
                          <input
                            type="checkbox"
                            checked={invitations.includes(p.id)}
                            onChange={(e) =>
                              setInvitations((v) =>
                                e.target.checked
                                  ? [...v, p.id]
                                  : v.filter((id) => id !== p.id),
                              )
                            }
                          />
                          <span>
                            <strong>{p.legal_name}</strong>
                            <small>
                              {label(p.type)} · {p.city}
                            </small>
                          </span>
                        </label>
                      ))}
                  </div>
                  <small>
                    {invitations.length} partner
                    {invitations.length !== 1 ? "s" : ""} selected
                  </small>
                </section>
              )}
              {[
                "rfqs",
                "requirements",
                "quotations",
                "orders",
                "invoices",
                "contracts",
              ].includes(kind) &&
                !(
                  kind === "requirements" &&
                  payload.requirement_type === "hiring"
                ) && (
                  <section className="form-section">
                    <div className="form-section-heading">
                      <div>
                        <h3>Line items</h3>
                        <p>
                          {linkedItems
                            ? "Commercial values are copied from the approved source record."
                            : quoteItems
                              ? "Quote the requested quantities. Totals are calculated on the server."
                              : "Add clear specifications and quantities for each item."}
                        </p>
                      </div>
                      {!linkedItems && !quoteItems && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setItems((i) => [...i, emptyItem()])}
                        >
                          <Plus size={15} />
                          Add item
                        </Button>
                      )}
                    </div>
                    {!linkedItems &&
                      !quoteItems &&
                      lookups.data?.catalog.length > 0 && (
                        <select
                          className="input catalog-import"
                          aria-label="Add from catalog"
                          value=""
                          onChange={(e) => {
                            const entry = lookups.data.catalog.find(
                              (c: WorkRecord) => c.id === e.target.value,
                            );
                            if (entry && entry.currency === currency)
                              setItems((i) => [
                                ...i.filter((v) => v.name || v.unit_price),
                                {
                                  catalog_item_id: entry.id,
                                  name: entry.title,
                                  specification:
                                    entry.payload.specifications || "",
                                  quantity: entry.payload.moq || 1,
                                  unit: entry.payload.unit || "units",
                                  unit_price: entry.payload.price || 0,
                                  tax: entry.payload.tax ?? 18,
                                  discount: 0,
                                },
                              ]);
                          }}
                        >
                          <option value="">
                            + Add an item from your catalog
                          </option>
                          {lookups.data.catalog
                            .filter((c: WorkRecord) => c.currency === currency)
                            .map((c: WorkRecord) => (
                              <option key={c.id} value={c.id}>
                                {c.title} · {c.payload.sku}
                              </option>
                            ))}
                        </select>
                      )}
                    <div className="line-item-editor">
                      {items.map((item, index) => (
                        <div className="line-item-row" key={index}>
                          <span className="line-item-number">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <div className="line-item-fields">
                            {quoteItems && lookups.data?.catalog.length > 0 && (
                              <div className="catalog-line-choice">
                                <select
                                  className="input"
                                  aria-label={`Use catalog pricing for item ${index + 1}`}
                                  value=""
                                  onChange={(e) => {
                                    const entry = lookups.data.catalog.find(
                                      (c: WorkRecord) =>
                                        c.id === e.target.value,
                                    );
                                    if (entry)
                                      setItems((all) =>
                                        all.map((it, n) =>
                                          n === index
                                            ? {
                                                ...it,
                                                catalog_item_id: entry.id,
                                                unit_price:
                                                  entry.payload.price || 0,
                                                tax: entry.payload.tax ?? 18,
                                              }
                                            : it,
                                        ),
                                      );
                                  }}
                                >
                                  <option value="">
                                    Use pricing from your catalog…
                                  </option>
                                  {lookups.data.catalog
                                    .filter(
                                      (c: WorkRecord) =>
                                        c.currency === currency,
                                    )
                                    .map((c: WorkRecord) => (
                                      <option key={c.id} value={c.id}>
                                        {c.title} · {c.payload.sku}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            )}
                            <div className="line-item-name">
                              <Input
                                aria-label={`Item ${index + 1} name`}
                                placeholder="Item name"
                                value={item.name}
                                readOnly={linkedItems || quoteItems}
                                required
                                onChange={(e) =>
                                  setItems((v) =>
                                    v.map((it, n) =>
                                      n === index
                                        ? { ...it, name: e.target.value }
                                        : it,
                                    ),
                                  )
                                }
                              />
                              {!linkedItems && !quoteItems && (
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={`Remove item ${index + 1}`}
                                  onClick={() =>
                                    setItems((v) =>
                                      v.filter((_, n) => n !== index),
                                    )
                                  }
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                            <Input
                              aria-label={`Item ${index + 1} specification`}
                              placeholder="Specifications / description"
                              value={item.specification || ""}
                              readOnly={linkedItems}
                              onChange={(e) =>
                                setItems((v) =>
                                  v.map((it, n) =>
                                    n === index
                                      ? { ...it, specification: e.target.value }
                                      : it,
                                  ),
                                )
                              }
                            />
                            <div className="line-item-values">
                              {[
                                {
                                  key: "quantity",
                                  label: "Quantity",
                                  number: true,
                                },
                                { key: "unit", label: "Unit", number: false },
                                ...(!["rfqs", "requirements"].includes(kind)
                                  ? [
                                      {
                                        key: "unit_price",
                                        label: "Unit price",
                                        number: true,
                                      },
                                      {
                                        key: "discount",
                                        label: "Discount %",
                                        number: true,
                                      },
                                      {
                                        key: "tax",
                                        label: "Tax %",
                                        number: true,
                                      },
                                    ]
                                  : []),
                              ].map((col) => (
                                <Field key={col.key} label={col.label}>
                                  <Input
                                    aria-label={`Item ${index + 1} ${col.label.toLowerCase()}`}
                                    list={
                                      col.key === "unit"
                                        ? "record-master-units"
                                        : undefined
                                    }
                                    type={col.number ? "number" : "text"}
                                    step={
                                      col.key === "quantity" ? ".001" : ".01"
                                    }
                                    min={col.key === "quantity" ? 0.001 : 0}
                                    max={
                                      ["discount", "tax"].includes(col.key)
                                        ? 100
                                        : undefined
                                    }
                                    value={
                                      item[col.key as keyof LineItem] ?? ""
                                    }
                                    readOnly={
                                      linkedItems ||
                                      (quoteItems &&
                                        ["quantity", "unit"].includes(col.key))
                                    }
                                    required
                                    onChange={(e) =>
                                      setItems((v) =>
                                        v.map((it, n) =>
                                          n === index
                                            ? {
                                                ...it,
                                                [col.key]: col.number
                                                  ? Number(e.target.value)
                                                  : e.target.value,
                                              }
                                            : it,
                                        ),
                                      )
                                    }
                                  />
                                </Field>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {!["rfqs", "requirements"].includes(kind) && (
                      <div className="form-total">
                        <span>Estimated total, including tax</span>
                        <strong>
                          {money(
                            linkedItems && source
                              ? source.amount_minor
                              : subtotal,
                            currency,
                          )}
                        </strong>
                      </div>
                    )}
                  </section>
                )}
              {kind === "payments" && (
                <div className="info-banner">
                  <Info size={20} />
                  <p>
                    This records a payment made through your bank. It does not
                    transfer funds. Pending payments reserve their amount
                    against the invoice balance.
                  </p>
                </div>
              )}
              {kind === "candidates" && (
                <div className="info-banner">
                  <FileText size={20} />
                  <p>
                    Add the candidate’s resume in the Documents tab after
                    saving. Collect only information needed for this hiring
                    requirement.
                  </p>
                </div>
              )}
              {record && (
                <Field
                  label="Change note"
                  hint="Help your team understand what changed."
                >
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    name="note"
                  />
                </Field>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={lookups.isPending || Boolean(lookups.error)}
          >
            {record
              ? "Save changes"
              : `Create ${moduleDefinitions[kind].singular.toLowerCase()}`}
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
