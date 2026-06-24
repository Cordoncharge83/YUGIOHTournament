import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useParams } from "react-router-dom";

import api from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

const RESULT_OPTIONS = [
  { value: "PLAYER_ONE_WIN", label: "P1 wins" },
  { value: "PLAYER_TWO_WIN", label: "P2 wins" },
  { value: "DRAW", label: "Draw" },
  { value: "DOUBLE_LOSS", label: "Double loss" },
  { value: "UNREPORTED", label: "Reset" },
];

function formatPlayerDisplayName(name) {
  return (name || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

function isTauriApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const BRACKET_CARD_WIDTH = 256;
const BRACKET_CARD_HEIGHT = 98;
const BRACKET_COLUMN_GAP = 96;
const BRACKET_ROW_GAP = 28;
const BRACKET_ROW_PITCH = BRACKET_CARD_HEIGHT + BRACKET_ROW_GAP;
const BRACKET_HEADER_HEIGHT = 34;
const BRACKET_SIDE_PADDING = 8;
const BRACKET_CHAMPION_WIDTH = 220;

function getPlayoffRoundName(bracketSize, roundIndex) {
  const matchCount = bracketSize / (2 ** (roundIndex + 1));
  if (matchCount === 8) return "Round of 16";
  if (matchCount === 4) return "Quarterfinals";
  if (matchCount === 2) return "Semifinals";
  return "Final";
}

function buildPlayoffRounds(playoffBracket) {
  if (!playoffBracket) {
    return [];
  }

  return [...new Set(playoffBracket.matches.map((match) => match.round_index))]
    .sort((firstRound, secondRound) => firstRound - secondRound)
    .map((roundIndex) => ({
      roundIndex,
      matches: playoffBracket.matches
        .filter((match) => match.round_index === roundIndex)
        .sort((firstMatch, secondMatch) => firstMatch.match_index - secondMatch.match_index),
    }));
}

function PlayoffBracketView({ playoffBracket, savingPlayoffMatchId, onSetWinner }) {
  const playoffRounds = buildPlayoffRounds(playoffBracket);
  const firstRoundMatchCount = playoffRounds[0]?.matches.length || 0;
  const roundCount = playoffRounds.length;
  const championMatch = playoffBracket.matches.find(
    (match) => match.round_index === roundCount - 1 && match.winner_player_id,
  );
  const championName = championMatch?.winner_player_id === championMatch?.player_one_id
    ? championMatch?.player_one_name
    : championMatch?.player_two_name;
  const boardHeight = BRACKET_HEADER_HEIGHT + Math.max(firstRoundMatchCount, 1) * BRACKET_ROW_PITCH - BRACKET_ROW_GAP;
  const boardWidth = (
    roundCount * BRACKET_CARD_WIDTH
    + Math.max(roundCount - 1, 0) * BRACKET_COLUMN_GAP
    + BRACKET_CHAMPION_WIDTH
    + BRACKET_COLUMN_GAP
    + BRACKET_SIDE_PADDING * 2
  );

  const cardPosition = (roundIndex, matchIndex) => {
    const left = BRACKET_SIDE_PADDING + roundIndex * (BRACKET_CARD_WIDTH + BRACKET_COLUMN_GAP);
    const blockSize = 2 ** roundIndex;
    const sourceCenterIndex = matchIndex * blockSize + (blockSize - 1) / 2;
    const top = BRACKET_HEADER_HEIGHT + sourceCenterIndex * BRACKET_ROW_PITCH;
    return { left, top };
  };

  const cardCenterY = (roundIndex, matchIndex) => cardPosition(roundIndex, matchIndex).top + BRACKET_CARD_HEIGHT / 2;
  const connectors = playoffRounds.slice(1).flatMap((round) => (
    round.matches.map((match) => {
      const targetPosition = cardPosition(round.roundIndex, match.match_index);
      const sourceRoundIndex = round.roundIndex - 1;
      const firstSourceIndex = match.match_index * 2;
      const secondSourceIndex = firstSourceIndex + 1;
      const sourceX = BRACKET_SIDE_PADDING + sourceRoundIndex * (BRACKET_CARD_WIDTH + BRACKET_COLUMN_GAP) + BRACKET_CARD_WIDTH;
      const targetX = targetPosition.left;
      const elbowX = sourceX + (targetX - sourceX) / 2;
      const firstY = cardCenterY(sourceRoundIndex, firstSourceIndex);
      const secondY = cardCenterY(sourceRoundIndex, secondSourceIndex);
      const targetY = targetPosition.top + BRACKET_CARD_HEIGHT / 2;

      return {
        key: `${round.roundIndex}-${match.match_index}`,
        sourceX,
        elbowX,
        targetX,
        firstY,
        secondY,
        targetY,
      };
    })
  ));
  const championLeft = BRACKET_SIDE_PADDING + roundCount * (BRACKET_CARD_WIDTH + BRACKET_COLUMN_GAP);
  const finalCenterY = cardCenterY(roundCount - 1, 0);

  return (
    <div className="overflow-x-auto">
      <div className="playoff-bracket-board" style={{ height: boardHeight, width: boardWidth }}>
        {playoffRounds.map((round) => (
          <h3
            className="playoff-round-heading"
            key={`heading-${round.roundIndex}`}
            style={{ left: cardPosition(round.roundIndex, 0).left, width: BRACKET_CARD_WIDTH }}
          >
            {getPlayoffRoundName(playoffBracket.size, round.roundIndex)}
          </h3>
        ))}

        {connectors.map((connector) => (
          <div className="playoff-connector-group" key={connector.key}>
            <span
              className="playoff-connector playoff-connector-horizontal"
              style={{
                left: connector.sourceX,
                top: connector.firstY,
                width: connector.elbowX - connector.sourceX,
              }}
            />
            <span
              className="playoff-connector playoff-connector-horizontal"
              style={{
                left: connector.sourceX,
                top: connector.secondY,
                width: connector.elbowX - connector.sourceX,
              }}
            />
            <span
              className="playoff-connector playoff-connector-vertical"
              style={{
                height: Math.abs(connector.secondY - connector.firstY),
                left: connector.elbowX,
                top: Math.min(connector.firstY, connector.secondY),
              }}
            />
            <span
              className="playoff-connector playoff-connector-horizontal"
              style={{
                left: connector.elbowX,
                top: connector.targetY,
                width: connector.targetX - connector.elbowX,
              }}
            />
          </div>
        ))}

        <span
          className="playoff-connector playoff-connector-horizontal"
          style={{
            left: BRACKET_SIDE_PADDING + (roundCount - 1) * (BRACKET_CARD_WIDTH + BRACKET_COLUMN_GAP) + BRACKET_CARD_WIDTH,
            top: finalCenterY,
            width: BRACKET_COLUMN_GAP,
          }}
        />

        {playoffRounds.map((round) => (
          round.matches.map((match) => {
            const playersReady = Boolean(match.player_one_id && match.player_two_id);
            const playerRows = [
              { id: match.player_one_id, name: match.player_one_name, seed: match.player_one_seed },
              { id: match.player_two_id, name: match.player_two_name, seed: match.player_two_seed },
            ];

            return (
              <div
                className="playoff-match-card"
                key={match.id}
                style={{
                  height: BRACKET_CARD_HEIGHT,
                  left: cardPosition(round.roundIndex, match.match_index).left,
                  top: cardPosition(round.roundIndex, match.match_index).top,
                  width: BRACKET_CARD_WIDTH,
                }}
              >
                {playerRows.map((player, playerIndex) => {
                  const isWinner = player.id && match.winner_player_id === player.id;
                  const canClick = playersReady && player.id && savingPlayoffMatchId !== match.id;

                  return (
                    <button
                      className={`playoff-player-row ${isWinner ? "playoff-player-row-winner" : ""}`}
                      disabled={!canClick}
                      key={`${match.id}-${playerIndex}`}
                      onClick={() => onSetWinner(match, player.id)}
                      type="button"
                    >
                      <span className="playoff-player-name">
                        {player.seed ? `#${player.seed} ` : ""}
                        {player.name || "TBD"}
                      </span>
                      {isWinner ? <span className="playoff-winner-badge">Winner</span> : null}
                    </button>
                  );
                })}
              </div>
            );
          })
        ))}

        <div
          className="playoff-champion-card"
          style={{
            left: championLeft,
            top: finalCenterY - 36,
            width: BRACKET_CHAMPION_WIDTH,
          }}
        >
          <p className="text-xs font-semibold uppercase text-amber-300">Champion</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-50">{championName || "TBD"}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminTournamentPage() {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [isLoadingRounds, setIsLoadingRounds] = useState(true);
  const [isCreatingRound, setIsCreatingRound] = useState(false);
  const [roundsError, setRoundsError] = useState("");
  const [matches, setMatches] = useState([]);
  const [matchForm, setMatchForm] = useState({
    round_id: "",
    table_number: "",
    player_one_id: "",
    player_two_id: "",
  });
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [isCreatingMatch, setIsCreatingMatch] = useState(false);
  const [savingMatchId, setSavingMatchId] = useState(null);
  const [matchesError, setMatchesError] = useState("");
  const [standings, setStandings] = useState([]);
  const [standingsSearch, setStandingsSearch] = useState("");
  const [playoffBracket, setPlayoffBracket] = useState(null);
  const [isLoadingPlayoffs, setIsLoadingPlayoffs] = useState(true);
  const [isCreatingPlayoffs, setIsCreatingPlayoffs] = useState(false);
  const [isDeletingPlayoffs, setIsDeletingPlayoffs] = useState(false);
  const [savingPlayoffMatchId, setSavingPlayoffMatchId] = useState(null);
  const [playoffsError, setPlayoffsError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [importRoundNumber, setImportRoundNumber] = useState("1");
  const [importFile, setImportFile] = useState(null);
  const importFileInputRef = useRef(null);
  const [importPreview, setImportPreview] = useState(null);
  const [isPreviewingImport, setIsPreviewingImport] = useState(false);
  const [isImportingRound, setIsImportingRound] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [standingsFile, setStandingsFile] = useState(null);
  const standingsFileInputRef = useRef(null);
  const [isImportingStandings, setIsImportingStandings] = useState(false);
  const [standingsImportMessage, setStandingsImportMessage] = useState("");
  const [standingsImportError, setStandingsImportError] = useState("");
  const [tournamentFile, setTournamentFile] = useState(null);
  const tournamentFileInputRef = useRef(null);
  const [isImportingTournamentFile, setIsImportingTournamentFile] = useState(false);
  const [tournamentFileImportMessage, setTournamentFileImportMessage] = useState("");
  const [tournamentFileImportError, setTournamentFileImportError] = useState("");
  const [autoSyncStatus, setAutoSyncStatus] = useState(null);
  const [autoSyncFilePath, setAutoSyncFilePath] = useState("");
  const [autoSyncMessage, setAutoSyncMessage] = useState("");
  const [autoSyncError, setAutoSyncError] = useState("");
  const [isPublishingTournament, setIsPublishingTournament] = useState(false);
  const [isUnpublishingTournament, setIsUnpublishingTournament] = useState(false);
  const [publicPublishingConfig, setPublicPublishingConfig] = useState(null);
  const [publishMessage, setPublishMessage] = useState("");
  const [publishError, setPublishError] = useState("");
  const [communityStatsMessage, setCommunityStatsMessage] = useState("");
  const [communityStatsError, setCommunityStatsError] = useState("");
  const [isUpdatingCommunityStatsInclusion, setIsUpdatingCommunityStatsInclusion] = useState(false);
  const [isEnablingAutoSync, setIsEnablingAutoSync] = useState(false);
  const [isDisablingAutoSync, setIsDisablingAutoSync] = useState(false);
  const [isRunningAutoSync, setIsRunningAutoSync] = useState(false);
  const [isRefreshingAutoSyncStatus, setIsRefreshingAutoSyncStatus] = useState(false);
  const [isChoosingAutoSyncFile, setIsChoosingAutoSyncFile] = useState(false);
  const [isResumingAutoSync, setIsResumingAutoSync] = useState(false);
  const lastHandledAutoSyncAtRef = useRef(null);
  const [activeTournamentTab, setActiveTournamentTab] = useState("matches");
  const [isManualToolsOpen, setIsManualToolsOpen] = useState(true);
  const [isAdvancedImportToolsOpen, setIsAdvancedImportToolsOpen] = useState(false);
  const [isRoundsToolOpen, setIsRoundsToolOpen] = useState(false);
  const [isPreviousRoundsOpen, setIsPreviousRoundsOpen] = useState(false);
  const [selectedMatchRoundId, setSelectedMatchRoundId] = useState(null);
  const [showOnlyUnreportedMatches, setShowOnlyUnreportedMatches] = useState(false);

  function getApiErrorMessage(error, fallbackMessage) {
    const detail = error.response?.data?.detail;

    if (typeof detail === "string") {
      return detail;
    }

    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((item) => item.msg).filter(Boolean).join(" ") || fallbackMessage;
    }

    return fallbackMessage;
  }

  function getRoundNumberById(roundList, roundId) {
    if (!roundId) {
      return null;
    }

    return roundList.find((round) => round.id === roundId)?.number || null;
  }

  function getCurrentRoundFromData(tournamentData, roundList) {
    return tournamentData?.current_round_id
      ? roundList.find((round) => round.id === tournamentData.current_round_id) || null
      : null;
  }

  async function fetchTournament() {
    try {
      const response = await api.get(`/tournaments/${id}`);
      setTournament(response.data);
      return response.data;
    } catch {
      setRoundsError("Could not load tournament.");
      return null;
    }
  }

  async function fetchPlayers() {
    try {
      const response = await api.get(`/tournaments/${id}/players`);
      setPlayers(response.data);
      return response.data;
    } catch {
      setPlayers([]);
      return [];
    }
  }

  async function fetchRounds() {
    try {
      setRoundsError("");
      const response = await api.get(`/tournaments/${id}/rounds`);
      setRounds(response.data);
      return response.data;
    } catch {
      setRoundsError("Could not load rounds.");
      return [];
    } finally {
      setIsLoadingRounds(false);
    }
  }

  async function fetchMatches() {
    try {
      setMatchesError("");
      const response = await api.get(`/tournaments/${id}/matches`);
      setMatches(response.data);
      return response.data;
    } catch {
      setMatchesError("Could not load matches.");
      return [];
    } finally {
      setIsLoadingMatches(false);
    }
  }

  async function fetchStandings() {
    try {
      const response = await api.get(`/tournaments/${id}/standings`);
      setStandings(response.data || []);
      return response.data || [];
    } catch {
      setStandings([]);
      return [];
    }
  }

  async function fetchPlayoffs() {
    try {
      setPlayoffsError("");
      const response = await api.get(`/tournaments/${id}/playoffs`);
      setPlayoffBracket(response.data || null);
      return response.data || null;
    } catch {
      setPlayoffsError("Could not load playoffs.");
      setPlayoffBracket(null);
      return null;
    } finally {
      setIsLoadingPlayoffs(false);
    }
  }

  async function fetchAutoSyncStatus() {
    try {
      const response = await api.get("/auto-sync/status");
      setAutoSyncStatus(response.data);
    } catch {
      setAutoSyncStatus(null);
    }
  }

  async function fetchPublicPublishingConfig() {
    try {
      const response = await api.get("/tournaments/public-publishing/config");
      setPublicPublishingConfig(response.data);
    } catch {
      setPublicPublishingConfig(null);
    }
  }

  async function fetchTournamentContentData({ reconcileKtsSyncRound = false } = {}) {
    const previousCurrentRoundNumber = getRoundNumberById(rounds, tournament?.current_round_id);
    const previousSelectedRoundNumber = getRoundNumberById(rounds, selectedMatchRoundId);

    const [nextTournament, , nextRounds] = await Promise.all([
      fetchTournament(),
      fetchPlayers(),
      fetchRounds(),
      fetchMatches(),
      fetchStandings(),
      fetchPlayoffs(),
    ]);

    if (!reconcileKtsSyncRound || !nextTournament || nextRounds.length === 0) {
      return;
    }

    const nextCurrentRound = getCurrentRoundFromData(nextTournament, nextRounds);
    const currentRoundAdvanced =
      nextCurrentRound &&
      (previousCurrentRoundNumber == null || nextCurrentRound.number > previousCurrentRoundNumber);

    if (currentRoundAdvanced) {
      setSelectedMatchRoundId(nextCurrentRound.id);
      return;
    }

    if (previousSelectedRoundNumber != null) {
      const replacementSelectedRound = nextRounds.find((round) => round.number === previousSelectedRoundNumber);
      if (replacementSelectedRound) {
        setSelectedMatchRoundId(replacementSelectedRound.id);
      }
    }
  }

  async function fetchTournamentDetailData() {
    await Promise.all([
      fetchTournamentContentData(),
      fetchAutoSyncStatus(),
      fetchPublicPublishingConfig(),
    ]);
  }

  async function enableAutoSyncForPath(filePath) {
    const response = await api.post("/auto-sync/enable", {
      tournament_id: Number(id),
      file_path: filePath,
    });
    setAutoSyncStatus(response.data);
    return response.data;
  }

  async function enableAndRunAutoSyncForPath(filePath) {
    setAutoSyncFilePath(filePath);
    await enableAutoSyncForPath(filePath);

    const syncResponse = await api.post("/auto-sync/run-now");
    setAutoSyncStatus(syncResponse.data.status);
    await fetchTournamentContentData({ reconcileKtsSyncRound: true });
    await Promise.all([fetchAutoSyncStatus(), fetchPublicPublishingConfig()]);
    return syncResponse.data.summary;
  }

  async function handleRefreshAutoSyncStatus() {
    try {
      setIsRefreshingAutoSyncStatus(true);
      setAutoSyncError("");
      await fetchAutoSyncStatus();
    } finally {
      setIsRefreshingAutoSyncStatus(false);
    }
  }

  async function handleEnableAutoSync(event) {
    event.preventDefault();

    if (!autoSyncFilePath.trim()) {
      setAutoSyncError("Paste the exact .Tournament file path first.");
      return;
    }

    try {
      setIsEnablingAutoSync(true);
      setAutoSyncError("");
      setAutoSyncMessage("");
      await enableAutoSyncForPath(autoSyncFilePath.trim());
      await fetchTournament();
      setAutoSyncMessage("Auto-sync enabled.");
    } catch (error) {
      setAutoSyncError(getApiErrorMessage(error, "Could not enable auto-sync."));
    } finally {
      setIsEnablingAutoSync(false);
    }
  }

  async function handleChooseAutoSyncFile() {
    if (!isTauriApp()) {
      return;
    }

    try {
      setIsChoosingAutoSyncFile(true);
      setAutoSyncError("");
      setAutoSyncMessage("");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selectedFile = await open({
        directory: false,
        multiple: false,
        title: "Choose KTS Tournament File",
        filters: [
          {
            name: "KTS Tournament File",
            extensions: ["Tournament"],
          },
        ],
      });

      const selectedPath = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;

      if (!selectedPath) {
        return;
      }

      const summary = await enableAndRunAutoSyncForPath(selectedPath);
      setAutoSyncMessage(
        `Selected KTS file, enabled auto-sync, and imported ${summary.players_imported} players, ${summary.rounds_imported} rounds, ${summary.matches_imported} matches, and ${summary.standings_imported} standings entries.`,
      );
    } catch (error) {
      setAutoSyncError(getApiErrorMessage(error, "Could not choose and sync KTS file."));
      await fetchAutoSyncStatus();
    } finally {
      setIsChoosingAutoSyncFile(false);
    }
  }

  async function handleResumeAutoSync() {
    if (!tournament?.kts_file_path) {
      setAutoSyncError("No saved KTS file path is available for this tournament.");
      return;
    }

    try {
      setIsResumingAutoSync(true);
      setAutoSyncError("");
      setAutoSyncMessage("");
      const summary = await enableAndRunAutoSyncForPath(tournament.kts_file_path);
      setAutoSyncMessage(
        `Resumed watching and imported ${summary.players_imported} players, ${summary.rounds_imported} rounds, ${summary.matches_imported} matches, and ${summary.standings_imported} standings entries.`,
      );
    } catch (error) {
      setAutoSyncError(getApiErrorMessage(error, "Could not resume auto-sync."));
      await fetchAutoSyncStatus();
    } finally {
      setIsResumingAutoSync(false);
    }
  }

  async function handleDisableAutoSync() {
    try {
      setIsDisablingAutoSync(true);
      setAutoSyncError("");
      setAutoSyncMessage("");
      const response = await api.post("/auto-sync/disable");
      setAutoSyncStatus(response.data);
      setAutoSyncMessage("Auto-sync disabled.");
    } catch (error) {
      setAutoSyncError(getApiErrorMessage(error, "Could not disable auto-sync."));
    } finally {
      setIsDisablingAutoSync(false);
    }
  }

  async function handleRunAutoSyncNow() {
    try {
      setIsRunningAutoSync(true);
      setAutoSyncError("");
      setAutoSyncMessage("");
      const response = await api.post("/auto-sync/run-now");
      setAutoSyncStatus(response.data.status);
      await fetchTournamentContentData({ reconcileKtsSyncRound: true });
      await fetchPublicPublishingConfig();
      setAutoSyncMessage(
        `Synced ${response.data.summary.players_imported} players, ${response.data.summary.rounds_imported} rounds, ${response.data.summary.matches_imported} matches, and ${response.data.summary.standings_imported} standings entries.`,
      );
    } catch (error) {
      setAutoSyncError(getApiErrorMessage(error, "Could not run auto-sync."));
      await fetchAutoSyncStatus();
    } finally {
      setIsRunningAutoSync(false);
    }
  }

  useEffect(() => {
    fetchTournamentDetailData();
  }, [id]);

  useEffect(() => {
    const intervalId = window.setInterval(fetchAutoSyncStatus, 5000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const lastSyncAt = autoSyncStatus?.last_sync_at;
    const isCurrentTournamentSync = Number(autoSyncStatus?.tournament_id) === Number(id);

    if (!lastSyncAt || !autoSyncStatus?.enabled || !isCurrentTournamentSync) {
      return;
    }

    if (lastHandledAutoSyncAtRef.current === lastSyncAt) {
      return;
    }

    lastHandledAutoSyncAtRef.current = lastSyncAt;
    fetchTournamentContentData({ reconcileKtsSyncRound: true });
  }, [autoSyncStatus?.last_sync_at, autoSyncStatus?.enabled, autoSyncStatus?.tournament_id, id]);

  useEffect(() => {
    if (!autoSyncStatus?.file_path) {
      return;
    }

    setAutoSyncFilePath((currentPath) => currentPath || autoSyncStatus.file_path);
  }, [autoSyncStatus?.file_path]);

  useEffect(() => {
    if (!tournament?.kts_file_path) {
      return;
    }

    setAutoSyncFilePath((currentPath) => currentPath || tournament.kts_file_path);
  }, [tournament?.kts_file_path]);

  async function handleCreateNextRound() {
    const nextRoundNumber =
      rounds.length === 0 ? 1 : Math.max(...rounds.map((round) => round.number)) + 1;

    try {
      setIsCreatingRound(true);
      setRoundsError("");
      await api.post(`/tournaments/${id}/rounds`, { number: nextRoundNumber });
      await fetchTournament();
      await fetchRounds();
    } catch {
      setRoundsError("Could not create round.");
    } finally {
      setIsCreatingRound(false);
    }
  }

  async function handleDeleteRound(roundId) {
    try {
      setRoundsError("");
      await api.delete(`/rounds/${roundId}`);
      await fetchTournament();
      await fetchRounds();
    } catch (error) {
      const message = error.response?.data?.detail || "Could not delete round.";
      setRoundsError(message);
    }
  }

  async function handleSetCurrentRound(roundId) {
    try {
      setRoundsError("");
      await api.patch(`/tournaments/${id}/current-round`, { round_id: roundId });
      setSelectedMatchRoundId(roundId);
      await fetchTournament();
      await fetchRounds();
    } catch (error) {
      const message = error.response?.data?.detail || "Could not set current round.";
      setRoundsError(message);
    }
  }

  function updateMatchForm(field, value) {
    setMatchForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleCreateMatch(event) {
    event.preventDefault();

    const roundId = Number(matchForm.round_id);
    const tableNumber = Number(matchForm.table_number);
    const playerOneId = Number(matchForm.player_one_id);
    const playerTwoId = Number(matchForm.player_two_id);

    if (!roundId || !tableNumber || !playerOneId || !playerTwoId) {
      setMatchesError("Round, table number, and both players are required.");
      return;
    }

    try {
      setIsCreatingMatch(true);
      setMatchesError("");
      await api.post(`/tournaments/${id}/matches`, {
        round_id: roundId,
        table_number: tableNumber,
        player_one_id: playerOneId,
        player_two_id: playerTwoId,
      });
      setMatchForm({
        round_id: selectedMatchRoundId ? String(selectedMatchRoundId) : "",
        table_number: "",
        player_one_id: "",
        player_two_id: "",
      });
      await fetchMatches();
    } catch (error) {
      const message = error.response?.data?.detail || "Could not create match.";
      setMatchesError(message);
    } finally {
      setIsCreatingMatch(false);
    }
  }

  async function handleSaveResult(match, resultStatus) {
    try {
      setSavingMatchId(match.id);
      setMatchesError("");
      await api.patch(`/matches/${match.id}/result`, {
        result_status: resultStatus,
      });
      await fetchMatches();
    } catch (error) {
      const message = error.response?.data?.detail || "Could not save result.";
      setMatchesError(message);
    } finally {
      setSavingMatchId(null);
    }
  }

  async function handleDeleteMatch(matchId) {
    try {
      setMatchesError("");
      await api.delete(`/matches/${matchId}`);
      await fetchMatches();
    } catch (error) {
      const message = error.response?.data?.detail || "Could not delete match.";
      setMatchesError(message);
    }
  }

  async function handleCopyPublicLink() {
    if (!displayPublicUrl) {
      setCopyMessage("Publish first");
      return;
    }

    try {
      await navigator.clipboard.writeText(displayPublicUrl);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Copy failed");
    }
  }

  async function handleOpenPublicPage(event) {
    if (!displayPublicUrl) {
      event.preventDefault();
      return;
    }

    if (!isTauriApp()) {
      return;
    }

    event.preventDefault();

    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(displayPublicUrl);
    } catch {
      window.open(displayPublicUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function handlePublishTournament() {
    try {
      setIsPublishingTournament(true);
      setPublishError("");
      setPublishMessage("");
      const response = await api.post(`/tournaments/${id}/publish`);
      setTournament((currentTournament) => ({ ...currentTournament, ...response.data }));
      setPublishMessage("Tournament published online.");
    } catch (error) {
      setPublishError(getApiErrorMessage(error, "Could not publish tournament."));
    } finally {
      setIsPublishingTournament(false);
    }
  }

  async function handleUnpublishTournament() {
    try {
      setIsUnpublishingTournament(true);
      setPublishError("");
      setPublishMessage("");
      const response = await api.post(`/tournaments/${id}/unpublish`);
      setTournament((currentTournament) => ({ ...currentTournament, ...response.data }));
      setPublishMessage("Tournament unpublished online.");
    } catch (error) {
      setPublishError(getApiErrorMessage(error, "Could not unpublish tournament."));
    } finally {
      setIsUnpublishingTournament(false);
    }
  }

  async function handleUpdateCommunityStatsInclusion(shouldCount) {
    try {
      setIsUpdatingCommunityStatsInclusion(true);
      setCommunityStatsError("");
      setCommunityStatsMessage("");
      const response = await api.patch(`/tournaments/${id}/community-stats`, {
        counts_toward_community_stats: shouldCount,
      });
      setTournament(response.data);
      setCommunityStatsMessage(
        shouldCount
          ? "Tournament now counts toward community statistics."
          : "Tournament excluded from community statistics.",
      );
    } catch (error) {
      setCommunityStatsError(getApiErrorMessage(error, "Could not update community statistics setting."));
    } finally {
      setIsUpdatingCommunityStatsInclusion(false);
    }
  }

  function updateImportRoundNumber(value) {
    setImportRoundNumber(value);
    setImportPreview(null);
    setImportMessage("");
    setImportError("");
  }

  function updateImportFile(file) {
    setImportFile(file);
    setImportPreview(null);
    setImportMessage("");
    setImportError("");
  }

  function buildImportFormData(roundNumber) {
    const formData = new FormData();
    formData.append("round_number", String(roundNumber));
    formData.append("file", importFile);
    return formData;
  }

  async function handlePreviewRoundCsv(event) {
    event.preventDefault();

    const roundNumber = Number(importRoundNumber);
    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      setImportError("Round number must be 1 or greater.");
      return;
    }

    if (!importFile) {
      setImportError("Choose a CSV file to import.");
      return;
    }

    try {
      setIsPreviewingImport(true);
      setImportError("");
      setImportMessage("");
      setImportPreview(null);
      const response = await api.post(`/tournaments/${id}/preview-round-csv`, buildImportFormData(roundNumber));
      setImportPreview(response.data);
    } catch (error) {
      setImportError(getApiErrorMessage(error, "Could not preview CSV."));
    } finally {
      setIsPreviewingImport(false);
    }
  }

  async function handleConfirmRoundCsvImport() {
    const roundNumber = Number(importRoundNumber);

    if (!importPreview) {
      setImportError("Preview the CSV before confirming import.");
      return;
    }

    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      setImportError("Round number must be 1 or greater.");
      return;
    }

    if (!importFile) {
      setImportError("Choose a CSV file to import.");
      return;
    }

    try {
      setIsImportingRound(true);
      setImportError("");
      setImportMessage("");
      const response = await api.post(`/tournaments/${id}/import-round-csv`, buildImportFormData(roundNumber));
      await Promise.all([fetchPlayers(), fetchRounds(), fetchMatches(), fetchTournament()]);
      setSelectedMatchRoundId(null);
      setImportFile(null);
      setImportPreview(null);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
      setImportMessage(
        `Imported round ${response.data.round_number}: ${response.data.matches_imported} matches, ${response.data.players_created} new players.`,
      );
    } catch (error) {
      setImportError(getApiErrorMessage(error, "Could not import CSV."));
    } finally {
      setIsImportingRound(false);
    }
  }

  async function handleImportStandingsCsv(event) {
    event.preventDefault();

    if (!standingsFile) {
      setStandingsImportError("Choose a standings CSV file to import.");
      return;
    }

    const formData = new FormData();
    formData.append("file", standingsFile);

    try {
      setIsImportingStandings(true);
      setStandingsImportError("");
      setStandingsImportMessage("");
      const response = await api.post(`/tournaments/${id}/import-standings-csv`, formData);
      await fetchStandings();
      setStandingsFile(null);
      if (standingsFileInputRef.current) {
        standingsFileInputRef.current.value = "";
      }
      setStandingsImportMessage(`Imported standings for ${response.data.players_imported} players.`);
    } catch (error) {
      setStandingsImportError(getApiErrorMessage(error, "Could not import standings CSV."));
    } finally {
      setIsImportingStandings(false);
    }
  }

  async function handleImportTournamentFile(event) {
    event.preventDefault();

    if (!tournamentFile) {
      setTournamentFileImportError("Choose a .Tournament or XML file to import.");
      return;
    }

    const formData = new FormData();
    formData.append("file", tournamentFile);

    try {
      setIsImportingTournamentFile(true);
      setTournamentFileImportError("");
      setTournamentFileImportMessage("");
      const response = await api.post(`/tournaments/${id}/import-tournament-file`, formData);
      await Promise.all([fetchTournament(), fetchPlayers(), fetchRounds(), fetchMatches(), fetchStandings()]);
      setSelectedMatchRoundId(null);
      setTournamentFile(null);
      if (tournamentFileInputRef.current) {
        tournamentFileInputRef.current.value = "";
      }
      setTournamentFileImportMessage(
        `Imported ${response.data.players_imported} players, ${response.data.rounds_imported} rounds, ${response.data.matches_imported} matches, and ${response.data.standings_imported} standings entries.`,
      );
    } catch (error) {
      setTournamentFileImportError(getApiErrorMessage(error, "Could not import KTS tournament file."));
    } finally {
      setIsImportingTournamentFile(false);
    }
  }

  async function handleCreatePlayoffs(size) {
    try {
      setIsCreatingPlayoffs(true);
      setPlayoffsError("");
      const response = await api.post(`/tournaments/${id}/playoffs`, { size });
      setPlayoffBracket(response.data);
    } catch (error) {
      setPlayoffsError(getApiErrorMessage(error, "Could not create playoffs."));
    } finally {
      setIsCreatingPlayoffs(false);
    }
  }

  async function handleDeletePlayoffs() {
    try {
      setIsDeletingPlayoffs(true);
      setPlayoffsError("");
      await api.delete(`/tournaments/${id}/playoffs`);
      setPlayoffBracket(null);
    } catch (error) {
      setPlayoffsError(getApiErrorMessage(error, "Could not reset playoffs."));
    } finally {
      setIsDeletingPlayoffs(false);
    }
  }

  async function handleSetPlayoffWinner(match, winnerPlayerId) {
    if (!match.player_one_id || !match.player_two_id) {
      return;
    }

    try {
      setSavingPlayoffMatchId(match.id);
      setPlayoffsError("");
      const response = await api.put(`/tournaments/${id}/playoffs/matches/${match.id}/winner`, {
        winner_player_id: winnerPlayerId,
      });
      setPlayoffBracket(response.data);
    } catch (error) {
      setPlayoffsError(getApiErrorMessage(error, "Could not save playoff winner."));
    } finally {
      setSavingPlayoffMatchId(null);
    }
  }

  const displayPublicUrl = tournament?.public_url || null;
  const playerDisplayNames = Object.fromEntries(players.map((player) => [player.id, formatPlayerDisplayName(player.name)]));
  const roundNumbers = Object.fromEntries(rounds.map((round) => [round.id, round.number]));
  const sortedRounds = [...rounds].sort((firstRound, secondRound) => firstRound.number - secondRound.number);
  const currentRound = rounds.find((round) => round.id === tournament?.current_round_id) || null;
  const visibleMatchRoundTabs = isPreviousRoundsOpen
    ? sortedRounds
    : sortedRounds.filter((round) => round.id === (currentRound?.id || selectedMatchRoundId));
  const currentRoundUnreportedMatches = currentRound
    ? matches
        .filter((match) => match.round_id === currentRound.id && (match.result_status || "UNREPORTED") === "UNREPORTED")
        .sort((firstMatch, secondMatch) => (firstMatch.table_number || 0) - (secondMatch.table_number || 0))
    : [];
  const currentRoundUnreportedCount = currentRound ? currentRoundUnreportedMatches.length : null;
  const currentRoundUnreportedTableNumbers = currentRoundUnreportedMatches
    .map((match) => match.table_number)
    .filter((tableNumber) => tableNumber !== null && tableNumber !== undefined)
    .sort((firstTable, secondTable) => firstTable - secondTable);
  const selectedMatchRound = rounds.find((round) => round.id === selectedMatchRoundId) || null;
  const selectedRoundMatches = selectedMatchRound
    ? matches
        .filter((match) => match.round_id === selectedMatchRound.id)
        .sort((firstMatch, secondMatch) => (firstMatch.table_number || 0) - (secondMatch.table_number || 0))
    : [];
  const selectedRoundUnreportedCount = selectedRoundMatches.filter(
    (match) => (match.result_status || "UNREPORTED") === "UNREPORTED",
  ).length;
  const displayedSelectedRoundMatches = showOnlyUnreportedMatches
    ? selectedRoundMatches.filter((match) => (match.result_status || "UNREPORTED") === "UNREPORTED")
    : selectedRoundMatches;
  const normalizedStandingsSearch = standingsSearch.trim().toLowerCase();
  const filteredStandings = normalizedStandingsSearch
    ? standings.filter((standing) => {
        const fullName = (standing.full_name || "").toLowerCase();
        const shortName = (standing.short_name || "").toLowerCase();
        const cossyId = (standing.cossy_id || "").toLowerCase();

        return fullName.includes(normalizedStandingsSearch)
          || shortName.includes(normalizedStandingsSearch)
          || cossyId.includes(normalizedStandingsSearch);
      })
    : standings;
  const autoSyncTargetsCurrentTournament = Number(autoSyncStatus?.tournament_id) === Number(id);
  const autoSyncTargetsAnotherTournament = Boolean(
    autoSyncStatus?.enabled && autoSyncStatus?.tournament_id && !autoSyncTargetsCurrentTournament,
  );
  const activeWatcherForCurrentTournament = Boolean(autoSyncStatus?.enabled && autoSyncTargetsCurrentTournament);
  const savedKtsFilePath = tournament?.kts_file_path || null;
  const savedKtsFileName = savedKtsFilePath ? savedKtsFilePath.split(/[\\/]/).filter(Boolean).pop() : null;
  const watchedFileName = activeWatcherForCurrentTournament ? autoSyncStatus?.file_name : null;
  const watchedFilePath = activeWatcherForCurrentTournament ? autoSyncStatus?.file_path : null;
  const currentKtsFilePath = watchedFilePath || savedKtsFilePath;
  const currentKtsFileName = watchedFileName || savedKtsFileName;
  const autoSyncTargetLabel = autoSyncStatus?.tournament_id
    ? `${autoSyncStatus.tournament_name || "Tournament"} #${autoSyncStatus.tournament_id}`
    : null;
  const lastSyncTime = autoSyncStatus?.last_sync_at
    ? new Date(autoSyncStatus.last_sync_at).toLocaleString()
    : null;
  const lastHostedPublishTime = autoSyncStatus?.last_hosted_publish_at
    ? new Date(autoSyncStatus.last_hosted_publish_at).toLocaleString()
    : null;
  const isRunningInTauri = isTauriApp();
  const autoSyncStateLabel = activeWatcherForCurrentTournament
    ? "Watching / Enabled"
    : savedKtsFilePath
      ? "Saved, not watching"
      : "Disabled";
  const autoSyncBadgeLabel = activeWatcherForCurrentTournament
    ? "Watching"
    : savedKtsFilePath
      ? "Not Watching"
      : "Disabled";
  const autoSyncBadgeClass = activeWatcherForCurrentTournament
    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
    : savedKtsFilePath
      ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
      : "border-gray-500/50 bg-gray-500/15 text-gray-300";
  const publishStatus = tournament?.publish_status || "draft";
  const publishStatusLabel = publishStatus.charAt(0).toUpperCase() + publishStatus.slice(1);
  const publishBadgeClass = publishStatus === "published"
    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
    : publishStatus === "unpublished"
      ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
      : "border-slate-600 bg-slate-800 text-slate-300";
  const publishTimestamp = tournament?.last_published_at
    ? new Date(tournament.last_published_at).toLocaleString()
    : null;
  const publicPublishingConfigured = publicPublishingConfig?.configured;
  const publicSiteUrl = publicPublishingConfig?.site_url || null;

  useEffect(() => {
    if (rounds.length === 0) {
      setSelectedMatchRoundId(null);
      return;
    }

    if (selectedMatchRoundId && rounds.some((round) => round.id === selectedMatchRoundId)) {
      return;
    }

    const currentRoundCandidate = tournament?.current_round_id
      ? rounds.find((round) => round.id === tournament.current_round_id)
      : null;
    const highestRound = [...rounds].sort((firstRound, secondRound) => secondRound.number - firstRound.number)[0];
    const fallbackRound = highestRound || [...rounds].sort((firstRound, secondRound) => firstRound.number - secondRound.number)[0];
    setSelectedMatchRoundId((currentRoundCandidate || fallbackRound).id);
  }, [rounds, selectedMatchRoundId, tournament?.current_round_id]);

  useEffect(() => {
    if (!selectedMatchRoundId) {
      return;
    }

    setMatchForm((currentForm) => {
      if (currentForm.round_id === String(selectedMatchRoundId)) {
        return currentForm;
      }

      return {
        ...currentForm,
        round_id: String(selectedMatchRoundId),
      };
    });
  }, [selectedMatchRoundId]);

  const getMatchPlayerTwoName = (match) => {
    if (match.notes === "BYE" && match.player_two_id == null) {
      return "BYE";
    }

    return playerDisplayNames[match.player_two_id] || "Player two";
  };
  const getMatchResultLabel = (match) => {
    if (match.notes === "BYE") {
      return "BYE — Automatic Win";
    }

    const resultStatus = match.result_status || "UNREPORTED";
    const playerOneName = playerDisplayNames[match.player_one_id] || "Player one";
    const playerTwoName = getMatchPlayerTwoName(match);

    if (resultStatus === "PLAYER_ONE_WIN") {
      return `${playerOneName} wins`;
    }

    if (resultStatus === "PLAYER_TWO_WIN") {
      return `${playerTwoName} wins`;
    }

    if (resultStatus === "DRAW") {
      return "Draw";
    }

    if (resultStatus === "DOUBLE_LOSS") {
      return "Double loss";
    }

    return "Unreported";
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header>
        <Link className="text-sm font-medium text-blue-700 hover:text-blue-900" to="/admin">
          Back to tournaments
        </Link>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-blue-700">KTS companion display</p>
            <h1 className="mt-2 text-3xl font-semibold text-gray-950">{tournament?.name || `Tournament #${id}`}</h1>
            <div className="mt-4 grid gap-3 text-sm text-gray-700 sm:grid-cols-3">
              <div>
                <p className="font-semibold text-gray-950">Location</p>
                <p>{tournament?.location || "Location not set"}</p>
              </div>
              <div>
                <p className="font-semibold text-gray-950">Current round</p>
                <p>{currentRound ? `Round ${currentRound.number}` : "Not set"}</p>
                {currentRoundUnreportedCount !== null && currentRoundUnreportedCount > 0 ? (
                  <div className="mt-1 text-xs font-medium text-yellow-700">
                    <p>{currentRoundUnreportedCount} unreported matches</p>
                    {currentRoundUnreportedTableNumbers.length > 0 ? (
                      <p className="mt-1">Tables: {currentRoundUnreportedTableNumbers.join(", ")}</p>
                    ) : null}
                  </div>
                ) : null}
                {currentRoundUnreportedCount === 0 ? (
                  <p className="mt-1 text-xs font-medium text-green-700">All current round matches reported</p>
                ) : null}
              </div>
              <div>
                <p className="font-semibold text-gray-950">Public link</p>
                <p className="break-all">{displayPublicUrl || "Publish this tournament first to generate a public link."}</p>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <label className="flex items-start gap-3 text-sm font-medium text-gray-950">
                <input
                  checked={tournament?.counts_toward_community_stats !== false}
                  className="mt-1 h-4 w-4"
                  disabled={isUpdatingCommunityStatsInclusion || !tournament}
                  onChange={(event) => handleUpdateCommunityStatsInclusion(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  Count toward community statistics
                  <span className="mt-1 block text-sm font-normal text-gray-600">
                    Turn this off for test, casual, or side events that should not affect player totals.
                  </span>
                </span>
              </label>
              {tournament?.counts_toward_community_stats === false ? (
                <Badge className="mt-3 border-amber-300 bg-amber-100 text-amber-900">
                  Excluded from community stats
                </Badge>
              ) : null}
              {communityStatsMessage ? <p className="mt-2 text-sm font-medium text-green-700">{communityStatsMessage}</p> : null}
              {communityStatsError ? <p className="mt-2 text-sm font-medium text-red-700">{communityStatsError}</p> : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                className={`rounded-md px-3 py-2 text-sm font-medium text-white ${displayPublicUrl ? "bg-blue-700 hover:bg-blue-800" : "pointer-events-none bg-gray-400"}`}
                aria-disabled={!displayPublicUrl}
                href={displayPublicUrl || undefined}
                onClick={handleOpenPublicPage}
                rel="noreferrer"
                target="_blank"
              >
                Open public page
              </a>
              <button
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={!displayPublicUrl}
                onClick={handleCopyPublicLink}
                type="button"
              >
                Copy link
              </button>
              {copyMessage ? <span className="self-center text-sm font-medium text-gray-600">{copyMessage}</span> : null}
            </div>
          </div>
          <div className="w-fit rounded-lg border border-gray-200 bg-gray-50 p-3">
            {displayPublicUrl ? (
              <QRCodeSVG value={displayPublicUrl} size={144} />
            ) : (
              <div className="flex h-36 w-36 items-center justify-center text-center text-xs font-medium text-gray-500">
                Publish first
              </div>
            )}
          </div>
        </div>
      </section>

      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Public Publishing</CardTitle>
            <CardDescription>Hosted public snapshot publishing.</CardDescription>
          </div>
          <Badge className={publishBadgeClass}>{publishStatusLabel}</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-3">
            <div>
              <p className="font-semibold text-slate-50">Publish Status</p>
              <p className="mt-1">{publishStatusLabel}</p>
            </div>
            <div>
              <p className="font-semibold text-slate-50">Public ID</p>
              <p className="mt-1 break-all">{tournament?.public_id || "-"}</p>
            </div>
            <div>
              <p className="font-semibold text-slate-50">Last Published</p>
              <p className="mt-1">{publishTimestamp || "-"}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 text-sm text-slate-300 md:grid-cols-2">
            <div>
              <p className="font-semibold text-slate-50">Public Site</p>
              <p className="mt-1 break-all">{publicSiteUrl || "Not configured"}</p>
            </div>
            <div>
              <p className="font-semibold text-slate-50">Configuration</p>
              <p className="mt-1">{publicPublishingConfigured ? "Ready" : "Configure publishing settings before publishing"}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!publicPublishingConfigured ? (
              <Button asChild type="button" variant="outline">
                <Link to="/admin/settings/publishing">Configure publishing settings</Link>
              </Button>
            ) : null}
            <Button
              disabled={isPublishingTournament || isUnpublishingTournament || publishStatus === "published" || !publicPublishingConfigured}
              onClick={handlePublishTournament}
              type="button"
            >
              {isPublishingTournament ? "Publishing..." : "Publish Tournament"}
            </Button>
            <Button
              disabled={isPublishingTournament || isUnpublishingTournament || publishStatus !== "published"}
              onClick={handleUnpublishTournament}
              type="button"
              variant="outline"
            >
              {isUnpublishingTournament ? "Unpublishing..." : "Unpublish Tournament"}
            </Button>
          </div>

          {publishMessage ? <p className="mt-3 text-sm font-medium text-emerald-200">{publishMessage}</p> : null}
          {publishError ? <p className="mt-3 text-sm font-medium text-rose-300">{publishError}</p> : null}
        </CardContent>
      </Card>

      <section className="rounded-lg border border-slate-700/70 bg-slate-950/85 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">KTS integration</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">KTS Tournament File</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              {isRunningInTauri
                ? "Choose the original KTS .Tournament file to import it now and keep it watched during the event."
                : "Use a KTS .Tournament file either as a one-time upload or as a watched live-event source."}
            </p>
          </div>
          <button
            className="w-fit rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRefreshingAutoSyncStatus}
            onClick={handleRefreshAutoSyncStatus}
            type="button"
          >
            {isRefreshingAutoSyncStatus ? "Refreshing..." : "Refresh Status"}
          </button>
        </div>

        {autoSyncTargetsAnotherTournament ? (
          <p className="mt-4 rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100">
            Auto-sync is currently targeting {autoSyncTargetLabel}.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
          <Badge className={autoSyncBadgeClass}>{autoSyncBadgeLabel}</Badge>
          <span className="text-sm text-slate-400">Last sync: {lastSyncTime || "-"}</span>
          <span className="text-sm text-slate-300">{autoSyncStateLabel}</span>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Current KTS file</p>
          <p className="mt-2 text-base font-semibold text-slate-50">{currentKtsFileName || "No KTS file selected"}</p>
          {currentKtsFilePath ? <p className="mt-1 break-all text-xs leading-5 text-slate-400">{currentKtsFilePath}</p> : null}
        </div>

        {isRunningInTauri ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              disabled={isChoosingAutoSyncFile || isResumingAutoSync || isEnablingAutoSync || isRunningAutoSync}
              onClick={handleChooseAutoSyncFile}
              type="button"
              variant={savedKtsFilePath ? "outline" : "default"}
            >
              {isChoosingAutoSyncFile ? "Choosing..." : savedKtsFilePath ? "Choose Different File" : "Choose KTS File"}
            </Button>
            {savedKtsFilePath && !activeWatcherForCurrentTournament ? (
              <Button
                disabled={isResumingAutoSync || isChoosingAutoSyncFile || isEnablingAutoSync || isRunningAutoSync}
                onClick={handleResumeAutoSync}
                type="button"
              >
                {isResumingAutoSync ? "Resuming..." : "Resume Watching"}
              </Button>
            ) : null}
            <Button
              disabled={!activeWatcherForCurrentTournament || isRunningAutoSync || isChoosingAutoSyncFile || isResumingAutoSync}
              onClick={handleRunAutoSyncNow}
              type="button"
              variant="secondary"
            >
              {isRunningAutoSync ? "Syncing..." : "Sync Now"}
            </Button>
            <Button
              disabled={!autoSyncStatus?.enabled || isDisablingAutoSync}
              onClick={handleDisableAutoSync}
              type="button"
              variant="destructive"
            >
              {isDisablingAutoSync ? "Disabling..." : "Disable Auto-Sync"}
            </Button>
          </div>
        ) : (
          <form className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]" onSubmit={handleEnableAutoSync}>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-300">
              .Tournament file path
              <Input
                onChange={(event) => {
                  setAutoSyncFilePath(event.target.value);
                  setAutoSyncMessage("");
                  setAutoSyncError("");
                }}
                placeholder="C:\Users\...\Competitive Tournament (ID ...).Tournament"
                type="text"
                value={autoSyncFilePath}
              />
              <span className="text-xs text-slate-400">
                Browser mode cannot read real local paths, so paste the full path for auto-sync.
              </span>
            </label>
            <Button
              className="self-end"
              disabled={isEnablingAutoSync || isChoosingAutoSyncFile}
              type="submit"
            >
              {isEnablingAutoSync ? "Enabling..." : "Enable Auto-Sync"}
            </Button>
            <Button
              className="self-end"
              disabled={!activeWatcherForCurrentTournament || isRunningAutoSync || isChoosingAutoSyncFile || isResumingAutoSync}
              onClick={handleRunAutoSyncNow}
              type="button"
              variant="secondary"
            >
              {isRunningAutoSync ? "Syncing..." : "Sync Now"}
            </Button>
            <Button
              className="self-end"
              disabled={!autoSyncStatus?.enabled || isDisablingAutoSync}
              onClick={handleDisableAutoSync}
              type="button"
              variant="destructive"
            >
              {isDisablingAutoSync ? "Disabling..." : "Disable Auto-Sync"}
            </Button>
          </form>
        )}

        {autoSyncStatus?.last_status ? (
          <p className="mt-3 text-sm text-slate-300">
            <span className="font-medium text-slate-200">Last sync result:</span> {autoSyncStatus.last_status}
          </p>
        ) : null}
        {lastHostedPublishTime ? (
          <p className="mt-2 text-sm text-slate-300">
            <span className="font-medium text-slate-200">Last hosted publish:</span> {lastHostedPublishTime}
          </p>
        ) : null}
        {autoSyncStatus?.last_warning ? (
          <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-100">
            {autoSyncStatus.last_warning}
          </p>
        ) : null}
        {autoSyncMessage ? <p className="mt-3 text-sm font-medium text-emerald-200">{autoSyncMessage}</p> : null}
        {autoSyncError ? <p className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200">{autoSyncError}</p> : null}
        {autoSyncStatus?.last_error ? (
          <p className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200">
            {autoSyncStatus.last_error}
          </p>
        ) : null}

        {!isRunningInTauri ? (
          <div className="mt-5 border-t border-slate-800 pt-4">
            <h3 className="text-sm font-semibold text-slate-50">Manual one-time import</h3>
            <p className="mt-1 text-sm text-slate-400">
              Upload a .Tournament file once if you do not need live auto-sync.
            </p>

            <form className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={handleImportTournamentFile}>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-300">
                .Tournament or XML file
                <input
                  accept=".Tournament,.tournament,.xml,application/xml,text/xml"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                  onChange={(event) => {
                    setTournamentFile(event.target.files?.[0] || null);
                    setTournamentFileImportMessage("");
                    setTournamentFileImportError("");
                  }}
                  ref={tournamentFileInputRef}
                  type="file"
                />
              </label>

              <button
                className="self-end rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
                disabled={isImportingTournamentFile}
                type="submit"
              >
                {isImportingTournamentFile ? "Importing..." : "Import file"}
              </button>
            </form>

            {tournamentFileImportMessage ? <p className="mt-3 text-sm font-medium text-green-700">{tournamentFileImportMessage}</p> : null}
            {tournamentFileImportError ? <p className="mt-3 text-sm font-medium text-red-700">{tournamentFileImportError}</p> : null}
          </div>
        ) : null}
      </section>

      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardContent className="p-4">
          <Tabs onValueChange={setActiveTournamentTab} value={activeTournamentTab}>
            <TabsList>
              <TabsTrigger value="matches">Current Round / Matches</TabsTrigger>
              <TabsTrigger value="playoffs">Playoffs</TabsTrigger>
              <TabsTrigger value="standings">Standings</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {activeTournamentTab === "standings" ? (
      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Standings</CardTitle>
            <CardDescription>{standings.length} players imported</CardDescription>
          </div>
          <Button onClick={fetchStandings} size="sm" type="button" variant="ghost">
            Refresh
          </Button>
        </CardHeader>
        <CardContent>

        <Input
          onChange={(event) => setStandingsSearch(event.target.value)}
          placeholder="Search standings..."
          type="search"
          value={standingsSearch}
        />

        {standings.length === 0 ? <p className="mt-4 text-sm text-slate-400">No standings imported yet.</p> : null}
        {standings.length > 0 && filteredStandings.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No standings match "{standingsSearch.trim()}".</p>
        ) : null}

        {filteredStandings.length > 0 ? (
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Rank</TableHead>
                  <TableHead className="min-w-48">Player</TableHead>
                  <TableHead className="whitespace-nowrap">Points</TableHead>
                  <TableHead className="whitespace-nowrap">Tiebreaker</TableHead>
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
                    <TableCell className="whitespace-nowrap text-slate-300">{standing.tiebreaker || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        </CardContent>
      </Card>
      ) : null}

      {activeTournamentTab === "playoffs" ? (
        <Card className="border-slate-700/70 bg-slate-950/85">
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Playoffs</CardTitle>
              <CardDescription>
                {playoffBracket ? `Top ${playoffBracket.size} - ${playoffBracket.status}` : "Seeds are generated from the current standings."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={fetchPlayoffs} size="sm" type="button" variant="ghost">
                Refresh
              </Button>
              {playoffBracket ? (
                <Button disabled={isDeletingPlayoffs} onClick={handleDeletePlayoffs} size="sm" type="button" variant="destructive">
                  {isDeletingPlayoffs ? "Resetting..." : "Reset"}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {playoffsError ? (
              <p className="mb-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200">
                {playoffsError}
              </p>
            ) : null}

            {isLoadingPlayoffs ? <p className="text-sm text-slate-400">Loading playoffs...</p> : null}

            {!isLoadingPlayoffs && !playoffBracket ? (
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/55 p-4">
                <h3 className="text-base font-semibold text-slate-50">Create Top Cut</h3>
                <p className="mt-1 text-sm text-slate-400">Seeds are generated from the current standings.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[4, 8, 16].map((size) => (
                    <Button
                      disabled={isCreatingPlayoffs}
                      key={size}
                      onClick={() => handleCreatePlayoffs(size)}
                      type="button"
                    >
                      {isCreatingPlayoffs ? "Creating..." : `Top ${size}`}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {playoffBracket ? (
              <PlayoffBracketView
                onSetWinner={handleSetPlayoffWinner}
                playoffBracket={playoffBracket}
                savingPlayoffMatchId={savingPlayoffMatchId}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {activeTournamentTab === "matches" ? (
      <>
      <section className="rounded-lg border border-slate-700/70 bg-slate-950/85 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-50">Tournament Management</h2>
          </div>
          <button
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
            onClick={() => setIsManualToolsOpen((isOpen) => !isOpen)}
            type="button"
          >
            {isManualToolsOpen ? "Hide manual tools" : "Show manual tools"}
          </button>
        </div>

        {isManualToolsOpen ? (
          <div className="mt-4 grid items-start gap-4 md:grid-cols-3">
        <div className="order-3 self-start rounded-lg border border-slate-700/70 bg-slate-900/55 p-4">
          <div className="flex items-center justify-between gap-4">
            <button
              className="text-left text-base font-semibold text-gray-950"
              onClick={() => setIsRoundsToolOpen((isOpen) => !isOpen)}
              type="button"
            >
              Rounds — {rounds.length} total
            </button>
            <button
              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => setIsRoundsToolOpen((isOpen) => !isOpen)}
              type="button"
            >
              {isRoundsToolOpen ? "Hide" : "Show"}
            </button>
          </div>

          {isRoundsToolOpen ? (
            <>
          <button className="mt-4 text-sm font-medium text-blue-700 hover:text-blue-900" onClick={fetchRounds} type="button">
            Refresh
          </button>

          <button
            className="mt-4 w-full rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={isCreatingRound || isLoadingRounds}
            onClick={handleCreateNextRound}
            type="button"
          >
            {isCreatingRound ? "Creating..." : "Create next round"}
          </button>

          {roundsError ? <p className="mt-3 text-sm font-medium text-red-700">{roundsError}</p> : null}
          {isLoadingRounds ? <p className="mt-4 text-sm text-gray-700">Loading rounds...</p> : null}
          {!isLoadingRounds && rounds.length === 0 ? <p className="mt-4 text-sm text-gray-700">No rounds yet.</p> : null}

          {rounds.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-800">
              {rounds.map((round) => (
                <li className="flex items-center justify-between gap-3 py-3 text-sm font-medium text-gray-950" key={round.id}>
                  <span>Round {round.number}</span>
                  {tournament?.current_round_id === round.id ? (
                    <span className="ml-auto rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">Current</span>
                  ) : (
                    <button
                      className="ml-auto rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      onClick={() => handleSetCurrentRound(round.id)}
                      type="button"
                    >
                      Set Current
                    </button>
                  )}
                  <button
                    aria-label={`Delete round ${round.number}`}
                    className="flex h-8 w-8 items-center justify-center rounded border border-red-200 text-lg font-semibold leading-none text-red-700 hover:bg-red-50"
                    onClick={() => handleDeleteRound(round.id)}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
            </>
          ) : null}
        </div>
        <Card className="order-1 self-start border-slate-700/70 bg-slate-950/85 md:col-span-3">
          <CardContent className="p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-50">Matches</h2>
            <div className="flex items-center gap-3">
              <Button className="px-0" onClick={fetchMatches} size="sm" type="button" variant="ghost">
                Refresh
              </Button>
            </div>
          </div>

          {sortedRounds.length > 0 ? (
            <div className="mt-4">
              <div className="mb-2 flex justify-end">
                <button
                  className="text-xs font-semibold text-blue-700 hover:text-blue-900"
                  onClick={() => setIsPreviousRoundsOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  {isPreviousRoundsOpen ? "Hide previous rounds" : "Show previous rounds"}
                </button>
              </div>
              <div className="flex overflow-x-auto overflow-y-hidden">
                {visibleMatchRoundTabs.map((round) => {
                  const isActive = selectedMatchRoundId === round.id;
                  const isCurrent = tournament?.current_round_id === round.id;

                  return (
                    <button
                      className={`shrink-0 rounded-t-md border px-3 py-2 text-sm font-semibold ${
                        isActive
                          ? "border-sky-400/50 bg-slate-800 text-slate-50"
                          : "border-slate-700 bg-slate-900/70 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                      }`}
                      key={round.id}
                      onClick={() => setSelectedMatchRoundId(round.id)}
                      type="button"
                    >
                      Round {round.number}
                      {isCurrent ? (
                        <Badge className="ml-2">Current</Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {selectedMatchRound ? (
                <p className="rounded-b-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-slate-300">
                  Round {selectedMatchRound.number}{tournament?.current_round_id === selectedMatchRound.id ? " - Current Round" : ""} - {selectedRoundMatches.length} matches - {selectedRoundUnreportedCount} unreported
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="mt-4 flex w-fit items-center gap-2 rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-300">
            <input
              checked={showOnlyUnreportedMatches}
              className="h-4 w-4"
              onChange={(event) => setShowOnlyUnreportedMatches(event.target.checked)}
              type="checkbox"
            />
            Show only unreported matches
          </label>

          {matchesError ? <p className="mt-3 text-sm font-medium text-rose-300">{matchesError}</p> : null}
          {isLoadingMatches ? <p className="mt-4 text-sm text-slate-400">Loading matches...</p> : null}
          {!isLoadingMatches && matches.length === 0 ? <p className="mt-4 text-sm text-slate-400">No matches yet.</p> : null}
          {!isLoadingMatches && matches.length > 0 && selectedMatchRound && selectedRoundMatches.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No matches for this round.</p>
          ) : null}
          {!isLoadingMatches && selectedMatchRound && selectedRoundMatches.length > 0 && showOnlyUnreportedMatches && displayedSelectedRoundMatches.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">All matches reported for this round.</p>
          ) : null}

          {displayedSelectedRoundMatches.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-800">
              {displayedSelectedRoundMatches.map((match) => {
                const isBye = match.notes === "BYE";
                const playerOneName = playerDisplayNames[match.player_one_id] || "Player one";

                return (
                  <li className="grid gap-3 py-4 md:grid-cols-[1fr_auto_auto]" key={match.id}>
                    <div>
                      <p className="text-sm font-semibold text-slate-50">
                        Round {roundNumbers[match.round_id] || "?"} - Table {match.table_number || "-"}
                      </p>
                      <p className="mt-1 text-sm text-slate-300">
                        {isBye ? `${playerOneName} has a BYE` : `${playerOneName} vs ${getMatchPlayerTwoName(match)}`}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-400">Result: {getMatchResultLabel(match)}</p>
                    </div>

                    {isBye ? (
                      <div className="flex items-end">
                        <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-200">
                          BYE — Automatic Win
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        {RESULT_OPTIONS.map((option) => {
                          const isSelected = (match.result_status || "UNREPORTED") === option.value;

                          return (
                            <button
                              className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                                isSelected
                                  ? "border-sky-400/40 bg-sky-500/20 text-sky-100"
                                  : "border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800"
                              }`}
                              disabled={savingMatchId === match.id}
                              key={option.value}
                              onClick={() => handleSaveResult(match, option.value)}
                              type="button"
                            >
                              {savingMatchId === match.id && isSelected ? "Saving..." : option.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <button
                      aria-label={`Delete match ${match.id}`}
                      className="flex h-8 w-8 items-center justify-center self-end rounded border border-red-200 text-lg font-semibold leading-none text-red-700 hover:bg-red-50"
                      onClick={() => handleDeleteMatch(match.id)}
                      type="button"
                    >
                      x
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="mt-6 rounded-lg border border-slate-700/70 bg-slate-900/55 p-4">
            <h3 className="text-base font-semibold text-slate-50">Add match manually</h3>
            <p className="mt-1 text-sm text-slate-400">Use only if you need to manually create a missing match.</p>

            <form className="mt-4 grid gap-3 md:grid-cols-5" onSubmit={handleCreateMatch}>
              <select
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => {
                  updateMatchForm("round_id", event.target.value);
                  setSelectedMatchRoundId(Number(event.target.value));
                }}
                value={matchForm.round_id}
              >
                <option disabled value="">
                  Select round
                </option>
                {rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    Round {round.number}
                  </option>
                ))}
              </select>

              <input
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                min="1"
                onChange={(event) => updateMatchForm("table_number", event.target.value)}
                placeholder="Table"
                type="number"
                value={matchForm.table_number}
              />

              <select
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => updateMatchForm("player_one_id", event.target.value)}
                value={matchForm.player_one_id}
              >
                <option value="">Player one</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>

              <select
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => updateMatchForm("player_two_id", event.target.value)}
                value={matchForm.player_two_id}
              >
                <option value="">Player two</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>

              <button
                className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
                disabled={isCreatingMatch || rounds.length === 0 || players.length < 2}
                type="submit"
              >
                {isCreatingMatch ? "Creating..." : "Add match"}
              </button>
            </form>
          </div>
          </CardContent>
        </Card>
          </div>
        ) : null}
      </section>
      </>
      ) : null}
        <div className="rounded-lg border border-slate-700/70 bg-slate-950/85 p-4 md:col-span-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-50">Advanced Import Tools</h2>
              <p className="mt-1 text-sm text-slate-400">
                Use these only if the full KTS tournament file import is unavailable or you need a partial manual import.
              </p>
            </div>
            <button
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
              onClick={() => setIsAdvancedImportToolsOpen((isOpen) => !isOpen)}
              type="button"
            >
              {isAdvancedImportToolsOpen ? "Hide tools" : "Show tools"}
            </button>
          </div>

          {isAdvancedImportToolsOpen ? (
            <div className="mt-4 grid gap-4">
              <section className="rounded-lg border border-slate-700/70 bg-slate-900/55 p-5 shadow-sm">
                <div>
                  <h2 className="text-xl font-semibold text-slate-50">Import Round from KTS</h2>
                </div>

                <form className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]" onSubmit={handlePreviewRoundCsv}>
                  <label className="flex flex-col gap-1 text-sm font-medium text-slate-300">
                    Round number
                    <input
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                      min="1"
                      onChange={(event) => updateImportRoundNumber(event.target.value)}
                      type="number"
                      value={importRoundNumber}
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm font-medium text-slate-300">
                    CSV file
                    <input
                      accept=".csv,text/csv"
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                      onChange={(event) => updateImportFile(event.target.files?.[0] || null)}
                      ref={importFileInputRef}
                      type="file"
                    />
                  </label>

                  <button
                    className="self-end rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    disabled={isPreviewingImport || isImportingRound}
                    type="submit"
                  >
                    {isPreviewingImport ? "Previewing..." : "Preview import"}
                  </button>
                </form>

                {importPreview ? (
                  <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/65 p-4">
                    <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-4">
                      <div>
                        <p className="font-semibold text-slate-50">Round</p>
                        <p>{importPreview.round_number}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-50">Matches</p>
                        <p>{importPreview.matches_count}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-50">Players</p>
                        <p>{importPreview.players_detected_count}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-50">BYEs</p>
                        <p>{importPreview.bye_count}</p>
                      </div>
                    </div>
                    {importPreview.warning ? (
                      <p className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm font-semibold text-yellow-900">
                        {importPreview.warning}
                      </p>
                    ) : null}
                    <button
                      className="mt-4 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
                      disabled={isImportingRound}
                      onClick={handleConfirmRoundCsvImport}
                      type="button"
                    >
                      {isImportingRound ? "Importing..." : "Confirm import"}
                    </button>
                  </div>
                ) : null}

                {importMessage ? <p className="mt-3 text-sm font-medium text-green-700">{importMessage}</p> : null}
                {importError ? <p className="mt-3 text-sm font-medium text-red-700">{importError}</p> : null}
              </section>

              <section className="rounded-lg border border-slate-700/70 bg-slate-900/55 p-5 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-50">Import KTS Standings CSV</h2>

                <form className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={handleImportStandingsCsv}>
                  <label className="flex flex-col gap-1 text-sm font-medium text-slate-300">
                    CSV file
                    <input
                      accept=".csv,text/csv"
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                      onChange={(event) => {
                        setStandingsFile(event.target.files?.[0] || null);
                        setStandingsImportMessage("");
                        setStandingsImportError("");
                      }}
                      ref={standingsFileInputRef}
                      type="file"
                    />
                  </label>

                  <button
                    className="self-end rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    disabled={isImportingStandings}
                    type="submit"
                  >
                    {isImportingStandings ? "Importing..." : "Import standings"}
                  </button>
                </form>

                {standingsImportMessage ? <p className="mt-3 text-sm font-medium text-green-700">{standingsImportMessage}</p> : null}
                {standingsImportError ? <p className="mt-3 text-sm font-medium text-red-700">{standingsImportError}</p> : null}
              </section>
            </div>
          ) : null}
        </div>
    </main>
  );
}
