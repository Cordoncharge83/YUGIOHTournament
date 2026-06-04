import { useEffect, useMemo, useState } from "react";
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

function getWinnerDisplay(match) {
  const resultStatus = match.result_status || "UNREPORTED";
  const playerOneName = formatPlayerDisplayName(match.player_one_name);
  const playerTwoName = match.notes === "BYE" && !match.player_two_name
    ? "BYE"
    : formatPlayerDisplayName(match.player_two_name) || "TBD";

  if (match.notes === "BYE") {
    return `Winner: ${playerOneName}`;
  }

  if (resultStatus === "PLAYER_ONE_WIN") {
    return `Winner: ${playerOneName}`;
  }

  if (resultStatus === "PLAYER_TWO_WIN") {
    return `Winner: ${playerTwoName}`;
  }

  if (resultStatus === "DRAW") {
    return "Result: Draw";
  }

  if (resultStatus === "DOUBLE_LOSS") {
    return "Result: Double loss";
  }

  return "Result: Pending";
}

function getMatchStatusBadge(match) {
  const resultStatus = match.result_status || "UNREPORTED";

  if (match.notes === "BYE") {
    return { label: "BYE", className: "bg-blue-100 text-blue-800" };
  }

  if (resultStatus === "PLAYER_ONE_WIN" || resultStatus === "PLAYER_TWO_WIN") {
    return { label: "Reported", className: "bg-green-100 text-green-800" };
  }

  if (resultStatus === "DRAW") {
    return { label: "Draw", className: "bg-purple-100 text-purple-800" };
  }

  if (resultStatus === "DOUBLE_LOSS") {
    return { label: "Double loss", className: "bg-red-100 text-red-700" };
  }

  return { label: "Pending", className: "bg-yellow-100 text-yellow-800" };
}

