import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { RosterPage } from "./RosterPage";
import * as playersApi from "../lib/api/players";
import { ROSTER_PAGE_SIZE } from "../../../src/shared/constants";
import type { Player } from "../../../src/shared/types";

vi.mock("../lib/api/players");

const mockedApi = vi.mocked(playersApi);

const samplePlayers: Player[] = [
  { id: "1", name: "Alex Keeper", position: "GK", club: null, nation: null, league: null, imageUrl: null, externalId: null, archivedAt: null },
  { id: "2", name: "Sam Back", position: "DEF", club: null, nation: null, league: null, imageUrl: null, externalId: null, archivedAt: null },
];

beforeEach(() => {
  vi.resetAllMocks();
  mockedApi.listPlayers.mockResolvedValue({ players: [...samplePlayers], total: samplePlayers.length });
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
        club: null,
        nation: null,
        imageUrl: null,
      });
    });

    await waitFor(() => {
      expect(mockedApi.listPlayers).toHaveBeenCalledTimes(2);
    });
  });

  it("requests a bounded page instead of the entire roster", async () => {
    render(<RosterPage />);

    await screen.findByText("Alex Keeper");

    expect(mockedApi.listPlayers).toHaveBeenCalledWith({ limit: ROSTER_PAGE_SIZE, offset: 0 });
  });

  it("pages forward and back through a roster larger than one page", async () => {
    const secondPagePlayer: Player = {
      id: "3",
      name: "Page Two Player",
      position: "ATT",
      club: null,
      nation: null,
      league: null,
      imageUrl: null,
      externalId: null,
      archivedAt: null,
    };
    mockedApi.listPlayers.mockImplementation(async ({ offset } = {}) =>
      offset && offset > 0
        ? { players: [secondPagePlayer], total: ROSTER_PAGE_SIZE + 1 }
        : { players: [...samplePlayers], total: ROSTER_PAGE_SIZE + 1 },
    );

    render(<RosterPage />);
    await screen.findByText("Alex Keeper");

    const prevButton = screen.getByRole("button", { name: /previous/i });
    const nextButton = screen.getByRole("button", { name: /^next$/i });
    expect(prevButton).toBeDisabled();

    fireEvent.click(nextButton);

    await screen.findByText("Page Two Player");
    expect(mockedApi.listPlayers).toHaveBeenLastCalledWith({ limit: ROSTER_PAGE_SIZE, offset: ROSTER_PAGE_SIZE });
    expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    await screen.findByText("Alex Keeper");
    expect(mockedApi.listPlayers).toHaveBeenLastCalledWith({ limit: ROSTER_PAGE_SIZE, offset: 0 });
  });
});
