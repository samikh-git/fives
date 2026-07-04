import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Copy, Check, ShareNetwork } from "@phosphor-icons/react";
import { getCaptainSession } from "../lib/session";
import { useGameSocket } from "../hooks/useGameSocket";
import { computeMaxLegalBid } from "../../../src/shared/rules";
import { PlayerCard } from "../components/PlayerCard";
import { BidControls } from "../components/BidControls";
import { BudgetPanel } from "../components/BudgetPanel";
import { SquadPanel } from "../components/SquadPanel";
import { ResultsTable } from "../components/ResultsTable";
import { ChatModal } from "../components/ChatModal";
import type { Captain, SquadEntry } from "../../../src/shared/types";

export function GameRoomPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const session = gameId ? getCaptainSession(gameId) : null;
  const [linkCopied, setLinkCopied] = useState(false);

  async function copyJoinLink(url: string) {
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function shareJoinLink(url: string) {
    if (navigator.share) {
      try {
        await navigator.share({ url, title: "Join my Fives draft" });
      } catch {
        // user cancelled the share sheet — nothing to do
      }
    } else {
      await copyJoinLink(url);
    }
  }

  // Hooks must run unconditionally; useGameSocket no-ops (stays disconnected)
  // when gameId/token are null, which is the case whenever there's no valid
  // session for this game.
  const { state, error, chatMessages, connected, placeBid, pass, proposeNextPlayer, sendChat, dismissError } = useGameSocket(
    session && gameId ? gameId : null,
    session ? session.token : null,
    session?.name ?? null,
  );

  useEffect(() => {
    if (state?.phase === "in_progress" && state.round === null) {
      proposeNextPlayer();
    }
  }, [state?.phase, state?.round, proposeNextPlayer]);

  if (!gameId || !session) {
    return (
      <p className="alert" role="alert">
        Invalid link. Ask your captain to resend the game invite.
      </p>
    );
  }

  const myCaptain: Captain = session.role;

  if (!state) {
    return <p className="status-line">Connecting to game...</p>;
  }

  let content: ReactNode;

  if (state.phase === "waiting_for_captain_b") {
    content = (
      <div className="lobby-card">
        <span className="kickoff__eyebrow">Kick-off pending</span>
        <h2>Waiting for {state.captainNames.B ?? "Captain B"} to join...</h2>
        <div className="lobby-card__connections">
          <span className="lobby-dot">
            <span className={`lobby-dot__light ${state.captainAConnected ? "lobby-dot__light--on" : ""}`} />
            {state.captainNames.A ?? "Captain A"}: {state.captainAConnected ? "connected" : "offline"}
          </span>
          <span className="lobby-dot">
            <span className={`lobby-dot__light ${state.captainBConnected ? "lobby-dot__light--on" : ""}`} />
            {state.captainNames.B ?? "Captain B"}: {state.captainBConnected ? "connected" : "offline"}
          </span>
        </div>
        {session.joinUrlForB && (
          <div className="lobby-card__link-row">
            <label htmlFor="join-link-b">Share this link with Captain B</label>
            <div className="lobby-card__link-input-row">
              <input readOnly id="join-link-b" aria-label="Join link for Captain B" value={session.joinUrlForB} />
              <button
                className="btn btn--icon"
                type="button"
                aria-label={linkCopied ? "Link copied" : "Copy link"}
                title={linkCopied ? "Copied!" : "Copy link"}
                onClick={() => void copyJoinLink(session.joinUrlForB!)}
              >
                {linkCopied ? <Check weight="bold" /> : <Copy weight="bold" />}
              </button>
              <button
                className="btn btn--icon lobby-card__share-btn"
                type="button"
                aria-label="Share link"
                title="Share link"
                onClick={() => void shareJoinLink(session.joinUrlForB!)}
              >
                <ShareNetwork weight="bold" />
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="alert" role="alert">
            {error.message}
            <button type="button" className="alert__dismiss" aria-label="Dismiss" onClick={dismissError}>
              &times;
            </button>
          </p>
        )}
      </div>
    );
  }

  if (state.phase === "completed") {
    content = (
      <div className="fulltime">
        <span className="fulltime__eyebrow">Full time</span>
        <h1>Final squads</h1>
        <ResultsTable squads={state.squads} captainNames={state.captainNames} />
      </div>
    );
  }

  if (state.phase === "in_progress") {
    const opponent: Captain = myCaptain === "A" ? "B" : "A";
    const round = state.round;

    content = (
      <div className="matchroom">
        {error && (
          <p className="alert" role="alert">
            {error.message}
            <button type="button" className="alert__dismiss" aria-label="Dismiss" onClick={dismissError}>
              &times;
            </button>
          </p>
        )}

        <div className="matchroom__scoreboard">
          <Side
            captain={myCaptain}
            name={state.captainNames[myCaptain]}
            mine
            onTheBall={round?.turn === myCaptain}
            budget={state.budgets[myCaptain]}
            squadCount={state.squadCounts[myCaptain]}
            squad={state.squads[myCaptain]}
          />

          <div className="auction-card">
            {round ? (
              <>
                <span className="auction-card__label">On the block · Round {round.roundNumber}</span>
                <PlayerCard
                  name={round.name}
                  position={round.position}
                  club={round.club}
                  nation={round.nation}
                  imageUrl={round.imageUrl}
                />

                <span
                  className={`turn-flag ${round.turn === myCaptain ? "turn-flag--active" : ""}`}
                >
                  {round.turn === myCaptain ? "Your bid" : "Waiting on opponent"}
                </span>

                <div className="bid-ticker">
                  <span className="bid-ticker__label">Current bid</span>
                  <span className="bid-ticker__amount" key={round.currentBid ?? "none"}>
                    {round.currentBid !== null ? round.currentBid.toLocaleString() : "—"}
                  </span>
                  {round.currentBidder && (
                    <span className={`bid-ticker__holder bid-ticker__holder--${round.currentBidder.toLowerCase()}`}>
                      held by {state.captainNames[round.currentBidder] ?? `Captain ${round.currentBidder}`}
                    </span>
                  )}
                </div>

                <BidControls
                  currentBid={round.currentBid}
                  subphase={round.subphase}
                  isMyTurn={round.turn === myCaptain}
                  isFirstBidder={round.firstBidder === myCaptain}
                  maxLegalBid={computeMaxLegalBid(
                    state.budgets[myCaptain],
                    state.squadCounts[myCaptain],
                  )}
                  onBid={placeBid}
                  onPass={pass}
                />
              </>
            ) : (
              <div className="propose-next">
                <span className="auction-card__label">Between rounds</span>
                <p>Bringing up the next player...</p>
              </div>
            )}
          </div>

          <Side
            captain={opponent}
            name={state.captainNames[opponent]}
            mine={false}
            onTheBall={round?.turn === opponent}
            budget={state.budgets[opponent]}
            squadCount={state.squadCounts[opponent]}
            squad={state.squads[opponent]}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {!connected && (
        <p className="alert alert--reconnecting" role="status">
          Reconnecting...
        </p>
      )}
      {content}
      <ChatModal
        myCaptain={myCaptain}
        captainNames={state.captainNames}
        messages={chatMessages}
        onSend={sendChat}
      />
    </>
  );
}

function Side({
  captain,
  name,
  mine,
  onTheBall,
  budget,
  squadCount,
  squad,
}: {
  captain: Captain;
  name: string | null;
  mine: boolean;
  onTheBall: boolean;
  budget: number;
  squadCount: number;
  squad: SquadEntry[];
}) {
  return (
    <section
      className={[
        "side",
        captain === "A" ? "side--a" : "side--b",
        mine ? "side--mine" : "",
        onTheBall ? "side--on-the-ball" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <BudgetPanel captain={captain} name={name} budget={budget} squadCount={squadCount} />
      <SquadPanel captain={captain} name={name} squad={squad} />
    </section>
  );
}
