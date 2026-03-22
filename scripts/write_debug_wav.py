#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
from pathlib import Path
import wave


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Write a short deterministic WAV file for smoke tests.")
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--text", default="")
    parser.add_argument("--seconds", type=float, default=1.2)
    parser.add_argument("--sample-rate", type=int, default=16_000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    amplitude = 12_000
    frequency = 440.0 if args.text.strip() else 330.0
    frame_count = max(1, int(args.seconds * args.sample_rate))

    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(args.sample_rate)
        frames = bytearray()
        for index in range(frame_count):
            sample = int(amplitude * math.sin((2.0 * math.pi * frequency * index) / args.sample_rate))
            frames.extend(sample.to_bytes(2, byteorder="little", signed=True))
        wav_file.writeframes(frames)

    print(output_path)


if __name__ == "__main__":
    main()
