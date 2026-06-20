import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import api from "../api/client";
import PublicTournamentView from "../components/PublicTournamentView";

export default function PublicTournamentPage() {
  const { id } = useParams();
  const [tournamentData, setTournamentData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchTournament() {
      try {
        setIsLoading(true);
        setError("");
        const response = await api.get(`/public/tournaments/${id}`);
        setTournamentData({
          ...response.data,
          lastUpdatedAt: new Date().toISOString(),
        });
      } catch {
        setError("Could not load tournament.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchTournament();
  }, [id]);

  return (
    <PublicTournamentView
      error={error}
      fallbackTitle={`Tournament #${id}`}
      isLoading={isLoading}
      tournamentData={tournamentData}
    />
  );
}
