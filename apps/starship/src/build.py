"""Generate Starship's native configuration using Luna Next's selected palette."""

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
    template = (app / "templates/starship.toml").read_text()
    rendered = re.sub(
        r"\{\{colors\.([a-z_]+)\}\}",
        lambda match: theme["colors"][match[1]],
        template,
    )
    # Resolve the complete palette before replacing the staged file.
    output = Path(os.environ["LUNA_CONFIG_OUTPUT"]) / "starship.toml"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered)


if __name__ == "__main__":
    try:
        build()
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        sys.exit(f"Cannot build Starship configuration: {detail}")
