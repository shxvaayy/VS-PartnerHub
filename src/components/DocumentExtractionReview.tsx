import { Link } from "react-router-dom";
import { FileSearch, ShieldCheck } from "lucide-react";
import { useApi } from "../lib/api";
import { Button, Field, FormError, Input, Loading } from "./ui";
import {
  emptyIdentity,
  identityLabels,
  type ExtractedIdentity,
  type IdentityField,
  type ExtractionValidation,
} from "../../shared/ai";
import { formatDate } from "../lib/format";

export type ExtractionReviewInput = {
  extractionId: string;
  fields: ExtractedIdentity;
  sourceConfirmed: boolean;
};
export function ExtractionChecks({
  checks,
}: {
  checks: ExtractionValidation[];
}) {
  return (
    <ul className="extraction-checks">
      {checks.map((check) => (
        <li className={`extraction-check-${check.status}`} key={check.field}>
          <strong>
            {identityLabels[check.field]}{" "}
            <span>
              {check.status === "valid"
                ? "Checked"
                : check.status === "missing"
                  ? "Not found"
                  : "Review needed"}
            </span>
          </strong>
          <p>{check.message}</p>
        </li>
      ))}
    </ul>
  );
}
export default function DocumentExtractionReview({
  documentId,
  value,
  onChange,
}: {
  documentId: string;
  value?: ExtractionReviewInput;
  onChange: (review?: ExtractionReviewInput) => void;
}) {
  const extractions = useApi<any>(`/documents/${documentId}/extractions`);
  if (extractions.isPending) return <Loading />;
  if (extractions.error) return <FormError error={extractions.error} />;
  const items = extractions.data.items || [],
    selected = items.find((item: any) => item.id === value?.extractionId);
  return (
    <section
      className="extraction-review-panel"
      aria-label="AI extraction and human review"
    >
      <div className="operations-heading">
        <div>
          <h3>
            <FileSearch size={18} /> Document AI review
          </h3>
          <p>
            Inspect the source, correct extracted fields and record your
            decision.
          </p>
        </div>
      </div>
      {!items.length ? (
        <p className="small-note">
          No extraction is available for this document.{" "}
          <Link
            className="text-link"
            to={`/app/ai?mode=document&document=${documentId}`}
          >
            Extract with VS AI
          </Link>{" "}
          or continue with a manual document review.
        </p>
      ) : (
        <>
          <Field label="Extraction for this review">
            <select
              className="input"
              value={value?.extractionId || ""}
              onChange={(event) => {
                const item = items.find(
                  (row: any) => row.id === event.target.value,
                );
                onChange(
                  item
                    ? {
                        extractionId: item.id,
                        fields:
                          item.reviews[0]?.fields ||
                          item.result.identity ||
                          emptyIdentity(),
                        sourceConfirmed: false,
                      }
                    : undefined,
                );
              }}
            >
              <option value="">Manual review without an AI extraction</option>
              {items.map((item: any) => (
                <option key={item.id} value={item.id}>
                  {formatDate(item.created_at)} · {item.result.documentType} ·{" "}
                  {item.reviews.length
                    ? "Previously reviewed"
                    : "Awaiting human review"}
                </option>
              ))}
            </select>
          </Field>
          {selected && value && (
            <>
              <p className="small-note">{selected.result.summary}</p>
              <div className="extraction-review-fields">
                {(Object.keys(identityLabels) as IdentityField[]).map((key) => (
                  <Field
                    key={key}
                    label={`Reviewed ${identityLabels[key]}`}
                    hint={
                      selected.result.identity[key]
                        ? `AI extracted: ${selected.result.identity[key]}`
                        : "Not found in the extraction. Leave blank if absent from the source."
                    }
                  >
                    <Input
                      value={value.fields[key] || ""}
                      maxLength={
                        key === "address"
                          ? 2000
                          : key === "company_name"
                            ? 500
                            : key === "certificate_type" ||
                                key === "registration_number"
                              ? 200
                              : 100
                      }
                      onChange={(event) =>
                        onChange({
                          ...value,
                          sourceConfirmed: false,
                          fields: {
                            ...value.fields,
                            [key]: event.target.value || null,
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <details className="extraction-validation-detail">
                <summary>Inspect original format and profile checks</summary>
                <ExtractionChecks checks={selected.result.validation || []} />
              </details>
              <label className="checkbox-label extraction-confirm">
                <input
                  type="checkbox"
                  checked={value.sourceConfirmed}
                  required
                  onChange={(event) =>
                    onChange({
                      ...value,
                      sourceConfirmed: event.target.checked,
                    })
                  }
                />
                <span>
                  I compared these fields with the source document. My decision
                  and corrections should be recorded.
                </span>
              </label>
              <p className="small-note">
                <ShieldCheck size={13} /> The VS verification team makes the
                decision. Saving reviewed fields does not silently change the
                company profile or registered expiry date.
              </p>
              {selected.reviews.length > 0 && (
                <details>
                  <summary>
                    Previous human reviews ({selected.reviews.length})
                  </summary>
                  <ul className="extraction-review-history">
                    {selected.reviews.map((review: any) => (
                      <li key={review.id}>
                        <strong>
                          {review.reviewer_name} ·{" "}
                          {review.decision.replaceAll("_", " ")}
                        </strong>
                        <p>
                          {formatDate(review.created_at)} ·{" "}
                          {review.note ||
                            "Source inspected and decision recorded."}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => onChange(undefined)}
              >
                Continue with manual review
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
