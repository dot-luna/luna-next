"""Generate Kitty's native theme include inside the export staging directory."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys


def build():
    result = subprocess.run(
        ["luna", "theme", "get", "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
    response = json.loads(result.stdout)
    if response["ok"] is not True:
        raise ValueError(response.get("error", "Cannot resolve the selected theme"))
    theme = response["result"]
    app = Path(os.environ["LUNA_APP_DIR"])
    template = (app / "templates/theme.conf").read_text()
    rendered = re.sub(
        r"\{\{(colors|fonts)\.([a-z_]+)\}\}",
        lambda match: theme[match[1]][match[2]],
        template,
    )
    # Resolve every value before touching the staged export. The installer publishes it.
    output = Path(os.environ["LUNA_CONFIG_OUTPUT"]) / "generated/theme.conf"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered)


if __name__ == "__main__":
    try:
        build()
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        sys.exit(f"Cannot build Kitty configuration: {detail}")
