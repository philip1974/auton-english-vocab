#!/usr/bin/env python3
"""Build the pinned English wordfreq list for English Vocab.

Source package: wordfreq 3.1.1.
Filtering rule: keep only lowercase English words that match
^[a-z]+(?:'[a-z]+)*$, preserving wordfreq's original order, then take the first
30,000 items. Rank is the filtered index + 1.
"""

import json
import re
import sys
from importlib.metadata import version
from pathlib import Path

from wordfreq import top_n_list

PINNED_VERSION = "3.1.1"
COUNT = 30_000
WORD_RE = re.compile(r"^[a-z]+(?:'[a-z]+)*$")


def main() -> int:
    actual = version("wordfreq")
    if actual != PINNED_VERSION:
        print(f"wordfreq {PINNED_VERSION} is required, found {actual}", file=sys.stderr)
        return 1

    words = []
    seen = set()
    request_size = 32_000
    while len(words) < COUNT:
        for word in top_n_list("en", request_size):
            normalized = word.lower()
            if normalized in seen or not WORD_RE.fullmatch(normalized):
                continue
            seen.add(normalized)
            words.append(normalized)
            if len(words) == COUNT:
                break
        if len(words) < COUNT:
            request_size *= 2

    out = Path("data/en-wordfreq-30k.json")
    out.write_text(json.dumps(words, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
