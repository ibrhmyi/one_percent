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
