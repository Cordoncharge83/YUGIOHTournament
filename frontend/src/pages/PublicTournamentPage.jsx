import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import api from "../api/client";

function formatPlayerDisplayName(name) {
  return (name || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

function getResultDisplay(match) {
  const resultStatus = match.result_status || "UNREPORTED";
  const playerOneName = formatPlayerDisplayName(match.player_one_name);
  const playerTwoName = match.notes === "BYE" && !match.player_two_name
    ? "BYE"
    : formatPlayerDisplayName(match.player_two_name) || "TBD";

  if (match.notes === "BYE") {
    return "Automatic Win";
  }

  if (resultStatus === "PLAYER_ONE_WIN") {
    return `${playerOneName} defeated ${playerTwoName}`;
  }

  if (resultStatus === "PLAYER_TWO_WIN") {
    return `${playerTwoName} defeated ${playerOneName}`;
  }

  if (resultStatus === "DRAW") {
    return "Draw";
  }

  if (resultStatus === "DOUBLE_LOSS") {
    return "Double loss";
  }

  return "Pending";
}

export default function PublicTournamentPage() {
  const { id } = useParams();
  const [tournamentData, setTournamentData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState(null);
  const [lastUpdated] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );

  useEffect(() => {
    async function fetchTournament() {
      try {
        setSelectedRoundId(null);
        setError("");
        const response = await api.get(`/public/tournaments/${id}`);
        setTournamentData(response.data);
      } catch {
        setError("Could not load tournament.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchTournament();
  }, [id]);

  const tournament = tournamentData?.tournament;
  const rounds = tournamentData?.rounds || [];
  const matches = tournamentData?.matches || [];
  const sortedRounds = [...rounds].sort((firstRound, secondRound) => firstRound.number - secondRound.number);
  const selectedRound = rounds.find((round) => round.id === selectedRoundId) || null;
  const selectedRoundMatches = selectedRound
    ? matches
        .filter((match) => match.round_number === selectedRound.number)
        .sort((firstMatch, secondMatch) => (firstMatch.table_number || 0) - (secondMatch.table_number || 0))
    : [];

  useEffect(() => {
    if (!tournamentData || selectedRoundId !== null || rounds.length === 0) {
      return;
    }

    setSelectedRoundId(tournament?.current_round_id || rounds[0].id);
  }, [rounds, selectedRoundId, tournament?.current_round_id, tournamentData]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:py-8">
      <header className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Tournament</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-950">{tournament?.name || `Tournament #${id}`}</h1>
        <div className="mt-3 flex flex-col gap-1 text-sm text-gray-700 sm:flex-row sm:items-center sm:gap-4">
          <p>{tournament?.location || "Location not set"}</p>
          <p>Last updated {lastUpdated}</p>
        </div>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-gray-950">Rounds and matches</h2>
        </div>

        {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}
        {isLoading ? <p className="mt-4 text-gray-700">Loading tournament...</p> : null}
        {!isLoading && sortedRounds.length === 0 ? <p className="mt-4 text-gray-700">No rounds yet.</p> : null}

        {sortedRounds.length > 0 ? (
          <div className="mt-4">
            <div className="flex overflow-x-auto overflow-y-hidden">
              {sortedRounds.map((round) => {
                const isActive = selectedRoundId === round.id;
                const isCurrent = tournament?.current_round_id === round.id;

                return (
                  <button
                    className={`relative z-10 -mb-px flex shrink-0 items-center gap-2 rounded-t-lg border px-4 py-2 text-sm font-semibold ${
                      isActive
                        ? "border-gray-300 border-b-white bg-white text-gray-950"
                        : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    }`}
                    key={round.id}
                    onClick={() => setSelectedRoundId(round.id)}
                    type="button"
                  >
                    Round {round.number}
                    {isCurrent ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                        Current
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {selectedRound ? (
          <section className="rounded-b-lg rounded-tr-lg border border-gray-300 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold text-gray-950">Round {selectedRound.number}</h3>
              {tournament?.current_round_id === selectedRound.id ? (
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                  Current round
                </span>
              ) : null}
            </div>

            {selectedRoundMatches.length === 0 ? <p className="mt-3 text-sm text-gray-700">No matches for this round.</p> : null}

            {selectedRoundMatches.length > 0 ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {selectedRoundMatches.map((match) => {
                  const playerOneName = formatPlayerDisplayName(match.player_one_name);
                  const playerTwoName = match.notes === "BYE" && !match.player_two_name
                    ? "BYE"
                    : formatPlayerDisplayName(match.player_two_name) || "TBD";
                  const isBye = match.notes === "BYE";
                  const isReported = isBye || (match.result_status || "UNREPORTED") !== "UNREPORTED";

                  return (
                    <li
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                      key={`${selectedRound.number}-${match.table_number}-${match.player_one_name}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Table</p>
                          <p className="text-4xl font-bold leading-none text-gray-950">{match.table_number || "-"}</p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isReported ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {isReported ? "Reported" : "Pending"}
                        </span>
                      </div>

                      {isBye ? (
                        <p className="mt-4 text-sm font-medium text-gray-600">{playerOneName} has a BYE</p>
                      ) : (
                        <p className="mt-4 text-sm font-medium text-gray-600">
                          {playerOneName} vs {playerTwoName}
                        </p>
                      )}
                      <p className={`mt-2 text-base font-semibold ${isReported ? "text-gray-950" : "text-yellow-800"}`}>
                        {getResultDisplay(match)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
