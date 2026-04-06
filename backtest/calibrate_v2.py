"""
calibrate_v2.py — Calibrate win probability model against market prices as ground truth.

Instead of predicting post-scoring price changes, we ask:
"Given (score, time), does our model produce probabilities that match what the market says?"

The market price IS the best estimate of true win probability. Our model should closely
track it. Where it disagrees, either:
  a) Our model is wrong (most of the time), or
  b) The market is mispricing (rare, but tradeable when it happens)

We use the 8,690 events' pre-scoring market prices as ground truth samples of
P(home_win | score, time), then fit K and TS to minimize error against those.
"""

import json
import math
import sys
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EVENTS_PATH = PROJECT_ROOT / "data" / "backtest_results" / "v3_events.json"
OUTPUT_PATH = PROJECT_ROOT / "data" / "backtest_results" / "calibration_v2.json"


def model_prob(lead: float, secs: float, K: float, TS: float) -> float:
    """P_home = 1 / (1 + exp(-K*lead / (TS*sqrt(secs))))"""
    effective_secs = max(30, secs)
    z = -K * lead / (TS * math.sqrt(effective_secs))
    z = max(-20, min(20, z))
    return 1 / (1 + math.exp(z))


def evaluate_fit(samples: list, K: float, TS: float) -> dict:
    """Compare model win prob vs market price for each sample."""
    errors = []
    sq_errors = []
    abs_errors = []
    bucket_errors = defaultdict(list)  # by predicted prob bucket

    for s in samples:
        predicted = model_prob(s["lead"], s["secs"], K, TS)
        actual = s["market_prob"]
        err = predicted - actual
        errors.append(err)
        sq_errors.append(err ** 2)
        abs_errors.append(abs(err))

        # Calibration: bucket by predicted prob, check avg actual
        bucket = round(predicted * 10) / 10  # 0.1, 0.2, ..., 0.9
        bucket_errors[bucket].append((predicted, actual))

    mae = sum(abs_errors) / len(abs_errors)
    rmse = math.sqrt(sum(sq_errors) / len(sq_errors))
    bias = sum(errors) / len(errors)

    # Calibration: for events where model says ~70%, does market agree ~70%?
    calibration = {}
    for bucket, pairs in sorted(bucket_errors.items()):
        if len(pairs) >= 10:
            avg_pred = sum(p for p, _ in pairs) / len(pairs)
            avg_actual = sum(a for _, a in pairs) / len(pairs)
            calibration[f"{bucket:.1f}"] = {
                "n": len(pairs),
                "avg_predicted": round(avg_pred, 4),
                "avg_market": round(avg_actual, 4),
                "gap": round(avg_pred - avg_actual, 4),
            }

    return {"mae": mae, "rmse": rmse, "bias": bias, "n": len(samples),
            "calibration": calibration}


def extract_samples(events: list) -> list:
    """Extract (lead, secs_remaining, market_prob) samples from events.

    market_prob = the YES price before the scoring event.
    If yes_is_home, YES price = P(home win).
    If NOT yes_is_home, YES price = P(away win), so P(home win) = 1 - YES price.

    We use the BEFORE price because it represents the market's assessment
    BEFORE the scoring event, at a known (score, time) state.
    """
    samples = []
    for e in events:
        price_before = e["price_before"]
        yes_is_home = e["yes_is_home"]
        secs = e["secs_remaining"]

        # Score BEFORE this event
        score_home = e["score_home"]
        score_away = e["score_away"]
        points = e["points"]
        is_home = e["is_home"]

        # Undo the scoring event to get the state the market was pricing
        if is_home:
            score_home -= points
        else:
            score_away -= points

        lead = score_home - score_away

        # Convert YES price to home win probability
        if yes_is_home:
            market_prob = price_before
        else:
            market_prob = 1 - price_before

        # Skip extreme prices (market already decided)
        if market_prob < 0.03 or market_prob > 0.97:
            continue

        samples.append({
            "lead": lead,
            "secs": secs,
            "market_prob": market_prob,
            "period": e["period"],
            "abs_margin": abs(lead),
            "is_crunch": e["is_crunch"],
            "is_prime": e["is_prime"],
        })

    return samples


def grid_search(samples: list, fine: bool = False) -> list:
    """Grid search over K and TS."""
    if fine:
        k_values = [round(0.01 + i * 0.01, 3) for i in range(100)]  # 0.01 to 1.0
        ts_values = [round(0.01 + i * 0.01, 3) for i in range(100)]  # 0.01 to 1.0
    else:
        k_values = [round(0.05 + i * 0.05, 2) for i in range(40)]  # 0.05 to 2.0
        ts_values = [round(0.05 + i * 0.05, 2) for i in range(30)]  # 0.05 to 1.5

    results = []
    for K in k_values:
        for TS in ts_values:
            r = evaluate_fit(samples, K, TS)
            results.append({"K": K, "TS": TS, "mae": r["mae"], "rmse": r["rmse"],
                            "bias": r["bias"]})

    results.sort(key=lambda x: x["mae"])
    return results


