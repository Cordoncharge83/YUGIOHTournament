export function formatPlayerDisplayName(name) {
  return (name || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

export function adaptSnapshotToPublicTournamentData(workerData, publicId) {
  const snapshot = workerData?.snapshot;

  if (!snapshot) {
    return null;
  }

  const currentRoundNumber = snapshot.current_round_number;
  const currentRoundId = currentRoundNumber ? `round-${currentRoundNumber}` : null;
  const uniquePlayerNames = new Set();

  for (const pairing of snapshot.current_round_pairings || []) {
    addPlayerName(uniquePlayerNames, pairing.player_one_name);
    if (pairing.notes !== "BYE") {
      addPlayerName(uniquePlayerNames, pairing.player_two_name);
    }
  }

  for (const standing of snapshot.standings || []) {
    addPlayerName(uniquePlayerNames, standing.player_name);
  }

  const players = [...uniquePlayerNames].map((name, index) => ({
    id: `player-${index + 1}`,
    name,
  }));

  const metadataPlayerCount = Number(snapshot.metadata?.total_players || 0);
  while (players.length < metadataPlayerCount) {
    players.push({
      id: `hidden-player-${players.length + 1}`,
      name: null,
    });
  }

  return {
    tournament: {
      id: publicId,
      name: snapshot.tournament_name,
      location: snapshot.location,
      current_round_id: currentRoundId,
    },
    players,
    rounds: currentRoundNumber
      ? [
          {
            id: currentRoundId,
            number: currentRoundNumber,
          },
        ]
      : [],
    matches: (snapshot.current_round_pairings || []).map((pairing) => ({
      table_number: pairing.table_number,
      round_number: currentRoundNumber,
      player_one_name: pairing.player_one_name,
      player_two_name: pairing.player_two_name,
      result_status: pairing.result_status,
      notes: pairing.notes,
    })),
    standings: (snapshot.standings || []).map((standing) => ({
      id: `standing-${standing.rank}-${standing.player_name}`,
      rank: standing.rank,
      full_name: standing.player_name,
      short_name: standing.player_name,
      cossy_id: null,
      points: standing.points,
      tiebreaker: standing.tiebreaker,
    })),
    lastUpdatedAt: snapshot.last_updated_at || workerData.updatedAt || null,
  };
}

function addPlayerName(playerNames, playerName) {
  const displayName = formatPlayerDisplayName(playerName);
  if (displayName) {
    playerNames.add(displayName);
  }
}
