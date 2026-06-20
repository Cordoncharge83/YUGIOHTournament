const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const PUBLIC_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const MAX_SNAPSHOT_BYTES = 256 * 1024;

const REQUIRED_SNAPSHOT_FIELDS = [
  "tournament_name",
  "current_round_pairings",
  "standings",
  "metadata",
];

const PRIVATE_FIELD_NAMES = new Set([
  "cossy_id",
  "cossyId",
  "file_path",
  "filePath",
  "kts_file_path",
  "ktsFilePath",
  "saved_kts_file_path",
  "savedKtsFilePath",
  "database_id",
  "databaseId",
  "tournament_id",
  "tournamentId",
  "player_id",
  "playerId",
  "match_id",
  "matchId",
  "round_id",
  "roundId",
]);

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
};

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (request.method === "OPTIONS") {
    return corsResponse();
  }

  if (request.method === "GET" && path === "/api/health") {
    return jsonResponse({ status: "ok" });
  }

  const tournamentMatch = path.match(/^\/api\/tournaments\/([^/]+)$/);
  if (tournamentMatch) {
    const publicId = tournamentMatch[1];

    if (!isValidPublicId(publicId)) {
      return jsonResponse({ error: "Invalid public tournament id" }, 400);
    }

    if (request.method === "PUT") {
      const authError = requirePublishKey(request, env);
      if (authError) {
        return authError;
      }
      return putTournamentSnapshot(request, env, publicId);
    }

    if (request.method === "GET") {
      return getTournamentSnapshot(env, publicId);
    }
  }

  const unpublishMatch = path.match(/^\/api\/tournaments\/([^/]+)\/unpublish$/);
  if (unpublishMatch && request.method === "POST") {
    const publicId = unpublishMatch[1];

    if (!isValidPublicId(publicId)) {
      return jsonResponse({ error: "Invalid public tournament id" }, 400);
    }

    const authError = requirePublishKey(request, env);
    if (authError) {
      return authError;
    }

    return unpublishTournament(env, publicId);
  }

  return jsonResponse({ error: "Not found" }, 404);
}

async function putTournamentSnapshot(request, env, publicId) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_SNAPSHOT_BYTES) {
    return jsonResponse({ error: "Snapshot payload is too large" }, 413);
  }

  let snapshot;
  try {
    const bodyText = await request.text();
    const bodyBytes = new TextEncoder().encode(bodyText).length;
    if (bodyBytes > MAX_SNAPSHOT_BYTES) {
      return jsonResponse({ error: "Snapshot payload is too large" }, 413);
    }
    snapshot = JSON.parse(bodyText);
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400);
  }

  const validationError = validatePublicSnapshot(snapshot);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }

  const record = {
    publicId,
    snapshot: sanitizePublicSnapshot(snapshot),
    status: "published",
    updatedAt: new Date().toISOString(),
  };

  await env.TOURNAMENT_SNAPSHOTS.put(storageKey(publicId), JSON.stringify(record));

  return jsonResponse({
    publicId: record.publicId,
    status: record.status,
    updatedAt: record.updatedAt,
  });
}

async function getTournamentSnapshot(env, publicId) {
  const record = await readTournamentRecord(env, publicId);
  if (!record || record.status !== "published") {
    return jsonResponse({ error: "Tournament snapshot is unavailable" }, 404);
  }

  return jsonResponse({
    publicId: record.publicId,
    snapshot: record.snapshot,
    status: record.status,
    updatedAt: record.updatedAt,
  });
}

async function unpublishTournament(env, publicId) {
  const existing = await readTournamentRecord(env, publicId);
  const now = new Date().toISOString();
  const record = {
    publicId,
    snapshot: existing?.snapshot ?? null,
    status: "unpublished",
    updatedAt: existing?.updatedAt ?? now,
    unpublishedAt: now,
  };

  await env.TOURNAMENT_SNAPSHOTS.put(storageKey(publicId), JSON.stringify(record));

  return jsonResponse({
    publicId: record.publicId,
    status: record.status,
    updatedAt: record.updatedAt,
    unpublishedAt: record.unpublishedAt,
  });
}

async function readTournamentRecord(env, publicId) {
  const value = await env.TOURNAMENT_SNAPSHOTS.get(storageKey(publicId), "json");
  if (!value || typeof value !== "object") {
    return null;
  }
  return value;
}

function requirePublishKey(request, env) {
  const expectedKey = env.PUBLISH_KEY;
  if (!expectedKey) {
    return jsonResponse({ error: "Publish key is not configured" }, 500);
  }

  const actualKey = request.headers.get("x-publish-key");
  if (!actualKey || actualKey !== expectedKey) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return null;
}

function validatePublicSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return "Snapshot must be a JSON object";
  }

  for (const field of REQUIRED_SNAPSHOT_FIELDS) {
    if (!(field in snapshot)) {
      return `Snapshot is missing required field: ${field}`;
    }
  }

  if (containsPrivateField(snapshot)) {
    return "Snapshot contains private or internal fields";
  }

  if (typeof snapshot.tournament_name !== "string" || snapshot.tournament_name.trim() === "") {
    return "Snapshot tournament_name must be a non-empty string";
  }

  if (!Array.isArray(snapshot.current_round_pairings)) {
    return "Snapshot current_round_pairings must be an array";
  }

  if (!Array.isArray(snapshot.standings)) {
    return "Snapshot standings must be an array";
  }

  if (!snapshot.metadata || typeof snapshot.metadata !== "object" || Array.isArray(snapshot.metadata)) {
    return "Snapshot metadata must be an object";
  }

  return null;
}

function sanitizePublicSnapshot(snapshot) {
  const { tournament_id: _tournamentId, tournamentId: _camelTournamentId, ...publicSnapshot } = snapshot;
  return publicSnapshot;
}

function containsPrivateField(value, path = []) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item, index) => containsPrivateField(item, [...path, String(index)]));
  }

  for (const [key, child] of Object.entries(value)) {
    const currentPath = [...path, key];
    const isTopLevelTournamentId = currentPath.length === 1 && (key === "tournament_id" || key === "tournamentId");
    if (!isTopLevelTournamentId && PRIVATE_FIELD_NAMES.has(key)) {
      return true;
    }
    if (containsPrivateField(child, currentPath)) {
      return true;
    }
  }

  return false;
}

function isValidPublicId(publicId) {
  return PUBLIC_ID_PATTERN.test(publicId);
}

function storageKey(publicId) {
  return `tournament:${publicId}`;
}

function normalizePath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "access-control-allow-origin": "*",
    },
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-publish-key",
      "access-control-max-age": "86400",
    },
  });
}
