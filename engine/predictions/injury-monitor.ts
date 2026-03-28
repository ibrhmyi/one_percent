/**
 * NBA/NCAAB Injury Monitor
 *
 * Polls ESPN's free injury API every 2 minutes.
 * When a player's status changes (especially star players going OUT),
 * triggers an immediate edge recalculation.
 *
 * This is one of the highest-edge free data sources because:
 * 1. Injury news moves lines 5-15% for star players
 * 2. Polymarket reacts slowly (casual traders take 5-30 min to adjust)
 * 3. We detect it within 2 minutes via ESPN, before most Polymarket traders
 */

import { addMessage } from '../state';

const ESPN_INJURIES_NBA = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
const ESPN_INJURIES_NCAAB = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/injuries';

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// Track previous injury statuses to detect changes
const previousStatuses: Map<string, string> = new Map(); // playerId -> status
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPollAt = 0;

// Players whose injury status significantly impacts game odds
// (stars, key starters — their absence swings lines 5%+)
const HIGH_IMPACT_KEYWORDS = [
  // General impact indicators
  'out', 'doubtful',
];

export interface InjuryUpdate {
  playerId: string;
  playerName: string;
  team: string;
  previousStatus: string;
  newStatus: string;
  league: string;
  timestamp: string;
  isSignificant: boolean; // true if player went to OUT or DOUBTFUL
}

interface ESPNInjuryResponse {
  items?: Array<{
    team?: { displayName?: string; abbreviation?: string };
    injuries?: Array<{
      athlete?: { id?: string; displayName?: string };
      status?: string;
      type?: { text?: string };
      details?: { type?: string; detail?: string };
    }>;
  }>;
}

async function fetchInjuries(url: string, league: string): Promise<InjuryUpdate[]> {
  const updates: InjuryUpdate[] = [];

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      console.error(`[InjuryMonitor] ${league} HTTP ${res.status}`);
      return updates;
    }

    const data: ESPNInjuryResponse = await res.json();

    for (const teamEntry of data.items ?? []) {
      const teamName = teamEntry.team?.displayName ?? 'Unknown';

      for (const injury of teamEntry.injuries ?? []) {
        const playerId = injury.athlete?.id ?? '';
        const playerName = injury.athlete?.displayName ?? 'Unknown';
        const status = (injury.status ?? injury.type?.text ?? 'unknown').toLowerCase();

        if (!playerId) continue;

        const prevStatus = previousStatuses.get(playerId);

        if (prevStatus !== undefined && prevStatus !== status) {
          // Status changed!
          const isSignificant =
            (status === 'out' || status === 'doubtful') &&
            (prevStatus !== 'out' && prevStatus !== 'doubtful');

          const update: InjuryUpdate = {
            playerId,
            playerName,
            team: teamName,
            previousStatus: prevStatus,
            newStatus: status,
            league,
            timestamp: new Date().toISOString(),
            isSignificant,
          };

          updates.push(update);
        }

        previousStatuses.set(playerId, status);
      }
    }
  } catch (err) {
    console.error(`[InjuryMonitor] ${league} error:`, err instanceof Error ? err.message : err);
  }

  return updates;
}

// Callbacks for when injuries are detected
type InjuryCallback = (updates: InjuryUpdate[]) => void;
const callbacks: InjuryCallback[] = [];

export function onInjuryUpdate(cb: InjuryCallback): void {
  callbacks.push(cb);
}

async function pollOnce(): Promise<void> {
  lastPollAt = Date.now();

  const [nbaUpdates, ncaabUpdates] = await Promise.all([
    fetchInjuries(ESPN_INJURIES_NBA, 'NBA'),
    fetchInjuries(ESPN_INJURIES_NCAAB, 'NCAAB'),
  ]);

  const allUpdates = [...nbaUpdates, ...ncaabUpdates];

  if (allUpdates.length > 0) {
    const significant = allUpdates.filter(u => u.isSignificant);

    for (const update of significant) {
      addMessage({
        text: `🚨 INJURY: ${update.playerName} (${update.team}) → ${update.newStatus.toUpperCase()} (was ${update.previousStatus}) [${update.league}]`,
        type: 'warning',
      });
    }

    if (allUpdates.length > 0) {
      console.log(`[InjuryMonitor] ${allUpdates.length} status changes (${significant.length} significant)`);
    }

    // Notify subscribers
    for (const cb of callbacks) {
      try {
        cb(allUpdates);
      } catch (err) {
        console.error('[InjuryMonitor] Callback error:', err);
      }
    }
  }
}

export function startInjuryMonitor(): void {
  if (pollTimer) return;

  console.log('[InjuryMonitor] Starting — polling every 2 minutes');

  // First poll populates the baseline (no alerts on first run)
  pollOnce();

  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

export function stopInjuryMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getInjuryMonitorStatus(): {
  isRunning: boolean;
  lastPollAt: number;
  trackedPlayers: number;
} {
  return {
    isRunning: pollTimer !== null,
    lastPollAt,
    trackedPlayers: previousStatuses.size,
  };
}
