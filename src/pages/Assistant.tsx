import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ArrowUpRight,
  BellRing,
  Bot,
  ChevronDown,
  FileSearch,
  FileText,
  GitCompareArrows,
  LoaderCircle,
  MessageSquare,
  Plus,
  Paperclip,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { api, ApiError, documentAiRequest, useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Button,
  Badge,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  PageHeader,
} from "../components/ui";
import RecordForm from "../components/RecordForm";
import { formatDate, money } from "../lib/format";
import {
  aiRequestTimeout,
  documentLimits,
  identityLabels,
  type IdentityField,
  type ExtractionValidation,
  type DocumentAiStage,
  type DocumentAiProgress,
} from "../../shared/ai";
import { ExtractionChecks } from "../components/DocumentExtractionReview";
import { AiReply, VsAiMark } from "../components/VsAi";
import { DocumentUpload } from "./Documents";
import DocumentWorkflow from "../components/DocumentWorkflow";
import DocumentNextSteps from "../components/DocumentNextSteps";
import { moduleDefinitions, type Module } from "../../shared/domain";
import {
  aiActionLabels,
  allowedAiActions,
  presentAiText,
} from "../../shared/ai-presentation";

type Mode =
  "chat" | "draft" | "comparison" | "discovery" | "document" | "alerts";
