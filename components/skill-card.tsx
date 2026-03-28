'use client';

import { useState } from 'react';
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
  paused: {
    label: 'Paused',
    textClass: 'text-slate-500',
    dotClass: 'bg-slate-600',
    glowClass: '',
    borderTopClass: 'from-white/10 via-white/[0.04] to-transparent',
    badgeBg: 'bg-white/[0.05] border-white/10',
  },
};

/** Minimal markdown-to-JSX renderer for skill descriptions */
function renderMarkdown(md: string) {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="text-xs font-semibold text-white mt-3 mb-1.5 uppercase tracking-wider">
          {trimmed.slice(3)}
        </h3>
      );
    } else if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={i} className="text-[11px] font-semibold text-slate-300 mt-2.5 mb-1">
          {trimmed.slice(4)}
        </h4>
      );
    } else if (trimmed.startsWith('- **')) {
      const match = trimmed.match(/^- \*\*(.+?)\*\*(.*)$/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-1.5 text-[10px] leading-relaxed ml-2 mb-0.5">
            <span className="text-slate-600 flex-shrink-0">•</span>
            <span>
              <span className="text-cyan-400 font-medium">{match[1]}</span>
              <span className="text-slate-500">{match[2]}</span>
            </span>
          </div>
        );
      }
    } else if (trimmed.startsWith('- ')) {
      elements.push(
        <div key={i} className="flex gap-1.5 text-[10px] text-slate-500 leading-relaxed ml-2 mb-0.5">
          <span className="text-slate-600 flex-shrink-0">•</span>
          <span>{trimmed.slice(2)}</span>
        </div>
      );
    } else if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
      elements.push(
        <code key={i} className="block text-[10px] font-mono text-cyan-400/80 bg-white/[0.03] px-2 py-1 rounded my-1">
          {trimmed.slice(1, -1)}
        </code>
      );
    } else if (trimmed.match(/^\d+\./)) {
      const text = trimmed.replace(/^\d+\.\s*/, '');
      elements.push(
        <div key={i} className="flex gap-1.5 text-[10px] text-slate-500 leading-relaxed ml-2 mb-0.5">
          <span className="text-slate-600 flex-shrink-0">{trimmed.match(/^\d+/)?.[0]}.</span>
          <span>{renderInlineFormatting(text)}</span>
        </div>
      );
    } else if (trimmed === '') {
      // Skip empty lines
    } else {
      elements.push(
        <p key={i} className="text-[10px] text-slate-500 leading-relaxed mb-1">
          {renderInlineFormatting(trimmed)}
        </p>
      );
    }
  }

  return elements;
}

function renderInlineFormatting(text: string): React.ReactNode {
  // Handle **bold** and `code` inline
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <span key={i} className="text-slate-300 font-medium">{part.slice(2, -2)}</span>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="text-cyan-400/80 bg-white/[0.03] px-1 rounded text-[9px]">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export function SkillCard({ skill }: Props) {
  const [expanded, setExpanded] = useState(false);
  const s = STATUS_CONFIG[skill.status];
  const winRate = skill.stats.trades > 0
    ? `${((skill.stats.wins / skill.stats.trades) * 100).toFixed(0)}%`
    : '—';
  const pnlPositive = skill.stats.totalPnl >= 0;
  const pnlStr = `${pnlPositive ? '+' : ''}$${Math.abs(skill.stats.totalPnl).toFixed(2)}`;
  const pollLabel = skill.pollIntervalMs >= 1000
    ? `${skill.pollIntervalMs / 1000}s`
    : `${skill.pollIntervalMs}ms`;

  const hasDetails = !!skill.detailedDescription;

  return (
    <div className={`relative rounded-2xl overflow-hidden card-border ${s.glowClass} transition-shadow`}>
      {/* Gradient top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${s.borderTopClass}`} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {skill.icon && (
              <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-lg flex-shrink-0">
                {skill.icon}
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-white leading-tight">{skill.name}</h3>
              <div className="text-[10px] font-mono text-slate-600 mt-0.5 uppercase tracking-wider">
                {skill.category} · {pollLabel} poll
              </div>
            </div>
          </div>

          <span className={`flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 ${s.badgeBg}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dotClass}`} />
            <span className={s.textClass}>{s.label}</span>
          </span>
        </div>

        {/* Description + expand button */}
        <div
          className={`${hasDetails ? 'cursor-pointer' : ''}`}
          onClick={() => hasDetails && setExpanded(!expanded)}
        >
          <p className="text-xs text-slate-500 leading-relaxed mb-2">{skill.description}</p>

          {hasDetails && (
            <div className="flex items-center gap-1 text-[10px] text-cyan-500/60 mb-3">
              <span style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                display: 'inline-block',
              }}>▶</span>
              <span>{expanded ? 'Hide details' : 'View strategy details'}</span>
            </div>
          )}
        </div>

        {/* Expanded detailed description */}
        {expanded && skill.detailedDescription && (
          <div className="border-t border-white/[0.05] pt-3 mb-4 max-h-[400px] overflow-y-auto pr-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
          >
            {renderMarkdown(skill.detailedDescription)}

            {/* Data sources badges */}
            {skill.dataSources && skill.dataSources.length > 0 && (
              <div className="mt-3 pt-2 border-t border-white/[0.04]">
                <div className="text-[9px] font-mono text-slate-600 uppercase tracking-wider mb-1.5">
                  Data Sources
                </div>
                <div className="flex flex-wrap gap-1">
                  {skill.dataSources.map(src => (
                    <span key={src} className="text-[9px] font-mono text-cyan-400/70 bg-cyan-500/[0.08] border border-cyan-500/20 px-1.5 py-0.5 rounded">
                      {src}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <StatCell label="TRADES" value={String(skill.stats.trades)} />
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
