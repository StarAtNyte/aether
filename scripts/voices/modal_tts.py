"""
Pre-recorded voice lines for showroom guides (docs/CONTRACTS.md, "Showroom guide").

Runs Chatterbox (Resemble AI, MIT licence) in its own Modal app on a CPU container (no GPU: it never waits for, or takes,
GPU capacity other Modal jobs or this computer use; about 10-30 s a line). Nothing here runs while visitors use the site: the player only plays the MP3s.

Input: a JSON file
  {"lines": {"<key>": "<text>", ...},
   "ref": "path/to/voice.wav",        # optional: a few seconds of the voice to match; absent: Chatterbox's own voice
   "exaggeration": 0.5, "cfg": 0.5}   # optional: expressiveness and pacing
Output: one mono 32 kbps MP3 per line in the output folder, named <key>.mp3.

  modal run scripts/voices/modal_tts.py --spec lines.json --out apps/studio/public/templates/voices/<slug>
"""
import json
import pathlib

import modal

app = modal.App("aether-guide-voices")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("chatterbox-tts==0.1.2")
    # Bake the weights into the image (one download).
    .run_commands("python -c \"from chatterbox.tts import ChatterboxTTS; ChatterboxTTS.from_pretrained(device='cpu')\"")
)


@app.function(image=image, cpu=8.0, memory=16384, timeout=3600)
def synth(lines: dict[str, str], ref: bytes | None, exaggeration: float, cfg: float) -> dict[str, bytes]:
    import io
    import subprocess
    import tempfile

    import torchaudio as ta
    from chatterbox.tts import ChatterboxTTS

    model = ChatterboxTTS.from_pretrained(device="cpu")
    ref_path = None
    if ref:
        f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        f.write(ref)
        f.close()
        ref_path = f.name
    out: dict[str, bytes] = {}
    for key, text in lines.items():
        wav = model.generate(text, audio_prompt_path=ref_path, exaggeration=exaggeration, cfg_weight=cfg)
        buf = io.BytesIO()
        ta.save(buf, wav.cpu(), model.sr, format="wav")
        out[key] = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-b:a", "32k", "-ar", "24000", "-f", "mp3", "pipe:1"],
            input=buf.getvalue(), capture_output=True, check=True,
        ).stdout
    return out


@app.local_entrypoint()
def main(spec: str, out: str):
    data = json.loads(pathlib.Path(spec).read_text())
    ref = pathlib.Path(data["ref"]).read_bytes() if data.get("ref") else None
    dest = pathlib.Path(out)
    dest.mkdir(parents=True, exist_ok=True)
    clips = synth.remote(data["lines"], ref, float(data.get("exaggeration", 0.5)), float(data.get("cfg", 0.5)))
    for key, mp3 in clips.items():
        (dest / f"{key}.mp3").write_bytes(mp3)
    print(f"wrote {len(clips)} clips to {dest}")
