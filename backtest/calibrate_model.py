"""
calibrate_model.py — Calibrate the live win probability model using 8,690 backtest events.

Compares the backtest's single-k model with the live model's (K, TS) parameterization.
Grid searches over (K, TS) space to minimize prediction error against actual Polymarket prices.
Evaluates separately by game phase, margin, and time remaining.

Outputs:
  - data/backtest_results/calibration.json — full results
  - Console summary with recommendations for win-probability.ts
"""

import json
import math
import sys
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EVENTS_PATH = PROJECT_ROOT / "data" / "backtest_results" / "v3_events.json"
OUTPUT_PATH = PROJECT_ROOT / "data" / "backtest_results" / "calibration.json"

TAKER_FEE = 0.0075  # Current live fee model (flat 0.75%)

# ── Model Formulas ──

def live_model(lead: float, secs: float, K: float, TS: float) -> float:
    """Live model: P = 1/(1+exp(-K*lead/(TS*sqrt(secs))))"""
    effective_secs = max(30, secs)
    z = -K * lead / (TS * math.sqrt(effective_secs))
    z = max(-20, min(20, z))
    return 1 / (1 + math.exp(z))


def backtest_model(lead: float, secs: float, k: float) -> float:
    """Backtest model: P = 1/(1+exp(-(k/sqrt(secs/2880))*lead))"""
    time_factor = max(0.1, secs / 2880)
    ek = k / math.sqrt(time_factor)
    z = max(-20, min(20, -ek * lead))
    return 1 / (1 + math.exp(z))


def reverse_live(prob: float, secs: float, K: float, TS: float) -> float:
    """Invert live model: given P, solve for lead."""
    effective_secs = max(30, secs)
    prob = max(0.001, min(0.999, prob))
    return -math.log((1 / prob) - 1) * TS * math.sqrt(effective_secs) / K


def predict_post_score_live(yes_price: float, secs: float, yes_scored: bool,
                            points: int, K: float, TS: float) -> float:
    """Predict new YES price after scoring event using live model."""
    implied_lead = reverse_live(yes_price, secs, K, TS)
    new_lead = implied_lead + points if yes_scored else implied_lead - points
    p = live_model(new_lead, secs, K, TS)
    return max(0.01, min(0.99, p))


# ── Evaluation ──

def evaluate(events: list, K: float, TS: float, offset: str = "10") -> dict:
    """Evaluate model against events at a given price offset."""
    errors = []
    dir_correct = 0
    dir_total = 0
    ev_sum = 0
    ev_count = 0

    for e in events:
        price_before = e["price_before"]
        actual_price = e["price_at_offsets"].get(offset)
        if actual_price is None:
            continue

        secs = e["secs_remaining"]
        yes_scored = e["is_yes_team"]
        points = e["points"]

        predicted = predict_post_score_live(price_before, secs, yes_scored, points, K, TS)
        predicted_delta = predicted - price_before
        actual_delta = actual_price - price_before

        errors.append(abs(predicted - actual_price))

        # Directional accuracy (only count if there was actual movement)
        if abs(actual_delta) > 0.001:
            dir_total += 1
            if (predicted_delta > 0 and actual_delta > 0) or (predicted_delta < 0 and actual_delta < 0):
                dir_correct += 1

        # Expected value: if model says price should be X and market is at Y, edge = X - Y
        if abs(predicted_delta) > 0.005:  # minimum 0.5¢ predicted move
            edge = abs(predicted - actual_price)  # how wrong the market is
            # Simulate: buy at price_before, true value is predicted
            if predicted_delta > 0:  # model says go up → buy YES
                cost = price_before
                true_value = predicted
            else:  # model says go down → buy NO (= 1 - YES price)
                cost = 1 - price_before
                true_value = 1 - predicted
            ev = true_value - cost - TAKER_FEE
            ev_sum += ev
            ev_count += 1

    mae = sum(errors) / len(errors) if errors else 999
    dir_acc = dir_correct / dir_total if dir_total > 0 else 0
    avg_ev = ev_sum / ev_count if ev_count > 0 else 0

    return {
        "mae": mae,
        "dir_acc": dir_acc,
        "dir_n": dir_total,
        "n": len(errors),
        "avg_ev": avg_ev,
        "ev_n": ev_count,
    }


