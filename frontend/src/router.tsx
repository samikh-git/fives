import type { ReactNode } from "react";
import { useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { RosterPage } from "./pages/RosterPage";
import { CreateGamePage } from "./pages/CreateGamePage";
import { JoinGamePage } from "./pages/JoinGamePage";
import { GameRoomPage } from "./pages/GameRoomPage";
import { PublicSquadPage } from "./pages/PublicSquadPage";
import { PublicFeedPage } from "./pages/PublicFeedPage";
import { ChatToggleSlotContext } from "./lib/chatToggleSlot";

function HomePage() {
  return (
    <div className="kickoff">
      <span className="kickoff__eyebrow">2 captains · 10 players</span>
      <h1 className="kickoff__title">
        FIVE<span>S</span>
      </h1>
      <p className="kickoff__subtitle">
        A live bidding draft for 5-a-side squads. Build your roster, throw open a pool of ten,
        and outbid your co-captain player by player until both squads are full.
      </p>
      <div className="kickoff__actions">
        <Link className="btn btn--primary" to="/games/new">
          Start a new game
        </Link>
      </div>
    </div>
  );
}

function StadiumGutter({ side }: { side: "left" | "right" }) {
  return <div className={`stadium__sidebar stadium__sidebar--${side}`} aria-hidden="true" />;
}

function Ticker() {
  return (
    <p className="ticker">
      Fives · <span className="ticker__highlight">live bidding draft</span> for 5-a-side squads
    </p>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [chatToggleSlot, setChatToggleSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div className="stadium">
      <StadiumGutter side="left" />

      <div className="stadium__screen">
        <header className="matchday-header">
          <Link className="matchday-header__wordmark" to="/">
            FIVE<span>S</span>
          </Link>
          <div className="matchday-header__actions">
            <div className="matchday-header__chat-slot" ref={setChatToggleSlot} />
            <Link className="matchday-header__admin-link" to="/showcase">
              Public showcase
            </Link>
            <span className="matchday-header__live">On air</span>
          </div>
        </header>
        <main className="app-main">
          <ChatToggleSlotContext.Provider value={chatToggleSlot}>
            {children}
          </ChatToggleSlotContext.Provider>
        </main>
      </div>

      <StadiumGutter side="right" />

      <footer className="stadium__footer">
        <Ticker />
      </footer>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/roster" element={<RosterPage />} />
          <Route path="/games/new" element={<CreateGamePage />} />
          <Route path="/game/:gameId/join" element={<JoinGamePage />} />
          <Route path="/game/:gameId" element={<GameRoomPage />} />
          <Route path="/showcase" element={<PublicFeedPage />} />
          <Route path="/showcase/:slug" element={<PublicSquadPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
