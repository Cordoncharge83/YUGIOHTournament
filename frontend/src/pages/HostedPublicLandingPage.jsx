import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

export default function HostedPublicLandingPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-8">
      <Card className="w-full border-slate-700/70 bg-slate-950/85">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Yu-Gi-Oh Tournament Manager</p>
          <CardTitle className="mt-2 text-3xl">Public tournament viewer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-slate-300">
            Open a tournament link from your organizer to view current pairings and standings.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
