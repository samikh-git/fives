import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { saveCaptainSession } from "../lib/session";
import { MAX_CAPTAIN_NAME_LENGTH } from "../../../src/shared/constants";

export function JoinGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("t");
  const [name, setName] = useState("");

  if (!gameId || !token) {
    return (
      <p className="alert" role="alert">
        Invalid join link. Ask your captain to resend the invite.
      </p>
    );
  }

  function handleJoin() {
    const trimmedName = name.trim();
    saveCaptainSession(gameId!, token!, "B", undefined, trimmedName === "" ? undefined : trimmedName);
    navigate(`/game/${gameId}`, { replace: true });
  }

  return (
    <div className="join-game">
      <h1>Join game</h1>
      <div className="create-game__field">
        <label htmlFor="captain-name">Your name</label>
        <input
          id="captain-name"
          placeholder="Captain B"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_CAPTAIN_NAME_LENGTH}
        />
      </div>
      <button className="btn btn--primary" type="button" onClick={handleJoin}>
        Join game
      </button>
    </div>
  );
}
