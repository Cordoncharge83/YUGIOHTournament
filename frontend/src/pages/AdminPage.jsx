import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";

import api from "../api/client";

export default function AdminPage() {
  const [tournaments, setTournaments] = useState([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingTournamentId, setDeletingTournamentId] = useState(null);
  const [error, setError] = useState("");
  const [shareTournament, setShareTournament] = useState(null);
  const [copyMessage, setCopyMessage] = useState("");

  async function fetchTournaments() {
    try {
      setError("");
      const response = await api.get("/tournaments");
      setTournaments(response.data);
    } catch {
      setError("Could not load tournaments.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchTournaments();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Tournament name is required.");
      return;
    }

    try {
      setIsCreating(true);
      setError("");
      await api.post("/tournaments", {
        name: name.trim(),
        location: location.trim() || null,
      });
      setName("");
      setLocation("");
      await fetchTournaments();
    } catch {
      setError("Could not create tournament.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopyLink(publicUrl) {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Copy failed");
    }
  }

  async function handleDeleteTournament(tournament) {
    const shouldDelete = window.confirm(
      "Delete this tournament? This will permanently remove its rounds, matches, standings, and tournament history. Player profiles from other tournaments will be kept.",
    );

    if (!shouldDelete) {
      return;
    }

    try {
      setDeletingTournamentId(tournament.id);
      setError("");
      await api.delete(`/tournaments/${tournament.id}`);
      setTournaments((currentTournaments) => currentTournaments.filter((currentTournament) => currentTournament.id !== tournament.id));
      setShareTournament((currentShareTournament) => (currentShareTournament?.id === tournament.id ? null : currentShareTournament));
      setCopyMessage("");
    } catch {
      setError("Could not delete tournament.");
    } finally {
      setDeletingTournamentId(null);
    }
  }

  function getPublicUrl(tournamentId) {
    return `${window.location.origin}/t/${tournamentId}`;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Admin</p>
          <h1 className="mt-2 text-3xl font-semibold text-gray-950">Tournaments</h1>
        </div>
        <Link
          className="self-start rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:self-auto"
          to="/admin/players"
        >
          Community Players
        </Link>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-950">Create tournament</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Name
            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setName(event.target.value)}
              placeholder="Local tournament"
              type="text"
              value={name}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Location
            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Store name"
              type="text"
              value={location}
            />
          </label>

          <button
            className="self-end rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </form>
        {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-950">Tournament list</h2>
          <button className="text-sm font-medium text-blue-700 hover:text-blue-900" onClick={fetchTournaments} type="button">
            Refresh
          </button>
        </div>

        {isLoading ? <p className="mt-4 text-gray-700">Loading tournaments...</p> : null}

        {!isLoading && tournaments.length === 0 ? (
          <p className="mt-4 text-gray-700">No tournaments created yet.</p>
        ) : null}

        {tournaments.length > 0 ? (
          <ul className="mt-4 divide-y divide-gray-200">
            {tournaments.map((tournament) => (
              <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" key={tournament.id}>
                <div>
                  <p className="font-medium text-gray-950">{tournament.name}</p>
                  <p className="mt-1 text-sm text-gray-600">{tournament.location || "No location"}</p>
                </div>
                <div className="flex gap-2">
                  <Link
                    className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
                    to={`/admin/tournaments/${tournament.id}`}
                  >
                    Open
                  </Link>
                  <button
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setCopyMessage("");
                      setShareTournament(tournament);
                    }}
                    type="button"
                  >
                    Share
                  </button>
                  <button
                    className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={deletingTournamentId === tournament.id}
                    onClick={() => handleDeleteTournament(tournament)}
                    type="button"
                  >
                    {deletingTournamentId === tournament.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {shareTournament ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Share tournament</p>
                <h2 className="mt-1 text-xl font-semibold text-gray-950">{shareTournament.name}</h2>
              </div>
              <button
                className="rounded-md border border-gray-300 px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setShareTournament(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-5 flex justify-center">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <QRCodeSVG value={getPublicUrl(shareTournament.id)} size={180} />
              </div>
            </div>

            <p className="mt-4 break-all rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {getPublicUrl(shareTournament.id)}
            </p>

            <button
              className="mt-4 w-full rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
              onClick={() => handleCopyLink(getPublicUrl(shareTournament.id))}
              type="button"
            >
              Copy link
            </button>
            {copyMessage ? <p className="mt-3 text-center text-sm font-medium text-gray-600">{copyMessage}</p> : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
