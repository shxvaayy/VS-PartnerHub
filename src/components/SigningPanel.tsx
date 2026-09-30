import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileSignature, Mail, Plus, ShieldCheck } from "lucide-react";
import { api, useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  Modal,
  useToast,
} from "./ui";
import { formatDate } from "../lib/format";
import type { WorkRecord } from "../../shared/domain";

export default function SigningPanel({ record }: { record: WorkRecord }) {
  const { user, demo } = useAuth(),
    client = useQueryClient(),
    toast = useToast();
  const data = useApi<any>(`/signatures/contracts/${record.id}`),
    documents = useApi<any>(`/documents?record_id=${record.id}&limit=100`);
  const [requesting, setRequesting] = useState(false),
    [signing, setSigning] = useState<any>(),
    [voiding, setVoiding] = useState<any>(),
    [challenge, setChallenge] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function send(path: string, body: any) {
    return api(`/signatures/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await send(`contracts/${record.id}`, {
        documentId: form.get("documentId"),
        signerIds: form.getAll("signerIds"),
        expiresInDays: Number(form.get("expiresInDays")),
        version: record.version,
      });
      await client.invalidateQueries();
      setRequesting(false);
      toast(
        "Signature request created. The designated signers have been notified.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function otp() {
    setBusy(true);
    setError(undefined);
    try {
      setChallenge(await send(`${signing.id}/otp`, {}));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await send(`${signing.id}/sign`, {
        challengeId: challenge.challengeId,
        code: form.get("code"),
        name: form.get("name"),
        consent: form.has("consent"),
        sourceDigest: signing.source_digest,
      });
      await client.invalidateQueries();
      setSigning(undefined);
      setChallenge(undefined);
      toast("Your contract signature has been recorded.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (data.isPending) return <Loading />;
  if (data.error) return <ErrorState error={data.error} retry={data.refetch} />;
  return (
    <div className="operations-panel">
      <div className="operations-heading">
        <div>
          <h2>Contract signatures</h2>
          <p>Collect authorized signatures against a specific contract PDF.</p>
        </div>
        {data.data.canRequest &&
          !data.data.items.some((e: any) =>
            ["pending", "expired"].includes(e.status),
          ) && (
            <Button
              variant="secondary"
              onClick={() => {
                setRequesting(true);
                setError(undefined);
              }}
            >
              <Plus size={15} />
              Request signatures
            </Button>
          )}
      </div>
      {data.data.items.length ? (
        data.data.items.map((envelope: any) => (
          <div className="signature-envelope" key={envelope.id}>
            <div className="operations-heading">
              <div>
                <strong>Contract version {envelope.contract_version}</strong>
                <p>
                  Requested {formatDate(envelope.created_at)} · Expires{" "}
                  {formatDate(envelope.expires_at)}
                </p>
              </div>
              <Badge status={envelope.status} />
            </div>
            <a
              href={`/api/documents/${envelope.document_id}/download`}
              className="text-link"
            >
              <Download size={15} />
              Download the contract for this request
            </a>
            <div className="signature-parties">
              {envelope.parties.map((p: any) => (
                <div key={p.id}>
                  <span>
                    <strong>{p.signed_name || p.name}</strong>
                    <small>{p.email}</small>
                  </span>
                  <Badge
                    status={p.status === "signed" ? "approved" : "pending"}
                  >
                    {p.status === "signed" ? "Signed" : "Awaiting signature"}
                  </Badge>
                  {p.signed_at && <small>{formatDate(p.signed_at)}</small>}
                  {p.user_id === user?.id &&
                    p.status === "pending" &&
                    envelope.status === "pending" && (
                      <Button
                        onClick={() => {
                          setSigning(envelope);
                          setChallenge(undefined);
                          setError(undefined);
                        }}
                      >
                        <FileSignature size={15} />
                        Review & sign
                      </Button>
                    )}
                </div>
              ))}
            </div>
            <div className="signature-actions">
              {envelope.status === "completed" && (
                <>
                  <a
                    className="button button-secondary"
                    href={`/api/signatures/${envelope.id}/certificate`}
                  >
                    <ShieldCheck size={16} />
                    Download signing evidence
                  </a>
                  <a
                    className="button button-secondary"
                    href={`/api/signatures/${envelope.id}/evidence`}
                  >
                    <Download size={16} />
                    Download audit data (JSON)
                  </a>
                </>
              )}
              {data.data.canRequest &&
                ["pending", "expired"].includes(envelope.status) && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setVoiding(envelope);
                      setError(undefined);
                    }}
                  >
                    Void request
                  </Button>
                )}
            </div>
            <details className="signature-integrity">
              <summary>Document integrity</summary>
              <p>SHA-256 of the original document</p>
              <code>{envelope.source_digest}</code>
            </details>
          </div>
        ))
      ) : (
        <EmptyState
          icon={<FileSignature size={28} />}
          title="Keep signatures with the agreement"
          description="After the contract is approved, an authorized buyer can choose the final PDF and request signatures from both parties."
        />
      )}
      {requesting && (
        <Modal
          title="Request contract signatures"
          onClose={() => !busy && setRequesting(false)}
        >
          <form onSubmit={request}>
            <div className="modal-body form-stack">
              <FormError error={error} />
              <Field label="Final contract PDF" required>
                <select className="input" name="documentId" required>
                  <option value="">Choose a PDF attachment</option>
                  {documents.data?.items
                    .filter(
                      (d: any) =>
                        d.mime_type === "application/pdf" &&
                        !documents.data.items.some(
                          (n: any) => n.previous_id === d.id,
                        ),
                    )
                    .map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · Version {d.version}
                      </option>
                    ))}
                </select>
              </Field>
              <fieldset className="role-checks">
                <legend>
                  Authorized signers (at least one from each party)
                </legend>
                {data.data.eligibleSigners.map((s: any) => (
                  <label key={s.id}>
                    <input type="checkbox" name="signerIds" value={s.id} />
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {s.organization_name} · {s.email}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {data.data.eligibleSigners.length < 2 && (
                <p>
                  Each party needs an active representative with a verified
                  email and contract review permission. Use People & access to
                  manage your organization’s accounts.
                </p>
              )}
              <Field label="Request expires after (days)">
                <Input
                  name="expiresInDays"
                  type="number"
                  min={1}
                  max={30}
                  defaultValue={7}
                  required
                />
              </Field>
              <p className="small-note">
                Signers review the PDF and confirm their typed name using an
                email code. The original PDF is preserved with a signing
                evidence certificate. This workflow records electronic consent;
                it does not issue a statutory certificate-based digital
                signature.
              </p>
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setRequesting(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                busy={busy}
                disabled={data.data.eligibleSigners.length < 2}
              >
                Send signature request
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {signing && (
        <Modal
          title="Review and sign this contract"
          onClose={() => !busy && setSigning(undefined)}
        >
          <form onSubmit={sign}>
            <div className="modal-body form-stack">
              <FormError error={error} />
              <a
                href={`/api/documents/${signing.document_id}/download`}
                className="button button-secondary"
              >
                <Download size={16} />
                Download and review the contract
              </a>
              <p>
                {record.number} · Contract version {signing.contract_version}
              </p>
              <Field label="Your full legal name" required>
                <Input
                  name="name"
                  defaultValue={user?.name}
                  minLength={2}
                  required
                />
              </Field>
              <label className="checkbox-row signature-consent">
                <input type="checkbox" name="consent" required />
                {data.data.consent}
              </label>
              {challenge ? (
                <>
                  <p>
                    Signing code requested for {user?.email}. It expires in 10
                    minutes.
                  </p>
                  <Field label="Email signing code" required>
                    <Input
                      name="code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      required
                    />
                  </Field>
                  {demo && challenge.verificationCode && (
                    <div className="dev-code">
                      <strong>Isolated demo verification code</strong>
                      <code>{challenge.verificationCode}</code>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    busy={busy}
                    onClick={otp}
                  >
                    Resend signing code
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  busy={busy}
                  onClick={otp}
                >
                  <Mail size={16} />
                  Send code to my verified email
                </Button>
              )}
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setSigning(undefined)}
              >
                Cancel
              </Button>
              <Button type="submit" busy={busy} disabled={!challenge}>
                <FileSignature size={16} />
                Sign contract
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {voiding && (
        <Modal
          title="Void this signature request"
          onClose={() => !busy && setVoiding(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const note = new FormData(e.currentTarget).get("note");
              setBusy(true);
              setError(undefined);
              try {
                await send(`${voiding.id}/void`, { note });
                await client.invalidateQueries();
                setVoiding(undefined);
                toast(
                  "Signature request voided. Existing evidence is preserved.",
                );
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body form-stack">
              <FormError error={error} />
              <Field label="Reason" required>
                <textarea
                  className="input"
                  name="note"
                  minLength={5}
                  maxLength={2000}
                  required
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button type="submit" variant="danger" busy={busy}>
                Void signature request
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
