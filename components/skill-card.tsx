'use client';

import type { SkillInfo } from '@/lib/types';

interface Props {
  skill: SkillInfo;
}

const STATUS_CONFIG = {
  active: {
    label: 'Active',
    textClass: 'text-emerald-400',
    dotClass: 'bg-emerald-400 animate-pulse',
    glowClass: 'shadow-[0_0_30px_rgba(52,211,153,0.08)]',
    borderTopClass: 'from-emerald-500/40 via-emerald-500/10 to-transparent',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/25',
  },
  idle: {
    label: 'Idle',
    textClass: 'text-slate-500',
    dotClass: 'bg-slate-600',
    glowClass: '',
    borderTopClass: 'from-white/10 via-white/[0.04] to-transparent',
    badgeBg: 'bg-white/[0.05] border-white/10',
  },
  error: {
    label: 'Error',
    textClass: 'text-rose-400',
    dotClass: 'bg-rose-400',
    glowClass: 'shadow-[0_0_30px_rgba(248,113,113,0.08)]',
    borderTopClass: 'from-rose-500/40 via-rose-500/10 to-transparent',
    badgeBg: 'bg-rose-500/10 border-rose-500/25',
  },
};

export function SkillCard({ skill }: Props) {
  const s = STATUS_CONFIG[skill.status];
  const winRate = skill.stats.trades > 0
    ? `${((skill.stats.wins / skill.stats.trades) * 100).toFixed(0)}%`
    : '—';
  const pnlPositive = skill.stats.totalPnl >= 0;
  const pnlStr = `${pnlPositive ? '+' : ''}$${Math.abs(skill.stats.totalPnl).toFixed(2)}`;
  const pollLabel = skill.pollIntervalMs >= 1000
    ? `${skill.pollIntervalMs / 1000}s`
    : `${skill.pollIntervalMs}ms`;

  return (
    <div className={`relative rounded-2xl overflow-hidden card-border ${s.glowClass} transition-shadow`}>
      {/* Gradient top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${s.borderTopClass}`} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {/* Icon bubble */}
            <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-lg flex-shrink-0">
              {skill.icon}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white leading-tight">{skill.name}</h3>
              <div className="text-[10px] font-mono text-slate-600 mt-0.5 uppercase tracking-wider">
                {skill.category} · {pollLabel} poll
              </div>
            </div>
          </div>

          {/* Status badge */}
          <span className={`flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 ${s.badgeBg}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dotClass}`} />
            <span className={s.textClass}>{s.label}</span>
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-500 leading-relaxed mb-4">{skill.description}</p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <StatCell
            label="TRADES"
            value={String(skill.stats.trades)}
          />
          <StatCell
            label="WIN RATE"
            value={winRate}
            valueClass={skill.stats.trades > 0 ? 'text-cyan-400' : 'text-slate-400'}
          />
          <StatCell
            label="PNL"
            value={pnlStr}
            valueClass={pnlPositive ? 'text-emerald-400' : 'text-rose-400'}
          />
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  valueClass = 'text-slate-200',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-white/[0.025] border border-white/[0.05] rounded-xl px-3 py-2.5">
      <div className="text-[9px] font-mono text-slate-600 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-mono font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
