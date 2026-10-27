#!/usr/bin/env python3
"""Read-only hosted session prerequisites. Never launches an app; always blocked.

Only result.json is written. All native commands are short, read-only probes;
their environment is allowlisted and their PIDs are reaped individually.
"""

import argparse
import datetime
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys
import time


BLOCKED = 2
LAUNCH_VARIABLES = (
    "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH",
    "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH",
    "DYLD_FALLBACK_LIBRARY_PATH",
)


class Probes:
    def __init__(self, env):
        self.events = []
        # Never inherit download credentials, Actions tokens, or injection variables.
        self.env = {key: env[key] for key in ("HOME", "TMPDIR") if key in env}
        self.env.update(PATH="/usr/bin:/bin:/usr/sbin:/sbin", LANG="C", LC_ALL="C")

    def run(self, name, argv, *, stdin=None, discard=False):
        event = {"name": name, "argv": argv, "pid": None, "exit_code": None,
                 "timed_out": False, "reaped": False}
        self.events.append(event)
        started = time.monotonic()
        try:
            process = subprocess.Popen(
                argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL if discard else subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, env=self.env,
            )
            event["pid"] = process.pid
            try:
                stdout, _ = process.communicate(stdin, timeout=3)
            except subprocess.TimeoutExpired:
                event["timed_out"] = True
                process.kill()  # Only this owned probe, never WindowServer/login services.
                try:
                    stdout, _ = process.communicate(timeout=1)
                except subprocess.TimeoutExpired:
                    event["error"] = "ProbeCouldNotBeReaped"
                    return None  # Job timeout is the outer bound; never wait indefinitely.
            event.update(exit_code=process.returncode, reaped=True)
            return (stdout or "").strip()[:512] if event["exit_code"] == 0 and not event["timed_out"] else None
        except OSError as error:
            event["error"] = type(error).__name__
            return None
        finally:
            event["duration_ms"] = round((time.monotonic() - started) * 1000)


def collect(env, probes):
    report = {
        "schema_version": 1, "scope": "hosted-session-prerequisites-only",
        "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": "blocked", "exit_code": BLOCKED,
        "gui_availability": "unestablished", "actual_app": "unperformed",
        "updater": "unperformed", "visible_window": "unperformed",
        "artifact_acquisition": "unperformed", "model_acquisition": "unperformed",
        "harness_sha": env.get("HARNESS_SHA", "")[:40], "runner_label": "macos-15",
        "runner_image": {key: env.get(key, "")[:128] for key in ("ImageOS", "ImageVersion")},
        "probe_processes": probes.events, "prerequisites": {},
        "blockers": ["No visible responsive GUI observed; session probes cannot establish app/updater acceptance.",
                     "App launch withheld: unconditional ASR preflight requires a reviewed pre-staged-model/no-download plan."],
    }
    checks = report["prerequisites"]
    checks["hosted_macos_context"] = (
        sys.platform == "darwin" and env.get("GITHUB_ACTIONS") == "true"
        and env.get("RUNNER_ENVIRONMENT") == "github-hosted" and env.get("RUNNER_OS") == "macOS"
    )
    if not checks["hosted_macos_context"]:
        report["blockers"].append("Refused native probes outside a GitHub-hosted macOS job.")
        return report

    report["os"] = {
        "name": probes.run("os", ["/usr/bin/uname", "-s"]),
        "version": probes.run("os-version", ["/usr/bin/sw_vers", "-productVersion"]),
        "build": probes.run("os-build", ["/usr/bin/sw_vers", "-buildVersion"]),
        "architecture": probes.run("architecture", ["/usr/bin/uname", "-m"]),
    }
    actual = report["os"]
    checks["macos_15_arm64"] = (actual["name"] == "Darwin" and actual["architecture"] == "arm64"
                                and bool(re.fullmatch(r"15(?:\.\d+)+", actual["version"] or ""))
                                and bool(actual["build"]))
    uid = os.getuid()
    console_uid = probes.run("console-owner", ["/usr/bin/stat", "-f", "%u", "/dev/console"])
    console = probes.run("console-login", ["/usr/sbin/scutil"], stdin="show State:/Users/ConsoleUser\n") or ""
    login_uid = re.search(r"^\s*UID\s*:\s*(\d+)\s*$", console, re.MULTILINE)
    login_name = re.search(r"^\s*Name\s*:\s*(\S+)\s*$", console, re.MULTILINE)
    account = pwd.getpwuid(uid)
    report["console"] = {"probe_uid": uid, "owner_uid": console_uid,
                         "login_uid": login_uid[1] if login_uid else None,
                         "login_name": login_name[1] if login_name else None}
    checks["console_login_matches_runner"] = (
        uid > 0 and console_uid == str(uid) and login_uid is not None and login_uid[1] == str(uid)
        and login_name is not None and login_name[1] == account.pw_name
        and login_name[1] not in ("root", "loginwindow", "_mbsetupuser")
    )
    # The domain dump can contain environment values. Never capture or retain it.
    checks["gui_bootstrap_exists"] = probes.run(
        "gui-bootstrap", ["/bin/launchctl", "print", f"gui/{uid}"], discard=True
    ) is not None
    window_server = probes.run("windowserver", ["/usr/bin/pgrep", "-x", "WindowServer"])
    pids = (window_server or "").split()
    checks["windowserver_process_present"] = bool(pids) and all(pid.isdecimal() for pid in pids)
    report["windowserver_pids"] = pids if checks["windowserver_process_present"] else []
    # Presence only, never values; no launchctl setenv/unsetenv or TCC changes.
    report["launch_environment"] = {}
    for name in LAUNCH_VARIABLES:
        value = probes.run(f"launch-env-{name}", ["/bin/launchctl", "getenv", name])
        report["launch_environment"][name] = {
            "process_present": name in env,
            "launch_services_nonempty": bool(value) if value is not None else None,
        }
    checks["launch_environment_clear"] = all(
        not item["process_present"] and item["launch_services_nonempty"] is False
        for item in report["launch_environment"].values()
    )
    home = Path(account.pw_dir)
    profile = home / "Library/Application Support/DoodleNote"
    report["default_profile"] = {"path": str(profile), "exists": profile.exists(), "created": False}
    checks["default_home_unchanged"] = env.get("HOME") == str(home)
    checks["default_profile_absent"] = not report["default_profile"]["exists"]
    report["session_prerequisites"] = "observed" if all(checks.values()) else "incomplete"
    report["blockers"].extend(f"Missing prerequisite: {name}" for name, passed in checks.items() if not passed)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    probes = Probes(os.environ)
    try:
        report = collect(os.environ, probes)
    except (OSError, KeyError) as error:
        report = {"status": "blocked", "exit_code": BLOCKED,
                  "scope": "hosted-session-prerequisites-only", "error": type(error).__name__,
                  "actual_app": "unperformed", "updater": "unperformed",
                  "gui_availability": "unestablished", "probe_processes": probes.events}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print("BLOCKED: session-only report; actual GUI, app launch, and updater unperformed.")
    return BLOCKED


if __name__ == "__main__":
    sys.exit(main())
