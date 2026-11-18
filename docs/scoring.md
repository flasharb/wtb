# Wallet Quality Scoring Methodology & Documentation

This document describes the mathematical formula, Bayesian shrinkage model, and performance tracking system used to compute the dynamic **Wallet Quality Score (0–100)** for tracked whales on Solana and Ethereum.

---

## 1. Overview & Objectives

Whale tracking without performance measurement leads to noise: some high-capital wallets consistently generate positive alpha, while others are spray-and-pray retail gamblers, unhedged market makers, or bait accounts.

The scoring system dynamically adjusts each wallet's quality score from **0 to 100** based on the real-world return of tokens following their recorded buys:
- **Prior Baseline:** Every wallet starts with a neutral prior score of **50**.
- **Empirical Tracking:** Signal performance is measured at **+1h, +24h, and +7d**.
- **Bayesian Shrinkage:** Wallets with few recorded trades ($n < 10$) are shrunk towards the neutral prior of 50 to avoid small-sample bias.
- **Nightly Recomputation:** Scores are recalculated nightly from empirical `signal_outcomes`.

---

## 2. Mathematical Formulation

### A. Trade Outcome Evaluation
For each recorded buy by wallet $W$ on token $T$ at block timestamp $t_0$ with alert price $P_0$:
- Price at $+24\text{h}$: $P_{24h}$, Return $R_{24h} = \frac{P_{24h} - P_0}{P_0} \times 100$
- Price at $+7\text{d}$: $P_{7d}$, Return $R_{7d} = \frac{P_{7d} - P_0}{P_0} \times 100$

A trade is classified as a **Win** if $R_{24h} > 0\%$ (or $R_{7d} > 0\%$).

### B. Raw Performance Metric ($S_{\text{raw}}$)
We compute:
1. **Win Rate ($\text{WR}$):**
   $$\text{WR} = 0.4 \times \text{WinRate}_{24h} + 0.6 \times \text{WinRate}_{7d} \quad (\in [0, 100])$$
2. **Normalized Median Return Factor ($M$):**
   $$M = \min(\max(\text{Median}(R_{24h}, R_{7d}), -50\%), +150\%)$$
   Converted to a 0–100 scale:
   $$\text{ReturnScore} = 50 + \left(\frac{M}{2}\right)$$
3. **Composite Raw Score:**
   $$S_{\text{raw}} = 0.65 \times \text{WR} + 0.35 \times \text{ReturnScore}$$

### C. Bayesian Shrinkage Model
To prevent a wallet that got lucky on 1 or 2 trades from receiving a 100 score:

$$\text{Quality Score} = \left(\frac{n}{n + k}\right) \times S_{\text{raw}} + \left(\frac{k}{n + k}\right) \times \mu_0$$

Where:
- $n$: Number of completed, evaluated trades for the wallet.
- $k$: Shrinkage parameter (default $k = 10$).
- $\mu_0$: Neutral prior score (default $\mu_0 = 50$).

### Interpretation Table:

| Sample Size ($n$) | Raw Score ($S_{\text{raw}}$) | Shrinkage Weight $\frac{n}{n+10}$ | Final Quality Score |
| :--- | :--- | :--- | :--- |
| **0 trades** | N/A | 0% | **50** (Neutral prior) |
| **2 trades** | 90 (2 lucky wins) | 16.7% | **56.7** (Safely dampened) |
| **5 trades** | 85 (Consistent) | 33.3% | **61.7** |
| **10 trades** | 85 | 50.0% | **67.5** |
| **25 trades** | 88 (Proven alpha) | 71.4% | **77.1** |
| **50 trades** | 92 (Elite whale) | 83.3% | **85.0** (Qualifies for high-conviction signal) |

---

## 3. High-Conviction Signal Threshold

In Section 5 of the specification:
- A **High-Conviction Single Signal** requires:
  1. Quality Score $\ge 80$
  2. Buy size $\ge \$50,000$
- Because of shrinkage ($k = 10$), a wallet **cannot** reach an 80+ score without having at least 15+ verified profitable historical trades. This eliminates rugpull promoters, fake wash trading, and single-hit wonders from triggering single-whale alerts.

---

## 4. Recomputation Schedule

- **Scheduler:** The BullMQ job `recompute-scores` executes daily at `02:00 UTC`.
- **Query:** Pulls all `buys` joined with `signal_outcomes` where horizon is $+24\text{h}$ or $+7\text{d}$.
- **Output:** Updates `wallets.quality_score` in PostgreSQL.