def grid_search(events: list, offset: str = "10") -> list:
    """Grid search over K and TS space."""
    results = []

    # K: how steep the logistic curve is (higher = more sensitive to lead)
    # TS: time scaling (higher = less sensitive to time remaining)
    k_values = [round(0.1 + i * 0.1, 2) for i in range(25)]  # 0.1 to 2.5
    ts_values = [round(0.1 + i * 0.05, 2) for i in range(20)]  # 0.1 to 1.05

    for K in k_values:
        for TS in ts_values:
            r = evaluate(events, K, TS, offset)
            results.append({"K": K, "TS": TS, **r})

    results.sort(key=lambda x: x["mae"])
    return results


def segment_events(events: list) -> dict:
    """Split events into meaningful segments."""
    segments = {
        "all": events,
        "Q1_Q3": [e for e in events if e["period"] <= 3],
        "Q4": [e for e in events if e["period"] == 4],
        "OT": [e for e in events if e["period"] > 4],
        "crunch": [e for e in events if e["is_crunch"]],
        "prime": [e for e in events if e["is_prime"]],
        "tight_0_4": [e for e in events if e["abs_margin"] <= 4],
        "close_5_8": [e for e in events if 5 <= e["abs_margin"] <= 8],
        "moderate_9_15": [e for e in events if 9 <= e["abs_margin"] <= 15],
        "blowout_16": [e for e in events if e["abs_margin"] >= 16],
        "lt_2min": [e for e in events if e["secs_remaining"] < 120 and e["period"] == 4],
        "lt_5min": [e for e in events if e["secs_remaining"] < 300 and e["period"] == 4],
        "3pt_crunch": [e for e in events if e["is_crunch"] and e["points"] == 3],
        "2pt_crunch": [e for e in events if e["is_crunch"] and e["points"] == 2],
        "close_q4": [e for e in events if e["period"] == 4 and e["abs_margin"] <= 8],
    }
    return segments


def find_best_params_per_segment(events: list) -> dict:
    """For each segment, find best (K, TS) at multiple offsets."""
    segments = segment_events(events)
    offsets = ["5", "10", "15", "20", "30", "60"]

    results = {}
    for seg_name, seg_events in segments.items():
        if len(seg_events) < 30:
            continue
        seg_results = {}
        for offset in offsets:
            grid = grid_search(seg_events, offset)
            best = grid[0]
            # Also get top 5 for context
            top5 = grid[:5]
            seg_results[offset] = {
                "best": {"K": best["K"], "TS": best["TS"], "mae": best["mae"],
                         "dir_acc": best["dir_acc"], "avg_ev": best["avg_ev"]},
                "n": len(seg_events),
                "top5": [{"K": r["K"], "TS": r["TS"], "mae": round(r["mae"], 5),
                          "dir_acc": round(r["dir_acc"], 4)} for r in top5]
            }
        results[seg_name] = seg_results
        print(f"  {seg_name}: {len(seg_events)} events — best at 10s: K={seg_results['10']['best']['K']}, TS={seg_results['10']['best']['TS']}, MAE={seg_results['10']['best']['mae']:.4f}, dir={seg_results['10']['best']['dir_acc']:.3f}")

    return results


def analyze_market_efficiency(events: list):
    """How quickly does the market incorporate scoring events?"""
    offsets = ["1", "2", "3", "5", "10", "15", "20", "30", "45", "60", "90", "120"]

    segments = {
        "all": events,
        "crunch": [e for e in events if e["is_crunch"]],
        "prime": [e for e in events if e["is_prime"]],
        "close_q4": [e for e in events if e["period"] == 4 and e["abs_margin"] <= 8],
    }

    results = {}
    for seg_name, seg_events in segments.items():
        if not seg_events:
            continue
        seg_result = {}
        for offset in offsets:
            moves = []
            correct = 0
            total_dir = 0
            for e in seg_events:
                ap = e["price_at_offsets"].get(offset)
                if ap is None:
                    continue
                delta = ap - e["price_before"]
                expected_dir = 1 if e["is_yes_team"] else -1
                moves.append(delta * expected_dir)  # positive = moved in expected direction

                if abs(delta) > 0.001:
                    total_dir += 1
                    if delta * expected_dir > 0:
                        correct += 1

            if moves:
                avg_move = sum(moves) / len(moves)
                abs_avg = sum(abs(m) for m in moves) / len(moves)
                pct_correct = correct / total_dir if total_dir > 0 else 0
                seg_result[offset] = {
                    "avg_dir_move_cents": round(avg_move * 100, 3),
                    "avg_abs_move_cents": round(abs_avg * 100, 3),
                    "pct_moved_correct_dir": round(pct_correct, 4),
                    "n_with_movement": total_dir,
                }
        results[seg_name] = seg_result

    return results


