'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SoundToggle } from '@/components/sound-toggle';
import styles from './landing.module.css';

const games = [
  { matchup: 'LAL vs BOS', score: '87-82', odds: 'YES 42¢', ch: 'NBA-01', vid: '/clips/clip1.mp4' },
  { matchup: 'NYK vs MIA', score: '94-91', odds: 'NO 61¢', ch: 'WNBA-02', vid: '/clips/clip2.mp4' },
  { matchup: 'GSW vs DEN', score: '76-79', odds: 'YES 55¢', ch: 'NCAAM-03', vid: '/clips/clip3.mp4' },
  { matchup: 'PHX vs DAL', score: '101-98', odds: 'YES 67¢', ch: 'NBA-04', vid: '/clips/clip4.mp4' },
  { matchup: 'MIL vs CLE', score: '88-85', odds: 'NO 44¢', ch: 'GLEAGUE-05', vid: '/clips/clip5.mp4' },
  { matchup: 'CHI vs ATL', score: '72-70', odds: 'YES 51¢', ch: 'NBA-06', vid: '/clips/clip6.mp4' },
  { matchup: 'BKN vs IND', score: '64-68', odds: 'NO 38¢', ch: 'NCAAM-07', vid: '/clips/clip7.mp4' },
  { matchup: 'MIN vs SAC', score: '91-87', odds: 'YES 58¢', ch: 'WNBA-08', vid: '/clips/clip8.mp4' },
  { matchup: 'ORL vs TOR', score: '80-83', odds: 'NO 46¢', ch: 'SUMMER-09', vid: '/clips/clip9.mp4' },
  { matchup: 'POR vs HOU', score: '73-77', odds: 'YES 53¢', ch: 'NBA-10', vid: '/clips/clip10.mp4' },
  { matchup: 'OKC vs MEM', score: '96-92', odds: 'YES 71¢', ch: 'GLEAGUE-11', vid: '/clips/clip11.mp4' },
  { matchup: 'SAS vs NOP', score: '68-65', odds: 'NO 39¢', ch: 'NCAAM-12', vid: '/clips/clip12.mp4' },
];

const tickerItems = [
  { name: 'LAL vs BOS O218.5', val: '42¢', ch: '+3.2¢', up: true },
  { name: 'NYK ML', val: '61¢', ch: '-1.8¢', up: false },
  { name: 'GSW +6.5', val: '55¢', ch: '+0.4¢', up: true },
  { name: 'DEN vs MIA U208', val: '38¢', ch: '+2.1¢', up: true },
  { name: 'PHX ML', val: '67¢', ch: '-0.9¢', up: false },
  { name: 'BKN +4.5', val: '44¢', ch: '+1.6¢', up: true },
  { name: 'CHI vs ATL O224', val: '51¢', ch: '+0.7¢', up: true },
  { name: 'DAL ML', val: '76¢', ch: '-2.3¢', up: false },
  { name: 'MIL -3.5', val: '58¢', ch: '+1.1¢', up: true },
  { name: 'OKC vs MEM', val: '71¢', ch: '+4.2¢', up: true },
];

export default function LandingPage() {
  const scoresRef = useRef<Map<number, { a: number; b: number }>>(new Map());
  const [email, setEmail] = useState('');
  const [waitlistMsg, setWaitlistMsg] = useState('');
  const [waitlistError, setWaitlistError] = useState('');
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setWaitlistError('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.error) {
        setWaitlistError(data.error);
      } else {
        setWaitlistMsg(data.message || 'Done!');
        setWaitlistSuccess(true);
        setEmail('');
      }
    } catch {
      setWaitlistError('Failed to join. Try again.');
    }
  };

  useEffect(() => {
    // Initialize scores
    games.forEach((g, i) => {
      const [a, b] = g.score.split('-').map(Number);
      scoresRef.current.set(i, { a, b });
    });

    const interval = setInterval(() => {
      document.querySelectorAll(`.${styles.score}`).forEach((el, i) => {
        const s = scoresRef.current.get(i);
        if (!s) return;
        if (Math.random() > 0.5) s.a += Math.random() > 0.4 ? 2 : 3;
        else s.b += Math.random() > 0.4 ? 2 : 3;
        el.textContent = `${s.a}-${s.b}`;
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const tickerContent = Array(4).fill(tickerItems).flat();

  return (
    <div className={styles.page}>
      {/* Video Grid Background */}
      <div className={styles.videoGrid}>
        {games.map((game, i) => (
          <div key={i} className={`${styles.videoCell} ${i >= 6 ? styles.hideMobile : ''}`}>
            <video src={game.vid} autoPlay muted loop playsInline preload="auto" />
            <div className={styles.cellOverlay}>
              <div className={styles.cellScanline} />
              <div className={styles.liveBadge}><div className={styles.dot} /> LIVE</div>
              <div className={styles.channel}>{game.ch}</div>
              <div className={styles.oddsTag}>EDGE: {game.odds}</div>
              <div className={styles.gameInfo}>
                <span className={styles.matchup}>{game.matchup}</span>
                <span className={styles.score}>{game.score}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.dimOverlay} />
      <div className={styles.scanBeam} />

      {/* Logo */}
      <Link href="/" className={styles.logo}>ONEPERCENT</Link>

      {/* Nav */}
      <div className={styles.topNav}>
        <SoundToggle src="/ambient.mp3" />
        <Link href="/blog" className={`${styles.navBtn} ${styles.navBtnSecondary}`}>Blog</Link>
        <Link href="/terminal" className={`${styles.navBtn} ${styles.navBtnPrimary}`}>Terminal</Link>
      </div>

      {/* Hero Glass Card */}
      <div className={styles.heroGlass}>
        <div className={styles.headline}>
          Real-time edge detection for <span>prediction markets</span>
        </div>
        <p className={styles.description}>
          Watches every sports market 24/7, detects momentum shifts and mispriced odds before the crowd reacts, AI trades real-time.
        </p>
        {waitlistSuccess ? (
          <div style={{
            marginBottom: 30,
            padding: '16px 32px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 100,
            backdropFilter: 'blur(40px)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
            fontSize: 16,
            color: '#fff',
            letterSpacing: 0.5,
            fontWeight: 500,
            textAlign: 'center' as const,
          }}>
            ✓ {waitlistMsg}
          </div>
        ) : (
          <>
            <form className={styles.emailRow} onSubmit={handleWaitlist}>
              <input type="email" placeholder="your@email.com" value={email} onChange={e => { setEmail(e.target.value); setWaitlistError(''); }} />
              <button type="submit" className={styles.btnWaitlist}>Join waitlist</button>
            </form>
            {waitlistError && (
              <div style={{ fontSize: 12, color: 'rgba(239,68,68,0.8)', marginTop: -22, marginBottom: 22 }}>
                {waitlistError}
              </div>
            )}
          </>
        )}
        <div className={styles.skillsSection}>
          <div className={styles.skillLive}>
            <div className={styles.liveDot} />
            Basketball
          </div>
          <div className={styles.skillsDivider} />
          <div className={styles.skillsUpcoming}>
            <span className={styles.upcomingLabel}>Soon</span>
            <div className={styles.upcomingList}>
              <span>NHL</span>
              <span>UFC</span>
              <span>MLB</span>
              <span>Soccer</span>
              <span>Tennis</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ticker */}
      <div className={styles.tickerBar}>
        <div className={styles.tickerTrack}>
          {tickerContent.map((t, i) => (
            <span key={i}>
              {t.name} <span style={{ color: 'rgba(255,255,255,0.4)' }}>{t.val}</span>{' '}
              <span className={t.up ? styles.up : styles.down}>{t.ch}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