export default function PublicTournamentPage() {
  const { id } = useParams();
  const [tournamentData, setTournamentData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("pairings");
  const [playerSearch, setPlayerSearch] = useState("");
  const [standingsSearch, setStandingsSearch] = useState("");
  const [lastUpdated] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );

  useEffect(() => {
    async function fetchTournament() {
      try {
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
  const standings = tournamentData?.standings || [];
  const normalizedPlayerSearch = playerSearch.trim().toLowerCase();
  const normalizedStandingsSearch = standingsSearch.trim().toLowerCase();
  const currentRound = rounds.find((round) => round.id === tournament?.current_round_id) || null;
  const currentRoundMatches = currentRound
    ? matches
        .filter((match) => match.round_number === currentRound.number)
        .sort((firstMatch, secondMatch) => (firstMatch.table_number || 0) - (secondMatch.table_number || 0))
    : [];
  const searchedMatches = useMemo(() => {
    if (!normalizedPlayerSearch) {
      return [];
    }

    return currentRoundMatches
      .filter((match) => {
        const playerOneName = formatPlayerDisplayName(match.player_one_name).toLowerCase();
        const playerTwoName = formatPlayerDisplayName(match.player_two_name).toLowerCase();

        return playerOneName.includes(normalizedPlayerSearch) || playerTwoName.includes(normalizedPlayerSearch);
      })
      .sort((firstMatch, secondMatch) => (firstMatch.table_number || 0) - (secondMatch.table_number || 0));
  }, [currentRoundMatches, normalizedPlayerSearch]);
  const filteredStandings = useMemo(() => {
    if (!normalizedStandingsSearch) {
      return standings;
    }

    return standings.filter((standing) => {
      const fullName = (standing.full_name || "").toLowerCase();
      const shortName = (standing.short_name || "").toLowerCase();
      const cossyId = (standing.cossy_id || "").toLowerCase();

      return fullName.includes(normalizedStandingsSearch)
        || shortName.includes(normalizedStandingsSearch)
        || cossyId.includes(normalizedStandingsSearch);
    });
  }, [normalizedStandingsSearch, standings]);
  const playerCount = tournamentData?.players?.length || 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:py-8">
      <header className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Tournament</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-950">{tournament?.name || `Tournament #${id}`}</h1>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Location</p>
            <p className="mt-1 font-medium text-gray-950">{tournament?.location || "Location not set"}</p>
          </div>
          {currentRound ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Current Round</p>
              <p className="mt-1 font-semibold text-gray-950">{currentRound.number}</p>
            </div>
          ) : null}
          {playerCount > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Players</p>
              <p className="mt-1 font-semibold text-gray-950">{playerCount}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Updated</p>
            <p className="mt-1 font-medium text-gray-950">{lastUpdated}</p>
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex overflow-x-auto overflow-y-hidden border-b border-gray-200">
          <button
            className={`shrink-0 px-4 py-2 text-sm font-semibold ${
              activeTab === "pairings"
                ? "border-b-2 border-blue-700 text-blue-700"
                : "text-gray-500 hover:text-gray-800"
            }`}
            onClick={() => setActiveTab("pairings")}
            type="button"
          >
            Pairings
          </button>
          <button
            className={`shrink-0 px-4 py-2 text-sm font-semibold ${
              activeTab === "standings"
                ? "border-b-2 border-blue-700 text-blue-700"
                : "text-gray-500 hover:text-gray-800"
            }`}
            onClick={() => setActiveTab("standings")}
            type="button"
          >
            Standings
          </button>
        </div>

        {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}
        {isLoading ? <p className="mt-4 text-gray-700">Loading tournament...</p> : null}

        {activeTab === "pairings" ? (
          <input
            className="mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => setPlayerSearch(event.target.value)}
            placeholder="Search player name..."
            type="search"
            value={playerSearch}
          />
        ) : null}

        {activeTab === "pairings" && !isLoading && !currentRound ? (
          <p className="mt-4 text-gray-700">No current round is set.</p>
        ) : null}

        {activeTab === "pairings" && currentRound && normalizedPlayerSearch ? (
          <section className="mt-4 rounded-lg border border-gray-300 bg-white p-4">
            {searchedMatches.length === 0 ? (
              <p className="text-sm text-gray-700">No match found in the current round for '{playerSearch.trim()}'.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {searchedMatches.map((match) => {
                  const playerOneName = formatPlayerDisplayName(match.player_one_name);
                  const playerTwoName = match.notes === "BYE" && !match.player_two_name
                    ? "BYE"
                    : formatPlayerDisplayName(match.player_two_name) || "TBD";
                  const statusBadge = getMatchStatusBadge(match);

                  return (
                    <li
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                      key={`${match.round_number}-${match.table_number}-${match.player_one_name}-${match.player_two_name || "bye"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Round</p>
                          <p className="text-2xl font-bold leading-none text-gray-950">{match.round_number}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Table</p>
                          <p className="text-2xl font-bold leading-none text-gray-950">{match.table_number || "-"}</p>
                        </div>
                      </div>

                      <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>

                      <p className="mt-4 text-sm font-medium text-gray-600">
                        {match.notes === "BYE" ? `${playerOneName} has a BYE` : `${playerOneName} vs ${playerTwoName}`}
                      </p>
                      <p className="mt-2 text-base font-semibold text-gray-950">{getWinnerDisplay(match)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {activeTab === "pairings" && !normalizedPlayerSearch && currentRound ? (
          <section className="mt-4 rounded-lg border border-gray-300 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold text-gray-950">Round {currentRound.number} - Current Round</h3>
            </div>

            {currentRoundMatches.length === 0 ? <p className="mt-3 text-sm text-gray-700">No matches for the current round.</p> : null}

            {currentRoundMatches.length > 0 ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {currentRoundMatches.map((match) => {
                  const playerOneName = formatPlayerDisplayName(match.player_one_name);
                  const playerTwoName = match.notes === "BYE" && !match.player_two_name
                    ? "BYE"
                    : formatPlayerDisplayName(match.player_two_name) || "TBD";
                  const statusBadge = getMatchStatusBadge(match);

                  return (
                    <li
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                      key={`${currentRound.number}-${match.table_number}-${match.player_one_name}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Table</p>
                          <p className="text-4xl font-bold leading-none text-gray-950">{match.table_number || "-"}</p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge.className}`}
                        >
                          {statusBadge.label}
                        </span>
                      </div>

                      {match.notes === "BYE" ? (
                        <p className="mt-4 text-sm font-medium text-gray-600">{playerOneName} has a BYE</p>
                      ) : (
                        <p className="mt-4 text-sm font-medium text-gray-600">
                          {playerOneName} vs {playerTwoName}
                        </p>
                      )}
                      <p className="mt-2 text-base font-semibold text-gray-950">
                        {getResultDisplay(match)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}

        {activeTab === "standings" && !isLoading && standings.length === 0 ? (
          <p className="mt-4 text-gray-700">No standings imported yet.</p>
        ) : null}

        {activeTab === "standings" && standings.length > 0 ? (
          <>
            <input
              className="mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setStandingsSearch(event.target.value)}
              placeholder="Search player in standings..."
              type="search"
              value={standingsSearch}
            />

            {filteredStandings.length === 0 ? (
              <p className="mt-4 text-sm text-gray-700">No standing found for '{standingsSearch.trim()}'.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2">Rank</th>
                      <th className="min-w-48 px-3 py-2">Player</th>
                      <th className="whitespace-nowrap px-3 py-2">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredStandings.map((standing) => (
                      <tr key={standing.id}>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold text-gray-950">{standing.rank}</td>
                        <td className="px-3 py-3 font-medium text-gray-950">
                          {formatPlayerDisplayName(standing.short_name || standing.full_name)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">{standing.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
