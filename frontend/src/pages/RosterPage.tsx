import { useCallback, useEffect, useState } from "react";
import type { Player, Position } from "../../../src/shared/types";
import * as playersApi from "../lib/api/players";
import { AddPlayerModal } from "../components/AddPlayerModal";

const POSITIONS: Position[] = ["GK", "DEF", "MID", "ATT"];

export function RosterPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPosition, setEditPosition] = useState<Position>("GK");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await playersApi.listPlayers();
      setPlayers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function startEdit(player: Player) {
    setEditingId(player.id);
    setEditName(player.name);
    setEditPosition(player.position);
  }

  async function handleSaveEdit(id: string) {
    try {
      await playersApi.updatePlayer(id, { name: editName, position: editPosition });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update player");
    }
  }

  async function handleArchive(id: string) {
    try {
      await playersApi.archivePlayer(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive player");
    }
  }

  return (
    <div>
      <div className="roster-page__head">
        <h1>Player Roster</h1>
        <div className="roster-page__head-actions">
          <span className="status-line">{players.length} in the pool</span>
          <button className="btn btn--primary" type="button" onClick={() => setShowAddModal(true)}>
            Add Player
          </button>
        </div>
      </div>

      {showAddModal && (
        <AddPlayerModal onClose={() => setShowAddModal(false)} onCreated={() => void refresh()} />
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="status-line">Loading...</p>
      ) : (
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
      )}
    </div>
  );
}
