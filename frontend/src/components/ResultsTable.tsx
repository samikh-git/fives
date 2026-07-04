import { Fragment } from "react";
import type { Captain, SquadEntry } from "../../../src/shared/types";

export interface ResultsTableProps {
  squads: Record<Captain, SquadEntry[]>;
  captainNames?: Record<Captain, string | null>;
}

const CAPTAINS: Captain[] = ["A", "B"];

function totalSpend(entries: SquadEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.pricePaid, 0);
}

export function ResultsTable({ squads, captainNames }: ResultsTableProps) {
  const maxRows = Math.max(squads.A.length, squads.B.length);

  return (
    <table className="results-table">
      <thead>
        <tr>
          {CAPTAINS.map((captain) => (
            <th key={captain} colSpan={3}>
              {captainNames?.[captain] ?? `Captain ${captain}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: maxRows }).map((_, rowIndex) => (
          <tr key={rowIndex}>
            {CAPTAINS.map((captain) => {
              const entry = squads[captain][rowIndex];
              return (
                <Fragment key={captain}>
                  <td>
                    {entry?.imageUrl && <img className="results-table__image" src={entry.imageUrl} alt="" />}
                    {entry?.name ?? ""}
                  </td>
                  <td>{entry?.club ?? ""}</td>
                  <td>{entry ? entry.pricePaid.toLocaleString() : ""}</td>
                </Fragment>
              );
            })}
          </tr>
        ))}
        <tr>
          {CAPTAINS.map((captain) => (
            <td key={captain} colSpan={3}>
              Total: {totalSpend(squads[captain]).toLocaleString()}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
