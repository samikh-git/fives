import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { getPublicGamesFeed, voteOnPublicGame } from "../lib/api/games";
import type { PublicFeedEntry } from "../lib/api/games";
import { getVoterId, hasVoted, markVoted } from "../lib/voter";
import { CommentsSection } from "../components/CommentsSection";
import type { Captain } from "../../../src/shared/types";

export function PublicFeedPage() {
  const [entries, setEntries] = useState<PublicFeedEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [voting, setVoting] = useState(false);
  const [votedSlugs, setVotedSlugs] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    getPublicGamesFeed().then((data) => {
      if (!cancelled) setEntries(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!entries) {
    return <p className="status-line">Loading...</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="public-feed">
        <p className="status-line">No squads have been published for public voting yet.</p>
        <Link className="btn btn--primary" to="/games/new">
          Draft your own squad
        </Link>
      </div>
    );
  }

  const entry = entries[index]!;
  const votingClosed = now > entry.votingClosesAt;
  const alreadyVoted = votedSlugs.has(entry.publicSlug) || hasVoted(entry.publicSlug);
  const canVote = !votingClosed && !alreadyVoted;
  const total = entry.tallies.A + entry.tallies.B;

  async function castVote(choice: Captain) {
    if (voting) return;
    setVoting(true);
    try {
      const { tallies } = await voteOnPublicGame(entry.publicSlug, choice, getVoterId());
      markVoted(entry.publicSlug);
      setVotedSlugs((prev) => new Set(prev).add(entry.publicSlug));
      setEntries((prev) => (prev ? prev.map((e, i) => (i === index ? { ...e, tallies } : e)) : prev));
    } finally {
      setVoting(false);
    }
  }

  return (
    <div className="public-feed">
      <span className="fulltime__eyebrow">Public showcase</span>
      <h1>Vote on live matchups</h1>

      <div className="public-feed__viewport">
        <button
          type="button"
          className="public-feed__arrow"
          aria-label="Previous matchup"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <CaretLeft weight="bold" />
        </button>

        <div className="public-feed__card">
          <img
            className="public-feed__image"
            src={`/api/games/public/${entry.publicSlug}/share/combined.png`}
            alt="Squad matchup"
            loading="lazy"
          />

          {canVote ? (
            <div className="public-feed__vote-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={voting}
                onClick={() => void castVote("A")}
              >
                Vote Squad A
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={voting}
                onClick={() => void castVote("B")}
              >
                Vote Squad B
              </button>
            </div>
          ) : (
            <p className="status-line">
              {votingClosed ? "Voting has closed for this matchup." : "You already voted on this matchup."}
            </p>
          )}

          <span className="public-feed__caption">
            Squad A {entry.tallies.A} - {entry.tallies.B} Squad B
            {total > 0 && ` (${total} votes)`}
          </span>
        </div>

        <button
          type="button"
          className="public-feed__arrow"
          aria-label="Next matchup"
          disabled={index === entries.length - 1}
          onClick={() => setIndex((i) => Math.min(entries.length - 1, i + 1))}
        >
          <CaretRight weight="bold" />
        </button>
      </div>

      <CommentsSection key={entry.publicSlug} slug={entry.publicSlug} />
    </div>
  );
}
