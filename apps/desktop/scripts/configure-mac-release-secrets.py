#!/usr/bin/env python3
"""Upload missing release credentials directly to GitHub, never to chat or disk."""
import argparse
import base64
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import warnings

REPOSITORY = "Onyx-Dev-Labs/doodle-note"
EXPECTED_TEAM = "VTZW6K32K4"
REQUIRED = (
    "DOODLENOTE_GOOGLE_CLIENT_SECRET", "MAC_CSC_LINK", "MAC_CSC_KEY_PASSWORD",
    "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID",
)


def check_environment(environ):
    missing = [name for name in REQUIRED if not environ.get(name, "").strip()]
    if missing:
        raise ValueError("Missing GitHub Actions secrets: " + ", ".join(missing))
    if environ["APPLE_TEAM_ID"] != EXPECTED_TEAM:
        raise ValueError("APPLE_TEAM_ID does not match the existing DoodleNote signing team")


def hidden_input(label):
    # getpass otherwise falls back to echoed input when no terminal is available.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        value = getpass.getpass(label + ": ")
    if not value.strip():
        raise ValueError("Empty input; no secret uploaded")
    return value


def save_secret(name, value):
    if len(value.encode("utf-8")) > 48 * 1024:
        raise ValueError(name + " exceeds GitHub's 48 KiB secret limit")
    result = subprocess.run(
        ["gh", "secret", "set", name, "--repo", REPOSITORY],
        input=value, text=True, capture_output=True, check=False,
    )
    # Do not forward arbitrary subprocess output from a credential operation.
    if result.returncode:
        raise RuntimeError("GitHub rejected " + name + "; check gh authentication/permissions")
    print("Saved " + name)


def configure():
    if not sys.stdin.isatty():
        raise ValueError("Run interactively in your own terminal; do not pipe credentials")
    result = subprocess.run(
        ["gh", "secret", "list", "--repo", REPOSITORY, "--json", "name"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise RuntimeError("Cannot list repository secrets; sign in with gh first")
    existing = {item["name"] for item in json.loads(result.stdout)}
    print("Destination: " + REPOSITORY + " / GitHub Actions repository secrets")
    print("Existing secrets are preserved. Values are sent through gh stdin, not command arguments.")
    if "MAC_CSC_LINK" not in existing:
        path = Path(input("Path to exported Developer ID Application .p12 (includes private key): ").strip()).expanduser()
        if path.suffix.lower() not in (".p12", ".pfx") or not path.is_file():
            raise ValueError("Choose an existing .p12/.pfx export, not a certificate-only .cer")
        if path.stat().st_size > 36 * 1024:
            raise ValueError("Certificate export too large for a base64 GitHub secret; export only the required identity")
        save_secret("MAC_CSC_LINK", base64.b64encode(path.read_bytes()).decode("ascii"))
    prompts = {
        "MAC_CSC_KEY_PASSWORD": "Password protecting the .p12 export",
        "APPLE_ID": "Apple ID authorized for the existing Developer ID team",
        "APPLE_APP_SPECIFIC_PASSWORD": "Apple app-specific password (not your Apple login password)",
        "DOODLENOTE_GOOGLE_CLIENT_SECRET": "Existing DoodleNote Desktop Google OAuth client secret",
    }
    for name, label in prompts.items():
        if name not in existing:
            save_secret(name, hidden_input(label))
    if "APPLE_TEAM_ID" not in existing:
        save_secret("APPLE_TEAM_ID", EXPECTED_TEAM)
    print("Candidate credential setup finished. Verify names with gh secret list.")
    print("This does not run a workflow, publish a feed, or verify Apple's credentials.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-env", action="store_true", help="Check required CI variables without printing values")
    args = parser.parse_args()
    try:
        if args.check_env:
            check_environment(os.environ)
            print("Required release inputs are present; signing/notarization still need validation.")
        else:
            configure()
    except (ValueError, RuntimeError, OSError, getpass.GetPassWarning, EOFError, KeyboardInterrupt) as error:
        # Avoid displaying filesystem errors, subprocess output, or secret values.
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else "Setup interrupted or input unavailable; no credential details logged"
        print(message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
