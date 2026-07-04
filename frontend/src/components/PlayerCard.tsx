import type { Position } from "../../../src/shared/types";

export interface PlayerCardProps {
  name: string;
  position: Position;
  club?: string | null;
  nation?: string | null;
  imageUrl?: string | null;
}

export function PlayerCard({ name, position, club, nation, imageUrl }: PlayerCardProps) {
  return (
    <div className="player-card">
      {imageUrl && <img className="player-card__image" src={imageUrl} alt="" />}
      <span className="player-card__name">{name}</span>
      <span className="player-card__position">{position}</span>
      {club && <span className="player-card__club">{club}</span>}
      {nation && <span className="player-card__nation">{nation}</span>}
    </div>
  );
}
