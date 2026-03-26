'use client';

import { useEffect, useRef } from 'react';
import type { BrainMessage } from '@/lib/types';

const TYPE_COLORS: Record<BrainMessage['type'], string> = {
  info: 'text-cyan-400',
  warning: 'text-amber-400',
  action: 'text-orange-400',
  success: 'text-green-400',
  idle: 'text-slate-500',
};

const TYPE_DOTS: Record<BrainMessage['type'], string> = {
  info: 'bg-cyan-400',
  warning: 'bg-amber-400',
  action: 'bg-orange-400',
  success: 'bg-green-400',
  idle: 'bg-slate-600',
};

interface Props {
  messages: BrainMessage[];
  isRunning: boolean;
}

export function AIChatBar({ messages, isRunning }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const displayed = messages.slice(-5);

  return (
    <div className="flex flex-col h-full glass-card rounded-xl p-3 overflow-hidden">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
        <span className="text-xs font-mono uppercase tracking-widest text-slate-500">AI Brain</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 scrollbar-hide">
        {displayed.length === 0 ? (
          <p className="text-slate-600 text-sm font-mono">Initializing...</p>
        ) : (
          displayed.map((msg, i) => (
            <div
              key={msg.id}
              className={`flex items-start gap-2 text-sm font-mono transition-opacity duration-300 ${
                i === displayed.length - 1 ? 'opacity-100' : 'opacity-50'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${TYPE_DOTS[msg.type]}`} />
              <span className={TYPE_COLORS[msg.type]}>{msg.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
