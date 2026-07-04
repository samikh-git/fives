import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame } from "../lib/api/games";
import * as playersApi from "../lib/api/players";
import { saveCaptainSession } from "../lib/session";
import { MIN_GOALIES_IN_POOL, POOL_SIZE } from "../../../src/shared/constants";
import type { Player } from "../../../src/shared/types";

type PoolMode = "random" | "manual";

export function CreateGamePage() {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<PoolMode>("random");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (mode === "manual" && players.length === 0) {
      void playersApi.listPlayers().then(setPlayers);
    }
  }, [mode, players.length]);

  const selectedGoalieCount = players.filter(
    (p) => selectedIds.has(p.id) && p.position === "GK",
  ).length;
  const canSubmitManual =
    selectedIds.size === POOL_SIZE && selectedGoalieCount >= MIN_GOALIES_IN_POOL;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result =
        mode === "manual" ? await createGame([...selectedIds]) : await createGame();
      const trimmedName = name.trim();
      saveCaptainSession(
        result.gameId,
        result.captainAToken,
        "A",
        result.joinUrlForB,
        trimmedName === "" ? undefined : trimmedName,
      );
      navigate(`/game/${result.gameId}`, { replace: true });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="create-game">
      <h1>Create game</h1>
      {errorMessage && (
        <p className="alert" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="create-game__field">
        <label htmlFor="captain-name">Your name</label>
        <input
          id="captain-name"
          placeholder="Captain A"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <fieldset className="create-game__mode">
        <legend>Player pool</legend>
        <label>
          <input
            type="radio"
            name="pool-mode"
            value="random"
            checked={mode === "random"}
            onChange={() => setMode("random")}
          />
          Random pool of {POOL_SIZE} players
        </label>
        <label>
          <input
            type="radio"
            name="pool-mode"
            value="manual"
            checked={mode === "manual"}
            onChange={() => setMode("manual")}
          />
          Choose players
        </label>
      </fieldset>

      {mode === "manual" && (
        <div className="create-game__player-picker">
          <p className="status-line">
            {selectedIds.size}/{POOL_SIZE} selected · {selectedGoalieCount}/{MIN_GOALIES_IN_POOL}{" "}
            goalkeepers
          </p>
          <ul className="create-game__player-list">
            {players.map((player) => (
              <li key={player.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(player.id)}
                    disabled={!selectedIds.has(player.id) && selectedIds.size >= POOL_SIZE}
                    onChange={() => toggleSelected(player.id)}
                  />
                  {player.imageUrl && (
                    <img className="create-game__player-image" src={player.imageUrl} alt="" />
                  )}
                  <span className={`position-badge position-badge--${player.position.toLowerCase()}`}>
                    {player.position}
                  </span>
                  <span>{player.name}</span>
                  {player.club && <span>{player.club}</span>}
                  {player.nation && <span>{player.nation}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        className="btn btn--primary"
        type="button"
        disabled={submitting || (mode === "manual" && !canSubmitManual)}
        onClick={() => void handleSubmit()}
      >
        {submitting ? "Drawing pool..." : "Create game"}
      </button>
    </div>
  );
}
