"""
Pure scoring functions — no side-effects, easy to unit test.

>>> calculate_guesser_score(0, 80)   # instant guess
200
>>> calculate_guesser_score(80, 80)  # last-second guess
100
>>> calculate_drawer_score(2)
100
"""
from __future__ import annotations


def calculate_guesser_score(
    elapsed: float,
    total: int,
    base: int = 100,
    bonus_max: int = 100,
) -> int:
    """
    base + time_bonus, where bonus scales linearly from bonus_max → 0
    as elapsed goes from 0 → total.
    """
    if total <= 0:
        return base
    fraction_remaining = max(0.0, 1.0 - elapsed / total)
    return base + round(bonus_max * fraction_remaining)


def calculate_drawer_score(correct_guessers: int, per_correct: int = 50) -> int:
    """Drawer earns per_correct points for every guesser who got it right."""
    return correct_guessers * per_correct


if __name__ == "__main__":
    # ponytail: minimal self-check — run with `python -m app.game.scoring`
    assert calculate_guesser_score(0, 80) == 200
    assert calculate_guesser_score(80, 80) == 100
    assert calculate_guesser_score(40, 80) == 150
    assert calculate_drawer_score(2) == 100
    print("scoring OK")
