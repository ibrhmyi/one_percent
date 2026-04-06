"""
calibrate_v3.py — Calibrate win probability model using actual game outcomes.

The model's job: given (lead, time_remaining), output P(leading_team_wins).
Ground truth: did the leading team actually win?

Key insight: the model doesn't need to match the market price (which encodes
pre-game odds, injuries, etc.). It needs to produce calibrated probabilities
that, combined with the market price, identify mispricings.

Approach:
1. For each scoring event, compute model P(home_win) from (lead, secs)
2. Determine actual outcome (did home team win?)
3. Grid search K, TS to maximize calibration and discrimination
4. Separately evaluate: is model_prob - market_prob predictive of outcome?
"""

import json
import math
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EVENTS_PATH = PROJECT_ROOT / "data" / "backtest_results" / "v3_events.json"
GAMES_DIR = PROJECT_ROOT / "data" / "backtest_results" / "games"
OUTPUT_PATH = PROJECT_ROOT / "data" / "backtest_results" / "calibration_v3.json"


def model_prob(lead: float, secs: float, K: float, TS: float) -> float:
    """P(home win) given home lead and seconds remaining."""
    effective_secs = max(30, secs)
    z = -K * lead / (TS * math.sqrt(effective_secs))
    z = max(-20, min(20, z))
    return 1 / (1 + math.exp(z))


def get_game_outcomes(events: list) -> dict:
    """Determine actual game outcome for each game.

    Use the final score or settled price to determine winner.
    """
    outcomes = {}
    # Group events by game
    games = defaultdict(list)
    for e in events:
        games[e["game_id"]].append(e)

    for game_id, game_events in games.items():
        # Find the last event (closest to game end) to determine outcome
        last = min(game_events, key=lambda e: e["secs_remaining"])

        # The settled price tells us the outcome
        # price_settled near 1.0 = YES won, near 0.0 = NO won
        settled = last.get("price_settled", 0.5)
        yes_is_home = last["yes_is_home"]

        if settled > 0.5:
            # YES token won
            home_won = yes_is_home
        else:
            # NO token won (YES lost)
            home_won = not yes_is_home

        outcomes[game_id] = {
            "home_won": home_won,
            "yes_is_home": yes_is_home,
            "settled": settled,
            "final_score_home": last["score_home"],
            "final_score_away": last["score_away"],
        }

    return outcomes


def brier_score(predictions: list) -> float:
    """Brier score: mean of (predicted - actual)^2. Lower is better."""
    return sum((p - a) ** 2 for p, a in predictions) / len(predictions)


def log_loss(predictions: list) -> float:
    """Log loss. Lower is better."""
    total = 0
    for p, a in predictions:
        p = max(0.001, min(0.999, p))
        if a == 1:
            total += -math.log(p)
        else:
            total += -math.log(1 - p)
    return total / len(predictions)


def calibration_table(predictions: list, n_buckets: int = 10) -> dict:
    """Calibration: bin by predicted prob, compare to actual win rate."""
    buckets = defaultdict(list)
    for pred, actual in predictions:
        bucket = min(n_buckets - 1, int(pred * n_buckets))
        buckets[bucket].append((pred, actual))

    table = {}
    for b in range(n_buckets):
        if b not in buckets or len(buckets[b]) < 5:
            continue
        pairs = buckets[b]
        avg_pred = sum(p for p, _ in pairs) / len(pairs)
        avg_actual = sum(a for _, a in pairs) / len(pairs)
        table[f"{b/n_buckets:.1f}-{(b+1)/n_buckets:.1f}"] = {
            "n": len(pairs),
            "avg_predicted": round(avg_pred, 4),
            "actual_win_rate": round(avg_actual, 4),
            "gap": round(avg_pred - avg_actual, 4),
        }
    return table


def evaluate_model(samples: list, K: float, TS: float) -> dict:
    """Evaluate model calibration and discrimination."""
    predictions = []
    for s in samples:
        pred = model_prob(s["lead"], s["secs"], K, TS)
        actual = 1.0 if s["home_won"] else 0.0
        predictions.append((pred, actual))

    return {
        "brier": brier_score(predictions),
        "logloss": log_loss(predictions),
        "n": len(predictions),
    }


