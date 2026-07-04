import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { RosterPage } from "./RosterPage";
import * as playersApi from "../lib/api/players";
import type { Player } from "../../../src/shared/types";

vi.mock("../lib/api/players");

const mockedApi = vi.mocked(playersApi);

const samplePlayers: Player[] = [
  { id: "1", name: "Alex Keeper", position: "GK", club: null, nation: null, league: null, imageUrl: null, externalId: null, archivedAt: null },
  { id: "2", name: "Sam Back", position: "DEF", club: null, nation: null, league: null, imageUrl: null, externalId: null, archivedAt: null },
];

beforeEach(() => {
  vi.resetAllMocks();
  mockedApi.listPlayers.mockResolvedValue([...samplePlayers]);
  mockedApi.createPlayer.mockResolvedValue({
    id: "3",
    name: "New Player",
    position: "MID",
    club: null,
    nation: null,
    league: null,
    imageUrl: null,
    externalId: null,
    archivedAt: null,
  });
  mockedApi.updatePlayer.mockResolvedValue(samplePlayers[0]!);
  mockedApi.archivePlayer.mockResolvedValue({ ...samplePlayers[0]!, archivedAt: Date.now() });
});

describe("RosterPage", () => {
  it("fetches and renders the roster on mount", async () => {
    render(<RosterPage />);

    expect(mockedApi.listPlayers).toHaveBeenCalledTimes(1);
    await screen.findByText("Alex Keeper");
    screen.getByText("Sam Back");

    const table = screen.getByRole("table");
    within(table).getByText("GK");
    within(table).getByText("DEF");
  });

  it("opens the add-player modal, submits it, and refreshes the roster", async () => {
    render(<RosterPage />);

    await screen.findByText("Alex Keeper");

    fireEvent.click(screen.getByRole("button", { name: /add player/i }));

    const dialog = screen.getByRole("dialog", { name: /add player/i });
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Player" } });
    fireEvent.change(within(dialog).getByLabelText(/^position$/i), { target: { value: "MID" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add player/i }));

    await waitFor(() => {
      expect(mockedApi.createPlayer).toHaveBeenCalledWith({
        name: "New Player",
        position: "MID",
        imageUrl: null,
      });
    });

    await waitFor(() => {
      expect(mockedApi.listPlayers).toHaveBeenCalledTimes(2);
    });
  });
});
