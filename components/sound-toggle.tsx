'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  src: string;
}

export function SoundToggle({ src }: Props) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0.35;
    audioRef.current = audio;

    // Seamless loop with volume fade
    const handleTimeUpdate = () => {
      if (!audio) return;
      const timeLeft = audio.duration - audio.currentTime;
      if (timeLeft < 3) {
        // Fade out in last 3 seconds
        audio.volume = Math.max(0, 0.35 * (timeLeft / 3));
      } else if (audio.currentTime < 1) {
        // Fade in first 1 second
        audio.volume = 0.35 * Math.min(1, audio.currentTime);
      } else {
        audio.volume = 0.35;
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.pause();
    };
  }, [src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
    setPlaying(!playing);
  }, [playing]);

  return (
    <button
      onClick={toggle}
      aria-label={playing ? 'Mute' : 'Play music'}
      style={{
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '50%',
        width: 36,
        height: 36,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 0.2s',
        padding: 0,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        {playing ? (
          /* Sound wave animation — 4 bars */
          <>
            {[3, 6, 9, 12, 15].map((x, i) => (
              <rect
                key={i}
                x={x - 1}
                width="1.5"
                rx="0.75"
                fill="rgba(255,255,255,0.6)"
                style={{
                  animation: `soundBar ${0.4 + i * 0.1}s ease-in-out infinite alternate`,
                  transformOrigin: 'center',
                }}
              >
                <animate
                  attributeName="y"
                  values={`${9 - (2 + i)}; ${9 - (4 + i * 1.2)}; ${9 - (2 + i)}`}
                  dur={`${0.4 + i * 0.12}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="height"
                  values={`${4 + i * 2}; ${8 + i * 2.4}; ${4 + i * 2}`}
                  dur={`${0.4 + i * 0.12}s`}
                  repeatCount="indefinite"
                />
              </rect>
            ))}
          </>
        ) : (
          /* Paused — static circle */
          <circle
            cx="9"
            cy="9"
            r="4"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1.5"
            fill="none"
          />
        )}
      </svg>
    </button>
  );
}
