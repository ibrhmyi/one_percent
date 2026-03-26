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
    warning: 'var(--amber)',
    action: 'var(--cyan)',
    success: 'var(--green)',
    trade: 'var(--green)',
    error: 'var(--red)',
  };
  const color = typeColor[latestMessage?.type ?? 'info'] ?? 'var(--text-secondary)';

  return (
    <div style={{
      height: '32px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-default)',
      display: 'flex', alignItems: 'center',
      overflow: 'hidden',
      fontSize: '0.7rem',
      fontFamily: 'var(--font-mono)',
    }}>
      {/* Logo */}
      <div style={{
        padding: '0 16px',
        borderRight: '1px solid var(--border-default)',
        whiteSpace: 'nowrap',
        color: 'var(--cyan)',
        fontWeight: 700,
        fontSize: '0.8rem',
        letterSpacing: '-0.02em',
        flexShrink: 0,
      }}>
        ONEPERCENT
      </div>

      {/* Sliding brain message */}
      <div style={{
        flex: 1,
        padding: '0 16px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        color,
        opacity: fade ? 1 : 0,
        transition: 'opacity 0.15s ease',
      }}>
        {displayed}
      </div>
    </div>
  );
}
