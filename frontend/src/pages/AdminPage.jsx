import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, Download, MapPin, Plus, RefreshCw, Share2, Trash2, Upload } from "lucide-react";

import api, { getApiErrorMessage } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";

function isTauriApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function backupFileName(tournament) {
  const safeName = (tournament.name || "tournament")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "tournament";
  return `${safeName}.ygotournament.json`;
}

function getBackupErrorMessage(error, fallbackMessage) {
  if (error?.response) {
    return getApiErrorMessage(error, fallbackMessage);
  }

  return error?.message || fallbackMessage;
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingTournamentId, setDeletingTournamentId] = useState(null);
  const [updatingStatsTournamentId, setUpdatingStatsTournamentId] = useState(null);
  const [exportingTournamentId, setExportingTournamentId] = useState(null);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [error, setError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const [shareTournament, setShareTournament] = useState(null);
  const [copyMessage, setCopyMessage] = useState("");
  const backupFileInputRef = useRef(null);

  async function fetchTournaments() {
    try {
      setError("");
      const response = await api.get("/tournaments");
      setTournaments(response.data);
    } catch (error) {
      setError(getApiErrorMessage(error, "Could not load tournaments."));
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
    } catch (error) {
      setError(getApiErrorMessage(error, "Could not create tournament."));
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
    } catch (error) {
      setError(getApiErrorMessage(error, "Could not delete tournament."));
    } finally {
      setDeletingTournamentId(null);
    }
  }

  async function invokeTauriCommand(command, args) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  }

  async function saveBackupWithTauri(tournament, contents) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: backupFileName(tournament),
      title: "Export Tournament Backup",
      filters: [
        {
          name: "Yu-Gi-Oh Tournament Backup",
          extensions: ["json"],
        },
      ],
    });

    if (!path) {
      return false;
    }

    await invokeTauriCommand("write_tournament_backup_file", { path, contents });
    return true;
  }

  function saveBackupWithBrowser(tournament, contents) {
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFileName(tournament);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExportTournament(tournament) {
    try {
      setExportingTournamentId(tournament.id);
      setBackupError("");
      setBackupMessage("");
      const response = await api.get(`/tournaments/${tournament.id}/export`);
      const contents = `${JSON.stringify(response.data, null, 2)}\n`;

      if (isTauriApp()) {
        const saved = await saveBackupWithTauri(tournament, contents);
        if (!saved) {
          return;
        }
      } else {
        saveBackupWithBrowser(tournament, contents);
      }

      setBackupMessage(`Exported ${tournament.name}.`);
    } catch (error) {
      setBackupError(getBackupErrorMessage(error, "Could not export tournament backup."));
    } finally {
      setExportingTournamentId(null);
    }
  }

  async function importBackupContents(contents) {
    let backup;
    try {
      backup = JSON.parse(contents);
    } catch {
      throw new Error("Backup file must be valid JSON.");
    }

    const response = await api.post("/tournaments/import", backup);
    setTournaments((currentTournaments) => [response.data, ...currentTournaments]);
    setBackupMessage(`Imported ${response.data.name}.`);
    navigate(`/admin/tournaments/${response.data.id}`);
  }

  async function handleImportBackupFromTauri() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selectedFile = await open({
      directory: false,
      multiple: false,
      title: "Import Tournament Backup",
      filters: [
        {
          name: "Yu-Gi-Oh Tournament Backup",
          extensions: ["json"],
        },
      ],
    });
    const path = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;
    if (!path) {
      return;
    }

    const contents = await invokeTauriCommand("read_tournament_backup_file", { path });
    await importBackupContents(contents);
  }

  async function handleImportBackupClick() {
    try {
      setIsImportingBackup(true);
      setBackupError("");
      setBackupMessage("");

      if (isTauriApp()) {
        await handleImportBackupFromTauri();
        return;
      }

      backupFileInputRef.current?.click();
    } catch (error) {
      setBackupError(getBackupErrorMessage(error, "Could not import tournament backup."));
    } finally {
      setIsImportingBackup(false);
    }
  }

  async function handleImportBackupFile(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      setIsImportingBackup(true);
      setBackupError("");
      setBackupMessage("");
      await importBackupContents(await file.text());
    } catch (error) {
      setBackupError(getBackupErrorMessage(error, "Could not import tournament backup."));
    } finally {
      setIsImportingBackup(false);
    }
  }

  async function handleToggleCommunityStats(tournament) {
    const shouldCount = tournament.counts_toward_community_stats === false;

    try {
      setUpdatingStatsTournamentId(tournament.id);
      setError("");
      const response = await api.patch(`/tournaments/${tournament.id}/community-stats`, {
        counts_toward_community_stats: shouldCount,
      });
      setTournaments((currentTournaments) => (
        currentTournaments.map((currentTournament) => (
          currentTournament.id === tournament.id ? response.data : currentTournament
        ))
      ));
      setShareTournament((currentShareTournament) => (
        currentShareTournament?.id === tournament.id ? response.data : currentShareTournament
      ));
    } catch (error) {
      setError(getApiErrorMessage(error, "Could not update community statistics setting."));
    } finally {
      setUpdatingStatsTournamentId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-sky-300">Admin Console</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-50">Tournaments</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Create, manage, and share local Yu-Gi-Oh tournament events.
          </p>
        </div>
      </header>

      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardHeader>
          <CardTitle>Create tournament</CardTitle>
          <CardDescription>Start a new local event. KTS setup can be connected from the tournament detail page.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-300">
              Name
              <Input
                onChange={(event) => setName(event.target.value)}
                placeholder="Local tournament"
                type="text"
                value={name}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium text-slate-300">
              Location
              <Input
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Store name"
                type="text"
                value={location}
              />
            </label>

            <Button className="self-end" disabled={isCreating} type="submit">
              <Plus className="h-4 w-4" />
              {isCreating ? "Creating..." : "Create"}
            </Button>
          </form>
          {error ? <p className="mt-4 text-sm font-medium text-rose-300">{error}</p> : null}
        </CardContent>
      </Card>

      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Tournament dashboard</CardTitle>
            <CardDescription>{tournaments.length} saved tournament{tournaments.length === 1 ? "" : "s"}</CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={isImportingBackup} onClick={handleImportBackupClick} size="sm" type="button" variant="outline">
              <Upload className="h-4 w-4" />
              {isImportingBackup ? "Importing..." : "Import backup"}
            </Button>
            <Button onClick={fetchTournaments} size="sm" type="button" variant="ghost">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <input
            accept=".json,.ygotournament.json,.tournament-backup.json,application/json"
            className="hidden"
            onChange={handleImportBackupFile}
            ref={backupFileInputRef}
            type="file"
          />
          {backupError ? <p className="mb-4 text-sm font-medium text-rose-300">{backupError}</p> : null}
          {backupMessage ? <p className="mb-4 text-sm font-medium text-emerald-300">{backupMessage}</p> : null}
          {isLoading ? <p className="text-sm text-slate-400">Loading tournaments...</p> : null}

          {!isLoading && tournaments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-400">
              No tournaments created yet.
            </div>
          ) : null}

          {tournaments.length > 0 ? (
            <div className="grid gap-3">
              {tournaments.map((tournament) => (
                <Card className="border-slate-700/60 bg-slate-900/55 transition-colors hover:border-sky-400/40" key={tournament.id}>
                  <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-slate-50">{tournament.name}</h3>
                        {tournament.counts_toward_community_stats === false ? (
                          <Badge className="border-amber-400/35 bg-amber-400/10 text-amber-200">
                            Stats excluded
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-slate-500" />
                          {tournament.location || "No location"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5 text-slate-500" />
                          {new Date(tournament.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link to={`/admin/tournaments/${tournament.id}`}>Open</Link>
                      </Button>
                      <Button
                        className={tournament.counts_toward_community_stats === false ? "border-amber-400/45 text-amber-100 hover:bg-amber-400/10" : ""}
                        disabled={updatingStatsTournamentId === tournament.id}
                        onClick={() => handleToggleCommunityStats(tournament)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {updatingStatsTournamentId === tournament.id
                          ? "Saving..."
                          : tournament.counts_toward_community_stats === false
                            ? "Stats excluded"
                            : "Stats included"}
                      </Button>
                      <Button
                        onClick={() => {
                          setCopyMessage("");
                          setShareTournament(tournament);
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Share2 className="h-4 w-4" />
                        Share
                      </Button>
                      <Button
                        disabled={exportingTournamentId === tournament.id}
                        onClick={() => handleExportTournament(tournament)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download className="h-4 w-4" />
                        {exportingTournamentId === tournament.id ? "Exporting..." : "Export"}
                      </Button>
                      <Button
                        disabled={deletingTournamentId === tournament.id}
                        onClick={() => handleDeleteTournament(tournament)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingTournamentId === tournament.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShareTournament(null);
          }
        }}
        open={Boolean(shareTournament)}
      >
        <DialogContent>
          {shareTournament ? (
            <>
              <DialogHeader>
                <DialogDescription>Share tournament</DialogDescription>
                <DialogTitle>{shareTournament.name}</DialogTitle>
              </DialogHeader>

              <div className="flex justify-center">
                {shareTournament.public_url ? (
                  <div className="rounded-lg border border-slate-700 bg-white p-3">
                    <QRCodeSVG value={shareTournament.public_url} size={180} />
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-100">
                    Publish this tournament first to generate a public link.
                  </div>
                )}
              </div>

              {shareTournament.public_url ? (
                <>
                  <p className="break-all rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                    {shareTournament.public_url}
                  </p>

                  <Button className="w-full" onClick={() => handleCopyLink(shareTournament.public_url)} type="button">
                    Copy link
                  </Button>
                </>
              ) : null}
              {copyMessage ? <p className="text-center text-sm font-medium text-slate-400">{copyMessage}</p> : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