def evaluate_profitability(events: list, K: float, TS: float) -> dict:
    """Simulate trading with given model params, evaluate P&L by segment."""
    segments = segment_events(events)
    results = {}

    for seg_name, seg_events in segments.items():
        if len(seg_events) < 20:
            continue

        # For each event, would we have made money buying at price_before
        # and selling at various offsets?
        for hold_offset in ["10", "20", "30", "60"]:
            trades = []
            for e in seg_events:
                actual_exit = e["price_at_offsets"].get(hold_offset)
                if actual_exit is None:
                    continue

                price_before = e["price_before"]
                secs = e["secs_remaining"]
                yes_scored = e["is_yes_team"]
                points = e["points"]

                predicted = predict_post_score_live(price_before, secs, yes_scored, points, K, TS)
                predicted_delta = predicted - price_before

                # Only trade if model predicts meaningful move
                min_edge = TAKER_FEE + 0.005  # fee + 0.5¢ minimum edge

                if predicted_delta > min_edge:
                    # Buy YES at price_before, sell at actual_exit
                    pnl = actual_exit - price_before - TAKER_FEE
                    trades.append(pnl)
                elif predicted_delta < -min_edge:
                    # Buy NO at (1-price_before), sell at (1-actual_exit)
                    pnl = (1 - actual_exit) - (1 - price_before) - TAKER_FEE
                    trades.append(pnl)

            if trades:
                key = f"{seg_name}@{hold_offset}s"
                winners = sum(1 for t in trades if t > 0)
                results[key] = {
                    "n_trades": len(trades),
                    "win_rate": round(winners / len(trades), 4),
                    "avg_pnl": round(sum(trades) / len(trades), 5),
                    "total_pnl": round(sum(trades), 4),
                    "avg_winner": round(sum(t for t in trades if t > 0) / max(1, winners), 5),
                    "avg_loser": round(sum(t for t in trades if t <= 0) / max(1, len(trades) - winners), 5),
                }

    return results


