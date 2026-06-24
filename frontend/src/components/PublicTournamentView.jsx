import { useEffect, useMemo, useState } from "react";

import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { formatPlayerDisplayName } from "../lib/publicTournamentData";

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

const PUBLIC_BRACKET_CARD_WIDTH = 256;
const PUBLIC_BRACKET_CARD_HEIGHT = 98;
const PUBLIC_BRACKET_COLUMN_GAP = 96;
const PUBLIC_BRACKET_ROW_GAP = 28;
const PUBLIC_BRACKET_ROW_PITCH = PUBLIC_BRACKET_CARD_HEIGHT + PUBLIC_BRACKET_ROW_GAP;
const PUBLIC_BRACKET_HEADER_HEIGHT = 34;
const PUBLIC_BRACKET_SIDE_PADDING = 8;
const PUBLIC_BRACKET_CHAMPION_WIDTH = 220;

function PublicPlayoffBracketView({ playoffBracket }) {
  const playoffRounds = [...(playoffBracket?.rounds || [])].sort((firstRound, secondRound) => firstRound.round_index - secondRound.round_index);
  const firstRoundMatchCount = playoffRounds[0]?.matches.length || 0;
  const roundCount = playoffRounds.length;
  const boardHeight = PUBLIC_BRACKET_HEADER_HEIGHT + Math.max(firstRoundMatchCount, 1) * PUBLIC_BRACKET_ROW_PITCH - PUBLIC_BRACKET_ROW_GAP;
  const boardWidth = (
    roundCount * PUBLIC_BRACKET_CARD_WIDTH
    + Math.max(roundCount - 1, 0) * PUBLIC_BRACKET_COLUMN_GAP
    + PUBLIC_BRACKET_CHAMPION_WIDTH
    + PUBLIC_BRACKET_COLUMN_GAP
    + PUBLIC_BRACKET_SIDE_PADDING * 2
  );

  const cardPosition = (roundIndex, matchIndex) => {
    const left = PUBLIC_BRACKET_SIDE_PADDING + roundIndex * (PUBLIC_BRACKET_CARD_WIDTH + PUBLIC_BRACKET_COLUMN_GAP);
    const blockSize = 2 ** roundIndex;
    const sourceCenterIndex = matchIndex * blockSize + (blockSize - 1) / 2;
    return {
      left,
      top: PUBLIC_BRACKET_HEADER_HEIGHT + sourceCenterIndex * PUBLIC_BRACKET_ROW_PITCH,
    };
  };

  const cardCenterY = (roundIndex, matchIndex) => cardPosition(roundIndex, matchIndex).top + PUBLIC_BRACKET_CARD_HEIGHT / 2;
  const connectors = playoffRounds.slice(1).flatMap((round) => (
    [...round.matches]
      .sort((firstMatch, secondMatch) => firstMatch.match_index - secondMatch.match_index)
      .map((match) => {
        const sourceRoundIndex = round.round_index - 1;
        const firstSourceIndex = match.match_index * 2;
        const secondSourceIndex = firstSourceIndex + 1;
        const sourceX = PUBLIC_BRACKET_SIDE_PADDING + sourceRoundIndex * (PUBLIC_BRACKET_CARD_WIDTH + PUBLIC_BRACKET_COLUMN_GAP) + PUBLIC_BRACKET_CARD_WIDTH;
        const targetX = cardPosition(round.round_index, match.match_index).left;
        const elbowX = sourceX + (targetX - sourceX) / 2;
        const firstY = cardCenterY(sourceRoundIndex, firstSourceIndex);
        const secondY = cardCenterY(sourceRoundIndex, secondSourceIndex);
        const targetY = cardCenterY(round.round_index, match.match_index);

        return {
          key: `${round.round_index}-${match.match_index}`,
          sourceX,
          elbowX,
          targetX,
          firstY,
          secondY,
          targetY,
        };
      })
  ));
  const finalCenterY = roundCount > 0 ? cardCenterY(roundCount - 1, 0) : PUBLIC_BRACKET_HEADER_HEIGHT;
  const championLeft = PUBLIC_BRACKET_SIDE_PADDING + roundCount * (PUBLIC_BRACKET_CARD_WIDTH + PUBLIC_BRACKET_COLUMN_GAP);

  return (
    <div className="overflow-x-auto">
      <div className="playoff-bracket-board" style={{ height: boardHeight, width: boardWidth }}>
        {playoffRounds.map((round) => (
          <h3
            className="playoff-round-heading"
            key={`public-heading-${round.round_index}`}
            style={{ left: cardPosition(round.round_index, 0).left, width: PUBLIC_BRACKET_CARD_WIDTH }}
          >
            {round.name}
          </h3>
        ))}

        {connectors.map((connector) => (
          <div className="playoff-connector-group" key={connector.key}>
            <span className="playoff-connector playoff-connector-horizontal" style={{ left: connector.sourceX, top: connector.firstY, width: connector.elbowX - connector.sourceX }} />
            <span className="playoff-connector playoff-connector-horizontal" style={{ left: connector.sourceX, top: connector.secondY, width: connector.elbowX - connector.sourceX }} />
            <span className="playoff-connector playoff-connector-vertical" style={{ height: Math.abs(connector.secondY - connector.firstY), left: connector.elbowX, top: Math.min(connector.firstY, connector.secondY) }} />
            <span className="playoff-connector playoff-connector-horizontal" style={{ left: connector.elbowX, top: connector.targetY, width: connector.targetX - connector.elbowX }} />
          </div>
        ))}

        {roundCount > 0 ? (
          <span
            className="playoff-connector playoff-connector-horizontal"
            style={{
              left: PUBLIC_BRACKET_SIDE_PADDING + (roundCount - 1) * (PUBLIC_BRACKET_CARD_WIDTH + PUBLIC_BRACKET_COLUMN_GAP) + PUBLIC_BRACKET_CARD_WIDTH,
              top: finalCenterY,
              width: PUBLIC_BRACKET_COLUMN_GAP,
            }}
          />
        ) : null}

        {playoffRounds.map((round) => (
          [...round.matches]
            .sort((firstMatch, secondMatch) => firstMatch.match_index - secondMatch.match_index)
            .map((match) => (
              <div
                className="playoff-match-card"
                key={`public-match-${round.round_index}-${match.match_index}`}
                style={{
                  height: PUBLIC_BRACKET_CARD_HEIGHT,
                  left: cardPosition(round.round_index, match.match_index).left,
                  top: cardPosition(round.round_index, match.match_index).top,
                  width: PUBLIC_BRACKET_CARD_WIDTH,
                }}
              >
                {(match.players || []).map((player, playerIndex) => (
                  <div
                    className={`playoff-player-row playoff-player-row-readonly ${player.winner ? "playoff-player-row-winner" : ""}`}
                    key={`public-player-${round.round_index}-${match.match_index}-${playerIndex}`}
                  >
                    <span className="playoff-player-name">
                      {player.seed ? `#${player.seed} ` : ""}
                      {formatPlayerDisplayName(player.name) || "TBD"}
                    </span>
                    {player.winner ? <span className="playoff-winner-badge">Winner</span> : null}
                  </div>
                ))}
              </div>
            ))
        ))}

        <div
          className="playoff-champion-card"
          style={{
            left: championLeft,
            top: finalCenterY - 36,
            width: PUBLIC_BRACKET_CHAMPION_WIDTH,
          }}
        >
          <p className="text-xs font-semibold uppercase text-amber-300">Champion</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-50">
            {formatPlayerDisplayName(playoffBracket.champion_name) || "TBD"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function PublicTournamentView({
  tournamentData,
  isLoading,
  error,
  fallbackTitle,
}) {
  const [activeTab, setActiveTab] = useState("pairings");
  const [playerSearch, setPlayerSearch] = useState("");
  const [standingsSearch, setStandingsSearch] = useState("");

  const tournament = tournamentData?.tournament;
  const rounds = tournamentData?.rounds || [];
  const matches = tournamentData?.matches || [];
  const standings = tournamentData?.standings || [];
  const playoffBracket = tournamentData?.playoff_bracket || null;
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
  const lastUpdated = tournamentData?.lastUpdatedAt
    ? new Date(tournamentData.lastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "-";

  useEffect(() => {
    if (activeTab === "playoffs" && !playoffBracket) {
      setActiveTab("pairings");
    }
  }, [activeTab, playoffBracket]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:py-8">
      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Tournament</p>
          <CardTitle className="mt-2 text-3xl">{tournament?.name || fallbackTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Location</p>
              <p className="mt-1 font-medium text-slate-50">{tournament?.location || "Location not set"}</p>
            </div>
            {currentRound ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Current Round</p>
                <p className="mt-1 font-semibold text-slate-50">{currentRound.number}</p>
              </div>
            ) : null}
            {playerCount > 0 ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Players</p>
                <p className="mt-1 font-semibold text-slate-50">{playerCount}</p>
              </div>
            ) : null}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Updated</p>
              <p className="mt-1 font-medium text-slate-50">{lastUpdated}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardContent className="p-5">
          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <TabsList>
              <TabsTrigger value="pairings">Pairings</TabsTrigger>
              {playoffBracket ? <TabsTrigger value="playoffs">Playoffs</TabsTrigger> : null}
              <TabsTrigger value="standings">Standings</TabsTrigger>
            </TabsList>
          </Tabs>

          {error ? <p className="mt-4 text-sm font-medium text-rose-300">{error}</p> : null}
          {isLoading ? <p className="mt-4 text-slate-400">Loading tournament...</p> : null}

          {activeTab === "pairings" ? (
            <Input
              className="mt-4"
              onChange={(event) => setPlayerSearch(event.target.value)}
              placeholder="Search player name..."
              type="search"
              value={playerSearch}
            />
          ) : null}

          {activeTab === "pairings" && !isLoading && !currentRound && !error ? (
            <p className="mt-4 text-slate-400">No current round is set.</p>
          ) : null}

          {activeTab === "pairings" && currentRound && normalizedPlayerSearch ? (
            <section className="mt-4 rounded-lg border border-slate-700 bg-slate-900/55 p-4">
              {searchedMatches.length === 0 ? (
                <p className="text-sm text-slate-400">No match found in the current round for '{playerSearch.trim()}'.</p>
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
                        className="rounded-lg border border-slate-700 bg-slate-950/60 p-4"
                        key={`${match.round_number}-${match.table_number}-${match.player_one_name}-${match.player_two_name || "bye"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Round</p>
                            <p className="text-2xl font-bold leading-none text-slate-50">{match.round_number}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Table</p>
                            <p className="text-2xl font-bold leading-none text-slate-50">{match.table_number || "-"}</p>
                          </div>
                        </div>

                        <Badge className={`mt-3 ${statusBadge.className}`}>
                          {statusBadge.label}
                        </Badge>

                        <p className="mt-4 text-sm font-medium text-slate-300">
                          {match.notes === "BYE" ? `${playerOneName} has a BYE` : `${playerOneName} vs ${playerTwoName}`}
                        </p>
                        <p className="mt-2 text-base font-semibold text-slate-50">{getWinnerDisplay(match)}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          {activeTab === "pairings" && !normalizedPlayerSearch && currentRound ? (
            <section className="mt-4 rounded-lg border border-slate-700 bg-slate-900/55 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold text-slate-50">Round {currentRound.number} - Current Round</h3>
              </div>

              {currentRoundMatches.length === 0 ? <p className="mt-3 text-sm text-slate-400">No matches for the current round.</p> : null}

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
                        className="rounded-lg border border-slate-700 bg-slate-950/60 p-4"
                        key={`${currentRound.number}-${match.table_number}-${match.player_one_name}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Table</p>
                            <p className="text-4xl font-bold leading-none text-slate-50">{match.table_number || "-"}</p>
                          </div>
                          <Badge className={statusBadge.className}>
                            {statusBadge.label}
                          </Badge>
                        </div>

                        {match.notes === "BYE" ? (
                          <p className="mt-4 text-sm font-medium text-slate-300">{playerOneName} has a BYE</p>
                        ) : (
                          <p className="mt-4 text-sm font-medium text-slate-300">
                            {playerOneName} vs {playerTwoName}
                          </p>
                        )}
                        <p className="mt-2 text-base font-semibold text-slate-50">
                          {getResultDisplay(match)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          ) : null}

          {activeTab === "standings" && !isLoading && standings.length === 0 && !error ? (
            <p className="mt-4 text-slate-400">No standings imported yet.</p>
          ) : null}

          {activeTab === "standings" && standings.length > 0 ? (
            <>
              <Input
                className="mt-4"
                onChange={(event) => setStandingsSearch(event.target.value)}
                placeholder="Search player in standings..."
                type="search"
                value={standingsSearch}
              />

              {filteredStandings.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">No standing found for '{standingsSearch.trim()}'.</p>
              ) : (
                <div className="mt-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Rank</TableHead>
                        <TableHead className="min-w-48">Player</TableHead>
                        <TableHead className="whitespace-nowrap">Points</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStandings.map((standing) => (
                        <TableRow key={standing.id}>
                          <TableCell className="whitespace-nowrap font-semibold text-slate-50">{standing.rank}</TableCell>
                          <TableCell className="font-medium text-slate-50">
                            {formatPlayerDisplayName(standing.short_name || standing.full_name)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-slate-300">{standing.points}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          ) : null}

          {activeTab === "playoffs" && playoffBracket ? (
            <section className="mt-4 rounded-lg border border-slate-700 bg-slate-900/55 p-4">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h3 className="mr-2 text-xl font-semibold text-slate-50">Top Cut</h3>
                <Badge className="border-slate-600 bg-slate-800 text-slate-200">Top {playoffBracket.size}</Badge>
                <Badge className={playoffBracket.status === "completed" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
                  {playoffBracket.status === "completed" ? "Completed" : "Active"}
                </Badge>
              </div>
              <PublicPlayoffBracketView playoffBracket={playoffBracket} />
            </section>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
