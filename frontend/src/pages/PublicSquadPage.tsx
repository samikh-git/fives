import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ShareNetwork } from "@phosphor-icons/react";
import { getPublicGame, voteOnPublicGame } from "../lib/api/games";
import type { PublicGameSummary } from "../lib/api/games";
import { getVoterId, hasVoted, markVoted } from "../lib/voter";
import { ResultsTable } from "../components/ResultsTable";
import { shareOrDownloadImage } from "../lib/shareImage";
import type { Captain } from "../../../src/shared/types";

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

export function PublicSquadPage() {
  const { slug } = useParams<{ slug: string }>();
  const [summary, setSummary] = useState<PublicGameSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [voting, setVoting] = useState(false);
  const [justVoted, setJustVoted] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    getPublicGame(slug)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!slug || notFound) {
    return (
      <p className="alert" role="alert">
        This squad showcase isn't available. It may have expired or the link may be incorrect.
      </p>
    );
  }

  if (!summary) {
    return <p className="status-line">Loading...</p>;
  }

  const votingClosed = now > summary.votingClosesAt;
  const alreadyVoted = justVoted || hasVoted(slug);
  const canVote = !votingClosed && !alreadyVoted;
  const total = summary.tallies.A + summary.tallies.B;

  async function castVote(choice: Captain) {
    if (!slug || voting) return;
    setVoting(true);
    try {
      const { tallies } = await voteOnPublicGame(slug, choice, getVoterId());
      markVoted(slug);
      setJustVoted(true);
      setSummary((prev) => (prev ? { ...prev, tallies } : prev));
    } finally {
      setVoting(false);
    }
  }

  return (
    <div className="fulltime">
      <span className="fulltime__eyebrow">Public showcase</span>
      <h1>Which squad is better?</h1>
      <ResultsTable squads={summary.squads} />

      <div className="fulltime__share-row">
        {votingClosed && <p className="status-line">Voting has closed for this matchup.</p>}
        {canVote && (
          <>
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
          </>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() =>
            void shareOrDownloadImage(
              `/api/games/public/${slug}/share/combined.png`,
              "fives-matchup.png",
              "Vote on our Fives draft matchup",
            )
          }
        >
          <ShareNetwork weight="bold" /> Share matchup
        </button>
        <Link className="btn btn--primary" to="/games/new">
          Draft your own squad
        </Link>
      </div>

      <p className="status-line">
        Squad A: {summary.tallies.A} votes ({percentage(summary.tallies.A, total)}%) · Squad B:{" "}
        {summary.tallies.B} votes ({percentage(summary.tallies.B, total)}%)
      </p>
    </div>
  );
}
