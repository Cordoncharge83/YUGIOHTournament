import { useEffect, useState } from "react";
import { Play, RotateCcw, Settings } from "lucide-react";

import { Button } from "./ui/button";

function isTauriApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function truncatePath(path) {
  if (!path) {
    return "Not configured";
  }

  if (path.length <= 64) {
    return path;
  }

  return `${path.slice(0, 24)}...${path.slice(-34)}`;
}

async function chooseKtsExecutable() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selectedFile = await open({
    directory: false,
    multiple: false,
    title: "Choose KTS Executable",
    filters: [
      {
        name: "Windows executable",
        extensions: ["exe"],
      },
    ],
  });

  return Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;
}

export default function KtsLauncher({ variant = "header" }) {
  const [ktsPath, setKtsPath] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isDesktopRuntime = isTauriApp();
  const isSettingsVariant = variant === "settings";

  useEffect(() => {
    if (!isDesktopRuntime) {
      setIsLoading(false);
      return;
    }

    loadKtsPath();
  }, [isDesktopRuntime]);

  async function invokeCommand(command, args) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  }

  async function loadKtsPath() {
    try {
      setIsLoading(true);
      const savedPath = await invokeCommand("get_kts_executable_path");
      setKtsPath(savedPath || "");
    } catch (loadError) {
      setError(String(loadError || "Could not load KTS settings."));
    } finally {
      setIsLoading(false);
    }
  }

  async function saveKtsPath(path) {
    const savedPath = await invokeCommand("set_kts_executable_path", { path });
    setKtsPath(savedPath || "");
    return savedPath;
  }

  async function launchKts(path) {
    await invokeCommand("launch_kts", { path });
  }

  async function handleLaunch() {
    if (!isDesktopRuntime) {
      return;
    }

    try {
      setIsBusy(true);
      setMessage("");
      setError("");
      let executablePath = ktsPath;

      if (!executablePath) {
        const selectedPath = await chooseKtsExecutable();
        if (!selectedPath) {
          return;
        }

        executablePath = await saveKtsPath(selectedPath);
      }

      await launchKts(executablePath);
      setMessage("KTS launched.");
    } catch (launchError) {
      setError(String(launchError || "Could not launch KTS."));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleChangePath() {
    if (!isDesktopRuntime) {
      return;
    }

    try {
      setIsBusy(true);
      setMessage("");
      setError("");
      const selectedPath = await chooseKtsExecutable();
      if (!selectedPath) {
        return;
      }

      const savedPath = await saveKtsPath(selectedPath);
      setMessage(`KTS path saved: ${truncatePath(savedPath)}`);
    } catch (changeError) {
      setError(String(changeError || "Could not save KTS path."));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClearPath() {
    if (!isDesktopRuntime) {
      return;
    }

    try {
      setIsBusy(true);
      setMessage("");
      setError("");
      await invokeCommand("clear_kts_executable_path");
      setKtsPath("");
      setMessage("KTS path cleared.");
    } catch (clearError) {
      setError(String(clearError || "Could not clear KTS path."));
    } finally {
      setIsBusy(false);
    }
  }

  if (!isDesktopRuntime) {
    return null;
  }

  if (!isSettingsVariant) {
    return (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button disabled={isBusy || isLoading} onClick={handleLaunch} size="sm" type="button">
          <Play className="h-4 w-4" />
          {ktsPath ? "Launch KTS" : "Set up KTS"}
        </Button>
        {message ? <p className="text-xs font-medium text-emerald-300">{message}</p> : null}
        {error ? <p className="max-w-72 text-xs font-medium text-rose-300">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
        <p className="font-semibold text-slate-50">Current KTS executable</p>
        <p className="mt-1 break-all text-slate-400">{truncatePath(ktsPath)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={isBusy || isLoading} onClick={handleLaunch} type="button">
          <Play className="h-4 w-4" />
          {ktsPath ? "Launch KTS" : "Set up KTS"}
        </Button>
        <Button disabled={isBusy || isLoading} onClick={handleChangePath} type="button" variant="outline">
          <Settings className="h-4 w-4" />
          Change KTS Executable
        </Button>
        <Button disabled={isBusy || isLoading || !ktsPath} onClick={handleClearPath} type="button" variant="outline">
          <RotateCcw className="h-4 w-4" />
          Clear KTS Path
        </Button>
      </div>

      {message ? <p className="text-sm font-medium text-emerald-300">{message}</p> : null}
      {error ? <p className="text-sm font-medium text-rose-300">{error}</p> : null}
    </div>
  );
}
