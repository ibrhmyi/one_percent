'use client';

import { useState, useEffect, useCallback } from 'react';
import { TopBar } from '@/components/terminal/top-bar';
import { BottomBar } from '@/components/terminal/bottom-bar';
import { ScoreFeed } from '@/components/terminal/score-feed';
import { GameSchedule } from '@/components/terminal/game-schedule';
import { MarketsTable } from '@/components/terminal/markets-table';
import { TradesPanel } from '@/components/terminal/trades-panel';
import { AccountPanel } from '@/components/terminal/account-panel';
import { SkillsPanel } from '@/components/terminal/skills-panel';
import { OddsRanker } from '@/components/terminal/odds-ranker';
import { PositionsPanel } from '@/components/terminal/positions-panel';

const DEFAULT_STATE = {
  isRunning: false,
  lastCycleAt: null as string | null,
  wsConnected: false,
  account: { bankroll: 400, pnlToday: 0, pnlTotal: 0, openPositions: 0, mode: 'dry_run' as const, polymarketId: '0x...' },
  watchedMarkets: [] as any[],
  trades: [] as any[],
  messages: [] as any[],
  skills: [] as any[],
  cycleLogs: [] as any[],
  cycleCount: 0,
  uptimeSeconds: 0,
  liveGames: 0,
  totalGames: 0,
  scoringEvents: [] as any[],
  gameSchedule: [] as any[],
  latestMessage: null as any,
  preGameWatchlist: [] as any[],
  preGameOrders: [] as any[],
  preGameSummary: null as any,
};

export default function Home() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setLoaded(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 2000);
    return () => clearInterval(id);
  }, [fetchState]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
      paddingBottom: '32px',
      fontFamily: 'var(--font-mono)',
    }}>
      <TopBar latestMessage={state.latestMessage} />

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.3)',
          padding: '4px 16px', fontSize: '0.7rem', color: 'var(--red)',
        }}>
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {!loaded && !error && (
        <div style={{
          display: 'grid', gridTemplateColumns: '260px 1fr 280px',
          gap: 8, padding: 8,
        }}>
          {[0, 1, 2].map(col => (
            <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[120, 200, 160].map((h, i) => (
                <div key={i} className="panel" style={{
                  height: h, background: 'var(--bg-card)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Main 3-column grid */}
      <div style={{
        flex: 1,
        display: loaded ? 'grid' : 'none',
        gridTemplateColumns: '260px 1fr 280px',
        gap: 8,
        padding: 8,
        minHeight: 0,
        alignItems: 'start',
      }}>
        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ScoreFeed events={state.scoringEvents} />
          <GameSchedule games={state.gameSchedule} />
          <OddsRanker watchlist={state.preGameWatchlist} summary={state.preGameSummary} />
        </div>

        {/* CENTER COLUMN — Markets + Positions + Trades */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <MarketsTable markets={state.watchedMarkets} />
          <PositionsPanel orders={state.preGameOrders} summary={state.preGameSummary} />
          <TradesPanel trades={state.trades} mode={state.account.mode} />
        </div>

        {/* RIGHT COLUMN — Account + Skills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AccountPanel
            account={state.account}
            trades={state.trades}
            preGameOrderCount={state.preGameOrders?.length ?? 0}
            skillStats={state.skills?.map((s: any) => s.stats) ?? []}
          />
          <SkillsPanel skills={state.skills} />
        </div>
      </div>

      <BottomBar
        wsConnected={state.wsConnected}
        isRunning={state.isRunning}
        cycleCount={state.cycleCount}
        uptimeSeconds={state.uptimeSeconds}
        liveGames={state.liveGames}
        totalGames={state.totalGames}
        lastCycleAt={state.lastCycleAt}
      />
    </div>
  );
}
