'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import styles from './sound-toggle.module.css';

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

    const handleTimeUpdate = () => {
      if (!audio) return;
      const timeLeft = audio.duration - audio.currentTime;
      if (timeLeft < 3) {
        audio.volume = Math.max(0, 0.35 * (timeLeft / 3));
      } else if (audio.currentTime < 1) {
        audio.volume = 0.35 * Math.min(1, audio.currentTime);
      } else {
        audio.volume = 0.35;
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);

    // Autoplay after 5 seconds (requires user interaction first on most browsers)
    const autoplayTimer = setTimeout(() => {
      audio.play().then(() => setPlaying(true)).catch(() => {
        // Browser blocked autoplay — wait for user click on non-interactive elements
        const startOnClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          // Don't hijack clicks on forms, buttons, inputs, or links
          if (target.closest('form') || target.closest('button') || target.closest('a') || target.closest('input')) return;
          audio.play().then(() => setPlaying(true)).catch(() => {});
          document.removeEventListener('click', startOnClick);
        };
        document.addEventListener('click', startOnClick);
      });
    }, 5000);

    return () => {
      clearTimeout(autoplayTimer);
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
      className={styles.btn}
    >
      <div className={styles.bars}>
        {[0, 1, 2, 3, 4].map(i => (
          <span
            key={i}
            className={`${styles.bar} ${playing ? styles.playing : ''}`}
            style={{
              animationDelay: playing ? `${i * 0.12}s` : undefined,
              animationDuration: playing ? `${0.3 + i * 0.08}s` : undefined,
            }}
          />
        ))}
      </div>
    </button>
  );
}
