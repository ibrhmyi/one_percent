'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './blog.module.css';

export default function BlogPage() {
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [blogEmail, setBlogEmail] = useState('');
  const [blogMsg, setBlogMsg] = useState('');

  useEffect(() => {
    if (!sectionsRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add(styles.visible);
      });
    }, { threshold: 0.15 });

    sectionsRef.current.querySelectorAll(`.${styles.section}, .${styles.ctaSection}`).forEach(el => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page} ref={sectionsRef}>
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>ONEPERCENT</Link>
        <div className={styles.headerNav}>
          <Link href="/" className={`${styles.navBtn} ${styles.secondary}`}>Home</Link>
          <Link href="/terminal" className={`${styles.navBtn} ${styles.primary}`}>Terminal</Link>
        </div>
      </header>

      <div className={styles.content}>
        {/* WHY */}
        <div className={styles.section}>
          <h2>Why</h2>
          <p>
            Polymarket does billions in monthly volume. Sports is nearly half of it. Most traders are manual. They watch a game, see a score, open the app, place a trade. That takes 30 to 60 seconds. During that window the price is stale. That gap is where money is made.
          </p>
          <p>
            Bots already exploit this. Researchers have analyzed millions of bets and documented significant bot profit on-chain. Verifiable.
          </p>
          <p>
            But these bots are primitive. They chase price movements after they happen. They don&apos;t know why the price moved. They can&apos;t tell a 3-pointer in a tie game with two minutes left from garbage time in a blowout. They react to the chart, not the game.
          </p>
        </div>

        {/* WHAT */}
        <div className={styles.section}>
          <h2>What</h2>
          <p>
            OnePercent reacts to the game, not the chart. It pulls real-time score data seconds before the TV broadcast, calculates what the price should be, and trades the gap before the market catches up.
          </p>
          <p>
            A basket drops in a close 4th quarter. OnePercent recalculates win probability, compares it to the Polymarket price, and trades if the market is stale. By the time most traders see the play, the position is open. It also trades pre-game when the market opens at a price that&apos;s off from where the real odds are.
          </p>
        </div>

        {/* HOW */}
        <div className={styles.section}>
          <h2>How</h2>
          <p>
            OnePercent is an AI hedge fund for prediction markets. The system is organized around skills. Each skill is a self-contained strategy for a specific market type. Basketball live scoring is one skill. Pre-game odds mispricing is another. Each has its own data, model, and execution logic.
          </p>
          <p>
            An AI allocator sits on top. It sees every signal from every skill across every market, decides how much capital to deploy, when to enter, when to exit, and when to move money to a better opportunity.
          </p>
          <p>
            Basketball is live. NHL, UFC, MLB, Soccer, and Tennis are next. Every new skill plugs into the same allocator. More skills means more signals, better allocation, and broader coverage across Polymarket and every prediction market that comes after it.
          </p>
        </div>

        {/* CTA */}
        <div className={styles.ctaSection}>
          <h2>Get early access</h2>
          {blogMsg ? (
            <div style={{
              padding: '14px 28px',
              background: 'rgba(8,145,178,0.08)',
              border: '1px solid rgba(8,145,178,0.2)',
              borderRadius: 100,
              backdropFilter: 'blur(20px)',
              fontSize: 14,
              color: 'rgba(8,145,178,0.9)',
              letterSpacing: 0.5,
              fontWeight: 500,
              textAlign: 'center',
            }}>
              {blogMsg}
            </div>
          ) : (
            <form className={styles.ctaEmailRow} onSubmit={async (e) => {
              e.preventDefault();
              if (!blogEmail) return;
              try {
                const res = await fetch('/api/waitlist', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: blogEmail }),
                });
                const data = await res.json();
                setBlogMsg(data.message || data.error || 'Done!');
                if (!data.error) setBlogEmail('');
              } catch { setBlogMsg('Network error'); }
            }}>
              <input
                type="email"
                placeholder="your@email.com"
                value={blogEmail}
                onChange={e => { setBlogEmail(e.target.value); setBlogMsg(''); }}
              />
              <button type="submit">Join waitlist</button>
            </form>
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerLeft}>&copy; 2026 OnePercent</span>
        <div className={styles.footerLinks}>
          <Link href="/">Home</Link>
          <Link href="/terminal">Terminal</Link>
          <Link href="/blog">Blog</Link>
        </div>
      </footer>
    </div>
  );
}
