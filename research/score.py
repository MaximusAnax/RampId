#!/usr/bin/env python3
"""Rank business candidates by projected profit per founder-hour.

The point of this script is to stop me from picking the idea that sounds best.
Every candidate gets the same arithmetic applied to it, and the arithmetic is
driven by one number that matters: profit divided by the founder's hours.

Usage:
    python3 research/score.py                  # score candidates.json
    python3 research/score.py --sensitivity    # also show pessimistic/optimistic bands
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from dataclasses import dataclass

HERE = pathlib.Path(__file__).parent
CANDIDATES = HERE / "candidates.json"

# Horizon over which we evaluate. Short on purpose: a plan that only pays off in
# year three is not a plan, it is a hope.
HORIZON_MONTHS = 12


@dataclass
class Candidate:
    name: str
    acv: float                  # annual contract value, USD
    gross_margin: float         # after COGS (inference, data, hosting)
    clients_y1: int             # realistically closeable in 12 months
    hours_build: float          # one-time, founder hours
    hours_sell: float           # founder hours per closed deal
    hours_deliver: float        # founder hours per client per year
    hours_ops_monthly: float    # founder hours per month keeping lights on
    p_success: float            # probability the thesis survives contact with reality
    notes: str = ""

    @property
    def revenue(self) -> float:
        return self.acv * self.clients_y1

    @property
    def profit(self) -> float:
        return self.revenue * self.gross_margin

    @property
    def hours(self) -> float:
        return (
            self.hours_build
            + self.hours_sell * self.clients_y1
            + self.hours_deliver * self.clients_y1
            + self.hours_ops_monthly * HORIZON_MONTHS
        )

    @property
    def profit_per_hour(self) -> float:
        return self.profit / self.hours if self.hours else 0.0

    @property
    def risk_adjusted(self) -> float:
        """Expected profit per hour. An idea with a 20% chance of working is worth
        exactly one fifth of its headline number, and should be compared that way."""
        return self.profit_per_hour * self.p_success

    def hour_breakdown(self) -> dict[str, float]:
        return {
            "build": self.hours_build,
            "sell": self.hours_sell * self.clients_y1,
            "deliver": self.hours_deliver * self.clients_y1,
            "ops": self.hours_ops_monthly * HORIZON_MONTHS,
        }


def load() -> list[Candidate]:
    if not CANDIDATES.exists():
        sys.exit(f"no candidates file at {CANDIDATES}")
    raw = json.loads(CANDIDATES.read_text())
    return [Candidate(**c) for c in raw]


def money(x: float) -> str:
    if x >= 1_000_000:
        return f"${x/1_000_000:.2f}M"
    if x >= 1_000:
        return f"${x/1_000:.0f}k"
    return f"${x:.0f}"


def report(cands: list[Candidate], sensitivity: bool) -> None:
    cands = sorted(cands, key=lambda c: c.risk_adjusted, reverse=True)

    print(f"\n{'CANDIDATE':<34} {'REVENUE':>9} {'HOURS':>7} {'$/HR':>8} {'p':>5} {'ADJ $/HR':>9}")
    print("-" * 78)
    for c in cands:
        print(
            f"{c.name[:34]:<34} {money(c.revenue):>9} {c.hours:>7.0f} "
            f"{money(c.profit_per_hour):>8} {c.p_success:>5.2f} {money(c.risk_adjusted):>9}"
        )

    print("\nWhere the founder's hours actually go:")
    print("-" * 78)
    for c in cands:
        b = c.hour_breakdown()
        total = sum(b.values()) or 1
        bars = "  ".join(f"{k} {v/total*100:.0f}%" for k, v in b.items())
        print(f"  {c.name[:34]:<34} {bars}")

    if sensitivity:
        print("\nSensitivity — what if I close half as many clients at 70% of the price?")
        print("-" * 78)
        for c in cands:
            pess = Candidate(
                **{**c.__dict__, "acv": c.acv * 0.7, "clients_y1": max(1, c.clients_y1 // 2)}
            )
            print(
                f"  {c.name[:34]:<34} base {money(c.risk_adjusted):>8}/hr "
                f"→ pessimistic {money(pess.risk_adjusted * c.p_success):>8}/hr"
            )

    winner = cands[0]
    print(f"\nWINNER: {winner.name}")
    print(f"  {money(winner.revenue)} revenue on {winner.hours:.0f} founder-hours")
    print(f"  = {money(winner.risk_adjusted)}/hour risk-adjusted")
    if winner.notes:
        print(f"  {winner.notes}")
    print()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sensitivity", action="store_true")
    report(load(), ap.parse_args().sensitivity)
