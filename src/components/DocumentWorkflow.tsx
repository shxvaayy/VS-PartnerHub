import {
  Check,
  CheckCheck,
  CircleAlert,
  FileSearch,
  ScanLine,
  ShieldCheck,
  UploadCloud,
  UserRoundCheck,
} from "lucide-react";
import type { DocumentAiStage, DocumentAiProgress } from "../../shared/ai";
import { VsAiMark } from "./VsAi";

const steps = [
  { title: "Upload", detail: "Your source document", Icon: UploadCloud },
  { title: "Extract", detail: "Read text & identify fields", Icon: ScanLine },
  { title: "Validate", detail: "Check formats & profile", Icon: CheckCheck },
  {
    title: "Human review",
    detail: "Confirm against the source",
    Icon: UserRoundCheck,
  },
  {
    title: "VS decision",
    detail: "Authorized team approval",
    Icon: ShieldCheck,
  },
];
export default function DocumentWorkflow({
  stage,
  selected,
  busy,
  failed,
  stopped,
  extraction,
  fileName,
  progress,
}: {
  stage?: DocumentAiStage;
  selected: boolean;
  busy: boolean;
  failed: boolean;
  stopped: boolean;
  extraction?: any;
  fileName?: string;
  progress?: DocumentAiProgress;
}) {
  const reviewed = extraction?.reviewStatus === "reviewed";
  const approved = extraction?.documentStatus === "approved";
  const rejected = extraction?.documentStatus === "rejected";
  const expired = extraction?.documentStatus === "expired";
  const current = approved
    ? 5
    : reviewed
      ? 4
      : extraction || stage === "ready"
        ? 3
        : stage === "validating"
          ? 2
          : selected
            ? 1
            : 0;
  const running = busy && !failed && !stopped;
  const title = failed
    ? "Let's get this step completed"
    : stopped
      ? "Your document is saved. Continue when ready."
      : expired
        ? "Your document needs renewal"
        : approved
          ? "Review complete. Document approved."
          : rejected
            ? "The VS team has requested changes"
            : reviewed
              ? "Human review recorded"
              : extraction
                ? "Your document is ready for human review"
                : stage === "validating"
                  ? "Checking the extracted information"
                  : stage === "extracting"
                    ? "Turning your document into useful information"
                    : stage === "reading"
                      ? "Reading your document"
                      : selected
                        ? "Your document is ready to analyze"
                        : "From document to verified information";
  const detail = failed
    ? "Review the message below, then retry. Completed steps are preserved."
    : stopped
      ? "The analysis stopped. Your uploaded file remains in Documents."
      : expired
        ? "Open the document to upload its renewed version for review."
        : approved
          ? "The authorized VS reviewer has recorded the approval."
          : rejected
            ? "Open the document to read the review notes and prepare a new version."
            : reviewed
              ? "Open the document to see the latest review notes and decision."
              : extraction
                ? "Check each field against the source before a verification decision."
                : running
                  ? "VS AI is working through your file. You can stop the request at any time."
                  : "Upload a file, extract its details and give your team a clear review trail.";
  return (
    <section
      className={`document-workflow ${running ? "is-running" : ""} ${failed ? "has-error" : ""}`}
      aria-label="Document processing workflow"
      data-stage={stage || (selected ? "uploaded" : "waiting")}
    >
      <div className="document-workflow-heading">
        <VsAiMark active={running} />
        <div>
          <span className="document-workflow-eyebrow">
            DOCUMENT INTELLIGENCE
          </span>
          <h2>{title}</h2>
        </div>
        <span
          className={`document-workflow-status ${running ? "is-live" : ""}`}
        >
          <i aria-hidden="true" />
          {failed
            ? "Needs attention"
            : stopped
              ? "Paused"
              : expired
                ? "Renewal needed"
                : approved
                  ? "Approved"
                  : rejected
                    ? "Changes requested"
                    : extraction
                      ? "Ready to review"
                      : running
                        ? "Processing"
                        : "Ready"}
        </span>
      </div>
      <p className="document-workflow-description" role="status">
        {running && stage === "reading" && progress?.totalPages
          ? `${progress.pagesRead || 0} of ${progress.totalPages} pages read. Your file stays available in Documents.`
          : detail}
      </p>
      {running && stage === "reading" && Boolean(progress?.totalPages) && (
        <progress
          className="document-page-progress"
          aria-label="PDF pages read"
          value={progress?.pagesRead || 0}
          max={progress?.totalPages}
        />
      )}
      {fileName && (
        <div className="document-workflow-file">
          <FileSearch size={15} />
          <span>{fileName}</span>
          <span>Private document</span>
        </div>
      )}
      <ol className="document-workflow-steps">
        {steps.map(({ title: label, detail: subtitle, Icon }, index) => {
          const done = index < current,
            active = index === current,
            error = active && (failed || rejected || expired);
          return (
            <li
              key={label}
              className={`${done ? "is-complete" : ""} ${active ? "is-current" : ""} ${error ? "is-error" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              <span className="document-workflow-node" aria-hidden="true">
                {done ? (
                  <Check className="document-step-check" size={19} />
                ) : error ? (
                  <CircleAlert size={20} />
                ) : (
                  <Icon size={20} />
                )}
                <span className="document-workflow-orbit" />
                {active && running && (
                  <span className="document-workflow-scan" />
                )}
              </span>
              <div>
                <strong>{label}</strong>
                <small>{subtitle}</small>
                <span className="document-step-state">
                  {done
                    ? "Completed"
                    : error
                      ? "Needs attention"
                      : active
                        ? running
                          ? "In progress"
                          : index >= 3
                            ? "Awaiting review"
                            : "Next step"
                        : "Waiting"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="document-workflow-footer">
        <ShieldCheck size={14} />
        <span>
          Review stays with your team. Only an authorized verifier can approve.
        </span>
      </div>
    </section>
  );
}
