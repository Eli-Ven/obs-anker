"""Package the current build, excluding all user settings and Vault data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
built = root / "dist" / "anke-writing"
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
names = ["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD_PARTY_NOTICES.md"]

for name in ["manifest.json", "styles.css", "LICENSE"]:
    if (built / name).read_bytes() != (root / name).read_bytes():
        raise SystemExit(f"Stale build: {name}. Run npm run build first.")
main = (built / "main.js").read_text(encoding="utf-8")
for name in ["LICENSE", "THIRD_PARTY_NOTICES.md"]:
    notice = (built / name).read_text(encoding="utf-8").replace("*/", "* /")
    if notice not in main:
        raise SystemExit(f"Missing bundled notice: {name}. Run npm run build first.")
if "sourceMappingURL=data:" in main:
    raise SystemExit("Release builds must not contain inline source maps.")

archive = root / "dist" / f"obs-anker-{manifest['version']}.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as output:
    for name in names:
        output.write(built / name, f"anke-writing/{name}")
with ZipFile(archive) as output:
    if set(output.namelist()) != {f"anke-writing/{name}" for name in names}:
        raise SystemExit("Unexpected install ZIP contents.")
    if output.testzip() is not None:
        raise SystemExit("Corrupt install ZIP.")
    for name in names:
        if output.read(f"anke-writing/{name}") != (built / name).read_bytes():
            raise SystemExit(f"ZIP differs from current build: {name}")
print(f"Created {archive.name}: {len(names)} verified plugin files")
