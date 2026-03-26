'use client';
interface Message { id: string; text: string; type: string; timestamp: string; }
interface Props { messages: Message[]; }

const typeStyles: Record<string, { border: string; label: string; color: string }> = {
  info:     { border: 'var(--text-dim)',      label: 'INFO',   color: 'var(--text-secondary)' },
  idle:     { border: 'var(--border-accent)', label: 'IDLE',   color: 'var(--text-dim)' },
  warning:  { border: 'var(--amber)',         label: 'WARN',   color: 'var(--amber)' },
  error:    { border: 'var(--red)',           label: 'ERR',    color: 'var(--red)' },
  action:   { border: 'var(--green)',         label: 'ACTION', color: 'var(--green)' },
  decision: { border: 'var(--cyan)',          label: 'TRADE',  color: 'var(--cyan)' },
  score:    { border: 'var(--green)',         label: 'SCORE',  color: 'var(--green)' },
  foul:     { border: 'var(--amber)',         label: 'FOUL',   color: 'var(--amber)' },
  system:   { border: 'var(--purple)',        label: 'SYS',    color: 'var(--purple)' },
};

export function BrainLog({ messages }: Props) {
  const reversed = [...messages].reverse();
  return (
    <div className="panel">
      <div className="panel-header">AI Brain Log</div>
      <div style={{ overflowY: 'auto', maxHeight: '260px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {reversed.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', padding: '8px 0' }}>Waiting for events...</div>
        ) : reversed.map(msg => {
          const s = typeStyles[msg.type] ?? typeStyles.info;
          return (
            <div key={msg.id} className="fade-in" style={{
              borderLeft: `3px solid ${s.border}`,
              paddingLeft: 8,
              paddingTop: 3,
              paddingBottom: 3,
            }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 1 }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.6rem' }}>
                  {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </span>
                <span className="badge" style={{ background: `${s.border}20`, color: s.color, fontSize: '0.55rem' }}>
                  {s.label}
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{msg.text}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
