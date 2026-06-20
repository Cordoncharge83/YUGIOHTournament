import { Navigate, Route, Routes } from "react-router-dom";

import AdminPage from "./pages/AdminPage.jsx";
import AdminTournamentPage from "./pages/AdminTournamentPage.jsx";
import HostedPublicTournamentPage from "./pages/HostedPublicTournamentPage.jsx";
import PlayerProfilesPage from "./pages/PlayerProfilesPage.jsx";
import PublicTournamentPage from "./pages/PublicTournamentPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/players" element={<PlayerProfilesPage />} />
      <Route path="/admin/tournaments/:id" element={<AdminTournamentPage />} />
      <Route path="/t/:id" element={<PublicTournamentPage />} />
      <Route path="/tournaments/:publicId" element={<HostedPublicTournamentPage />} />
    </Routes>
  );
}
