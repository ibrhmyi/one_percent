'use client';
import { useEffect, useRef, useState } from 'react';

interface Message { text: string; type: string; timestamp: string; }
interface Props { latestMessage: Message | null; }

export function TopBar({ latestMessage }: Props) {
  const [displayed, setDisplayed] = useState<string>('Initializing...');
  const [fade, setFade] = useState(true);
  const prevRef = useRef<string>('');

  useEffect(() => {
    const txt = latestMessage?.text ?? '';
    if (!txt || txt === prevRef.current) return;
    prevRef.current = txt;
    setFade(false);
    const t = setTimeout(() => { setDisplayed(txt); setFade(true); }, 150);
    return () => clearTimeout(t);
  }, [latestMessage?.text]);

  const typeColor: Record<string, string> = {
    info: 'var(--text-secondary)',
    idle: 'var(--text-dim)',
    warning: 'var(--cyan)',
    action: 'var(--cyan)',
    success: 'var(--green)',
    trade: 'var(--green)',
    error: 'var(--red)',
  };
  const color = typeColor[latestMessage?.type ?? 'info'] ?? 'var(--text-secondary)';

  return (
    <div style={{
      height: '36px',
      background: 'rgba(20, 25, 34, 0.8)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: '1px solid var(--border-default)',
      display: 'flex', alignItems: 'center',
      overflow: 'hidden',
      fontSize: '0.7rem',
      fontFamily: 'var(--font-mono)',
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        padding: '0 16px',
        borderRight: '1px solid var(--border-default)',
        whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
      }}>
        <span style={{
          color: 'var(--cyan)',
          fontWeight: 700,
          fontSize: '0.85rem',
          letterSpacing: '-0.03em',
        }}>
          ONEPERCENT
        </span>
        <span style={{
          fontSize: '0.5rem',
          color: 'var(--text-dim)',
          padding: '1px 5px',
          border: '1px solid var(--border-default)',
          borderRadius: 3,
          letterSpacing: '0.05em',
        }}>
          alpha v1.1
        </span>
      </div>

      {/* Brain message */}
      <div style={{
        flex: 1,
        padding: '0 16px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        opacity: fade ? 1 : 0,
        transition: 'opacity 0.15s ease',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        {latestMessage?.timestamp && (
          <span style={{ color: 'var(--text-dim)', flexShrink: 0, fontSize: '0.6rem' }}>
            {new Date(latestMessage.timestamp).toLocaleTimeString('en-US', { hour12: false })}
          </span>
        )}
        <span style={{ color, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem' }}>{displayed}</span>
      </div>
    </div>
  );
}
