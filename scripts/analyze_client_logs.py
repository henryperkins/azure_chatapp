"""Analyze browser client log file for recent warnings and errors.

Usage:
    python scripts/analyze_client_logs.py [path_to_log] [--last N]

The log file is expected to contain one JSON object per line as produced by
services/client_log_service.ClientLogService (see CLIENT_LOG_FILE setting).

The script prints a human-readable summary including:
  • Total number of error/critical entries
  • Total number of warning entries
  • Top 10 most frequent error messages
  • The last N (default 20) error/warning events with timestamps
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, deque
from pathlib import Path
from typing import Any, Deque, Dict, List


def load_lines(path: Path) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    if not path.exists():
        print(f"Log file not found: {path}")
        return events

    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                # skip malformed line
                continue
            events.append(obj)
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze client browser logs")
    parser.add_argument("logfile", nargs="?", default="client_logs.log", help="Path to client log file")
    parser.add_argument("--last", type=int, default=20, help="Show last N events")

    args = parser.parse_args()

    path = Path(args.logfile)
    events = load_lines(path)
    if not events:
        print("No events found in log file.")
        return

    warn_levels = {"warn", "warning"}
    error_levels = {"error", "critical"}

    warn_count = sum(1 for e in events if e.get("level") in warn_levels)
    error_count = sum(1 for e in events if e.get("level") in error_levels)

    print("=== Client Browser Log Summary ===")
    print(f"Total events: {len(events):,}")
    print(f"Warnings      : {warn_count:,}")
    print(f"Errors/Critical: {error_count:,}\n")

    # Top 10 frequent error messages
    error_messages = Counter()
    for e in events:
        if e.get("level") in error_levels:
            msg = str(e.get("message", ""))
            error_messages[msg] += 1

    if error_messages:
        print("Top 10 error messages:")
        for msg, cnt in error_messages.most_common(10):
            print(f"  {cnt:>5} × {msg}")
        print()

    # Last N events (warn + error)
    recent: Deque[Dict[str, Any]] = deque(maxlen=args.last)
    for e in events:
        if e.get("level") in warn_levels.union(error_levels):
            recent.append(e)

    if recent:
        print(f"Last {len(recent)} warning/error events:")
        for e in recent:
            ts = e.get("timestamp", "?")
            lvl = e.get("level")
            ctx = e.get("context")
            msg = e.get("message")
            print(f"[{ts}] {lvl.upper():7} {ctx:<30} – {msg}")


if __name__ == "__main__":
    main()
