"""Flexion Day-1 gate G5: can Bedrock Nova turn a photo of a hand therapist's exercise sheet into a structured routine?

Usage:  python nova_sheet.py <sheet.jpg|.png|.webp>
Env:    usual AWS credentials (AWS_PROFILE or the default profile), AWS_REGION (default us-east-1),
        NOVA_MODEL_ID (default us.amazon.nova-2-lite-v1:0)
Pass:   valid JSON, every exercise on the sheet present, numbers match the sheet, every written limit captured,
        nothing invented (check by eye against the photo).
"""
import json
import os
import pathlib
import sys
import time

import boto3

FORMATS = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp"}
PROMPT = """You are reading a home exercise sheet written by a hand therapist.
Return ONLY a JSON object, no prose, with this shape:
{"exercises": [{"name": "", "fingers_or_joint": "", "reps": null, "sets": null, "hold_seconds": null,
  "times_per_day": null, "instructions": ""}],
 "limits": ["every restriction the therapist wrote: pain rules, ranges not to exceed, things to avoid, splint rules"],
 "unreadable": ["anything you could not read"]}
Use null for any number the sheet does not state. Never guess or invent a number."""


def main(path: str) -> None:
    sheet = pathlib.Path(path)
    fmt = FORMATS.get(sheet.suffix.lower())
    if fmt is None:
        sys.exit(f"Unsupported image type {sheet.suffix}; use one of {', '.join(FORMATS)}")
    client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    model = os.environ.get("NOVA_MODEL_ID", "us.amazon.nova-2-lite-v1:0")
    start = time.perf_counter()
    resp = client.converse(
        modelId=model,
        messages=[{"role": "user", "content": [
            {"image": {"format": fmt, "source": {"bytes": sheet.read_bytes()}}},
            {"text": PROMPT},
        ]}],
        inferenceConfig={"temperature": 0, "maxTokens": 2000},
    )
    ms = (time.perf_counter() - start) * 1000
    text = resp["output"]["message"]["content"][0]["text"].strip()
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        routine = json.loads(text)
    except json.JSONDecodeError:
        sys.exit(f"G5 FAIL: the model did not return JSON:\n{text}")
    exercises = routine.get("exercises") or []
    print(json.dumps(routine, indent=2, ensure_ascii=False))
    print(f"\n{model} · {ms:.0f} ms · {resp['usage']}")
    verdict = "PASS (now check the numbers by eye)" if exercises else "FAIL: no exercises found"
    print(f"G5 {verdict}: {len(exercises)} exercises, {len(routine.get('limits') or [])} limits")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
