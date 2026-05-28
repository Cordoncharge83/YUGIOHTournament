import { Navigate, Route, Routes } from "react-router-dom";

import AdminPage from "./pages/AdminPage.jsx";
import AdminTournamentPage from "./pages/AdminTournamentPage.jsx";
import PublicTournamentPage from "./pages/PublicTournamentPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/tournaments/:id" element={<AdminTournamentPage />} />
      <Route path="/t/:id" element={<PublicTournamentPage />} />
    </Routes>
  );
}
