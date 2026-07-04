import type { Captain, SquadEntry } from "../../../src/shared/types";

export interface SquadPanelProps {
  captain: Captain;
  name?: string | null;
  squad: SquadEntry[];
}

export function SquadPanel({ captain, name, squad }: SquadPanelProps) {
  return (
    <div className="squad-panel">
      <h3>{name ?? `Captain ${captain}`}'s squad</h3>
      {squad.length === 0 ? (
        <p className="squad-list__empty">No players signed yet.</p>
      ) : (
        <ul className="squad-list">
          {squad.map((entry) => (
            <li key={entry.playerId}>
              {entry.imageUrl && <img className="squad-list__image" src={entry.imageUrl} alt="" />}
              <span className={`position-badge position-badge--${entry.position.toLowerCase()}`}>
                {entry.position}
              </span>
              <span>{entry.name}</span>
              {entry.club && <span className="squad-list__club">{entry.club}</span>}
              {entry.nation && <span className="squad-list__nation">{entry.nation}</span>}
              <span className="squad-list__price mono-num">{entry.pricePaid.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
