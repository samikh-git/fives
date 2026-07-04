import { useCallback, useEffect, useState } from "react";
import type { Player, Position } from "../../../src/shared/types";
import { ROSTER_PAGE_SIZE } from "../../../src/shared/constants";
import * as playersApi from "../lib/api/players";
import { AddPlayerModal } from "../components/AddPlayerModal";

const POSITIONS: Position[] = ["GK", "DEF", "MID", "ATT"];

export function RosterPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPosition, setEditPosition] = useState<Position>("GK");

  const pageCount = Math.max(1, Math.ceil(total / ROSTER_PAGE_SIZE));

  const refresh = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const data = await playersApi.listPlayers({
        limit: ROSTER_PAGE_SIZE,
        offset: targetPage * ROSTER_PAGE_SIZE,
      });
      setPlayers(data.players);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(page);
  }, [refresh, page]);

  // If an archive/delete empties the current (non-first) page, step back a page
  // rather than showing a page with nothing on it.
  useEffect(() => {
    if (!loading && players.length === 0 && page > 0) {
      setPage((p) => p - 1);
    }
  }, [loading, players.length, page]);

  function startEdit(player: Player) {
    setEditingId(player.id);
    setEditName(player.name);
    setEditPosition(player.position);
  }

  async function handleSaveEdit(id: string) {
    try {
      await playersApi.updatePlayer(id, { name: editName, position: editPosition });
      setEditingId(null);
      await refresh(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update player");
    }
  }

  async function handleArchive(id: string) {
    try {
      await playersApi.archivePlayer(id);
      await refresh(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive player");
    }
  }

  return (
    <div>
      <div className="roster-page__head">
        <h1>Player Roster</h1>
        <div className="roster-page__head-actions">
          <span className="status-line">{total} in the pool</span>
          <button className="btn btn--primary" type="button" onClick={() => setShowAddModal(true)}>
            Add Player
          </button>
        </div>
      </div>

      {showAddModal && (
        <AddPlayerModal onClose={() => setShowAddModal(false)} onCreated={() => void refresh(page)} />
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="status-line">Loading...</p>
      ) : (
        <div className="roster-table-wrapper">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Name</th>
              <th>Position</th>
              <th>Club</th>
              <th>Nation</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) =>
              editingId === player.id ? (
                <tr key={player.id}>
                  <td>
                    {player.imageUrl && <img className="roster-table__image" src={player.imageUrl} alt="" />}
                  </td>
                  <td>
                    <label htmlFor={`edit-name-${player.id}`}>Edit name</label>
                    <input
                      id={`edit-name-${player.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </td>
                  <td>
                    <label htmlFor={`edit-position-${player.id}`}>Edit position</label>
                    <select
                      id={`edit-position-${player.id}`}
                      value={editPosition}
                      onChange={(e) => setEditPosition(e.target.value as Position)}
                    >
                      {POSITIONS.map((pos) => (
                        <option key={pos} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{player.club}</td>
                  <td>{player.nation}</td>
                  <td>
                    <button
                      className="btn btn--small"
                      type="button"
                      onClick={() => void handleSaveEdit(player.id)}
                    >
                      Save
                    </button>
                    <button
                      className="btn btn--small btn--ghost"
                      type="button"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={player.id}>
                  <td>
                    {player.imageUrl && <img className="roster-table__image" src={player.imageUrl} alt="" />}
                  </td>
                  <td>{player.name}</td>
                  <td>
                    <span className={`position-badge position-badge--${player.position.toLowerCase()}`}>
                      {player.position}
                    </span>
                  </td>
                  <td>{player.club}</td>
                  <td>{player.nation}</td>
                  <td>
                    <button className="btn btn--small btn--ghost" type="button" onClick={() => startEdit(player)}>
                      Edit
                    </button>
                    <button
                      className="btn btn--small btn--ghost"
                      type="button"
                      onClick={() => void handleArchive(player.id)}
                    >
                      Archive
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="roster-pagination">
          <button
            className="btn btn--small btn--ghost"
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="status-line">
            Page {page + 1} of {pageCount}
          </span>
          <button
            className="btn btn--small btn--ghost"
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
