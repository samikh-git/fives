import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createGame } from "../lib/api/games";
import type { PoolFilters as ApiPoolFilters } from "../lib/api/games";
import * as playersApi from "../lib/api/players";
import { saveCaptainSession } from "../lib/session";
import { MAX_CAPTAIN_NAME_LENGTH, MIN_GOALIES_IN_POOL, POOL_SIZE } from "../../../src/shared/constants";
import type { Player } from "../../../src/shared/types";

type PoolMode = "random" | "manual";

type FacetKey = "league" | "club" | "nation";

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "league", label: "League" },
  { key: "club", label: "Club" },
  { key: "nation", label: "Nationality" },
];

type FacetFilters = Record<FacetKey, Set<string>>;

function emptyFacetFilters(): FacetFilters {
  return { league: new Set(), club: new Set(), nation: new Set() };
}

function matchesFilters(player: Player, filters: FacetFilters): boolean {
  return FACETS.every(({ key }) => {
    const selected = filters[key];
    if (selected.size === 0) return true;
    const value = player[key];
    return value !== null && selected.has(value);
  });
}

export function CreateGamePage() {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<PoolMode>("random");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FacetFilters>(emptyFacetFilters);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (players.length === 0) {
      void playersApi.listPlayers().then((page) => setPlayers(page.players));
    }
  }, [players.length]);

  const facetOptions = useMemo(() => {
    const options: Record<FacetKey, string[]> = { league: [], club: [], nation: [] };
    for (const { key } of FACETS) {
      const values = new Set<string>();
      for (const player of players) {
        const value = player[key];
        if (value) values.add(value);
      }
      options[key] = [...values].sort();
    }
    return options;
  }, [players]);

  const clubGroups = useMemo(() => {
    const byLeague = new Map<string, Set<string>>();
    const ungrouped = new Set<string>();
    for (const player of players) {
      if (!player.club) continue;
      if (player.league) {
        if (!byLeague.has(player.league)) byLeague.set(player.league, new Set());
        byLeague.get(player.league)!.add(player.club);
      } else {
        ungrouped.add(player.club);
      }
    }
    const groups = [...byLeague.entries()]
      .map(([league, clubs]) => ({ league, clubs: [...clubs].sort() }))
      .sort((a, b) => a.league.localeCompare(b.league));
    if (ungrouped.size > 0) {
      groups.push({ league: "Other", clubs: [...ungrouped].sort() });
    }
    return groups;
  }, [players]);

  const filteredPlayers = useMemo(
    () => players.filter((p) => matchesFilters(p, filters)),
    [players, filters],
  );

  const activeFilterCount = FACETS.reduce((sum, { key }) => sum + filters[key].size, 0);

  function handleFacetChange(key: FacetKey, e: ChangeEvent<HTMLSelectElement>) {
    const values = new Set(Array.from(e.target.selectedOptions, (option) => option.value));
    setFilters((prev) => ({ ...prev, [key]: values }));
  }

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
      const filtersPayload: ApiPoolFilters = {};
      if (filters.league.size > 0) filtersPayload.leagues = [...filters.league];
      if (filters.club.size > 0) filtersPayload.clubs = [...filters.club];
      if (filters.nation.size > 0) filtersPayload.nations = [...filters.nation];

      const result =
        mode === "manual"
          ? await createGame({ selectedPlayerIds: [...selectedIds] })
          : await createGame(Object.keys(filtersPayload).length > 0 ? { filters: filtersPayload } : undefined);
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
          maxLength={MAX_CAPTAIN_NAME_LENGTH}
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

      <div className="create-game__filters">
        <p className="create-game__filters-hint">
          Narrow the pool by league, club, or nationality. Hold Ctrl (Windows/Linux) or ⌘ (Mac) and
          click to select more than one value in a list; clubs are grouped under their league.
        </p>
        <div className="create-game__filter-fields">
          <div className="create-game__filter">
            <label htmlFor="filter-league">League</label>
            <select
              id="filter-league"
              multiple
              size={Math.min(6, Math.max(facetOptions.league.length, 1))}
              value={[...filters.league]}
              onChange={(e) => handleFacetChange("league", e)}
            >
              {facetOptions.league.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="create-game__filter">
            <label htmlFor="filter-club">Club</label>
            <select
              id="filter-club"
              multiple
              size={Math.min(6, Math.max(clubGroups.reduce((sum, g) => sum + g.clubs.length, 0), 1))}
              value={[...filters.club]}
              onChange={(e) => handleFacetChange("club", e)}
            >
              {clubGroups.map(({ league, clubs }) => (
                <optgroup key={league} label={league}>
                  {clubs.map((club) => (
                    <option key={club} value={club}>
                      {club}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="create-game__filter">
            <label htmlFor="filter-nation">Nationality</label>
            <select
              id="filter-nation"
              multiple
              size={Math.min(6, Math.max(facetOptions.nation.length, 1))}
              value={[...filters.nation]}
              onChange={(e) => handleFacetChange("nation", e)}
            >
              {facetOptions.nation.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        {activeFilterCount > 0 && (
          <button type="button" className="btn" onClick={() => setFilters(emptyFacetFilters())}>
            Clear filters
          </button>
        )}
      </div>

      {mode === "random" && activeFilterCount > 0 && (
        <p className="status-line">
          {filteredPlayers.length} player{filteredPlayers.length === 1 ? "" : "s"} match the selected
          filters
        </p>
      )}

      {mode === "manual" && (
        <div className="create-game__player-picker">
          <p className="status-line">
            {selectedIds.size}/{POOL_SIZE} selected · {selectedGoalieCount}/{MIN_GOALIES_IN_POOL}{" "}
            goalkeepers
          </p>
          <ul className="create-game__player-list">
            {filteredPlayers.map((player) => (
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