const discoveryFields = {
  industry: "Industry",
  category: "Category",
  location: "Location",
  products: "Products",
  services: "Services",
  technology: "Technology",
  certifications: "Certifications",
  capabilities: "Capabilities",
};
function QuotationEvidence({ quotes }: { quotes: any[] }) {
  const rows: [string, (quote: any) => string][] = [
    ["Total price", (q) => money(q.total_minor, q.currency)],
    ["Subtotal", (q) => money(q.subtotal_minor, q.currency)],
    ["Tax", (q) => money(q.tax_minor, q.currency)],
    ["Discount", (q) => money(q.discount_minor, q.currency)],
    ["Delivery charges", (q) => money(q.delivery_charges_minor, q.currency)],
    [
      "Delivery date",
      (q) => (q.delivery_date ? formatDate(q.delivery_date) : "Not provided"),
    ],
    ["Warranty", (q) => q.warranty || "Not provided"],
    ["Payment terms", (q) => q.payment_terms || "Not provided"],
    [
      "Valid until",
      (q) => (q.validity ? formatDate(q.validity) : "Not provided"),
    ],
    [
      "Missing / expired information",
      (q) => q.missingInformation.join("; ") || "None in these fields",
    ],
  ];
  return (
    <section className="ai-commercial-evidence">
      <h3>Recorded commercial terms</h3>
      <p className="small-note">
        These values come from submitted quotations. The buyer makes the
        procurement decision.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Commercial field</th>
              {quotes.map((q) => (
                <th scope="col" key={q.id}>
                  <Link to={`/app/quotations/${q.id}`}>{q.number}</Link>
                  <small className="table-subtext">
                    {q.partner} · {q.currency}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {quotes.map((q) => (
                  <td key={q.id}>{value(q)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function LookupEvidence({ results }: { results: any }) {
  return (
    <div className="ai-lookup-results">
      {results.records
        ?.filter((group: any) => !group.denied && group.items.length)
        .map((group: any) => (
          <section key={group.query.module} className="ai-record-results">
            <div className="ai-result-heading">
              <h3>{moduleDefinitions[group.query.module as Module].label}</h3>
              <Link to={`/app/${group.query.module}`}>
                View all <ArrowUpRight size={13} />
              </Link>
            </div>
            {group.items.map((record: any) => {
              const date =
                record.details?.deadline ||
                record.details?.due_date ||
                record.details?.delivery_date ||
                record.details?.required_date;
              return (
                <Link
                  className="ai-record-result"
                  key={record.id}
                  to={record.href}
                >
                  <div>
                    <strong>{record.title}</strong>
                    <span>
                      {date
                        ? `${group.query.module === "rfqs" ? "Respond by" : group.query.module === "invoices" ? "Due" : "Required by"} ${formatDate(date)}`
                        : "Open record for details"}
                      {record.outstanding_minor !== undefined
                        ? ` · Outstanding ${money(record.outstanding_minor, record.currency)}`
                        : ""}
                    </span>
                  </div>
                  <Badge status={record.status} />
                  <ArrowUpRight size={16} />
                </Link>
              );
            })}
            {group.truncated && (
              <p className="small-note">
                Showing {group.items.length} of {group.total} matching records.
              </p>
            )}
          </section>
        ))}
      {results.documents?.items?.length > 0 && (
        <section className="ai-record-results">
          <div className="ai-result-heading">
            <h3>Documents awaiting review</h3>
            <Link to="/app/documents">
              View documents <ArrowUpRight size={13} />
            </Link>
          </div>
          {results.documents.items.map((document: any) => (
            <Link
              className="ai-record-result"
              key={document.id}
              to={`/app/documents?document=${document.id}`}
            >
              <FileSearch size={18} />
              <div>
                <strong>{document.name}</strong>
                <span>
                  {document.category} · Version {document.version}
                  {document.expires_at
                    ? ` · Expires ${formatDate(document.expires_at)}`
                    : ""}
                </span>
              </div>
              <Badge status={document.status} />
              <ArrowUpRight size={16} />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
type Message = {
  id: string;
  role: string;
  content: string;
  sources: { id: string; title: string; href: string }[];
  structured: any;
  model?: string;
  unavailable?: boolean;
};
export default function Assistant() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [discoveryFilters, setDiscoveryFilters] = useState<
    Record<string, string>
  >({});
  const request = useRef<AbortController | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [requestNotice, setRequestNotice] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [slow, setSlow] = useState(false);
  const [revealId, setRevealId] = useState<string>();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [documentContext, setDocumentContext] = useState<{
    id: string;
    name: string;
  }>();
  const [documentStage, setDocumentStage] = useState<DocumentAiStage>();
  const [documentProgress, setDocumentProgress] =
    useState<DocumentAiProgress>();
  const [mode, setMode] = useState<Mode>(
      (params.get("mode") as Mode) || "chat",
    ),
    [prompt, setPrompt] = useState(""),
    [conversationId, setConversationId] = useState<string>(),
    [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [draft, setDraft] = useState<any>(),
    [extraction, setExtraction] = useState<any>(),
    [selected, setSelected] = useState(
      params.get("rfq") || params.get("document") || "",
    );
  const status = useApi<any>("/ai/status"),
    history = useApi<any[]>("/ai/conversations"),
    rfqs = useApi<any>("/records/rfqs?limit=100", mode === "comparison"),
    documents = useApi<any>(
      "/documents?limit=100",
      mode === "document" && Boolean(user?.permissions.documents),
    ),
    selectedDocument = useApi<any>(
      `/ai/documents/${selected}`,
      mode === "document" && Boolean(selected),
    ),
    extractions = useApi<any[]>("/ai/extractions");
  const documentOptions = [...(documents.data?.items || [])];
  if (
    selectedDocument.data &&
    !documentOptions.some((d) => d.id === selectedDocument.data.id)
  )
    documentOptions.push(selectedDocument.data);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const requested = params.get("mode") as Mode | null;
    if (
      !requested ||
      ![
        "chat",
        "draft",
        "comparison",
        "discovery",
        "document",
        "alerts",
      ].includes(requested)
    )
      return;
    request.current?.abort();
    setMode(requested);
    setConversationId(undefined);
    setMessages([]);
    setExtraction(undefined);
    setDocumentContext(undefined);
    setDocumentStage(undefined);
    setDocumentProgress(undefined);
    setError(undefined);
    setRevealId(undefined);
    setRequestNotice("");
    setCanRetry(false);
    setSelected(params.get("rfq") || params.get("document") || "");
  }, [params]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [busy]);
  useEffect(() => {
    if (messages.length || pendingText)
      end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, pendingText]);
  const capabilities = status.data?.capabilities || {};
  const identityKeys = Object.keys(identityLabels) as IdentityField[];
  const foundIdentityFields = identityKeys.filter(
    (key) => extraction?.result.identity?.[key],
  );
  const missingIdentityFields = identityKeys.filter(
    (key) => !extraction?.result.identity?.[key],
  );
  const otherExtractedFields = (extraction?.result.fields || []).filter(
    (field: any) =>
      !foundIdentityFields.some(
        (key) =>
          field.value === extraction.result.identity[key] &&
          [
            key.replaceAll("_", " "),
            identityLabels[key].toLowerCase(),
          ].includes(field.name.toLowerCase().trim()),
      ),
  );
  const modes: [Mode, string, any, boolean][] = [
    ["chat", "Ask your workspace", MessageSquare, true],
    ["draft", "Draft a requirement", FileText, capabilities.draft],
    [
      "comparison",
      "Analyze quotations",
      GitCompareArrows,
      capabilities.comparison,
    ],
    ["discovery", "Find partners", Search, capabilities.discovery],
    ["document", "Extract a document", FileSearch, capabilities.documents],
    ["alerts", "Explain operational alerts", BellRing, capabilities.alerts],
  ];
  function fresh(next: Mode = "chat") {
    setRevealId(undefined);
    setMode(next);
    setConversationId(undefined);
    setMessages([]);
    setExtraction(undefined);
    setDocumentContext(undefined);
    setDocumentStage(undefined);
    setDocumentProgress(undefined);
    setError(undefined);
    setRequestNotice("");
    setCanRetry(false);
    setSelected("");
    setPrompt("");
    setDiscoveryFilters({});
    setParams({});
  }
  async function openConversation(id: string) {
    setRevealId(undefined);
    setBusy(true);
    setError(undefined);
    try {
      const c = await api<any>(`/ai/conversations/${id}`);
      setConversationId(id);
      setMessages(c.messages);
      setDocumentContext(
        c.messages
          .filter((m: Message) => m.role === "assistant" && !m.unavailable)
          .at(-1)?.structured.documentContext,
      );
      setExtraction(undefined);
      setMode("chat");
      setParams({});
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function deleteConversation(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/ai/conversations/${id}`, { method: "DELETE" });
      if (conversationId === id) fresh();
      await history.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function openExtraction(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api<any>(`/ai/extractions/${id}`);
      fresh("document");
      setSelected(saved.document_id);
      setExtraction({ ...saved, documentId: saved.document_id });
      setDocumentContext({
        id: saved.document_id,
        name: saved.documentName || "Selected document",
      });
      setDocumentStage("ready");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function submit(
    event?: FormEvent,
    text = prompt,
    uploadedDocumentId?: string,
  ) {
    event?.preventDefault();
    if (request.current || busy) return;
    setRevealId(undefined);
    const controller = new AbortController();
    const activeMode = uploadedDocumentId ? "document" : mode;
    const activeSelection = uploadedDocumentId || selected;
    if (activeMode === "document") {
      setDocumentStage("uploaded");
      setDocumentProgress(undefined);
      setExtraction(undefined);
    }
    request.current = controller;
    const timeout = window.setTimeout(
      () =>
        controller.abort(
          new DOMException("Request deadline exceeded", "TimeoutError"),
        ),
      aiRequestTimeout(activeMode === "document") + 5000,
    );
    setError(undefined);
    setCanRetry(false);
    setRequestNotice("");
    setPendingText(activeMode === "chat" ? text : "");
    setBusy(true);
    try {
      const path =
        activeMode === "draft"
          ? "draft-requirement"
          : activeMode === "comparison"
            ? "analyze-quotations"
            : activeMode === "discovery"
              ? "discover"
              : activeMode === "document"
                ? "extract-document"
                : activeMode === "alerts"
                  ? "analyze-alerts"
                  : "chat";
      const body =
        activeMode === "draft"
          ? { brief: text }
          : activeMode === "comparison"
            ? { rfqId: activeSelection, question: text || undefined }
            : activeMode === "discovery"
              ? {
                  brief: text,
                  criteria: Object.fromEntries(
                    Object.entries(discoveryFilters).filter(([, value]) =>
                      value.trim(),
                    ),
                  ),
                }
              : activeMode === "document"
                ? { documentId: activeSelection }
                : activeMode === "alerts"
                  ? { question: text || undefined }
                  : {
                      message: text,
                      conversationId,
                      documentId: documentContext?.id || null,
                      recordIds: params.get("record")
                        ? [params.get("record")]
                        : [],
                    };
      const options = {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      };
      const result =
        activeMode === "document"
          ? await documentAiRequest<any>(`/ai/${path}`, options, (progress) => {
              setDocumentStage(progress.stage);
              setDocumentProgress(progress);
            })
          : await api<any>(`/ai/${path}`, options);
      if (controller.signal.aborted) return;
      if (activeMode === "document") {
        setExtraction(result);
        setDocumentContext({
          id: result.documentId,
          name: result.documentName || "Selected document",
        });
        setDocumentStage("ready");
      } else {
        setConversationId(result.conversationId);
        setRevealId(
          result.messages.filter((m: Message) => m.role === "assistant").at(-1)
            ?.id,
        );
        setMessages(result.messages);
        setMode("chat");
      }
      setPrompt("");
      await client.invalidateQueries({ queryKey: ["/ai/conversations"] });
      await client.invalidateQueries({ queryKey: ["/ai/extractions"] });
      await status.refetch();
    } catch (e) {
      if (
        controller.signal.aborted &&
        controller.signal.reason?.name !== "TimeoutError"
      ) {
        setRequestNotice(
          "Request stopped. Your text is ready when you want to try again.",
        );
      } else {
        setError(
          controller.signal.aborted
            ? new ApiError(
                "VS AI took too long to respond. Your text is saved here; please try again.",
                504,
              )
            : e instanceof TypeError
              ? new ApiError(
                  "The connection was interrupted. Check your connection and try again.",
                  502,
                )
              : e,
        );
        setCanRetry(true);
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      setPendingText("");
      setBusy(false);
    }
  }
  if (status.isPending) return <Loading />;
  if (status.error)
    return <ErrorState error={status.error} retry={status.refetch} />;
  return (
    <>
      <PageHeader
        eyebrow="INTELLIGENCE, WITH CONTEXT"
        title="VS AI Assistant"
        description="Ask questions. Understand your records. Move the next decision forward."
      />
      <FormError error={history.error || extractions.error} />
      <div className="ai-workspace">
        <aside className="ai-history card">
          <Button onClick={() => fresh()} disabled={busy}>
            <Plus size={16} />
            New conversation
          </Button>
          <p className="eyebrow">YOUR CONVERSATIONS</p>
          <div className="ai-conversation-list">
            {history.data?.length ? (
              history.data.map((c) => (
                <div
                  key={c.id}
                  className={conversationId === c.id ? "active" : ""}
                >
                  <button
                    onClick={() => openConversation(c.id)}
                    disabled={busy}
                  >
                    <MessageSquare size={15} />
                    <span>
                      {c.title}
                      <small>{formatDate(c.updated_at)}</small>
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${c.title}`}
                    disabled={busy}
                    onClick={() => deleteConversation(c.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">
                Your conversations stay private to your account.
              </p>
            )}
          </div>
          {Boolean(extractions.data?.length) && (
            <>
              <p className="eyebrow">DOCUMENT EXTRACTIONS</p>
              <div className="ai-conversation-list">
                {extractions.data!.map((e) => (
                  <div key={e.id}>
                    <button
                      onClick={() => openExtraction(e.id)}
                      disabled={busy}
                    >
                      <FileSearch size={15} />
                      <span>
                        {e.name}
                        <small>{formatDate(e.created_at)}</small>
                      </span>
                    </button>
                    <button
                      aria-label={`Delete extraction of ${e.name}`}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(undefined);
                        try {
                          await api(`/ai/extractions/${e.id}`, {
                            method: "DELETE",
                          });
                          if (extraction?.id === e.id) setExtraction(undefined);
                          await extractions.refetch();
                        } catch (err) {
                          setError(err);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="ai-trust">
            <ShieldCheck size={18} />
            <p>
              Uses only records your role and organization can access. Your
              business decisions stay with your team.
            </p>
          </div>
        </aside>
        <section className="ai-chat card" aria-label="VS AI assistant">
          {!status.data?.connected ? (
            <div className="ai-not-connected">
              <VsAiMark hero />
              <h2>Your assistant is not connected</h2>
              <p>
                Your platform administrator can connect VS AI to enable answers,
                document extraction and drafting.
              </p>
              {user?.role === "super_admin" ? (
                <Link className="button button-primary" to="/app/integrations">
                  Set up VS AI <ArrowUpRight size={16} />
                </Link>
              ) : (
                <p>
                  Ask your VS platform administrator to enable the connection.
                </p>
              )}
            </div>
          ) : (
            <>
              {!messages.length &&
                !extraction &&
                !pendingText &&
                mode !== "document" && (
                  <div className="ai-welcome">
                    <div className="ai-welcome-brand">
                      <VsAiMark hero />
                      <span>VS AI</span>
                    </div>
                    <h2>
                      {mode === "chat"
                        ? "What can I help you with?"
                        : mode === "draft"
                          ? "Turn your brief into a clear requirement"
                          : mode === "comparison"
                            ? "Understand the offers you received"
                            : mode === "discovery"
                              ? "Find partners for your next requirement"
                              : "See what needs your attention"}
                    </h2>
                    <p>
                      {mode === "chat"
                        ? "Work with information already in your workspace."
                        : mode === "draft"
                          ? "Describe what you need. Review and edit the suggested details before saving a draft."
                          : mode === "comparison"
                            ? "Choose an RFQ to compare recorded prices, delivery dates and commercial terms."
                            : mode === "discovery"
                              ? "Describe the capabilities you need, then refine the search by location, technology or certifications."
                              : "Review upcoming expiries, overdue commitments and trends supported by your workspace records."}
                    </p>
                    <div className="ai-task-grid">
                      {modes
                        .filter((m) => m[3])
                        .map(([key, title, Icon]) => (
                          <button
                            key={key}
                            className={mode === key ? "active" : ""}
                            onClick={() => fresh(key)}
                            disabled={busy}
                          >
                            <Icon size={21} />
                            <strong>{title}</strong>
                            <ArrowUpRight size={16} />
                          </button>
                        ))}
                    </div>
                    {mode === "chat" && (
                      <div
                        className="ai-prompt-chips"
                        aria-label="Suggested workspace questions"
                      >
                        {[
                          ["rfqs", "Show me pending RFQs."],
                          ["invoices", "Explain my overdue invoices."],
                          ["documents", "Which company documents need review?"],
                          ["settings", "How do I secure my sign-in?"],
                        ]
                          .filter(([permission]) =>
                            user?.permissions[permission]?.includes("view"),
                          )
                          .map(([, text]) => (
                            <button
                              type="button"
                              key={text}
                              onClick={() => setPrompt(text)}
                              disabled={busy}
                            >
                              {text}
                              <ArrowUpRight size={13} />
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              {mode === "document" && (
                <DocumentWorkflow
                  stage={documentStage}
                  selected={Boolean(selected)}
                  busy={busy}
                  failed={Boolean(error)}
                  stopped={Boolean(requestNotice)}
                  progress={documentProgress}
                  extraction={
                    extraction
                      ? {
                          ...extraction,
                          documentStatus:
                            selectedDocument.data?.status ||
                            extraction.documentStatus,
                        }
                      : undefined
                  }
                  fileName={
                    extraction?.documentName || selectedDocument.data?.name
                  }
                />
              )}
              <div className="ai-messages" aria-live="polite">
                {messages.map((m) => {
                  const navigation = [
                    ...(m.sources || [])
                      .filter((source) => source.id.startsWith("module:"))
                      .map((source) => ({
                        label: source.title,
                        href: source.href,
                      })),
                    ...modes
                      .filter(([, , , enabled]) => enabled)
                      .map(([mode]) => {
                        const href =
                          mode === "chat" ? "/app/ai" : `/app/ai?mode=${mode}`;
                        return { label: aiActionLabels[href], href };
                      }),
                  ];
                  const presentation =
                    m.role === "assistant"
                      ? presentAiText(m.content, navigation)
                      : { content: m.content, actions: [] };
                  const actions =
                    m.unavailable || m.role !== "assistant"
                      ? []
                      : allowedAiActions(
                          [
                            ...(m.structured?.actions || []),
                            ...presentation.actions,
                          ],
                          navigation,
                        );
                  const sources = (m.sources || []).filter(
                    (source) =>
                      m.structured?.citedSourceIds?.includes(source.id) &&
                      !actions.some((action) => action.href === source.href),
                  );
                  return (
                    <article
                      key={m.id}
                      className={`ai-message ai-message-${m.role}`}
                    >
                      <span
                        className={`ai-message-avatar ${m.role === "assistant" ? "ai-avatar-branded" : ""}`}
                      >
                        {m.role === "assistant" ? (
                          <VsAiMark active={revealId === m.id} />
                        ) : (
                          user?.name.charAt(0)
                        )}
                      </span>
                      <div>
                        <strong className="ai-message-name">
                          {m.role === "assistant" ? "VS AI" : user?.name}
                        </strong>
                        <AiReply
                          text={presentation.content}
                          animate={m.role === "assistant" && revealId === m.id}
                          onComplete={() =>
                            setRevealId((current) =>
                              current === m.id ? undefined : current,
                            )
                          }
                        />
                        {revealId !== m.id && (
                          <>
                            {actions.length > 0 && (
                              <nav
                                className="ai-actions"
                                aria-label="Continue with VS AI"
                              >
                                {actions.map((action) => {
                                  const requestedMode =
                                    action.href === "/app/ai"
                                      ? "chat"
                                      : action.href.startsWith("/app/ai?")
                                        ? (new URLSearchParams(
                                            action.href.split("?")[1],
                                          ).get("mode") as Mode)
                                        : undefined;
                                  const Icon =
                                    modes.find(
                                      ([mode]) => mode === requestedMode,
                                    )?.[2] || ArrowUpRight;
                                  return (
                                    <Link
                                      key={action.href}
                                      to={action.href}
                                      onClick={(event) => {
                                        if (requestedMode) {
                                          event.preventDefault();
                                          fresh(requestedMode);
                                        }
                                      }}
                                    >
                                      <Icon size={17} />
                                      <span>{action.label}</span>
                                      <ArrowUpRight size={14} />
                                    </Link>
                                  );
                                })}
                              </nav>
                            )}
                            {!m.structured?.lookupResults &&
                              sources.length > 0 && (
                                <div className="ai-sources">
                                  {sources.map((s) => (
                                    <Link key={s.id} to={s.href}>
                                      <FileText size={13} />
                                      {s.title}
                                      <ArrowUpRight size={12} />
                                    </Link>
                                  ))}
                                </div>
                              )}
                            {m.structured?.warnings?.length > 0 && (
                              <div className="ai-notes">
                                {m.structured.warnings.map(
                                  (warning: string, i: number) => (
                                    <p key={i}>
                                      {presentAiText(warning).content}
                                    </p>
                                  ),
                                )}
                              </div>
                            )}
                            {m.structured?.draft && (
                              <div className="ai-draft">
                                <FileText size={24} />
                                <div>
                                  <strong>{m.structured.draft.title}</strong>
                                  <p>
                                    Review the suggested fields and complete
                                    missing information.
                                  </p>
                                </div>
                                <Button
                                  onClick={() => setDraft(m.structured.draft)}
                                >
                                  Review requirement <ArrowUpRight size={15} />
                                </Button>
                              </div>
                            )}
                            {m.structured?.comparison && (
                              <QuotationEvidence
                                quotes={m.structured.comparison}
                              />
                            )}
                            {m.structured?.lookupResults && (
                              <LookupEvidence
                                results={m.structured.lookupResults}
                              />
                            )}
                            {m.structured?.discovery && (
                              <div className="ai-search-evidence">
                                <strong>
                                  {m.structured.discovery.total} matching{" "}
                                  {m.structured.discovery.total === 1
                                    ? "partner"
                                    : "partners"}
                                  {m.structured.discovery.considered <
                                  m.structured.discovery.total
                                    ? ` · ${m.structured.discovery.considered} included in this summary`
                                    : ""}
                                </strong>
                                <p>
                                  {Object.entries(
                                    m.structured.discovery.criteria,
                                  )
                                    .filter(([, value]) => value)
                                    .map(
                                      ([key, value]) =>
                                        `${({ ...discoveryFields, query: "Search", verification: "Status", type: "Partner type" } as Record<string, string>)[key] || key}: ${key === "verification" && value === "active" ? "Active & approved" : String(value).replaceAll("_", " ")}`,
                                    )
                                    .join(" · ")}
                                </p>
                                {m.structured.discovery.truncated && (
                                  <p>
                                    More profiles match these filters. Refine
                                    the search to review them.
                                  </p>
                                )}
                                <Link to="/app/discovery">
                                  Open partner discovery{" "}
                                  <ArrowUpRight size={14} />
                                </Link>
                              </div>
                            )}
                            {m.structured?.alertSummary && (
                              <p className="small-note">
                                Reviewed {m.structured.alertSummary.totalAlerts}{" "}
                                operational signals as of{" "}
                                {formatDate(m.structured.alertSummary.asOf)}.{" "}
                                <Link to="/app/insights">
                                  View current evidence
                                </Link>
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
                {extraction && (
                  <article className="ai-extraction">
                    <div className="ai-extraction-heading">
                      <FileSearch size={24} />
                      <div>
                        <h2>{extraction.result.documentType}</h2>
                        <p>{extraction.result.summary}</p>
                      </div>
                    </div>
                    {extraction.result.preparation && (
                      <div className="document-coverage" role="note">
                        <FileText size={18} aria-hidden="true" />
                        <div>
                          <strong>
                            {extraction.result.preparation.pageCount}{" "}
                            {extraction.result.preparation.pageCount === 1
                              ? "page"
                              : "pages"}{" "}
                            in the source document
                          </strong>
                          <p>
                            {extraction.result.preparation.method === "pdf_text"
                              ? extraction.result.preparation
                                  .analysisComplete === false ||
                                extraction.result.preparation.complete === false
                                ? "Fields were identified from relevant sections across the file. Check the original for details between excerpts."
                                : "The document text is available below. Check important details against the original."
                              : "The text was read from the document. Check unclear characters and any partial readings against the original."}
                          </p>
                        </div>
                      </div>
                    )}
                    {foundIdentityFields.length > 0 && (
                      <>
                        <h3>
                          Company & certificate details{" "}
                          <span className="document-field-count">
                            {foundIdentityFields.length} found
                          </span>
                        </h3>
                        <div
                          className="table-scroll"
                          tabIndex={0}
                          role="region"
                          aria-label="Extracted company and certificate fields"
                        >
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th scope="col">Field</th>
                                <th scope="col">Extracted value</th>
                                <th scope="col">Validation</th>
                              </tr>
                            </thead>
                            <tbody>
                              {foundIdentityFields.map((key) => {
                                const check =
                                  extraction.result.validation?.find(
                                    (v: ExtractionValidation) =>
                                      v.field === key,
                                  );
                                return (
                                  <tr key={key}>
                                    <th scope="row">{identityLabels[key]}</th>
                                    <td>
                                      {extraction.result.identity?.[key] ||
                                        "Not found"}
                                    </td>
                                    <td>
                                      <Badge
                                        status={
                                          check?.status === "valid"
                                            ? "approved"
                                            : check?.status === "invalid" ||
                                                check?.status === "warning"
                                              ? "under_review"
                                              : "draft"
                                        }
                                      >
                                        {check?.status === "valid"
                                          ? [
                                              "pan",
                                              "gst",
                                              "cin",
                                              "expiry_date",
                                            ].includes(key)
                                            ? "Format checked"
                                            : "Read from file"
                                          : check?.status === "invalid" ||
                                              check?.status === "warning"
                                            ? "Review needed"
                                            : "Not found"}
                                      </Badge>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {missingIdentityFields.length > 0 && (
                      <details className="document-missing-fields">
                        <summary>
                          {missingIdentityFields.length} company{" "}
                          {missingIdentityFields.length === 1
                            ? "field was"
                            : "fields were"}{" "}
                          not found
                        </summary>
                        <p className="small-note">
                          These fields may not apply to this document. A
                          reviewer can add a value only when it is present in
                          the original.
                        </p>
                        <ul>
                          {missingIdentityFields.map((key) => (
                            <li key={key}>
                              {identityLabels[key]}
                              <span>Not found in extracted text</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <details className="extraction-validation-detail">
                      <summary>View field checks</summary>
                      <ExtractionChecks
                        checks={extraction.result.validation || []}
                      />
                    </details>
                    {otherExtractedFields.length > 0 && (
                      <details
                        className="document-additional-fields"
                        open={foundIdentityFields.length === 0 || undefined}
                      >
                        <summary>
                          {foundIdentityFields.length
                            ? "Other details found"
                            : "Details found in your document"}{" "}
                          <span className="document-field-count">
                            {otherExtractedFields.length}
                          </span>
                        </summary>
                        <div
                          className="table-scroll"
                          tabIndex={0}
                          role="region"
                          aria-label="Additional extracted document data"
                        >
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Extracted field</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {otherExtractedFields.map((f: any, i: number) => (
                                <tr key={i}>
                                  <td>{f.name}</td>
                                  <td>{f.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                    {extraction.result.warnings.length > 0 && (
                      <details className="extraction-review-notes">
                        <summary>
                          {extraction.result.warnings.length}{" "}
                          {extraction.result.warnings.length === 1
                            ? "note"
                            : "notes"}{" "}
                          to review
                        </summary>
                        <div className="ai-notes">
                          {extraction.result.warnings.map(
                            (w: string, i: number) => (
                              <p key={i}>{w}</p>
                            ),
                          )}
                        </div>
                      </details>
                    )}
                    <details className="document-text-preview">
                      <summary>
                        <FileText size={20} aria-hidden="true" />
                        <span>
                          <strong>Read extracted text</strong>
                          <small>
                            See the text read from your uploaded file.
                          </small>
                        </span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <pre
                        tabIndex={0}
                        aria-label="Text extracted from the document"
                      >
                        {extraction.result.text ||
                          "No readable text was found in this document."}
                      </pre>
                    </details>
                    <DocumentNextSteps
                      documentId={extraction.documentId}
                      status={
                        selectedDocument.data?.id === extraction.documentId
                          ? selectedDocument.data.status
                          : extraction.documentStatus
                      }
                      canReview={Boolean(
                        user?.internal &&
                        user.permissions.verification?.includes("review") &&
                        user.permissions.documents?.includes("review"),
                      )}
                      onAsk={() => {
                        setDocumentContext({
                          id: extraction.documentId,
                          name: extraction.documentName || "Selected document",
                        });
                        setMode("chat");
                        setExtraction(undefined);
                        setPrompt("");
                        setParams({});
                      }}
                    />
                  </article>
                )}
                {pendingText && (
                  <article className="ai-message ai-message-user">
                    <span className="ai-message-avatar">
                      {user?.name.charAt(0)}
                    </span>
                    <div>
                      <strong className="ai-message-name">{user?.name}</strong>
                      <p className="ai-pending-text">{pendingText}</p>
                    </div>
                  </article>
                )}
                {busy && mode !== "document" && (
                  <div className="ai-thinking" role="status">
                    <VsAiMark active />
                    <div>
                      <strong>VS AI</strong>
                      <span className="ai-thinking-label">
                        {slow ? "Still working on your request" : "Thinking"}
                        <span className="ai-typing-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </span>
                    </div>
                  </div>
                )}
                <div ref={end} />
              </div>
              {!(mode === "document" && extraction) && (
                <form className="ai-composer" onSubmit={submit}>
                  {mode === "chat" && documentContext && (
                    <div className="ai-document-context">
                      <FileSearch size={18} />
                      <div>
                        <strong>Using this document</strong>
                        <Link
                          to={`/app/documents?document=${documentContext.id}`}
                        >
                          {documentContext.name}
                        </Link>
                      </div>
                      <button
                        className="icon-button"
                        type="button"
                        disabled={busy}
                        aria-label="Remove document context"
                        onClick={() => setDocumentContext(undefined)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  {mode !== "chat" && (
                    <div className="ai-mode-label">
                      {modes.find((m) => m[0] === mode)?.[1]}
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => fresh("chat")}
                        aria-label="Use chat mode"
                        disabled={busy}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {params.get("record") && (
                    <p className="ai-context-note">
                      <FileText size={14} />
                      The selected record is included as context.
                    </p>
                  )}
                  {mode === "comparison" && (
                    <Field label="RFQ to analyze">
                      <select
                        className="input"
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                        disabled={busy}
                        required
                      >
                        <option value="">Select an RFQ</option>
                        {rfqs.data?.items?.map((r: any) => (
                          <option key={r.id} value={r.id}>
                            {r.number} · {r.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {mode === "discovery" && (
                    <details className="ai-discovery-filters">
                      <summary>Refine by partner profile fields</summary>
                      <div className="form-grid">
                        {Object.entries(discoveryFields).map(([key, label]) => (
                          <Field key={key} label={`Partner ${label}`}>
                            <Input
                              value={discoveryFilters[key] || ""}
                              onChange={(event) =>
                                setDiscoveryFilters({
                                  ...discoveryFilters,
                                  [key]: event.target.value,
                                })
                              }
                              maxLength={160}
                            />
                          </Field>
                        ))}
                        <Field label="Partner verification status">
                          <select
                            className="input"
                            value={discoveryFilters.verification || "active"}
                            onChange={(event) =>
                              setDiscoveryFilters({
                                ...discoveryFilters,
                                verification: event.target.value,
                              })
                            }
                          >
                            <option value="active">Active & approved</option>
                            {user?.internal && (
                              <>
                                <option value="verified">
                                  Verified, awaiting activation
                                </option>
                                <option value="active_or_verified">
                                  Active or verified
                                </option>
                              </>
                            )}
                          </select>
                        </Field>
                      </div>
                    </details>
                  )}
                  {mode === "alerts" && (
                    <p className="ai-context-note">
                      Review expiry, delivery, invoice, hiring, procurement and
                      partner-response signals.{" "}
                      <Link to="/app/insights">Inspect the evidence</Link>
                    </p>
                  )}
                  {mode === "document" ? (
                    <>
                      {user?.permissions.documents?.includes("create") && (
                        <div className="ai-document-intake">
                          <UploadCloud size={25} />
                          <div>
                            <strong>Start with your document</strong>
                            <p>
                              PDF, PNG or JPEG · Up to 10 MB · PDF up to{" "}
                              {documentLimits.pages} pages
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setUploadOpen(true)}
                          >
                            Upload & extract
                          </Button>
                        </div>
                      )}
                      <Field label="Document to extract">
                        <select
                          className="input"
                          value={selected}
                          onChange={(e) => {
                            setSelected(e.target.value);
                            setDocumentStage(undefined);
                            setExtraction(undefined);
                            setError(undefined);
                            setRequestNotice("");
                          }}
                          disabled={busy}
                          required
                        >
                          <option value="">Select a document</option>
                          {documentOptions.map((d: any) => (
                            <option key={d.id} value={d.id}>
                              {d.name} · {d.category}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <p className="ai-context-note">
                        Extract readable information from your selected
                        document.{" "}
                        <Link to="/app/documents">Upload a document</Link>
                      </p>
                    </>
                  ) : (
                    <textarea
                      aria-label="Ask VS AI"
                      placeholder={
                        mode === "draft"
                          ? "Describe the products, services or hiring requirement you need…"
                          : mode === "discovery"
                            ? "Describe the capabilities, location and certifications you need…"
                            : mode === "comparison"
                              ? "What would you like to compare? (optional)"
                              : mode === "alerts"
                                ? "Which commitments or trends would you like to understand? (optional)"
                                : "Ask about your requirements, invoices, candidate pipeline or next steps…"
                      }
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                      required={mode !== "comparison" && mode !== "alerts"}
                      minLength={
                        mode === "draft" ? 12 : mode === "discovery" ? 8 : 1
                      }
                      maxLength={5000}
                      rows={3}
                      disabled={busy}
                    />
                  )}
                  <FormError
                    error={
                      error ||
                      documents.error ||
                      selectedDocument.error ||
                      rfqs.error
                    }
                  />
                  {requestNotice && (
                    <p className="ai-request-notice" role="status">
                      {requestNotice}
                    </p>
                  )}
                  <div className="ai-composer-bottom">
                    <div className="ai-composer-tools">
                      {user?.permissions.documents?.includes("create") && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Upload a document for extraction"
                          title="Upload a document"
                          disabled={busy}
                          onClick={() => {
                            fresh("document");
                            setUploadOpen(true);
                          }}
                        >
                          <Paperclip size={18} />
                        </button>
                      )}
                      <span>VS AI</span>
                    </div>
                    {revealId ? (
                      <Button
                        key="reveal"
                        type="button"
                        variant="secondary"
                        onClick={(event) => {
                          event.preventDefault();
                          setRevealId(undefined);
                        }}
                      >
                        <Square size={14} />
                        Show full reply
                      </Button>
                    ) : busy && request.current ? (
                      <Button
                        key="stop"
                        type="button"
                        variant="secondary"
                        onClick={(event) => {
                          event.preventDefault();
                          request.current?.abort();
                        }}
                      >
                        <Square size={14} />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        key="send"
                        type="submit"
                        disabled={
                          busy ||
                          ((mode === "document" || mode === "comparison") &&
                            !selected)
                        }
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <ArrowUp size={16} />
                        )}{" "}
                        {canRetry
                          ? "Retry request"
                          : mode === "document"
                            ? "Extract document"
                            : mode === "draft"
                              ? "Generate draft"
                              : mode === "comparison"
                                ? "Analyze quotations"
                                : mode === "discovery"
                                  ? "Find partners"
                                  : mode === "alerts"
                                    ? "Review alerts"
                                    : "Send"}
                      </Button>
                    )}
                  </div>
                  <p className="ai-disclosure">
                    Uses records you can access. Review AI suggestions before
                    making business decisions.
                  </p>
                </form>
              )}
              {mode === "document" && extraction && (
                <div className="document-start-again">
                  <Button variant="secondary" onClick={() => fresh("document")}>
                    <Plus size={16} />
                    Extract another document
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {draft && (
        <RecordForm
          kind="requirements"
          draft={draft}
          onClose={() => setDraft(undefined)}
        />
      )}
      {uploadOpen && (
        <DocumentUpload
          initialCategory="Other"
          submitLabel="Upload & extract"
          onClose={() => setUploadOpen(false)}
          onUploaded={(document) => {
            fresh("document");
            setSelected(document.id);
            setDocumentContext({ id: document.id, name: document.name });
            void submit(undefined, "", document.id);
          }}
        />
      )}
    </>
  );
}
