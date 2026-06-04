import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import api from "../api/client";

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString();
}

function formatAverage(value) {
  return Number(value || 0).toFixed(1);
}

const sortableColumns = [
  { key: "player", label: "Player", className: "min-w-48 px-3 py-2" },
  { key: "cossyId", label: "COSSY ID", className: "whitespace-nowrap px-3 py-2" },
  { key: "tournaments", label: "Tournaments", className: "whitespace-nowrap px-3 py-2" },
  { key: "points", label: "Points", className: "whitespace-nowrap px-3 py-2" },
  { key: "bestRank", label: "Best Rank", className: "whitespace-nowrap px-3 py-2" },
];

function compareProfiles(profileA, profileB, sortKey) {
  if (sortKey === "player") {
    return (profileA.display_name || "").localeCompare(profileB.display_name || "", undefined, { sensitivity: "base" });
  }

  if (sortKey === "cossyId") {
    return (profileA.cossy_id || "").localeCompare(profileB.cossy_id || "", undefined, { sensitivity: "base" });
  }

  if (sortKey === "tournaments") {
    return Number(profileA.tournaments_played || 0) - Number(profileB.tournaments_played || 0);
  }

  if (sortKey === "points") {
    return Number(profileA.total_points || 0) - Number(profileB.total_points || 0);
  }

  const rankA = profileA.best_rank;
  const rankB = profileB.best_rank;
  const hasRankA = rankA !== null && rankA !== undefined && rankA !== "";
  const hasRankB = rankB !== null && rankB !== undefined && rankB !== "";

  if (!hasRankA && !hasRankB) {
    return 0;
  }
  if (!hasRankA) {
    return 1;
  }
  if (!hasRankB) {
    return -1;
  }

  return Number(rankA) - Number(rankB);
}

function hasBestRank(profile) {
  return profile.best_rank !== null && profile.best_rank !== undefined && profile.best_rank !== "";
}

function sortTournamentHistory(historyRows) {
  return historyRows
    .map((historyRow, index) => ({ historyRow, index }))
    .sort((rowA, rowB) => {
      const dateA = new Date(rowA.historyRow.tournament_date).getTime();
      const dateB = new Date(rowB.historyRow.tournament_date).getTime();
      const validDateA = Number.isFinite(dateA);
      const validDateB = Number.isFinite(dateB);

      if (validDateA && validDateB && dateA !== dateB) {
        return dateB - dateA;
      }
      if (validDateA !== validDateB) {
        return validDateA ? -1 : 1;
      }

      const tournamentIdA = Number(rowA.historyRow.tournament_id || 0);
      const tournamentIdB = Number(rowB.historyRow.tournament_id || 0);
      if (tournamentIdA !== tournamentIdB) {
        return tournamentIdB - tournamentIdA;
      }

      return rowA.index - rowB.index;
    })
    .map(({ historyRow }) => historyRow);
}

