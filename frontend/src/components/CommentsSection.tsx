import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getComments, postComment } from "../lib/api/games";
import type { PublicComment } from "../lib/api/games";
import { MAX_COMMENT_AUTHOR_NAME_LENGTH, MAX_COMMENT_TEXT_LENGTH } from "../../../src/shared/constants";

export function CommentsSection({ slug }: { slug: string }) {
  const [comments, setComments] = useState<PublicComment[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComments(null);
    setLoadError(false);
    getComments(slug)
      .then((data) => {
        if (!cancelled) setComments(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const canSubmit = text.trim().length > 0 && (anonymous || authorName.trim().length > 0);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || posting) return;

    setPosting(true);
    setError(null);
    try {
      const comment = await postComment(slug, {
        text: text.trim(),
        authorName: anonymous ? null : authorName.trim(),
      });
      setComments((prev) => (prev ? [...prev, comment] : [comment]));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="comments">
      <h2 className="comments__title">Comments</h2>

      {loadError ? (
        <p className="alert" role="alert">
          Comments couldn't be loaded right now. Please try again later.
        </p>
      ) : (
        <>
          <ul className="comments__list">
            {comments === null && <li className="status-line">Loading comments...</li>}
            {comments?.length === 0 && (
              <li className="status-line">No comments yet. Be the first to say something.</li>
            )}
            {comments?.map((comment) => (
              <li key={comment.id} className="comments__item">
                <span className="comments__author">{comment.authorName ?? "Anonymous"}</span>
                <span className="comments__text">{comment.text}</span>
              </li>
            ))}
          </ul>

          <form className="comments__form" onSubmit={(event) => void handleSubmit(event)}>
            <textarea
              className="comments__input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Add a comment..."
              aria-label="Comment"
              maxLength={MAX_COMMENT_TEXT_LENGTH}
              rows={3}
            />
            <div className="comments__form-row">
              <input
                type="text"
                className="comments__author-input"
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                placeholder="Your name"
                aria-label="Your name"
                maxLength={MAX_COMMENT_AUTHOR_NAME_LENGTH}
                disabled={anonymous}
              />
              <label className="comments__anonymous-toggle">
                <input
                  type="checkbox"
                  checked={anonymous}
                  onChange={(event) => setAnonymous(event.target.checked)}
                />
                Post anonymously
              </label>
              <button type="submit" className="btn btn--small" disabled={!canSubmit || posting}>
                {posting ? "Posting..." : "Post"}
              </button>
            </div>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}
