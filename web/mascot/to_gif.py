# Combines render.mjs's PNG frames into a transparent GIF and a still image for people who turn motion off.
# Usage: python to_gif.py <frames folder> <output folder>
import sys
from pathlib import Path
from PIL import Image

FRAME_MS = 50
STILL_AT = 0.28
TRANSPARENT = 255


def flatten(frame: Image.Image) -> Image.Image:
    # GIF only has full transparency, so semi-transparent edges are snapped by a threshold.
    # Frames are drawn at twice the display size; the browser's downscaling smooths the edges.
    rgb = Image.new("RGB", frame.size, (255, 255, 255))
    rgb.paste(frame, mask=frame.getchannel("A"))
    return rgb


def main(source: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for folder in sorted(path for path in source.iterdir() if path.is_dir()):
        frames = [Image.open(path).convert("RGBA") for path in sorted(folder.glob("*.png"))]
        # One palette for the whole GIF, so colors do not flicker between frames.
        strip = Image.new("RGB", (frames[0].width * len(frames), frames[0].height), (255, 255, 255))
        for index, frame in enumerate(frames):
            strip.paste(flatten(frame), (index * frame.width, 0))
        palette = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        output = []
        for frame in frames:
            indexed = flatten(frame).quantize(palette=palette, dither=Image.Dither.NONE)
            hole = frame.getchannel("A").point(lambda alpha: 255 if alpha < 128 else 0)
            indexed.paste(TRANSPARENT, mask=hole)
            output.append(indexed)
        output[0].save(target / f"{folder.name}.gif", save_all=True, append_images=output[1:], duration=FRAME_MS, loop=0, disposal=2, transparency=TRANSPARENT, optimize=False)
        frames[int(len(frames) * STILL_AT)].resize((160, 160), Image.Resampling.LANCZOS).save(target / f"{folder.name}.png", optimize=True)
        print(folder.name, len(frames), (target / f"{folder.name}.gif").stat().st_size // 1024, "KB")


main(Path(sys.argv[1]), Path(sys.argv[2]))
