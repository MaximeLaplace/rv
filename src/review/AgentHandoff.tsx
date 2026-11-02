import { useState } from "react";
import { Modal } from "../components/Modal";
import { copyText } from "../lib/clipboard";
import type { AgentConnection } from "../types";

export function AgentStatusCard({ connection, error, submitted, onSetup }: {
  connection: AgentConnection;
  error: string;
  submitted: boolean;
  onSetup: () => void;
}) {
  const { enabled, waiting, queued } = connection;
  const tone = error ? "error" : queued ? "queued" : waiting || submitted ? "ready" : "idle";
  const title = error ? "Connection needs attention"
    : !enabled ? "Connect your coding agent"
    : queued ? `${queued} ${queued === 1 ? "review" : "reviews"} queued`
    : waiting ? "Agent is waiting"
    : submitted ? "Feedback delivered" : "Agent handoff enabled";
  const description = error || (!enabled ? "Send your review directly, without copy and paste."
    : queued ? "Your feedback is queued. Your agent receives it with rv --wait."
    : waiting ? "Submit your comments when you're ready."
    : submitted ? "Your agent received the review. Refresh after it makes changes."
    : "Ask your agent to run rv --wait. You can submit before it starts waiting.");
  return (
    <section className={`agent-card ${tone}`} aria-label="Agent handoff">
      <div className="agent-card-heading">
        <span className="agent-status-dot" aria-hidden="true" />
        <span className="agent-card-eyebrow">Agent handoff</span>
        <button className="text-button" onClick={onSetup}>
          {error ? "Setup" : enabled ? "How it works" : "Connect agent"}
        </button>
      </div>
      <div role="status" aria-live="polite">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </section>
  );
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function AgentConnectionDialog({ root, connection, connecting, error, hasComments, onEnable, onClose }: {
  root: string;
  connection: AgentConnection;
  connecting: boolean;
  error: string;
  hasComments: boolean;
  onEnable: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const fallback = !connection.enabled && !connection.connectable;
  const command = fallback ? `rv ensure ${shellQuote(root)} --agent` : `rv ${shellQuote(root)} --wait`;
  const instructions = fallback ? command
    : `Use rv to collect my review feedback in ${root}. Run ${command}, apply the submitted feedback, then run it again for the next review round. Keep the current rv server running; do not restart it between rounds.`;
  async function copyInstructions() {
    try {
      await copyText(instructions);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Clipboard unavailable. Select and copy the command below.");
    }
  }
  return (
    <Modal className="agent-dialog" aria-labelledby="agent-dialog-title" onClose={onClose}>
      <div className="agent-dialog-heading">
        <div>
          <span className="agent-card-eyebrow">Local review handoff</span>
          <h2 id="agent-dialog-title">{connection.enabled ? "Review together, one round at a time" : "Connect your coding agent"}</h2>
        </div>
        <button autoFocus onClick={onClose} aria-label="Close agent setup">✕</button>
      </div>
      <div className="agent-dialog-body">
        <p className="agent-intro">You review in the browser. Your agent receives your comments in its terminal. Nothing leaves this machine through rv.</p>
        <ol className="agent-steps">
          <li><span>1</span><div><strong>{connection.enabled ? "Handoff is enabled" : "Enable handoff here"}</strong><p>{fallback ? "Restart this server once with the command below, then refresh this page." : "No restart needed. Your comments and review progress stay put."}</p></div></li>
          <li><span>2</span><div><strong>Give your agent the instructions below</strong><p>It runs <code>rv --wait</code> to receive your next review. This does not launch a coding agent for you.</p></div></li>
          <li><span>3</span><div><strong>Comment, then Submit to Agent</strong><p>Feedback is queued if your agent isn't waiting yet. After it makes changes, refresh and review again.</p></div></li>
        </ol>
        <div className="agent-instructions">
          <div><span>{fallback ? "Run once, then refresh" : "For your coding agent"}</span><button onClick={copyInstructions}>{copied ? "✓ Copied" : fallback ? "Copy command" : "Copy instructions"}</button></div>
          <code tabIndex={0}>{command}</code>
        </div>
        {(error || copyError) && <p className="agent-setup-error" role="alert">{copyError || error}</p>}
      </div>
      <div className="dialog-footer">
        <span>{connection.waiting ? "Your agent is waiting for feedback." : "Copy Prompt is always available too."}</span>
        <div className="dialog-actions">
          <button onClick={onClose}>{connection.enabled || fallback ? "Done" : "Not now"}</button>
          {!connection.enabled && !fallback && <button className="primary" disabled={connecting} onClick={onEnable}>
            {connecting ? "Connecting…" : hasComments ? "Enable & submit" : "Enable handoff"}
          </button>}
        </div>
      </div>
    </Modal>
  );
}
