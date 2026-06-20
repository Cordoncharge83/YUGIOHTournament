import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, PlugZap, Save } from "lucide-react";

import api, { getApiErrorMessage } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

export default function PublishingSettingsPage() {
  const [serviceUrl, setServiceUrl] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [publishKey, setPublishKey] = useState("");
  const [publishKeyConfigured, setPublishKeyConfigured] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function fetchSettings() {
    try {
      setError("");
      const response = await api.get("/settings/publishing");
      applySettings(response.data);
    } catch (fetchError) {
      setError(getApiErrorMessage(fetchError, "Could not load publishing settings."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchSettings();
  }, []);

  function applySettings(settings) {
    setServiceUrl(settings.service_url || "");
    setSiteUrl(settings.site_url || "");
    setPublishKey("");
    setPublishKeyConfigured(Boolean(settings.publish_key_configured));
    setIsConfigured(Boolean(settings.configured));
  }

  async function handleSave(event) {
    event.preventDefault();

    try {
      setIsSaving(true);
      setError("");
      setMessage("");
      const response = await api.put("/settings/publishing", {
        service_url: serviceUrl,
        site_url: siteUrl,
        publish_key: publishKey || null,
      });
      applySettings(response.data);
      setMessage("Publishing settings saved.");
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "Could not save publishing settings."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setIsTesting(true);
      setError("");
      setMessage("");
      const response = await api.post("/settings/publishing/test");
      setMessage(response.data?.message || "Publishing API is reachable.");
    } catch (testError) {
      setError(getApiErrorMessage(testError, "Could not test publishing settings."));
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-sky-300">Settings</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-50">Publishing Settings</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Configure the hosted public page connection used when tournaments are published.
          </p>
        </div>
        <Button asChild className="self-start sm:self-auto" variant="outline">
          <Link to="/admin">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </header>

      <Card className="border-slate-700/70 bg-slate-950/85">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Hosted Publishing</CardTitle>
              <CardDescription>These values are stored locally on this computer.</CardDescription>
            </div>
            <Badge variant={isConfigured ? "default" : "secondary"}>
              {isConfigured ? "Configured" : "Missing key"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-slate-400">Loading settings...</p> : null}

          {!isLoading ? (
            <form className="grid gap-4" onSubmit={handleSave}>
              <label className="flex flex-col gap-2 text-sm font-medium text-slate-300">
                Publishing API URL
                <Input
                  onChange={(event) => setServiceUrl(event.target.value)}
                  placeholder="https://your-worker.workers.dev"
                  type="url"
                  value={serviceUrl}
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-slate-300">
                Public Page URL
                <Input
                  onChange={(event) => setSiteUrl(event.target.value)}
                  placeholder="https://your-public-site.pages.dev"
                  type="url"
                  value={siteUrl}
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-slate-300">
                Publish Key
                <Input
                  autoComplete="new-password"
                  onChange={(event) => setPublishKey(event.target.value)}
                  placeholder={publishKeyConfigured ? "Publish key configured" : "Enter organizer publish key"}
                  type="password"
                  value={publishKey}
                />
              </label>

              <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                {publishKeyConfigured ? (
                  <span className="inline-flex items-center gap-2 text-emerald-200">
                    <CheckCircle2 className="h-4 w-4" />
                    Publish key configured
                  </span>
                ) : (
                  "Publish key is not configured."
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button disabled={isSaving} type="submit">
                  <Save className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save Settings"}
                </Button>
                <Button disabled={isTesting || !serviceUrl} onClick={handleTestConnection} type="button" variant="outline">
                  <PlugZap className="h-4 w-4" />
                  {isTesting ? "Testing..." : "Test Connection"}
                </Button>
              </div>
            </form>
          ) : null}

          {message ? <p className="mt-4 text-sm font-medium text-emerald-300">{message}</p> : null}
          {error ? <p className="mt-4 text-sm font-medium text-rose-300">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
