import { SQUAD_SIZE } from "../../../src/shared/constants";
import type { Captain } from "../../../src/shared/types";

export interface BudgetPanelProps {
  captain: Captain;
  name?: string | null;
  budget: number;
  squadCount: number;
}

export function BudgetPanel({ captain, name, budget, squadCount }: BudgetPanelProps) {
  return (
    <div className="budget-panel">
      <div className="side__head">
        <h3>{name ?? `Captain ${captain}`}</h3>
        <span className="side__budget mono-num budget-panel__budget">{budget.toLocaleString()}</span>
      </div>
      <div className="side__slots budget-panel__slots">
        {Array.from({ length: SQUAD_SIZE }).map((_, i) => (
          <span key={i} className={`side__slot ${i < squadCount ? "side__slot--filled" : ""}`} />
        ))}
        <span className="status-line">
          {squadCount}/{SQUAD_SIZE}
        </span>
      </div>
    </div>
  );
}
