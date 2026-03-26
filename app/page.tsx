'use client';

import { useState, useEffect, useCallback } from 'react';
import { TopBar } from '@/components/terminal/top-bar';
import { BottomBar } from '@/components/terminal/bottom-bar';
import { ScoreFeed } from '@/components/terminal/score-feed';
import { GameSchedule } from '@/components/terminal/game-schedule';
import { MarketsTable } from '@/components/terminal/markets-table';
import { BrainLog } from '@/components/terminal/brain-log';
import { TradesPanel } from '@/components/terminal/trades-panel';
import { AccountPanel } from '@/components/terminal/account-panel';
import { SkillsPanel } from '@/components/terminal/skills-panel';

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
};

export default function Home() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 500);
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
      <TopBar
        scoringEvents={state.scoringEvents}
        cycleCount={state.cycleCount}
        liveGames={state.liveGames}
        isRunning={state.isRunning}
        wsConnected={state.wsConnected}
      />

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.3)',
          padding: '4px 16px', fontSize: '0.7rem', color: 'var(--red)',
        }}>
          {error}
        </div>
      )}

      {/* Main 3-column grid */}
      <div style={{
        flex: 1,
        display: 'grid',
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
        </div>

        {/* CENTER COLUMN — Markets + Trades */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <MarketsTable markets={state.watchedMarkets} />
          <TradesPanel trades={state.trades} mode={state.account.mode} />
        </div>

        {/* RIGHT COLUMN — Account + Skills + Log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AccountPanel account={state.account} trades={state.trades} />
          <SkillsPanel skills={state.skills} />
          <BrainLog messages={state.messages} />
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
