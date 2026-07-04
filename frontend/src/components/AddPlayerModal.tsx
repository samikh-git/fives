import { useState, type ChangeEvent, type FormEvent } from "react";
import type { Position } from "../../../src/shared/types";
import * as playersApi from "../lib/api/players";
import { Modal } from "./Modal";

const POSITIONS: Position[] = ["GK", "DEF", "MID", "ATT"];

interface AddPlayerModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function AddPlayerModal({ onClose, onCreated }: AddPlayerModalProps) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState<Position>("GK");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await playersApi.uploadPlayerImage(file);
      setImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    setSubmitting(true);
    setError(null);
    try {
      await playersApi.createPlayer({ name, position, imageUrl: imageUrl || null });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add player");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add Player" onClose={onClose}>
      <form className="roster-form roster-form--modal" onSubmit={(e) => void handleSubmit(e)}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <label htmlFor="new-player-name">Name</label>
        <input id="new-player-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

        <label htmlFor="new-player-position">Position</label>
        <select id="new-player-position" value={position} onChange={(e) => setPosition(e.target.value as Position)}>
          {POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {pos}
            </option>
          ))}
        </select>

        <label htmlFor="new-player-image-url">Image URL</label>
        <input
          id="new-player-image-url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://..."
        />

        <label htmlFor="new-player-image-file">Or upload an image</label>
        <input id="new-player-image-file" type="file" accept="image/*" onChange={(e) => void handleFileChange(e)} />

        {uploading && <p className="status-line">Uploading...</p>}
        {imageUrl && !uploading && <img className="roster-form__preview" src={imageUrl} alt="Preview" />}

        <button className="btn btn--primary" type="submit" disabled={submitting || uploading}>
          {submitting ? "Adding..." : "Add Player"}
        </button>
      </form>
    </Modal>
  );
}
