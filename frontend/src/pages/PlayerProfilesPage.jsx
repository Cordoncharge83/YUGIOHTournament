import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";

import api from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

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
  { key: "player", label: "Player", className: "w-[32%] px-2 py-2" },
  { key: "cossyId", label: "COSSY ID", className: "w-[16%] px-2 py-2" },
  { key: "tournaments", label: "Tournaments", className: "w-[16%] px-2 py-2 text-right" },
  { key: "points", label: "Points", className: "w-[24%] px-2 py-2" },
  { key: "bestRank", label: "Best Rank", className: "w-[12%] px-2 py-2 text-right" },
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
          <Link className="text-sm font-medium text-sky-300 hover:text-sky-200" to="/admin">
            Back to tournaments
          </Link>
          <p className="mt-4 text-sm font-medium uppercase tracking-wide text-sky-300">Admin</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-50">Community Players</h1>
        </div>
        <Button className="self-start sm:self-auto" onClick={fetchProfiles} type="button" variant="outline">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      {error ? <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">{error}</p> : null}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)]">
        <Card className="min-w-0 border-slate-700/70 bg-slate-950/85">
          <CardHeader>
            <CardTitle>Players</CardTitle>
            <CardDescription>{profiles.length} community profile{profiles.length === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent>
          <Input
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search players..."
            type="search"
            value={searchTerm}
          />

          {isLoading ? <p className="mt-4 text-slate-400">Loading players...</p> : null}
          {!isLoading && profiles.length === 0 ? <p className="mt-4 text-slate-400">No player profiles yet.</p> : null}
          {!isLoading && profiles.length > 0 && visibleProfiles.length === 0 ? <p className="mt-4 text-slate-400">No players match your search.</p> : null}

          {profiles.length > 0 ? (
            <div className="mt-4">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    {sortableColumns.map((column) => (
                      <TableHead className={column.className} key={column.key}>
                        <button
                          className={`flex min-w-0 items-center gap-1 font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-100 ${
                            column.key === "tournaments" || column.key === "bestRank" ? "ml-auto justify-end" : ""
                          }`}
                          onClick={() => updateSort(column.key)}
                          type="button"
                        >
                          <span className="truncate">{column.label}</span>
                          {sortConfig.key === column.key ? <span>{sortConfig.direction === "asc" ? "\u2191" : "\u2193"}</span> : null}
                        </button>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleProfiles.map((profile) => {
                    const isSelected = profile.id === selectedProfileId;

                    return (
                      <TableRow
                        className={isSelected ? "bg-sky-500/10" : ""}
                        key={profile.id}
                      >
                        <TableCell className="max-w-0 px-2">
                          <button
                            className="block max-w-full truncate text-left font-semibold text-sky-300 hover:text-sky-200"
                            onClick={() => setSelectedProfileId(profile.id)}
                            title={profile.display_name}
                            type="button"
                          >
                            {profile.display_name}
                          </button>
                        </TableCell>
                        <TableCell className="max-w-0 truncate px-2 text-slate-300" title={profile.cossy_id || "-"}>
                          {profile.cossy_id || "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-2 text-right text-slate-300">{profile.tournaments_played}</TableCell>
                        <TableCell
                          className="max-w-0 truncate px-2 text-slate-300"
                          title={`${profile.total_points} (${formatAverage(profile.average_points)} avg)`}
                        >
                          {profile.total_points} ({formatAverage(profile.average_points)} avg)
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-2 text-right text-slate-300">{profile.best_rank || "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-slate-700/70 bg-slate-950/85">
          <CardHeader>
            <CardTitle>Player History</CardTitle>
          </CardHeader>
          <CardContent>

          {!selectedProfileId ? <p className="text-sm text-slate-400">Select a player.</p> : null}
          {isLoadingDetail ? <p className="text-sm text-slate-400">Loading history...</p> : null}

          {selectedSummary && selectedProfile ? (
            <div>
              <h3 className="text-xl font-semibold text-slate-50">{selectedProfile.profile.display_name}</h3>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="font-semibold text-slate-50">COSSY ID</dt>
                  <dd className="text-slate-300">{selectedProfile.profile.cossy_id || "-"}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-50">Last Played</dt>
                  <dd className="text-slate-300">{formatDate(selectedProfile.last_tournament_date)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-50">Tournaments</dt>
                  <dd className="text-slate-300">{selectedProfile.tournaments_played}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-50">Total Points</dt>
                  <dd className="text-slate-300">{selectedProfile.total_points}</dd>
                </div>
              </dl>

              {sortedTournamentHistory.length > 0 ? (
                <ul className="mt-5 divide-y divide-slate-800">
                  {sortedTournamentHistory.map((historyRow) => (
                    <li className="py-3 text-sm" key={`${historyRow.tournament_id}-${historyRow.rank}`}>
                      <p className="font-semibold text-slate-50">{historyRow.tournament_name}</p>
                      <p className="mt-1 text-slate-400">{formatDate(historyRow.tournament_date)}</p>
                      <dl className="mt-2 grid grid-cols-1 gap-1 text-slate-300 sm:grid-cols-3">
                        <div>
                          <dt className="font-medium text-slate-50">Rank</dt>
                          <dd><Badge variant="secondary">{historyRow.rank}</Badge></dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-50">Points</dt>
                          <dd>{historyRow.points}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-50">Tiebreaker</dt>
                          <dd>{historyRow.tiebreaker || "-"}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 text-sm text-slate-400">No standings history yet.</p>
              )}
            </div>
          ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
