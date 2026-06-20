import { Navigate, Route, Routes } from "react-router-dom";

import HostedPublicLandingPage from "../pages/HostedPublicLandingPage.jsx";
import HostedPublicTournamentPage from "../pages/HostedPublicTournamentPage.jsx";

export default function PublicApp() {
  return (
    <Routes>
      <Route path="/" element={<HostedPublicLandingPage />} />
      <Route path="/tournaments/:publicId" element={<HostedPublicTournamentPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