export default function PlayerProfilesPage() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "player", direction: "asc" });

  async function fetchProfiles() {
    try {
      setError("");
      const response = await api.get("/player-profiles");
      setProfiles(response.data || []);
    } catch {
      setError("Could not load player history.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchProfiles();
  }, []);

  useEffect(() => {
    if (!selectedProfileId) {
      setSelectedProfile(null);
      return;
    }

    async function fetchProfileDetail() {
      try {
        setIsLoadingDetail(true);
        setError("");
        const response = await api.get(`/player-profiles/${selectedProfileId}`);
        setSelectedProfile(response.data);
      } catch {
        setError("Could not load player details.");
      } finally {
        setIsLoadingDetail(false);
      }
    }

    fetchProfileDetail();
  }, [selectedProfileId]);

  const selectedSummary = profiles.find((profile) => profile.id === selectedProfileId) || null;
  const visibleProfiles = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    const filteredProfiles = normalizedSearchTerm
      ? profiles.filter((profile) => {
          const displayName = (profile.display_name || "").toLowerCase();
          const cossyId = (profile.cossy_id || "").toLowerCase();

          return displayName.includes(normalizedSearchTerm) || cossyId.includes(normalizedSearchTerm);
        })
      : profiles;

    return [...filteredProfiles].sort((profileA, profileB) => {
      if (sortConfig.key === "bestRank") {
        const hasRankA = hasBestRank(profileA);
        const hasRankB = hasBestRank(profileB);

        if (!hasRankA && !hasRankB) {
          return 0;
        }
        if (!hasRankA) {
          return 1;
        }
        if (!hasRankB) {
          return -1;
        }
      }

      const comparison = compareProfiles(profileA, profileB, sortConfig.key);
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [profiles, searchTerm, sortConfig]);
  const sortedTournamentHistory = useMemo(
    () => sortTournamentHistory(selectedProfile?.tournament_history || []),
    [selectedProfile],
  );

  function updateSort(sortKey) {
    setSortConfig((currentSort) => {
      if (currentSort.key === sortKey) {
        return { key: sortKey, direction: currentSort.direction === "asc" ? "desc" : "asc" };
      }

      return { key: sortKey, direction: "asc" };
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link className="text-sm font-medium text-blue-700 hover:text-blue-900" to="/admin">
            Back to tournaments
          </Link>
          <p className="mt-4 text-sm font-medium uppercase tracking-wide text-blue-700">Admin</p>
          <h1 className="mt-2 text-3xl font-semibold text-gray-950">Community Players</h1>
        </div>
        <button className="self-start rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:self-auto" onClick={fetchProfiles} type="button">
          Refresh
        </button>
      </header>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-950">Players</h2>
          <input
            className="mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search players..."
            type="search"
            value={searchTerm}
          />

          {isLoading ? <p className="mt-4 text-gray-700">Loading players...</p> : null}
          {!isLoading && profiles.length === 0 ? <p className="mt-4 text-gray-700">No player profiles yet.</p> : null}
          {!isLoading && profiles.length > 0 && visibleProfiles.length === 0 ? <p className="mt-4 text-gray-700">No players match your search.</p> : null}

          {profiles.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    {sortableColumns.map((column) => (
                      <th className={column.className} key={column.key}>
                        <button
                          className="flex items-center gap-1 font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-900"
                          onClick={() => updateSort(column.key)}
                          type="button"
                        >
                          <span>{column.label}</span>
                          {sortConfig.key === column.key ? <span>{sortConfig.direction === "asc" ? "\u2191" : "\u2193"}</span> : null}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleProfiles.map((profile) => {
                    const isSelected = profile.id === selectedProfileId;

                    return (
                      <tr
                        className={isSelected ? "bg-blue-50" : "hover:bg-gray-50"}
                        key={profile.id}
                      >
                        <td className="px-3 py-3">
                          <button
                            className="text-left font-semibold text-blue-700 hover:text-blue-900"
                            onClick={() => setSelectedProfileId(profile.id)}
                            type="button"
                          >
                            {profile.display_name}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">{profile.cossy_id || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">{profile.tournaments_played}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">
                          {profile.total_points} ({formatAverage(profile.average_points)} avg)
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">{profile.best_rank || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <aside className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-950">Player History</h2>

          {!selectedProfileId ? <p className="mt-4 text-sm text-gray-700">Select a player.</p> : null}
          {isLoadingDetail ? <p className="mt-4 text-sm text-gray-700">Loading history...</p> : null}

          {selectedSummary && selectedProfile ? (
            <div className="mt-4">
              <h3 className="text-xl font-semibold text-gray-950">{selectedProfile.profile.display_name}</h3>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="font-semibold text-gray-950">COSSY ID</dt>
                  <dd className="text-gray-700">{selectedProfile.profile.cossy_id || "-"}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-950">Last Played</dt>
                  <dd className="text-gray-700">{formatDate(selectedProfile.last_tournament_date)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-950">Tournaments</dt>
                  <dd className="text-gray-700">{selectedProfile.tournaments_played}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-950">Total Points</dt>
                  <dd className="text-gray-700">{selectedProfile.total_points}</dd>
                </div>
              </dl>

              {sortedTournamentHistory.length > 0 ? (
                <ul className="mt-5 divide-y divide-gray-200">
                  {sortedTournamentHistory.map((historyRow) => (
                    <li className="py-3 text-sm" key={`${historyRow.tournament_id}-${historyRow.rank}`}>
                      <p className="font-semibold text-gray-950">{historyRow.tournament_name}</p>
                      <p className="mt-1 text-gray-700">{formatDate(historyRow.tournament_date)}</p>
                      <dl className="mt-2 grid grid-cols-1 gap-1 text-gray-700 sm:grid-cols-3">
                        <div>
                          <dt className="font-medium text-gray-950">Rank</dt>
                          <dd>{historyRow.rank}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-gray-950">Points</dt>
                          <dd>{historyRow.points}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-gray-950">Tiebreaker</dt>
                          <dd>{historyRow.tiebreaker || "-"}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 text-sm text-gray-700">No standings history yet.</p>
              )}
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
