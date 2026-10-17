import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "release_secrets", Path(__file__).with_name("configure-mac-release-secrets.py")
)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class ReleaseSecretsTests(unittest.TestCase):
    def test_missing_inputs_report_names_only(self):
        with self.assertRaisesRegex(ValueError, "MAC_CSC_LINK") as error:
            helper.check_environment({"APPLE_ID": "private-sentinel"})
        self.assertNotIn("private-sentinel", str(error.exception))

    def test_wrong_team_fails_without_printing_value(self):
        values = dict.fromkeys(helper.REQUIRED, "private-sentinel")
        with self.assertRaisesRegex(ValueError, "signing team") as error:
            helper.check_environment(values)
        self.assertNotIn("private-sentinel", str(error.exception))
        values["APPLE_TEAM_ID"] = helper.EXPECTED_TEAM
        helper.check_environment(values)

    def test_secret_uses_stdin_and_does_not_echo_subprocess_output(self):
        for exit_code in (0, 1):
            with self.subTest(exit_code=exit_code):
                result = subprocess.CompletedProcess([], exit_code, "private-sentinel", "private-sentinel")
                output = io.StringIO()
                with patch.object(helper.subprocess, "run", return_value=result) as run:
                    with contextlib.redirect_stdout(output):
                        try:
                            helper.save_secret("APPLE_ID", "private-sentinel")
                        except RuntimeError as error:
                            self.assertNotIn("private-sentinel", str(error))
                    self.assertNotIn("private-sentinel", str(run.call_args.args))
                    self.assertEqual(run.call_args.kwargs["input"], "private-sentinel")
                    self.assertNotIn("private-sentinel", output.getvalue())

    def test_existing_secrets_are_not_replaced(self):
        names = '[%s]' % ','.join('{"name":"%s"}' % name for name in helper.REQUIRED)
        result = subprocess.CompletedProcess([], 0, names, "")
        with patch.object(helper.sys.stdin, "isatty", return_value=True):
            with patch.object(helper.subprocess, "run", return_value=result) as run:
                with patch.object(helper, "hidden_input", side_effect=AssertionError("must not prompt")):
                    with contextlib.redirect_stdout(io.StringIO()):
                        helper.configure()
                self.assertEqual(run.call_count, 1)

    def test_no_terminal_refuses_configuration(self):
        with patch.object(helper.sys.stdin, "isatty", return_value=False):
            with patch.object(helper.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "interactively"):
                    helper.configure()
                run.assert_not_called()

    def test_getpass_echo_fallback_is_rejected(self):
        def warn(_):
            helper.warnings.warn("unavailable", helper.getpass.GetPassWarning)
        with patch.object(helper.getpass, "getpass", side_effect=warn):
            with self.assertRaises(helper.getpass.GetPassWarning):
                helper.hidden_input("Password")


if __name__ == "__main__":
    unittest.main()
