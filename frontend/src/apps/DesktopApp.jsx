import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import KtsLauncher from "../components/KtsLauncher.jsx";
import AdminPage from "../pages/AdminPage.jsx";
import AdminTournamentPage from "../pages/AdminTournamentPage.jsx";
import HostedPublicTournamentPage from "../pages/HostedPublicTournamentPage.jsx";
import PlayerProfilesPage from "../pages/PlayerProfilesPage.jsx";
import PublishingSettingsPage from "../pages/PublishingSettingsPage.jsx";
import PublicTournamentPage from "../pages/PublicTournamentPage.jsx";

const navLinkClassName = ({ isActive }) =>
  `inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold transition-colors ${
    isActive
      ? "border-sky-400/50 bg-sky-500/15 text-sky-100 shadow-sm shadow-sky-950/30"
      : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-sky-400/40 hover:bg-slate-800 hover:text-slate-50"
  }`;

export default function DesktopApp() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-3">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-50">
              Tournament Manager
            </span>
            <nav className="flex flex-wrap items-center gap-2 text-sm">
              <NavLink className={navLinkClassName} end to="/admin">
                Dashboard
              </NavLink>
              <NavLink className={navLinkClassName} to="/admin/players">
                Community Players
              </NavLink>
              <NavLink className={navLinkClassName} to="/admin/settings/publishing">
                Settings
              </NavLink>
            </nav>
          </div>
          <KtsLauncher />
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/players" element={<PlayerProfilesPage />} />
        <Route path="/admin/settings/publishing" element={<PublishingSettingsPage />} />
        <Route path="/admin/tournaments/:id" element={<AdminTournamentPage />} />
        <Route path="/t/:id" element={<PublicTournamentPage />} />
        <Route path="/tournaments/:publicId" element={<HostedPublicTournamentPage />} />
      </Routes>
    </div>
  );
}
