#!/usr/bin/env python3
"""Download published CC0 MP3 previews. Run locally before deploying Pages."""
import html
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = [
    ("muscle.mp3", "jackthemurray", 348430, "Classic Car Idle.wav"),
    ("flat-six.mp3", "victormalloy", 113216, "Porsche idle.aif"),
    ("exotic.mp3", "EwanPenman11", 659554, "Ferrari Engine (passive)"),
]


def download():
    output = ROOT / "audio"
    output.mkdir(exist_ok=True)
    metadata = []
    for filename, author, sound_id, title in SOURCES:
        source = f"https://freesound.org/people/{author}/sounds/{sound_id}/"
        request = urllib.request.Request(source, headers={"User-Agent": "DriveTone/1.0 (CC0 audio installer)"})
        page = html.unescape(urllib.request.urlopen(request, timeout=30).read().decode())
        if "creativecommons.org/publicdomain/zero/1.0" not in page:
            raise RuntimeError(f"CC0 license could not be verified for {source}; not downloading.")
        candidates = sorted(set(re.findall(r'https://[^\s"<>]+?\.mp3', page)))
        candidates = [url for url in candidates if "/previews/" in url and f"/{sound_id}_" in url]
        preview = next((url for url in candidates if "-hq.mp3" in url), next(iter(candidates), None))
        if not preview:
            raise RuntimeError(f"No public MP3 preview found at {source}. Download the original manually and convert to MP3.")
        data = urllib.request.urlopen(preview, timeout=30).read()
        if len(data) < 1024 or not (data.startswith(b"ID3") or data[0] == 0xFF):
            raise RuntimeError(f"Response for {filename} was not an MP3.")
        temporary = output / (filename + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(output / filename)
        metadata.append({"file": filename, "title": title, "author": author, "source": source, "download": preview, "license": "CC0 1.0"})
        print(f"Installed {filename} ({len(data):,} bytes) — {author}, CC0 1.0")
    (output / "sources.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print("Done. Reload the app to use the recordings.")


if __name__ == "__main__":
    try:
        download()
    except Exception as error:
        raise SystemExit(f"Audio install failed: {error}\nThe app will use synthesized previews for missing recordings.") from error