def main():
    print("=" * 70)
    print("MODEL CALIBRATION v2 — Fit model to market prices as ground truth")
    print("=" * 70)

    events = json.load(open(EVENTS_PATH))
    samples = extract_samples(events)
    print(f"Loaded {len(events)} events → {len(samples)} valid samples\n")

    # ── 1. Current live model ──
    print("─" * 70)
    print("1. CURRENT LIVE MODEL (K=0.7, TS=0.45)")
    print("─" * 70)
    current = evaluate_fit(samples, 0.7, 0.45)
    print(f"  MAE={current['mae']:.4f}, RMSE={current['rmse']:.4f}, bias={current['bias']:+.4f}")
    print(f"  Calibration (model_bucket → avg_predicted vs avg_market):")
    for bucket, cal in current["calibration"].items():
        gap_indicator = "✓" if abs(cal["gap"]) < 0.02 else "✗"
        print(f"    {bucket}: pred={cal['avg_predicted']:.3f}, market={cal['avg_market']:.3f}, "
              f"gap={cal['gap']:+.3f} {gap_indicator}  (n={cal['n']})")

    # ── 2. Coarse grid search ──
    print(f"\n{'─' * 70}")
    print("2. COARSE GRID SEARCH (all samples)")
    print("─" * 70)
    coarse = grid_search(samples, fine=False)
    print(f"  Top 10:")
    for r in coarse[:10]:
        print(f"    K={r['K']:.2f}, TS={r['TS']:.2f} → MAE={r['mae']:.5f}, RMSE={r['rmse']:.5f}, bias={r['bias']:+.5f}")

    best_coarse = coarse[0]

    # ── 3. Fine grid search around best ──
    print(f"\n{'─' * 70}")
    print(f"3. FINE GRID SEARCH around K={best_coarse['K']}, TS={best_coarse['TS']}")
    print("─" * 70)

    fine_k = [round(max(0.01, best_coarse["K"] - 0.15) + i * 0.005, 3) for i in range(60)]
    fine_ts = [round(max(0.01, best_coarse["TS"] - 0.15) + i * 0.005, 3) for i in range(60)]

    fine_results = []
    for K in fine_k:
        for TS in fine_ts:
            r = evaluate_fit(samples, K, TS)
            fine_results.append({"K": K, "TS": TS, "mae": r["mae"], "rmse": r["rmse"],
                                 "bias": r["bias"]})
    fine_results.sort(key=lambda x: x["mae"])

    print(f"  Top 10:")
    for r in fine_results[:10]:
        print(f"    K={r['K']:.3f}, TS={r['TS']:.3f} → MAE={r['mae']:.6f}, RMSE={r['rmse']:.6f}, bias={r['bias']:+.6f}")

    best = fine_results[0]
    best_K, best_TS = best["K"], best["TS"]

    # ── 4. Calibration with best params ──
    print(f"\n{'─' * 70}")
    print(f"4. CALIBRATION with best params K={best_K}, TS={best_TS}")
    print("─" * 70)
    best_eval = evaluate_fit(samples, best_K, best_TS)
    print(f"  MAE={best_eval['mae']:.4f}, RMSE={best_eval['rmse']:.4f}, bias={best_eval['bias']:+.4f}")
    print(f"  Calibration:")
    for bucket, cal in best_eval["calibration"].items():
        gap_indicator = "✓" if abs(cal["gap"]) < 0.02 else "✗"
        print(f"    {bucket}: pred={cal['avg_predicted']:.3f}, market={cal['avg_market']:.3f}, "
              f"gap={cal['gap']:+.3f} {gap_indicator}  (n={cal['n']})")

    # ── 5. Segment-specific calibration ──
    print(f"\n{'─' * 70}")
    print("5. SEGMENT ANALYSIS with best params")
    print("─" * 70)

    segment_defs = {
        "all": lambda s: True,
        "Q1_Q3": lambda s: s["period"] <= 3,
        "Q4": lambda s: s["period"] == 4,
        "crunch": lambda s: s["is_crunch"],
        "prime": lambda s: s["is_prime"],
        "tight_0_4": lambda s: s["abs_margin"] <= 4,
        "close_5_8": lambda s: 5 <= s["abs_margin"] <= 8,
        "moderate_9_15": lambda s: 9 <= s["abs_margin"] <= 15,
        "blowout_16": lambda s: s["abs_margin"] >= 16,
    }

    seg_results = {}
    for seg_name, pred in segment_defs.items():
        seg_samples = [s for s in samples if pred(s)]
        if len(seg_samples) < 30:
            continue
        # Evaluate with global best params
        r = evaluate_fit(seg_samples, best_K, best_TS)
        # Also find segment-specific best params
        seg_grid = grid_search(seg_samples, fine=False)
        seg_best = seg_grid[0]

        print(f"\n  {seg_name} ({len(seg_samples)} samples):")
        print(f"    Global params: MAE={r['mae']:.4f}, RMSE={r['rmse']:.4f}, bias={r['bias']:+.4f}")
        print(f"    Best params:   K={seg_best['K']:.2f}, TS={seg_best['TS']:.2f}, "
              f"MAE={seg_best['mae']:.4f}, bias={seg_best['bias']:+.4f}")

        seg_results[seg_name] = {
            "n": len(seg_samples),
            "global": {"mae": round(r["mae"], 5), "rmse": round(r["rmse"], 5),
                       "bias": round(r["bias"], 5)},
            "best": {"K": seg_best["K"], "TS": seg_best["TS"],
                     "mae": round(seg_best["mae"], 5), "bias": round(seg_best["bias"], 5)},
        }

    # ── 6. Compare old vs new ──
    print(f"\n{'─' * 70}")
    print("6. IMPROVEMENT: Old (K=0.7, TS=0.45) vs New")
    print("─" * 70)
    old_eval = evaluate_fit(samples, 0.7, 0.45)
    new_eval = evaluate_fit(samples, best_K, best_TS)
    print(f"  Old: MAE={old_eval['mae']:.5f}, RMSE={old_eval['rmse']:.5f}")
    print(f"  New: MAE={new_eval['mae']:.5f}, RMSE={new_eval['rmse']:.5f}")
    print(f"  Improvement: MAE {((old_eval['mae'] - new_eval['mae']) / old_eval['mae'] * 100):.1f}%, "
          f"RMSE {((old_eval['rmse'] - new_eval['rmse']) / old_eval['rmse'] * 100):.1f}%")

    # ── 7. Where model disagrees with market (potential edge) ──
    print(f"\n{'─' * 70}")
    print("7. MODEL-MARKET DISAGREEMENTS (potential edge)")
    print("─" * 70)
    disagreements = {"underpriced_home": 0, "overpriced_home": 0, "big_gaps": []}
    for s in samples:
        pred = model_prob(s["lead"], s["secs"], best_K, best_TS)
        gap = pred - s["market_prob"]
        if gap > 0.02:
            disagreements["underpriced_home"] += 1
        elif gap < -0.02:
            disagreements["overpriced_home"] += 1
        if abs(gap) > 0.05:
            disagreements["big_gaps"].append({
                "lead": s["lead"], "secs": s["secs"],
                "model": round(pred, 3), "market": round(s["market_prob"], 3),
                "gap": round(gap, 3), "period": s["period"],
            })

    print(f"  Model says home underpriced (gap > 2¢): {disagreements['underpriced_home']} ({disagreements['underpriced_home']/len(samples)*100:.1f}%)")
    print(f"  Model says home overpriced (gap < -2¢): {disagreements['overpriced_home']} ({disagreements['overpriced_home']/len(samples)*100:.1f}%)")
    print(f"  Big disagreements (|gap| > 5¢): {len(disagreements['big_gaps'])}")
    if disagreements["big_gaps"][:10]:
        print(f"  Sample big gaps:")
        for g in sorted(disagreements["big_gaps"], key=lambda x: -abs(x["gap"]))[:10]:
            print(f"    lead={g['lead']:+3d}, secs={g['secs']:6.0f}, P{g['period']}: "
                  f"model={g['model']:.3f}, market={g['market']:.3f}, gap={g['gap']:+.3f}")

    # ── Save output ──
    output = {
        "best_params": {"K": best_K, "TS": best_TS},
        "best_eval": {
            "mae": round(best_eval["mae"], 6),
            "rmse": round(best_eval["rmse"], 6),
            "bias": round(best_eval["bias"], 6),
        },
        "old_eval": {
            "K": 0.7, "TS": 0.45,
            "mae": round(old_eval["mae"], 6),
            "rmse": round(old_eval["rmse"], 6),
        },
        "improvement_pct": round((old_eval["mae"] - new_eval["mae"]) / old_eval["mae"] * 100, 1),
        "segment_results": seg_results,
        "calibration": best_eval["calibration"],
        "n_samples": len(samples),
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 70}")
    print(f"RECOMMENDATION: Update win-probability.ts")
    print(f"  MODEL_COEF = {best_K}  (was 0.7)")
    print(f"  STD_SCALE  = {best_TS}  (was 0.45)")
    print(f"  Calibrated on {len(samples)} market price observations from {len(events)} events")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
