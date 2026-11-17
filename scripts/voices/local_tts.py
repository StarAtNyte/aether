"""
Chatterbox on this computer's CPU, for when Modal is not available: same input and output as modal_tts.py.
Never uses a GPU (CUDA hidden), few threads, lowest priority, so a training run on this machine keeps its resources.

  CUDA_VISIBLE_DEVICES= nice -n 19 python scripts/voices/local_tts.py --spec lines.json --out <folder> [--threads 4]
"""
import argparse
import io
import json
import os
import pathlib
import subprocess

os.environ["CUDA_VISIBLE_DEVICES"] = ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    import torch
    import torchaudio as ta
    from chatterbox.tts import ChatterboxTTS

    torch.set_num_threads(a.threads)
    data = json.loads(pathlib.Path(a.spec).read_text())
    dest = pathlib.Path(a.out)
    dest.mkdir(parents=True, exist_ok=True)
    model = ChatterboxTTS.from_pretrained(device="cpu")
    ref = data.get("ref")
    for i, (key, text) in enumerate(data["lines"].items()):
        target = dest / f"{key}.mp3"
        if target.exists():
            continue
        wav = model.generate(text, audio_prompt_path=ref, exaggeration=float(data.get("exaggeration", 0.5)), cfg_weight=float(data.get("cfg", 0.5)))
        buf = io.BytesIO()
        ta.save(buf, wav.cpu(), model.sr, format="wav")
        mp3 = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-b:a", "32k", "-ar", "24000", "-f", "mp3", "pipe:1"], input=buf.getvalue(), capture_output=True, check=True).stdout
        target.write_bytes(mp3)
        print(f"{i + 1}/{len(data['lines'])} {key}", flush=True)


if __name__ == "__main__":
    main()
