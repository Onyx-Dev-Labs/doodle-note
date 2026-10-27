"""Fixture-only tests: no native commands or applications run on the developer host."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "session_preflight", Path(__file__).with_name("hosted-mac-gui-session-preflight.py")
)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class FakeProbes:
    def __init__(self, overrides=None):
        self.events = []
        self.answers = {
            "os": "Darwin", "os-version": "15.7.9", "os-build": "24G830",
            "architecture": "arm64", "console-owner": "501",
            "console-login": "<dictionary> {\n Name : runner\n UID : 501\n}",
            "gui-bootstrap": "", "windowserver": "121",
            **{f"launch-env-{name}": "" for name in preflight.LAUNCH_VARIABLES},
            **(overrides or {}),
        }

    def run(self, name, argv, **kwargs):
        self.events.append({"name": name, "argv": argv, **kwargs})
        return self.answers[name]


class SessionPreflightTests(unittest.TestCase):
    def setUp(self):
        self.env = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
                    "RUNNER_OS": "macOS", "HOME": "/Users/runner", "HARNESS_SHA": "a" * 40,
                    "ImageOS": "macos15", "ImageVersion": "20260907.0337.1"}
        self.account = types.SimpleNamespace(pw_dir="/Users/runner", pw_name="runner")

    def collect(self, overrides=None, *, profile_exists=False):
        probes = FakeProbes(overrides)
        with patch.object(preflight.sys, "platform", "darwin"), \
             patch.object(preflight.os, "getuid", return_value=501), \
             patch.object(preflight.pwd, "getpwuid", return_value=self.account), \
             patch.object(Path, "exists", return_value=profile_exists):
            return preflight.collect(self.env, probes)

    def test_all_positive_prerequisites_never_mean_gui_or_updater_pass(self):
        result = self.collect()
        self.assertEqual("observed", result["session_prerequisites"])
        self.assertEqual("blocked", result["status"])
        self.assertEqual(2, result["exit_code"])
        self.assertEqual("unestablished", result["gui_availability"])
        for key in ("actual_app", "updater", "visible_window", "artifact_acquisition", "model_acquisition"):
            self.assertEqual("unperformed", result[key])
        self.assertEqual({"name": "Darwin", "version": "15.7.9", "build": "24G830", "architecture": "arm64"}, result["os"])
        self.assertFalse(result["default_profile"]["created"])

    def test_local_and_self_hosted_contexts_refuse_all_native_probes(self):
        for key, value in (("GITHUB_ACTIONS", "false"), ("RUNNER_ENVIRONMENT", "self-hosted"),
                           ("RUNNER_OS", "Linux")):
            with self.subTest(key=key), patch.dict(self.env, {key: value}):
                result = self.collect()
                self.assertEqual([], result["probe_processes"])
                self.assertFalse(result["prerequisites"]["hosted_macos_context"])
        with patch.object(preflight.sys, "platform", "linux"):
            probes = FakeProbes()
            self.assertEqual([], preflight.collect(self.env, probes)["probe_processes"])

    def test_missing_or_incompatible_session_evidence_fails_closed(self):
        cases = [
            ({"architecture": "x86_64"}, "macos_15_arm64"),
            ({"os-version": "26.1"}, "macos_15_arm64"),
            ({"os-build": None}, "macos_15_arm64"),
            ({"console-owner": "0"}, "console_login_matches_runner"),
            ({"console-login": "Name : loginwindow\nUID : 0\n"}, "console_login_matches_runner"),
            ({"console-login": "unexpected"}, "console_login_matches_runner"),
            ({"gui-bootstrap": None}, "gui_bootstrap_exists"),
            ({"windowserver": None}, "windowserver_process_present"),
            ({"windowserver": "not a PID"}, "windowserver_process_present"),
            ({"launch-env-NODE_OPTIONS": None}, "launch_environment_clear"),
        ]
        for overrides, failed in cases:
            with self.subTest(overrides=overrides):
                result = self.collect(overrides)
                self.assertFalse(result["prerequisites"][failed])
                self.assertEqual("incomplete", result["session_prerequisites"])
                self.assertEqual("blocked", result["status"])

    def test_existing_or_overridden_default_home_blocks_without_reading_profile(self):
        self.assertFalse(self.collect(profile_exists=True)["prerequisites"]["default_profile_absent"])
        self.env["HOME"] = "/tmp/override"
        self.assertFalse(self.collect()["prerequisites"]["default_home_unchanged"])

    @patch.object(preflight.subprocess, "Popen")
    def test_cli_retains_blocked_report_without_running_native_probes_locally(self, popen):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "evidence/result.json"
            with patch.dict(preflight.os.environ, {}, clear=True), \
                 patch.object(preflight.sys, "argv", ["probe", "--output", str(output)]), \
                 patch("builtins.print"):
                self.assertEqual(2, preflight.main())
            result = json.loads(output.read_text())
            self.assertEqual("blocked", result["status"])
            self.assertEqual([], result["probe_processes"])
            popen.assert_not_called()

    def test_unsafe_values_and_unrelated_credentials_never_appear_in_report(self):
        sentinel = "SENSITIVE-SENTINEL-DO-NOT-RETAIN"
        self.env.update(NODE_OPTIONS=sentinel, GITHUB_TOKEN=sentinel)
        result = self.collect({"launch-env-ELECTRON_RUN_AS_NODE": sentinel})
        self.assertNotIn(sentinel, json.dumps(result))
        self.assertFalse(result["prerequisites"]["launch_environment_clear"])
        self.assertTrue(result["launch_environment"]["NODE_OPTIONS"]["process_present"])
        self.assertTrue(result["launch_environment"]["ELECTRON_RUN_AS_NODE"]["launch_services_nonempty"])
        bootstrap = next(e for e in result["probe_processes"] if e["name"] == "gui-bootstrap")
        self.assertTrue(bootstrap["discard"])

    @patch.object(preflight.subprocess, "Popen")
    def test_probe_timeout_kills_and_reaps_only_its_owned_pid(self, popen):
        process = popen.return_value
        process.pid, process.returncode = 123, -9
        process.communicate.side_effect = [subprocess.TimeoutExpired("probe", 3), ("partial", None)]
        probes = preflight.Probes({**self.env, "GITHUB_TOKEN": "secret", "NODE_OPTIONS": "injection"})
        self.assertIsNone(probes.run("probe", ["/usr/bin/uname", "-m"]))
        process.kill.assert_called_once_with()
        self.assertEqual([unittest.mock.call(None, timeout=3), unittest.mock.call(timeout=1)],
                         process.communicate.call_args_list)
        self.assertEqual({"HOME", "PATH", "LANG", "LC_ALL"}, set(popen.call_args.kwargs["env"]))
        event = probes.events[0]
        self.assertTrue(event["timed_out"])
        self.assertTrue(event["reaped"])
        self.assertEqual(123, event["pid"])
        self.assertEqual(-9, event["exit_code"])

    @patch.object(preflight.subprocess, "Popen")
    def test_probe_exit_failure_and_spawn_failure_record_only_metadata(self, popen):
        process = popen.return_value
        process.pid, process.returncode = 124, 1
        process.communicate.return_value = ("sensitive", None)
        probes = preflight.Probes(self.env)
        self.assertIsNone(probes.run("missing", ["/bin/launchctl", "getenv", "NODE_OPTIONS"]))
        self.assertTrue(probes.events[0]["reaped"])
        popen.side_effect = FileNotFoundError("sensitive")
        self.assertIsNone(probes.run("missing", ["/bin/launchctl"]))
        self.assertEqual("FileNotFoundError", probes.events[1]["error"])
        self.assertNotIn("sensitive", json.dumps(probes.events))

    @patch.object(preflight.subprocess, "Popen")
    def test_successful_probe_bounds_returned_text_and_does_not_log_raw_output(self, popen):
        process = popen.return_value
        process.pid, process.returncode = 125, 0
        process.communicate.return_value = ("x" * 10000, None)
        probes = preflight.Probes(self.env)
        self.assertEqual(512, len(probes.run("probe", ["/usr/bin/uname", "-m"])))
        self.assertNotIn("x" * 512, json.dumps(probes.events))
        process.communicate.return_value = (None, None)
        self.assertEqual("", probes.run("bootstrap", ["/bin/launchctl", "print", "gui/501"], discard=True))
        self.assertEqual(subprocess.DEVNULL, popen.call_args.kwargs["stdout"])

    @patch.object(preflight.subprocess, "Popen")
    def test_failed_reap_is_bounded_and_never_reported_as_success(self, popen):
        process = popen.return_value
        process.pid = 123
        process.communicate.side_effect = subprocess.TimeoutExpired("probe", 3)
        probes = preflight.Probes(self.env)
        self.assertIsNone(probes.run("probe", ["/usr/bin/uname", "-m"]))
        self.assertEqual(2, process.communicate.call_count)
        self.assertEqual("ProbeCouldNotBeReaped", probes.events[0]["error"])
        self.assertFalse(probes.events[0]["reaped"])


if __name__ == "__main__":
    unittest.main()
