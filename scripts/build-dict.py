#!/usr/bin/env python3
"""Build offline dictionary chunks from ECDICT.

ECDICT source: https://github.com/skywind3000/ECDICT
Pinned commit: bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
from pathlib import Path

from wordfreq import top_n_list


WORD_RE = re.compile(r"^[a-z]+(?:'[a-z]+)*$")
SOURCE_URL = "https://github.com/skywind3000/ECDICT"
SOURCE_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"


def compact_lines(value: str, limit: int | None = None) -> str:
    lines = []
    for line in str(value or "").replace("\\n", "\n").replace("\r\n", "\n").split("\n"):
        text = line.strip()
        if not text or text.startswith("[网络]"):
            continue
        lines.append(text)
    if limit is not None:
        lines = lines[:limit]
    return "\n".join(lines)


def is_wanted(row: dict[str, str], word: str, ranks: dict[str, int]) -> bool:
    if not WORD_RE.match(word):
        return False
    if not compact_lines(row.get("translation", ""), 4):
        return False
    return (
        word in ranks
        or bool(row.get("tag"))
        or (row.get("collins") or "").strip() not in {"", "0"}
        or (row.get("oxford") or "").strip() not in {"", "0"}
        or int(row.get("bnc") or 0) > 0
        or int(row.get("frq") or 0) > 0
    )


def row_entry(row: dict[str, str], rank: int | None) -> dict[str, object]:
    entry: dict[str, object] = {}
    if row.get("phonetic"):
        entry["p"] = row["phonetic"].strip()
    entry["t"] = compact_lines(row.get("translation", ""), 4)
    definition = compact_lines(row.get("definition", ""), 2)
    if definition:
        entry["d"] = definition
    if row.get("exchange"):
        entry["x"] = row["exchange"].strip()
    if rank is not None:
        entry["r"] = rank
    return entry


def prefer(existing: tuple[str, dict[str, object]] | None, word: str, original: str) -> bool:
    if existing is None:
        return True
    current_original, _entry = existing
    if original == word and current_original != word:
        return True
    return False


def write_module(path: Path, data: dict[str, dict[str, object]]) -> None:
    text = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    path.write_text(f"export default {text};\n", encoding="utf-8")


def build(ecdict: Path, outdir: Path, license_path: Path | None) -> dict[str, object]:
    ranks = {word: index + 1 for index, word in enumerate(top_n_list("en", 30000))}
    chosen: dict[str, tuple[str, dict[str, object]]] = {}
    with ecdict.open("r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            original = (row.get("word") or "").strip()
            word = original.lower()
            if not is_wanted(row, word, ranks):
                continue
            rank = ranks.get(word)
            entry = row_entry(row, rank)
            if prefer(chosen.get(word), word, original):
                chosen[word] = (original, entry)

    if outdir.exists():
        shutil.rmtree(outdir)
    outdir.mkdir(parents=True)
    manifest_chunks = {}
    total_bytes = 0
    max_bytes = 0
    for letter in "abcdefghijklmnopqrstuvwxyz":
      chunk = {word: entry for word, (_original, entry) in sorted(chosen.items()) if word.startswith(letter)}
      path = outdir / f"{letter}.mjs"
      write_module(path, chunk)
      content = path.read_bytes()
      size = len(content)
      total_bytes += size
      max_bytes = max(max_bytes, size)
      manifest_chunks[letter] = {
          "count": len(chunk),
          "bytes": size,
          "sha256": hashlib.sha256(content).hexdigest(),
      }
    manifest = {
        "source": {"url": SOURCE_URL, "commit": SOURCE_COMMIT},
        "total": sum(item["count"] for item in manifest_chunks.values()),
        "totalBytes": total_bytes,
        "maxChunkBytes": max_bytes,
        "chunks": manifest_chunks,
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    if license_path:
        mit = license_path.read_text(encoding="utf-8")
        (outdir / "LICENSE-ECDICT.md").write_text(
            "# ECDICT License and Source\n\n"
            f"Source: {SOURCE_URL}\n\n"
            f"Commit: `{SOURCE_COMMIT}`\n\n"
            "Changes: filtered to English word keys matching `^[a-z]+(?:'[a-z]+)*$`, removed `[网络]` translation lines, "
            "trimmed translations/definitions, split entries into deterministic letter chunks, and added wordfreq ranks for the top 30,000 words.\n\n"
            "## MIT License\n\n"
            f"{mit}",
            encoding="utf-8",
        )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ecdict", required=True, type=Path)
    parser.add_argument("--outdir", default=Path("dict"), type=Path)
    parser.add_argument("--license", dest="license_path", type=Path)
    args = parser.parse_args()
    manifest = build(args.ecdict, args.outdir, args.license_path)
    print(json.dumps({
        "total": manifest["total"],
        "totalBytes": manifest["totalBytes"],
        "maxChunkBytes": manifest["maxChunkBytes"],
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