def grid_search(samples: list) -> list:
    """Grid search over K and TS."""
    results = []

    # K: steepness — how much a point of lead changes probability
    # TS: time scaling — how much time remaining matters
    k_values = [round(0.05 + i * 0.05, 2) for i in range(60)]  # 0.05 to 3.0
    ts_values = [round(0.1 + i * 0.1, 2) for i in range(15)]  # 0.1 to 1.5

    for K in k_values:
        for TS in ts_values:
            r = evaluate_model(samples, K, TS)
            results.append({"K": K, "TS": TS, **r})

    results.sort(key=lambda x: x["brier"])
    return results


def fine_grid(samples: list, center_K: float, center_TS: float) -> list:
    """Fine grid search around a center point."""
    results = []
    k_values = [round(max(0.01, center_K - 0.3) + i * 0.01, 3) for i in range(60)]
    ts_values = [round(max(0.01, center_TS - 0.3) + i * 0.01, 3) for i in range(60)]

    for K in k_values:
        for TS in ts_values:
            r = evaluate_model(samples, K, TS)
            results.append({"K": K, "TS": TS, **r})

    results.sort(key=lambda x: x["brier"])
    return results


def evaluate_edge_detection(samples: list, K: float, TS: float) -> dict:
    """When model disagrees with market, who is right?

    Edge = model_prob - market_prob.
    If edge > 0: model says home is underpriced → should buy home.
    Check: does buying when edge > threshold actually profit?
    """
    results = {}

    for threshold in [0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15, 0.20]:
        buys = []  # (edge, outcome) where outcome = 1 if bet would win
        for s in samples:
            pred = model_prob(s["lead"], s["secs"], K, TS)
            market = s["market_prob"]
            edge = pred - market

            if abs(edge) >= threshold:
                if edge > 0:
                    # Buy home: profit if home wins
                    won = 1 if s["home_won"] else 0
                    buys.append((edge, won, market))
                else:
                    # Buy away: profit if away wins
                    won = 1 if not s["home_won"] else 0
                    buys.append((-edge, won, 1 - market))

        if len(buys) < 10:
            continue

        win_rate = sum(b[1] for b in buys) / len(buys)
        # Average implied probability from market (what we paid)
        avg_cost = sum(b[2] for b in buys) / len(buys)
        # Profit = win_rate - avg_cost - fee
        avg_pnl = win_rate - avg_cost - 0.0075

        results[f"threshold_{threshold}"] = {
            "n_trades": len(buys),
            "win_rate": round(win_rate, 4),
            "avg_cost": round(avg_cost, 4),
            "avg_edge_claimed": round(sum(b[0] for b in buys) / len(buys), 4),
            "avg_pnl_per_trade": round(avg_pnl, 5),
            "profitable": avg_pnl > 0,
        }

    return results


