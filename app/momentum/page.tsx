import { MomentumDashboard } from "@/components/momentum-dashboard";

export const dynamic = "force-dynamic";

export default function MomentumPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Title */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-zinc-100">
              Momentum Bot
            </h1>
            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
              DRY RUN
            </span>
          </div>
          <p className="text-sm text-zinc-500">
            Polymarket order-book velocity signals → Kalshi execution.
            Signals fire when YES price moves faster than 4¢/sec on a 4s window.
          </p>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {[
            { label: "Velocity threshold", value: "4¢/sec" },
            { label: "Window", value: "4 s" },
            { label: "Cooldown", value: "30 s" },
            { label: "Position size", value: "$25" },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="mt-1 font-mono text-sm font-semibold text-zinc-200">
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Live feed */}
        <MomentumDashboard />
      </div>
    </main>
  );
}
