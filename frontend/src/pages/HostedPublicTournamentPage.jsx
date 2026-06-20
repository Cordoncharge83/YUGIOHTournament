import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import PublicTournamentView from "../components/PublicTournamentView";
import { adaptSnapshotToPublicTournamentData } from "../lib/publicTournamentData";

const PUBLIC_SERVICE_URL = import.meta.env.VITE_PUBLIC_SERVICE_URL?.replace(/\/+$/, "");

export default function HostedPublicTournamentPage() {
  const { publicId } = useParams();
  const [tournamentData, setTournamentData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchHostedTournament() {
      if (!PUBLIC_SERVICE_URL) {
        setError("Public tournament service is not configured.");
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError("");
        setTournamentData(null);

        const response = await fetch(`${PUBLIC_SERVICE_URL}/api/tournaments/${encodeURIComponent(publicId)}`, {
          headers: {
            Accept: "application/json",
          },
        });

        if (response.status === 404) {
          setError("Tournament not found or unavailable.");
          return;
        }

        if (!response.ok) {
          setError("Could not load tournament from the public service.");
          return;
        }

        const workerData = await response.json();
        const adaptedData = adaptSnapshotToPublicTournamentData(workerData, publicId);
        if (!adaptedData) {
          setError("Tournament snapshot is unavailable.");
          return;
        }

        setTournamentData(adaptedData);
      } catch {
        setError("Network error while loading tournament.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchHostedTournament();
  }, [publicId]);

  return (
    <PublicTournamentView
      error={error}
      fallbackTitle={publicId}
      isLoading={isLoading}
      tournamentData={tournamentData}
    />
  );
}