def main():
    print("=" * 70)
    print("MODEL CALIBRATION v3 — Fit to actual game outcomes")
    print("=" * 70)

    events = json.load(open(EVENTS_PATH))
    outcomes = get_game_outcomes(events)
    print(f"Loaded {len(events)} events from {len(outcomes)} games")

    # Build samples: one per event with outcome
    samples = []
    for e in events:
        game_id = e["game_id"]
        if game_id not in outcomes:
            continue

        # Score BEFORE this event (undo the scoring)
        score_home = e["score_home"]
        score_away = e["score_away"]
        points = e["points"]
        is_home = e["is_home"]
        if is_home:
            score_home -= points
        else:
            score_away -= points

        lead = score_home - score_away
        secs = e["secs_remaining"]

        # Market probability of home win
        price = e["price_before"]
        yes_is_home = e["yes_is_home"]
        if yes_is_home:
            market_prob = price
        else:
            market_prob = 1 - price

        # Skip extreme market prices
        if market_prob < 0.03 or market_prob > 0.97:
            continue

        samples.append({
            "lead": lead,
            "secs": secs,
            "market_prob": market_prob,
            "home_won": outcomes[game_id]["home_won"],
            "period": e["period"],
            "abs_margin": abs(lead),
            "is_crunch": e["is_crunch"],
            "is_prime": e["is_prime"],
            "game_id": game_id,
        })

    print(f"Valid samples: {len(samples)}")
    home_wins = sum(1 for s in samples if s["home_won"])
    print(f"Home win rate: {home_wins/len(samples):.3f}")

    # Deduplicate to ~1 sample per unique game state
    # (many events from same game have correlated outcomes)
    seen = set()
    unique_samples = []
    for s in samples:
        key = (s["game_id"], round(s["lead"]), round(s["secs"] / 60))
        if key not in seen:
            seen.add(key)
            unique_samples.append(s)
    print(f"Unique game states (deduplicated): {len(unique_samples)}")

    # ── 1. Current model ──
    print(f"\n{'─' * 70}")
    print("1. CURRENT LIVE MODEL (K=0.7, TS=0.45)")
    print("─" * 70)
    current = evaluate_model(unique_samples, 0.7, 0.45)
    print(f"  Brier={current['brier']:.5f}, LogLoss={current['logloss']:.5f}")

    # Market as baseline
    market_preds = [(s["market_prob"], 1.0 if s["home_won"] else 0.0) for s in unique_samples]
    print(f"  Market baseline: Brier={brier_score(market_preds):.5f}, LogLoss={log_loss(market_preds):.5f}")

    # Calibration table for current
    model_preds = [(model_prob(s["lead"], s["secs"], 0.7, 0.45), 1.0 if s["home_won"] else 0.0)
                    for s in unique_samples]
    print(f"\n  Model calibration (K=0.7, TS=0.45):")
    cal = calibration_table(model_preds)
    for bucket, stats in cal.items():
        gap_indicator = "✓" if abs(stats["gap"]) < 0.05 else "✗"
        print(f"    {bucket}: pred={stats['avg_predicted']:.3f}, actual={stats['actual_win_rate']:.3f}, "
              f"gap={stats['gap']:+.3f} {gap_indicator}  (n={stats['n']})")

    print(f"\n  Market calibration:")
    market_cal = calibration_table(market_preds)
    for bucket, stats in market_cal.items():
        gap_indicator = "✓" if abs(stats["gap"]) < 0.05 else "✗"
        print(f"    {bucket}: pred={stats['avg_predicted']:.3f}, actual={stats['actual_win_rate']:.3f}, "
              f"gap={stats['gap']:+.3f} {gap_indicator}  (n={stats['n']})")

    # ── 2. Grid search ──
    print(f"\n{'─' * 70}")
    print("2. COARSE GRID SEARCH (minimizing Brier score)")
    print("─" * 70)
    coarse = grid_search(unique_samples)
    for r in coarse[:10]:
        print(f"  K={r['K']:.2f}, TS={r['TS']:.2f} → Brier={r['brier']:.5f}, LogLoss={r['logloss']:.5f}")

    best_coarse = coarse[0]

    # ── 3. Fine grid ──
    print(f"\n{'─' * 70}")
    print(f"3. FINE GRID SEARCH around K={best_coarse['K']}, TS={best_coarse['TS']}")
    print("─" * 70)
    fine = fine_grid(unique_samples, best_coarse["K"], best_coarse["TS"])
    for r in fine[:10]:
        print(f"  K={r['K']:.3f}, TS={r['TS']:.3f} → Brier={r['brier']:.6f}, LogLoss={r['logloss']:.6f}")

    best = fine[0]
    best_K, best_TS = best["K"], best["TS"]

    # ── 4. Calibration with best params ──
    print(f"\n{'─' * 70}")
    print(f"4. CALIBRATION — Best model (K={best_K}, TS={best_TS})")
    print("─" * 70)
    best_preds = [(model_prob(s["lead"], s["secs"], best_K, best_TS), 1.0 if s["home_won"] else 0.0)
                   for s in unique_samples]
    cal = calibration_table(best_preds)
    for bucket, stats in cal.items():
        gap_indicator = "✓" if abs(stats["gap"]) < 0.05 else "✗"
        print(f"    {bucket}: pred={stats['avg_predicted']:.3f}, actual={stats['actual_win_rate']:.3f}, "
              f"gap={stats['gap']:+.3f} {gap_indicator}  (n={stats['n']})")

    best_eval = evaluate_model(unique_samples, best_K, best_TS)
    print(f"\n  Best model: Brier={best_eval['brier']:.5f}, LogLoss={best_eval['logloss']:.5f}")
    print(f"  Market:     Brier={brier_score(market_preds):.5f}, LogLoss={log_loss(market_preds):.5f}")
    print(f"  Current:    Brier={current['brier']:.5f}, LogLoss={current['logloss']:.5f}")

    # ── 5. Segment analysis ──
    print(f"\n{'─' * 70}")
    print("5. SEGMENT ANALYSIS — Best params per segment")
    print("─" * 70)

    segment_defs = {
        "all": lambda s: True,
        "Q1_Q3": lambda s: s["period"] <= 3,
        "Q4": lambda s: s["period"] == 4,
        "crunch": lambda s: s["is_crunch"],
        "tight_0_4": lambda s: s["abs_margin"] <= 4,
        "close_5_8": lambda s: 5 <= s["abs_margin"] <= 8,
        "moderate_9_15": lambda s: 9 <= s["abs_margin"] <= 15,
        "blowout_16": lambda s: s["abs_margin"] >= 16,
    }

    seg_results = {}
    for seg_name, pred in segment_defs.items():
        seg = [s for s in unique_samples if pred(s)]
        if len(seg) < 50:
            continue
        seg_grid = grid_search(seg)
        seg_best = seg_grid[0]
        seg_current = evaluate_model(seg, 0.7, 0.45)
        seg_market = [(s["market_prob"], 1.0 if s["home_won"] else 0.0) for s in seg]
        market_brier = brier_score(seg_market)

        print(f"\n  {seg_name} ({len(seg)} samples):")
        print(f"    Market:   Brier={market_brier:.5f}")
        print(f"    Current:  Brier={seg_current['brier']:.5f} (K=0.7, TS=0.45)")
        print(f"    Best:     Brier={seg_best['brier']:.5f} (K={seg_best['K']}, TS={seg_best['TS']})")

        seg_results[seg_name] = {
            "n": len(seg),
            "market_brier": round(market_brier, 6),
            "current_brier": round(seg_current["brier"], 6),
            "best": {"K": seg_best["K"], "TS": seg_best["TS"],
                     "brier": round(seg_best["brier"], 6)},
        }

    # ── 6. Edge detection: can model beat market? ──
    print(f"\n{'─' * 70}")
    print(f"6. EDGE DETECTION — When model and market disagree, who wins?")
    print("─" * 70)

    for params_label, K, TS in [("current (0.7, 0.45)", 0.7, 0.45),
                                 (f"best ({best_K}, {best_TS})", best_K, best_TS)]:
        print(f"\n  Params: {params_label}")
        edge_results = evaluate_edge_detection(unique_samples, K, TS)
        for thresh, stats in sorted(edge_results.items()):
            profit_marker = "✓ PROFIT" if stats["profitable"] else "✗ LOSS"
            print(f"    {thresh}: {stats['n_trades']} trades, win={stats['win_rate']:.3f}, "
                  f"cost={stats['avg_cost']:.3f}, pnl={stats['avg_pnl_per_trade']:+.4f} {profit_marker}")

    # ── 7. Combined model (score-based + market prior) ──
    print(f"\n{'─' * 70}")
    print("7. COMBINED MODEL — Model as adjustment to market")
    print("─" * 70)
    # Blend: combined = alpha * model + (1-alpha) * market
    for alpha in [0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0]:
        preds = []
        for s in unique_samples:
            mp = model_prob(s["lead"], s["secs"], best_K, best_TS)
            combined = alpha * mp + (1 - alpha) * s["market_prob"]
            actual = 1.0 if s["home_won"] else 0.0
            preds.append((combined, actual))
        b = brier_score(preds)
        ll = log_loss(preds)
        label = "← pure market" if alpha == 0 else "← pure model" if alpha == 1 else ""
        print(f"  alpha={alpha:.2f}: Brier={b:.5f}, LogLoss={ll:.5f} {label}")

    # ── Save ──
    output = {
        "best_params": {"K": best_K, "TS": best_TS},
        "scores": {
            "best_model": {"brier": round(best_eval["brier"], 6),
                           "logloss": round(best_eval["logloss"], 6)},
            "current_model": {"brier": round(current["brier"], 6),
                              "logloss": round(current["logloss"], 6),
                              "K": 0.7, "TS": 0.45},
            "market": {"brier": round(brier_score(market_preds), 6),
                       "logloss": round(log_loss(market_preds), 6)},
        },
        "segments": seg_results,
        "calibration": cal,
        "n_samples": len(unique_samples),
        "n_games": len(outcomes),
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 70}")
    print("SUMMARY")
    print(f"  Best model params: K={best_K}, TS={best_TS}")
    print(f"  Model Brier:  {best_eval['brier']:.5f}")
    print(f"  Market Brier: {brier_score(market_preds):.5f}")
    gap = best_eval["brier"] - brier_score(market_preds)
    if gap > 0:
        print(f"  ⚠ Model is WORSE than market by {gap:.5f} Brier points")
        print(f"  → The market already incorporates team strength, pace, etc.")
        print(f"  → The model adds value only when COMBINED with market price")
    else:
        print(f"  ✓ Model BEATS market by {-gap:.5f} Brier points")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