def main():
    print("=" * 70)
    print("MODEL CALIBRATION — Live Model (K, TS) vs 8,690 Backtest Events")
    print("=" * 70)

    events = json.load(open(EVENTS_PATH))
    print(f"Loaded {len(events)} events\n")

    # ── 1. Current live model performance ──
    print("─" * 70)
    print("1. CURRENT LIVE MODEL (K=0.7, TS=0.45)")
    print("─" * 70)
    for offset in ["5", "10", "20", "30", "60"]:
        r = evaluate(events, 0.7, 0.45, offset)
        print(f"  @{offset:>3}s: MAE={r['mae']:.4f}, dir_acc={r['dir_acc']:.3f} ({r['dir_n']} events)")

    # By segment with current params
    segments = segment_events(events)
    print("\n  By segment @10s offset:")
    for seg_name, seg_events in segments.items():
        if len(seg_events) < 20:
            continue
        r = evaluate(seg_events, 0.7, 0.45, "10")
        print(f"    {seg_name:>15}: MAE={r['mae']:.4f}, dir={r['dir_acc']:.3f}, n={r['n']}")

    # ── 2. Grid search ──
    print(f"\n{'─' * 70}")
    print("2. GRID SEARCH — Best (K, TS) per segment per offset")
    print("─" * 70)
    seg_params = find_best_params_per_segment(events)

    # ── 3. Market efficiency analysis ──
    print(f"\n{'─' * 70}")
    print("3. MARKET EFFICIENCY — Does price move in expected direction?")
    print("─" * 70)
    efficiency = analyze_market_efficiency(events)
    for seg_name, offsets in efficiency.items():
        print(f"\n  {seg_name}:")
        for offset, stats in offsets.items():
            print(f"    @{offset:>3}s: avg_dir={stats['avg_dir_move_cents']:+.3f}¢, "
                  f"abs={stats['avg_abs_move_cents']:.3f}¢, "
                  f"pct_correct={stats['pct_moved_correct_dir']:.3f} "
                  f"(n={stats['n_with_movement']})")

    # ── 4. Best params for crunch/prime ──
    print(f"\n{'─' * 70}")
    print("4. RECOMMENDED PARAMETERS")
    print("─" * 70)

    # Use the best params for the most tradeable segment
    for seg in ["all", "crunch", "prime", "close_q4"]:
        if seg in seg_params and "10" in seg_params[seg]:
            best = seg_params[seg]["10"]["best"]
            print(f"  {seg:>10} @10s: K={best['K']}, TS={best['TS']}, MAE={best['mae']:.4f}, dir={best['dir_acc']:.3f}")

    # ── 5. Profitability check ──
    print(f"\n{'─' * 70}")
    print("5. PROFITABILITY — With best all-segment params")
    print("─" * 70)

    if "all" in seg_params and "10" in seg_params["all"]:
        best_all = seg_params["all"]["10"]["best"]
        prof = evaluate_profitability(events, best_all["K"], best_all["TS"])
        profitable = {k: v for k, v in prof.items() if v["avg_pnl"] > 0}
        unprofitable = {k: v for k, v in prof.items() if v["avg_pnl"] <= 0}

        if profitable:
            print("  PROFITABLE segments:")
            for k, v in sorted(profitable.items(), key=lambda x: -x[1]["avg_pnl"]):
                print(f"    {k:>25}: {v['n_trades']} trades, win={v['win_rate']:.3f}, "
                      f"avg_pnl={v['avg_pnl']:+.5f}, total={v['total_pnl']:+.4f}")

        print(f"\n  Unprofitable segments: {len(unprofitable)}")
        for k, v in sorted(unprofitable.items(), key=lambda x: x[1]["avg_pnl"]):
            print(f"    {k:>25}: {v['n_trades']} trades, win={v['win_rate']:.3f}, "
                  f"avg_pnl={v['avg_pnl']:+.5f}")

    # ── 6. Also check with crunch-specific params ──
    print(f"\n{'─' * 70}")
    print("6. PROFITABILITY — With crunch-specific params")
    print("─" * 70)
    if "crunch" in seg_params and "10" in seg_params["crunch"]:
        best_crunch = seg_params["crunch"]["10"]["best"]
        print(f"  Using K={best_crunch['K']}, TS={best_crunch['TS']}")
        crunch_events = [e for e in events if e["is_crunch"]]
        prof_crunch = evaluate_profitability(crunch_events, best_crunch["K"], best_crunch["TS"])
        for k, v in sorted(prof_crunch.items(), key=lambda x: -x[1]["avg_pnl"]):
            print(f"    {k:>25}: {v['n_trades']} trades, win={v['win_rate']:.3f}, "
                  f"avg_pnl={v['avg_pnl']:+.5f}, total={v['total_pnl']:+.4f}")

    # ── Save results ──
    output = {
        "current_model": {
            "K": 0.7, "TS": 0.45,
            "eval_all_10s": evaluate(events, 0.7, 0.45, "10"),
        },
        "segment_params": {},
        "market_efficiency": efficiency,
    }

    # Convert segment params for JSON (simplify)
    for seg_name, offsets in seg_params.items():
        output["segment_params"][seg_name] = {}
        for offset, data in offsets.items():
            output["segment_params"][seg_name][offset] = {
                "best_K": data["best"]["K"],
                "best_TS": data["best"]["TS"],
                "mae": round(data["best"]["mae"], 5),
                "dir_acc": round(data["best"]["dir_acc"], 4),
                "n": data["n"],
            }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nResults saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
