import { useState } from "react";
import type { Comment } from "@/lib/types";

function formatCommentDate(iso: string) {
  const date = new Date(iso + "T00:00:00");
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CommentBubble({ comment }: { comment: Comment }) {
  const isAdmin = comment.role === "building_admin";
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: isAdmin ? "var(--brand-tint)" : "var(--surface-2)",
        border: `1px solid ${isAdmin ? "color-mix(in srgb, var(--brand) 35%, transparent)" : "var(--border-hairline)"}`,
      }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[color:var(--text-primary)]">{comment.author}</span>
        {isAdmin && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white"
            style={{ background: "var(--brand)" }}
          >
            Building Admin
          </span>
        )}
        <span className="text-[10px] text-[color:var(--text-muted)]">{formatCommentDate(comment.timestamp)}</span>
      </div>
      <p className="text-sm text-[color:var(--text-secondary)]">{comment.text}</p>
    </div>
  );
}

export function ComplaintComments({ complaintId, seed }: { complaintId: string; seed: Comment[] }) {
  const [comments, setComments] = useState<Comment[]>(seed);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Stub for real auth/session data — a signed-in user's admin status would
  // come from the backend, not a checkbox. This just gates the UI so the
  // permission structure (who's allowed to post as an admin) is in place.
  const [isBuildingAdmin, setIsBuildingAdmin] = useState(false);

  const totalCount = comments.reduce((sum, c) => sum + 1 + (c.replies?.length ?? 0), 0);
  const replyTarget = replyTo ? comments.find((c) => c.id === replyTo) ?? null : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    const entry: Comment = {
      id: `${complaintId}-${Date.now()}`,
      author: isBuildingAdmin ? "Building Administrator" : "You",
      role: isBuildingAdmin ? "building_admin" : "resident",
      text: trimmed,
      timestamp: new Date().toISOString().slice(0, 10),
    };

    setComments((prev) =>
      replyTarget
        ? prev.map((c) => (c.id === replyTarget.id ? { ...c, replies: [...(c.replies ?? []), entry] } : c))
        : [...prev, entry]
    );
    setText("");
    setReplyTo(null);
  }

  return (
    <div>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
        Comments ({totalCount})
      </p>

      {comments.length === 0 ? (
        <p className="mb-4 text-sm text-[color:var(--text-muted)]">No comments yet — be the first to weigh in.</p>
      ) : (
        <div className="mb-4 flex flex-col gap-3">
          {comments.map((c) => (
            <div key={c.id}>
              <CommentBubble comment={c} />
              <button
                type="button"
                onClick={() => setReplyTo(c.id)}
                className="mt-1 ml-1 text-xs font-medium text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)]"
              >
                Reply
              </button>
              {c.replies && c.replies.length > 0 && (
                <div className="mt-2 flex flex-col gap-2 border-l-2 pl-3" style={{ borderColor: "var(--gridline)" }}>
                  {c.replies.map((r) => (
                    <CommentBubble key={r.id} comment={r} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="rounded-lg p-3" style={{ border: "1px solid var(--border-hairline)" }}>
        {replyTarget && (
          <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--text-muted)]">
            <span>Replying to {replyTarget.author}</span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="font-medium text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={isBuildingAdmin ? "Post a status update…" : "Share an update or ask a question…"}
          className="w-full resize-none rounded-md px-2.5 py-2 text-sm outline-none"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
            <input
              type="checkbox"
              checked={isBuildingAdmin}
              onChange={(e) => setIsBuildingAdmin(e.target.checked)}
              className="h-3 w-3"
            />
            Posting as registered building admin
          </label>
          <button
            type="submit"
            disabled={!text.trim()}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--brand)" }}
          >
            {replyTarget ? "Reply" : "Post"}
          </button>
        </div>
      </form>
    </div>
  );
}
