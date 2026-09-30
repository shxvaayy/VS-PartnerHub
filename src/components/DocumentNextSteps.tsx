import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCheck,
  Download,
  FilePenLine,
  UserRoundCheck,
} from "lucide-react";
import { VsAiMark } from "./VsAi";

export default function DocumentNextSteps({
  documentId,
  status,
  canReview,
  onAsk,
}: {
  documentId: string;
  status?: string;
  canReview: boolean;
  onAsk: () => void;
}) {
  const approved = status === "approved",
    rejected = status === "rejected",
    expired = status === "expired";
  const title = expired
    ? "Renewal needed"
    : approved
      ? "Document approved"
      : rejected
        ? "Changes are needed"
        : canReview
          ? "Ready for your review"
          : "Awaiting VS verification";
  const description = expired
    ? "This document has expired. Open it to upload a renewed version for the VS team to review."
    : approved
      ? "The VS team has approved this document. You can open the review details below."
      : rejected
        ? "Read the review notes to see what needs correcting before uploading a new version."
        : canReview
          ? "Check the extracted details against the original file, then approve or reject the document."
          : "The details have been extracted. The VS team will check the document and record its decision.";
  const action = expired
    ? "View document & renew"
    : approved
      ? "View review details"
      : rejected
        ? "View review notes"
        : canReview
          ? "Start document review"
          : "View review status";
  const Icon = approved ? CheckCheck : rejected ? FilePenLine : UserRoundCheck;
  return (
    <section
      className="document-next-steps"
      aria-label="Next steps for this document"
    >
      <div className={`document-review-next ${approved ? "is-approved" : ""}`}>
        <span className="document-next-icon" aria-hidden="true">
          <Icon size={23} />
        </span>
        <div className="document-next-copy">
          <span className="document-next-eyebrow">
            {approved || rejected ? "REVIEW OUTCOME" : "NEXT STEP"}
          </span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <Link
          className="button button-primary document-review-action"
          to={`/app/documents?document=${documentId}`}
        >
          {action}
          <ArrowRight size={16} />
        </Link>
      </div>
      <div className="document-support-actions">
        <a
          className="document-support-action"
          href={`/api/documents/${documentId}/download`}
          aria-label="Download original document"
        >
          <span className="document-support-icon" aria-hidden="true">
            <Download size={20} />
          </span>
          <span>
            <strong>Download original</strong>
            <small>Keep a copy of the uploaded file.</small>
          </span>
        </a>
        <button
          className="document-support-action"
          type="button"
          onClick={onAsk}
          aria-label="Ask VS AI about this document"
        >
          <VsAiMark />
          <span>
            <strong>Ask VS AI</strong>
            <small>Get help understanding this document.</small>
          </span>
          <ArrowRight
            className="document-support-arrow"
            size={16}
            aria-hidden="true"
          />
        </button>
      </div>
    </section>
  );
}
