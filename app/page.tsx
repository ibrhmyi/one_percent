'use client';

import { useState, useEffect, useCallback } from 'react';
import type { BrainMessage, WatchedMarket, Trade, SkillInfo, AccountState } from '@/lib/types';
import { AIChatBar } from '@/components/ai-chat-bar';
import { AccountPanel } from '@/components/account-panel';
import { WatchedMarkets } from '@/components/watched-markets';
import { WatchingPanel } from '@/components/watching-panel';
import { SkillsPanel } from '@/components/skills-panel';
import { TradesPanel } from '@/components/trades-panel';

type Tab = 'watching' | 'markets' | 'skills' | 'trades';

interface BrainState {
  messages: BrainMessage[];
  watchedMarkets: WatchedMarket[];
  trades: Trade[];
  skills: SkillInfo[];
  account: AccountState;
  isRunning: boolean;
  lastCycleAt: string | null;
  focusedMarketId: string | null;
}

const DEFAULT_STATE: BrainState = {
  messages: [],
  watchedMarkets: [],
  trades: [],
  skills: [],
  account: { bankroll: 400, pnlToday: 0, pnlTotal: 0, openPositions: 0, mode: 'dry_run', polymarketId: '0x...' },
  isRunning: false,
  lastCycleAt: null,
  focusedMarketId: null,
};

export default function Home() {
  const [tab, setTab] = useState<Tab>('watching');
  const [state, setState] = useState<BrainState>(DEFAULT_STATE);
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
    const id = setInterval(fetchState, 2_000);
    return () => clearInterval(id);
  }, [fetchState]);

  const TABS: { id: Tab; label: string; count?: number; accent?: boolean }[] = [
    { id: 'watching', label: 'Watching', accent: true },
    { id: 'markets',  label: 'Markets',  count: state.watchedMarkets.length },
    { id: 'skills',   label: 'Skills',   count: state.skills.length },
    { id: 'trades',   label: 'Trades',   count: state.trades.length },
  ];

  return (
    <div className="min-h-screen bg-[#060816] text-white">
      {/* ── Top bar ── */}
      <div className="border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto">
          {/* Logo */}
          <div className="flex items-baseline gap-1.5 mb-5">
            <span
              className="text-2xl font-bold tracking-[0.18em] uppercase select-none"
              style={{
                background: 'linear-gradient(120deg, #f1f5f9 0%, #67e8f9 55%, #818cf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                textShadow: 'none',
                filter: 'drop-shadow(0 0 18px rgba(103,232,249,0.22))',
              }}
            >
              onepercent
            </span>
            <span className="text-[11px] font-mono text-slate-600 tracking-widest">.markets</span>
          </div>

          <div className="flex gap-3">
            <div className="flex-[2] min-h-[88px]">
              <AIChatBar messages={state.messages} isRunning={state.isRunning} />
            </div>
            <div className="flex-1 min-w-[210px]">
              <AccountPanel account={state.account} />
            </div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/8 border-b border-red-500/15 px-6 py-2">
          <p className="text-red-400 text-xs font-mono max-w-5xl mx-auto">{error}</p>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="border-b border-white/[0.06] px-6">
        <div className="max-w-5xl mx-auto flex gap-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-mono transition-colors relative ${
                tab === t.id
                  ? t.accent ? 'text-cyan-400' : 'text-white'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="text-[10px] bg-white/[0.08] px-1.5 py-0.5 rounded-full tabular-nums">
                    {t.count}
                  </span>
                )}
                {t.id === 'watching' && state.focusedMarketId && (
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                )}
              </span>
              {tab === t.id && (
                <div className={`absolute bottom-0 left-0 right-0 h-px ${t.accent ? 'bg-cyan-400' : 'bg-white/30'}`} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="max-w-5xl mx-auto px-6 py-5">
        {tab === 'watching' && (
          <WatchingPanel markets={state.watchedMarkets} focusedMarketId={state.focusedMarketId} />
        )}
        {tab === 'markets' && <WatchedMarkets markets={state.watchedMarkets} />}
        {tab === 'skills'  && <SkillsPanel skills={state.skills} />}
        {tab === 'trades'  && <TradesPanel trades={state.trades} />}
      </main>
    </div>
  );
}
