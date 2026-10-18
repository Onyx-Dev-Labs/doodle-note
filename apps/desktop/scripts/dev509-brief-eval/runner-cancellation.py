"""Real CLI desired-behavior regression. Only signals subprocesses created here; never loads AI.

Startup-paused uses a preload stdout-boundary pause to make the original race repeatable.
Immediate, active and between-case controls have no timing hook. Artifacts remain in a
new temp directory; --output selects only the evidence directory, not a user library.
"""
import argparse
import json
import os
import pathlib
import signal
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=pathlib.Path)
args = parser.parse_args()
out = args.output or pathlib.Path(tempfile.mkdtemp(prefix='dev509-runner-cancel-'))
out.mkdir(parents=True, exist_ok=True)
desktop = pathlib.Path(__file__).resolve().parents[2]
repo = desktop.parents[1]
expected = {item['id'] for item in json.loads((repo / 'docs/qa/dev509/brief-corpus-v1.json').read_text())['cases']}
guard = out / 'no-native.mjs'
guard.write_text('''import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier === '@repo/ai' || /node-llama-cpp|local-engine\\.[cm]?[jt]s/.test(specifier)) throw new Error('Forbidden native runtime import '+specifier);
 return next(specifier,context);
}});
if(process.env.DEV509_TEST_PAUSE_READY === '1') {
 const write = process.stdout.write.bind(process.stdout);
 process.stdout.write = function(chunk, ...args) {
   const result = write(chunk, ...args);
   if(String(chunk).startsWith('DEV509 mechanical evaluation artifacts:'))
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
   return result;
 };
}
''')
results = []
for sig in [signal.SIGTERM, signal.SIGINT]:
    for mode in ['startup-paused', 'immediate', 'active', 'between-cases']:
        child = subprocess.Popen(
            ['node', '--import', str(guard), '--import', 'tsx', 'scripts/dev509-brief-eval/run.mts'],
            cwd=desktop, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            env={**os.environ, 'DEV509_TEST_PAUSE_READY': '1' if mode == 'startup-paused' else '0'})
        lines = []
        folder = None
        try:
            # Non-runnable launch failures are preserved rather than mistaken for a ready child.
            first = child.stdout.readline()
            lines.append(first)
            if not first.startswith('DEV509 mechanical evaluation artifacts: '):
                raise RuntimeError('Child did not announce artifact directory: ' + first)
            folder = pathlib.Path(first.strip().split(': ', 1)[1])
            initial = json.loads((folder / 'report.json').read_text()) if (folder / 'report.json').exists() else None
            if mode == 'active':
                time.sleep(.03)
            elif mode == 'between-cases':
                lines.append(child.stdout.readline())
            started = time.monotonic()
            child.send_signal(sig)
            rest, _ = child.communicate(timeout=15)
            lines.append(rest)
            elapsed = (time.monotonic() - started) * 1000
            report = json.loads((folder / 'report.json').read_text()) if (folder / 'report.json').exists() else None
            rows = report['results'] if report else []
            ids = [row['caseId'] for row in rows]
            pending = [row for row in rows if row['outcome'] == 'pending']
            ok = (child.returncode == 1 and initial is not None and
                  len(initial['results']) == 24 and {row['caseId'] for row in initial['results']} == expected and
                  len(rows) == 24 and len(set(ids)) == 24 and
                  set(ids) == expected and not pending and report['cleanup'] == 'complete' and
                  report['mechanicalGates'] == 'failed' and report['native'] is False and
                  not any(row.get('outputs') for row in rows))
            results.append({'signal': sig.name, 'mode': mode, 'passed': ok,
                            'exit': child.returncode, 'initialCases': len(initial['results']) if initial else None,
                            'cases': len(rows), 'uniqueCases': len(set(ids)),
                            'cleanup': report['cleanup'] if report else None,
                            'elapsedAfterSignalMs': elapsed, 'report': str(folder / 'report.json'),
                            'outcomes': {status: sum(row['outcome'] == status for row in rows) for status in sorted({row['outcome'] for row in rows})},
                            'native': False})
        except Exception as error:
            results.append({'signal': sig.name, 'mode': mode, 'passed': False, 'error': str(error), 'native': False})
        finally:
            if child.poll() is None:
                child.kill()
                rest, _ = child.communicate()
                lines.append(rest)
            (out / (sig.name + '-' + mode + '.log')).write_text(''.join(lines))
summary = {'actualNative': False, 'inference': False, 'controls': results,
           'allPassed': all(row['passed'] for row in results),
           'timingLimit': 'Synthetic subprocess scheduling only, not native cleanup latency.'}
(out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
raise SystemExit(0 if summary['allPassed'] else 1)
