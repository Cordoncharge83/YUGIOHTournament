import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useParams } from "react-router-dom";

import api from "../api/client";

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

export default function AdminTournamentPage() {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [players, setPlayers] = useState([]);
  const [playerName, setPlayerName] = useState("");
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(true);
  const [isCreatingPlayer, setIsCreatingPlayer] = useState(false);
  const [playersError, setPlayersError] = useState("");
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
  const [isManualToolsOpen, setIsManualToolsOpen] = useState(false);
  const [isPlayersToolOpen, setIsPlayersToolOpen] = useState(false);
  const [isRoundsToolOpen, setIsRoundsToolOpen] = useState(false);
  const [isStandingsToolOpen, setIsStandingsToolOpen] = useState(false);
  const [selectedMatchRoundId, setSelectedMatchRoundId] = useState(null);

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

  async function fetchTournament() {
    try {
      const response = await api.get(`/tournaments/${id}`);
      setTournament(response.data);
    } catch {
      setRoundsError("Could not load tournament.");
    }
  }

  async function fetchPlayers() {
    try {
      setPlayersError("");
      const response = await api.get(`/tournaments/${id}/players`);
      setPlayers(response.data);
    } catch {
      setPlayersError("Could not load players.");
    } finally {
      setIsLoadingPlayers(false);
    }
  }

  async function fetchRounds() {
    try {
      setRoundsError("");
      const response = await api.get(`/tournaments/${id}/rounds`);
      setRounds(response.data);
    } catch {
      setRoundsError("Could not load rounds.");
    } finally {
      setIsLoadingRounds(false);
    }
  }

  async function fetchMatches() {
    try {
      setMatchesError("");
      const response = await api.get(`/tournaments/${id}/matches`);
      setMatches(response.data);
    } catch {
      setMatchesError("Could not load matches.");
    } finally {
      setIsLoadingMatches(false);
    }
  }

  async function fetchStandings() {
    try {
      const response = await api.get(`/public/tournaments/${id}`);
      setStandings(response.data.standings || []);
    } catch {
      setStandings([]);
    }
  }

  useEffect(() => {
    fetchTournament();
    fetchPlayers();
    fetchRounds();
    fetchMatches();
    fetchStandings();
  }, [id]);

  async function handleCreatePlayer(event) {
    event.preventDefault();

    if (!playerName.trim()) {
      setPlayersError("Player name is required.");
      return;
    }

    try {
      setIsCreatingPlayer(true);
      setPlayersError("");
      await api.post(`/tournaments/${id}/players`, { name: playerName.trim() });
      setPlayerName("");
      await fetchPlayers();
    } catch {
      setPlayersError("Could not add player.");
    } finally {
      setIsCreatingPlayer(false);
    }
  }

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
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Copy failed");
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

  const publicPath = `/t/${id}`;
  const publicUrl = `${window.location.origin}${publicPath}`;
  const playerNames = Object.fromEntries(players.map((player) => [player.id, player.name]));
  const playerDisplayNames = Object.fromEntries(players.map((player) => [player.id, formatPlayerDisplayName(player.name)]));
  const roundNumbers = Object.fromEntries(rounds.map((round) => [round.id, round.number]));
  const sortedRounds = [...rounds].sort((firstRound, secondRound) => firstRound.number - secondRound.number);
  const currentRound = rounds.find((round) => round.id === tournament?.current_round_id) || null;
  const currentRoundUnreportedCount = currentRound
    ? matches.filter((match) => match.round_id === currentRound.id && (match.result_status || "UNREPORTED") === "UNREPORTED").length
    : null;
  const selectedMatchRound = rounds.find((round) => round.id === selectedMatchRoundId) || null;
  const selectedRoundMatches = selectedMatchRound
    ? matches
        .filter((match) => match.round_id === selectedMatchRound.id)
        .sort((firstMatch, secondMatch) => (firstMatch.table_number || 0) - (secondMatch.table_number || 0))
    : [];
  const selectedRoundUnreportedCount = selectedRoundMatches.filter(
    (match) => (match.result_status || "UNREPORTED") === "UNREPORTED",
  ).length;

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
                {currentRoundUnreportedCount !== null ? (
                  <p className="mt-1 text-xs font-medium text-yellow-700">{currentRoundUnreportedCount} unreported matches</p>
                ) : null}
              </div>
              <div>
                <p className="font-semibold text-gray-950">Public link</p>
                <p className="break-all">{publicUrl}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
                href={publicPath}
                rel="noreferrer"
                target="_blank"
              >
                Open public page
              </a>
              <button
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={handleCopyPublicLink}
                type="button"
              >
                Copy link
              </button>
              {copyMessage ? <span className="self-center text-sm font-medium text-gray-600">{copyMessage}</span> : null}
            </div>
          </div>
          <div className="w-fit rounded-lg border border-gray-200 bg-gray-50 p-3">
            <QRCodeSVG value={publicUrl} size={144} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-blue-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-xl font-semibold text-gray-950">Import Round from KTS</h2>
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]" onSubmit={handlePreviewRoundCsv}>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Round number
            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              min="1"
              onChange={(event) => updateImportRoundNumber(event.target.value)}
              type="number"
              value={importRoundNumber}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
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
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="grid gap-3 text-sm text-gray-700 sm:grid-cols-4">
              <div>
                <p className="font-semibold text-gray-950">Round</p>
                <p>{importPreview.round_number}</p>
              </div>
              <div>
                <p className="font-semibold text-gray-950">Matches</p>
                <p>{importPreview.matches_count}</p>
              </div>
              <div>
                <p className="font-semibold text-gray-950">Players</p>
                <p>{importPreview.players_detected_count}</p>
              </div>
              <div>
                <p className="font-semibold text-gray-950">BYEs</p>
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

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-950">Import KTS Standings CSV</h2>

        <form className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={handleImportStandingsCsv}>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
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

      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-950">Tournament Management</h2>
          </div>
          <button
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            onClick={() => setIsManualToolsOpen((isOpen) => !isOpen)}
            type="button"
          >
            {isManualToolsOpen ? "Hide manual tools" : "Show manual tools"}
          </button>
        </div>

        {isManualToolsOpen ? (
          <div className="mt-4 grid items-start gap-4 md:grid-cols-3">
        <div className="order-2 self-start rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-4">
            <button
              className="text-left text-base font-semibold text-gray-950"
              onClick={() => setIsPlayersToolOpen((isOpen) => !isOpen)}
              type="button"
            >
              Players — {players.length} total
            </button>
            <button
              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => setIsPlayersToolOpen((isOpen) => !isOpen)}
              type="button"
            >
              {isPlayersToolOpen ? "Hide" : "Show"}
            </button>
          </div>

          {isPlayersToolOpen ? (
            <>
          <button className="mt-4 text-sm font-medium text-blue-700 hover:text-blue-900" onClick={fetchPlayers} type="button">
            Refresh
          </button>

          <form className="mt-4 flex gap-2" onSubmit={handleCreatePlayer}>
            <input
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Player name"
              type="text"
              value={playerName}
            />
            <button
              className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              disabled={isCreatingPlayer}
              type="submit"
            >
              Add
            </button>
          </form>

          {playersError ? <p className="mt-3 text-sm font-medium text-red-700">{playersError}</p> : null}
          {isLoadingPlayers ? <p className="mt-4 text-sm text-gray-700">Loading players...</p> : null}
          {!isLoadingPlayers && players.length === 0 ? <p className="mt-4 text-sm text-gray-700">No players yet.</p> : null}

          {players.length > 0 ? (
            <ul className="mt-4 divide-y divide-gray-200">
              {players.map((player) => (
                <li className="py-3 text-sm font-medium text-gray-950" key={player.id}>
                  {player.name}
                </li>
              ))}
            </ul>
          ) : null}
            </>
          ) : null}
        </div>
        <div className="order-3 self-start rounded-lg border border-gray-200 bg-white p-4">
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
            <ul className="mt-4 divide-y divide-gray-200">
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
        <div className="order-4 self-start rounded-lg border border-gray-200 bg-white p-4 md:col-span-3">
          <div className="flex items-center justify-between gap-4">
            <button
              className="text-left text-base font-semibold text-gray-950"
              onClick={() => setIsStandingsToolOpen((isOpen) => !isOpen)}
              type="button"
            >
              Standings — {standings.length} players
            </button>
            <button
              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => setIsStandingsToolOpen((isOpen) => !isOpen)}
              type="button"
            >
              {isStandingsToolOpen ? "Hide" : "Show"}
            </button>
          </div>

          {isStandingsToolOpen ? (
            standings.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2">Rank</th>
                      <th className="min-w-48 px-3 py-2">Player</th>
                      <th className="whitespace-nowrap px-3 py-2">Points</th>
                      <th className="whitespace-nowrap px-3 py-2">Tiebreaker</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {standings.map((standing) => (
                      <tr key={standing.id}>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold text-gray-950">{standing.rank}</td>
                        <td className="px-3 py-3 font-medium text-gray-950">
                          {formatPlayerDisplayName(standing.short_name || standing.full_name)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">{standing.points}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">{standing.tiebreaker || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-700">No standings imported yet.</p>
            )
          ) : null}
        </div>
        <div className="order-1 self-start rounded-lg border border-gray-200 bg-white p-5 shadow-sm md:col-span-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-950">Matches</h2>
            <div className="flex items-center gap-3">
              <button className="text-sm font-medium text-blue-700 hover:text-blue-900" onClick={fetchMatches} type="button">
                Refresh
              </button>
            </div>
          </div>

          {sortedRounds.length > 0 ? (
            <div className="mt-4">
              <div className="flex overflow-x-auto overflow-y-hidden">
                {sortedRounds.map((round) => {
                  const isActive = selectedMatchRoundId === round.id;

                  return (
                    <button
                      className={`shrink-0 rounded-t-md border px-3 py-2 text-sm font-semibold ${
                        isActive
                          ? "border-gray-300 border-b-white bg-white text-gray-950"
                          : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                      }`}
                      key={round.id}
                      onClick={() => setSelectedMatchRoundId(round.id)}
                      type="button"
                    >
                      Round {round.number}
                    </button>
                  );
                })}
              </div>

              {selectedMatchRound ? (
                <p className="rounded-b-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700">
                  Round {selectedMatchRound.number} — {selectedRoundMatches.length} matches — {selectedRoundUnreportedCount} unreported
                </p>
              ) : null}
            </div>
          ) : null}

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

          {matchesError ? <p className="mt-3 text-sm font-medium text-red-700">{matchesError}</p> : null}
          {isLoadingMatches ? <p className="mt-4 text-sm text-gray-700">Loading matches...</p> : null}
          {!isLoadingMatches && matches.length === 0 ? <p className="mt-4 text-sm text-gray-700">No matches yet.</p> : null}
          {!isLoadingMatches && matches.length > 0 && selectedMatchRound && selectedRoundMatches.length === 0 ? (
            <p className="mt-4 text-sm text-gray-700">No matches for this round.</p>
          ) : null}

          {selectedRoundMatches.length > 0 ? (
            <ul className="mt-4 divide-y divide-gray-200">
              {selectedRoundMatches.map((match) => {
                const isBye = match.notes === "BYE";
                const playerOneName = playerDisplayNames[match.player_one_id] || "Player one";

                return (
                  <li className="grid gap-3 py-4 md:grid-cols-[1fr_auto_auto]" key={match.id}>
                    <div>
                      <p className="text-sm font-semibold text-gray-950">
                        Round {roundNumbers[match.round_id] || "?"} - Table {match.table_number || "-"}
                      </p>
                      <p className="mt-1 text-sm text-gray-700">
                        {isBye ? `${playerOneName} has a BYE` : `${playerOneName} vs ${getMatchPlayerTwoName(match)}`}
                      </p>
                      <p className="mt-1 text-sm font-medium text-gray-600">Result: {getMatchResultLabel(match)}</p>
                    </div>

                    {isBye ? (
                      <div className="flex items-end">
                        <span className="rounded-md bg-green-100 px-2.5 py-1.5 text-xs font-semibold text-green-800">
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
                                  ? "border-blue-700 bg-blue-700 text-white"
                                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
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
        </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
