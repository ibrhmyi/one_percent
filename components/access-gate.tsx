'use client';

import { useState, useEffect } from 'react';

const ACCESS_CODES = ['alpha', 'beta', 'pi'];
const COOKIE_NAME = 'op_access';
const COOKIE_DAYS = 365;

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value};expires=${expires};path=/`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    const stored = getCookie(COOKIE_NAME);
    setAuthorized(stored === '1');
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ACCESS_CODES.includes(code.toLowerCase().trim())) {
      setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
      setAuthorized(true);
      setError(false);
    } else {
      setError(true);
      setCode('');
    }
  };

  // Loading state
  if (authorized === null) {
    return <div style={{ background: '#0a0e17', height: '100vh' }} />;
  }

  if (authorized) {
    return <>{children}</>;
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#0a0e17',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      fontFamily: 'var(--font-sans), -apple-system, sans-serif',
    }}>
      <div style={{
        width: 360,
        padding: '40px 36px',
        textAlign: 'center',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 20,
        backdropFilter: 'blur(40px)',
      }}>
        <div style={{
          fontSize: 13,
          fontWeight: 400,
          letterSpacing: 3,
          color: 'rgba(255,255,255,0.7)',
          marginBottom: 32,
        }}>
          ONEPERCENT
        </div>

        <div style={{
          fontSize: 14,
          color: 'rgba(255,255,255,0.4)',
          marginBottom: 24,
          lineHeight: 1.6,
        }}>
          Terminal access is restricted.
        </div>

        <form onSubmit={handleSubmit} style={{
          display: 'flex',
          gap: 0,
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 100,
          padding: 4,
          transition: 'border-color 0.2s',
        }}>
          <input
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value); setError(false); }}
            placeholder="Access code"
            autoFocus
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: '12px 20px',
              color: '#fff',
              fontSize: 14,
              outline: 'none',
              borderRadius: 100,
              fontFamily: 'inherit',
            }}
          />
          <button type="submit" style={{
            background: 'linear-gradient(135deg, #0e7490, #0891b2, #0e7490)',
            backgroundSize: '200% 200%',
            border: 'none',
            borderRadius: 100,
            padding: '12px 24px',
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            fontFamily: 'inherit',
          }}>
            Enter
          </button>
        </form>

        {error && (
          <div style={{
            fontSize: 12,
            color: 'rgba(239,68,68,0.7)',
            marginTop: 12,
          }}>
            Invalid access code
          </div>
        )}
      </div>
    </div>
  );
}
