"""
Word bank + helpers.

pick_words(n, exclude) → list[str]   used by GameRoom to give the drawer choices.
pick_word(exclude)     → str          used internally when auto-picking.
"""
from __future__ import annotations

import random
from typing import Sequence

# ---------------------------------------------------------------------------
# Word list — broad categories so every game feels different
# ---------------------------------------------------------------------------

WORD_LIST: list[str] = [
    # Animals
    "cat", "dog", "elephant", "giraffe", "penguin", "whale", "dolphin",
    "tiger", "lion", "bear", "zebra", "kangaroo", "monkey", "parrot",
    "crocodile", "turtle", "octopus", "jellyfish", "flamingo", "koala",
    # Food
    "pizza", "hamburger", "sushi", "ice cream", "chocolate", "banana",
    "strawberry", "watermelon", "pineapple", "avocado", "popcorn",
    "pancakes", "sandwich", "taco", "donut", "cupcake", "spaghetti",
    # Objects
    "umbrella", "telescope", "piano", "bicycle", "camera", "compass",
    "hourglass", "lighthouse", "spaceship", "submarine", "helicopter",
    "backpack", "lantern", "magnet", "microscope", "parachute",
    # Nature
    "rainbow", "volcano", "tornado", "snowflake", "sunset", "waterfall",
    "mountain", "island", "cave", "forest", "desert", "glacier",
    # Actions / concepts
    "dancing", "swimming", "flying", "sleeping", "cooking", "laughing",
    "fishing", "camping", "skiing", "surfing",
]


def pick_words(n: int, exclude: Sequence[str] = ()) -> list[str]:
    """
    Return *n* distinct words from WORD_LIST, skipping already-used ones.
    Falls back to full list when the pool is nearly exhausted.
    """
    pool = [w for w in WORD_LIST if w not in exclude]
    if len(pool) < n:
        pool = WORD_LIST  # ponytail: reset pool rather than error on exhaustion
    return random.sample(pool, min(n, len(pool)))


def pick_word(exclude: Sequence[str] = ()) -> str:
    """Single random word; convenience wrapper around pick_words."""
    return pick_words(1, exclude)[0]
