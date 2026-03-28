'use client';

import { useState, useEffect } from 'react';

const ACCESS_CODES = ['alphabetapi'];
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
        width: 340,
        maxWidth: '90vw',
        padding: '36px 32px',
        textAlign: 'center',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        backdropFilter: 'blur(60px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        <div style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.45)',
          marginBottom: 24,
          lineHeight: 1.6,
          letterSpacing: 0.5,
        }}>
          Enter access code for live demo
        </div>

        <form onSubmit={handleSubmit} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <input
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value); setError(false); }}
            placeholder="Access code"
            autoFocus
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
              padding: '12px 16px',
              color: '#fff',
              fontSize: 14,
              outline: 'none',
              borderRadius: 8,
              fontFamily: 'inherit',
              transition: 'border-color 0.2s',
              textAlign: 'center',
              letterSpacing: 1,
            }}
          />
          <button type="submit" style={{
            width: '100%',
            background: 'linear-gradient(135deg, #0e7490, #0891b2, #06a5c7, #0891b2, #0e7490)',
            backgroundSize: '300% 300%',
            animation: 'gradientShift 4s ease infinite',
            border: 'none',
            borderRadius: 8,
            padding: '12px 24px',
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 0.5,
            transition: 'opacity 0.2s',
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

      <style>{`
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  );
}
