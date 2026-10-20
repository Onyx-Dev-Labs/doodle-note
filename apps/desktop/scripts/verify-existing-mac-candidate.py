#!/usr/bin/env python3
"""Verify an immutable signed artifact on macOS14; never build/sign/publish it."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
import zipfile

REPO = 'Onyx-Dev-Labs/doodle-note'
TEAM = 'VTZW6K32K4'
WORKFLOW = '.github/workflows/mac-release.yml'
MAX_ARCHIVE = 1024 ** 3
MAX_EXPANDED = 4 * 1024 ** 3
SCRIPTS = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_inputs(args):
    for value in (args.run_id, args.artifact_id):
        require(re.fullmatch(r'[1-9][0-9]{0,19}', value), 'Invalid numeric identity')
    for value in (args.candidate_sha, args.harness_sha):
        require(re.fullmatch(r'[0-9a-f]{40}', value), 'Invalid source SHA')
    require(re.fullmatch(r'[0-9a-f]{64}', args.archive_sha256), 'Invalid archive SHA256')
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?', args.version),
            'Invalid candidate version')


def validate_metadata(args, run, artifact):
    require(run['id'] == int(args.run_id) and run['repository']['full_name'] == REPO
            and run['head_repository']['full_name'] == REPO, 'Run repository/identity mismatch')
    require(run['path'] == WORKFLOW and run['event'] == 'workflow_dispatch'
            and run['status'] == 'completed' and run['conclusion'] == 'success',
            'Not a successful candidate workflow')
    require(run['head_sha'] == args.candidate_sha, 'Run source mismatch')
    source = artifact['workflow_run']
    require(artifact['id'] == int(args.artifact_id) and not artifact['expired']
            and artifact['name'] == 'doodlenote-mac-' + args.candidate_sha
            and source['id'] == int(args.run_id) and source['head_sha'] == args.candidate_sha
            and source['repository_id'] == run['repository']['id']
            and source['head_repository_id'] == run['repository']['id'],
            'Artifact provenance mismatch')
    require(artifact['digest'] == 'sha256:' + args.archive_sha256,
            'Artifact digest mismatch')
    require(0 < artifact['size_in_bytes'] <= MAX_ARCHIVE, 'Artifact size exceeds limit')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_request(route, token):
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + route,
                                    headers={'Authorization': 'Bearer ' + token,
                                             'Accept': 'application/vnd.github+json',
                                             'X-GitHub-Api-Version': '2022-11-28'})
    return urllib.request.build_opener(NoRedirect).open(request, timeout=30)


def api_json(route, token):
    try:
        with api_request(route, token) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        require(len(data) <= 2 * 1024 * 1024, 'Oversized API response')
        return json.loads(data)
    except (urllib.error.URLError, json.JSONDecodeError):
        raise ValueError('GitHub metadata request failed') from None


def download(args, token, target):
    # Never forward the API bearer token to the signed storage redirect.
    try:
        try:
            response = api_request('/actions/artifacts/' + args.artifact_id + '/zip', token)
        except urllib.error.HTTPError as error:
            require(error.code == 302, 'Artifact download API failed')
            url = error.headers['Location']
            parsed = urllib.parse.urlsplit(url)
            require(parsed.scheme == 'https' and parsed.hostname and not parsed.username
                    and not parsed.password, 'Invalid artifact download redirect')
            response = urllib.request.urlopen(url, timeout=30)  # no auth header
        started = time.monotonic()
        with response, target.open('xb') as output:
            total = 0
            digest = hashlib.sha256()
            while chunk := response.read(1024 * 1024):
                require(time.monotonic() - started < 300, 'Download deadline exceeded')
                total += len(chunk)
                require(total <= MAX_ARCHIVE, 'Archive download exceeds limit')
                digest.update(chunk)
                output.write(chunk)
        require(digest.hexdigest() == args.archive_sha256, 'Downloaded archive digest mismatch')
    except urllib.error.URLError:
        raise ValueError('Artifact download failed') from None


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        while chunk := file.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def payload_names(version):
    return {f'DoodleNote-{version}-arm64-mac.zip', f'DoodleNote-{version}-arm64.dmg',
            'latest-mac.yml', 'release-receipt.txt'}


def inspect_zip(archive, allowed=None):
    entries = archive.infolist()
    require(0 < len(entries) <= 100000, 'Invalid archive entry count')
    require(sum(item.file_size for item in entries) <= MAX_EXPANDED, 'Archive expands beyond limit')
    names, links = set(), set()
    for item in entries:
        raw = item.filename.rstrip('/')
        parts = raw.split('/')
        require(raw and '\\' not in raw and '\x00' not in raw
                and all(part not in ('', '.', '..') for part in parts), 'Unsafe archive path')
        # macOS is commonly case insensitive; reject alias collisions before ditto.
        folded = raw.casefold()
        require(folded not in names, 'Duplicate archive path')
        names.add(folded)
        mode = item.external_attr >> 16
        kind = stat.S_IFMT(mode)
        require(kind in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK), 'Special archive entry')
        if allowed is not None:
            require(raw in allowed and not item.is_dir() and kind != stat.S_IFLNK,
                    'Unexpected outer archive member')
        else:
            require(parts[0] == 'DoodleNote.app', 'Unexpected app archive root')
            if kind == stat.S_IFLNK:
                require(item.file_size < 4096, 'Oversized symlink')
                target = archive.read(item).decode('utf8')
                # Packaged frameworks use forward, relative targets. Reject all
                # parent traversal, including chains whose lexical path looks safe.
                require(target and not target.startswith('/') and '\\' not in target
                        and all(p not in ('', '.', '..') for p in target.split('/')),
                        'Unsafe symlink target')
                links.add(folded)
    for name in names:
        require(not any(str(parent) in links for parent in PurePosixPath(name).parents),
                'Archive writes through symlink')
    if allowed is not None:
        require(names == {name.casefold() for name in allowed}, 'Missing archive payload')


def extract_outer(source, destination, version):
    with zipfile.ZipFile(source) as archive:
        inspect_zip(archive, payload_names(version))
        destination.mkdir()
        for item in archive.infolist():
            with archive.open(item) as incoming, (destination / item.filename).open('xb') as output:
                shutil.copyfileobj(incoming, output)


def verify_receipt(directory, args):
    lines = (directory / 'release-receipt.txt').read_text().splitlines()
    require(lines[:3] == ['Source commit: ' + args.candidate_sha, 'Version: ' + args.version,
                         'Signing team: ' + TEAM], 'Receipt identity mismatch')
    require(len(lines) == 7 and lines[3] ==
            'Verified app/ZIP/DMG payloads, signatures, tickets, Gatekeeper, version and manifest SHA-512 hashes.',
            'Unexpected receipt format')
    found = {}
    for line in lines[4:]:
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        require(match, 'Invalid receipt hash')
        name = PurePosixPath(match[2]).name
        require(name in payload_names(args.version) - {'release-receipt.txt'} and name not in found,
                'Unexpected receipt payload')
        require(digest(directory / name) == match[1], 'Receipt payload hash mismatch')
        found[name] = match[1]
    require(len(found) == 3, 'Missing receipt hashes')
    return found


def runtime_env(root):
    # Candidate processes never inherit workflow token/signing/cloud credentials.
    env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8'}
    for key, name in [('HOME', 'home'), ('TMPDIR', 'tmp'), ('XDG_CACHE_HOME', 'cache'),
                      ('XDG_CONFIG_HOME', 'config')]:
        directory = root / name
        directory.mkdir(exist_ok=True)
        env[key] = str(directory)
    return env


def cleanup_group(process, timeout=2):
    # Only the dedicated group created by this invocation; never scan by name.
    deadline = time.monotonic() + timeout
    failure = None
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except OSError as error:
        failure = error
    try:
        process.wait(timeout=max(.001, deadline - time.monotonic()))
        while True:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            require(time.monotonic() < deadline, 'Owned process group cleanup timed out')
            time.sleep(.01)
    except Exception as error:
        failure = failure or error
    if failure:
        raise failure


def run(command, root, env, timeout=60, expected=0):
    # Files cannot keep communicate() blocked when a descendant inherits pipes.
    # Collect diagnostics only after bounded cleanup, on every parent exit path.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([str(x) for x in command], stdout=output,
                                   stderr=errors, env=env, start_new_session=True)
        primary, cleanup = None, None
        try:
            process.wait(timeout=timeout)
            if process.returncode != expected:
                primary = ValueError('Command failed: ' + Path(command[0]).name)
        except subprocess.TimeoutExpired:
            primary = ValueError('Command timed out: ' + Path(command[0]).name)
        except BaseException as error:
            primary = error
        finally:
            try:
                cleanup_group(process)
            except Exception as error:
                cleanup = error
            output.seek(0); errors.seek(0)
            stdout, stderr = output.read(), errors.read()
            with (root / 'commands.log').open('ab') as log:
                log.write(('COMMAND ' + ' '.join(map(str, command)) + '\n').encode())
                if primary:
                    log.write(('TIMEOUT\n' if 'timed out' in str(primary) else 'FAILED\n').encode())
                log.write(stdout + stderr)
                if cleanup:
                    log.write(('\nCLEANUP FAILED: ' + type(cleanup).__name__ + '\n').encode())
        if primary:
            raise primary from cleanup
        if cleanup:
            raise ValueError('Owned process group cleanup failed') from cleanup
        return stdout.decode('utf8', errors='replace')


def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        relative = str(path.relative_to(root))
        if path.is_symlink():
            require(path.resolve().is_relative_to(root.resolve()), 'Bundle symlink escapes app')
            result[relative] = ['link', os.readlink(path)]
        elif path.is_file():
            result[relative] = ['file', stat.S_IMODE(path.stat().st_mode), digest(path)]
        elif path.is_dir():
            result[relative] = ['directory']
        else:
            raise ValueError('Unexpected bundle file type')
    return result


def verify_app(app, args, root, env):
    with (app / 'Contents/Info.plist').open('rb') as file:
        info = plistlib.load(file)
    require(info['CFBundleShortVersionString'] == args.version
            and info['CFBundleIdentifier'] == 'com.doodlenote.desktop', 'App identity mismatch')
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', app], root, env)
    # codesign details are on stderr, so inspect a plist-free dedicated capture.
    details = subprocess.run(['/usr/bin/codesign', '-dv', '--verbose=4', str(app)],
                             capture_output=True, env=env, timeout=30, check=True)
    require(('TeamIdentifier=' + TEAM) in details.stderr.decode().splitlines(), 'Signing team mismatch')
    run(['/usr/bin/xcrun', 'stapler', 'validate', app], root, env)
    run(['/usr/sbin/spctl', '--assess', '--type', 'execute', app], root, env)


def verify_payload(directory, args, root, env):
    hashes = verify_receipt(directory, args)
    run(['/usr/bin/ruby', SCRIPTS / 'mac-release-manifest.rb', directory, args.version], root, env)
    zipped = directory / f'DoodleNote-{args.version}-arm64-mac.zip'
    with zipfile.ZipFile(zipped) as archive:
        inspect_zip(archive)
    extracted = root / 'extracted'
    run(['/usr/bin/ditto', '-x', '-k', zipped, extracted], root, env)
    app = extracted / 'DoodleNote.app'
    verify_app(app, args, root, env)
    before = inventory(app)
    dmg = directory / f'DoodleNote-{args.version}-arm64.dmg'
    run(['/usr/bin/codesign', '--verify', '--strict', dmg], root, env)
    details = subprocess.run(['/usr/bin/codesign', '-dv', '--verbose=4', str(dmg)],
                             capture_output=True, env=env, timeout=30, check=True)
    require(('TeamIdentifier=' + TEAM) in details.stderr.decode().splitlines(), 'DMG team mismatch')
    run(['/usr/bin/xcrun', 'stapler', 'validate', dmg], root, env)
    run(['/usr/sbin/spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', dmg], root, env)
    mount = root / 'mount'
    mount.mkdir()
    try:
        run(['/usr/bin/hdiutil', 'attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount], root, env)
        verify_app(mount / 'DoodleNote.app', args, root, env)
        require(inventory(mount / 'DoodleNote.app') == before, 'ZIP/DMG app payloads differ')
    finally:
        # Attempt cleanup even if attach timed out after the volume mounted.
        if os.path.ismount(mount):
            run(['/usr/bin/hdiutil', 'detach', mount], root, env)
    return app, before, hashes


def write_wave(path, channels=1, frequency=440):
    with wave.open(str(path), 'wb') as output:
        output.setparams((channels, 2, 16000, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(struct.pack('<h', int(10000 * math.sin(2 * math.pi *
            (frequency + channel * 220) * frame / 16000)))
            for frame in range(16000) for channel in range(channels)))


def check_wave(path, channels=1, seconds=1, frequencies=None):
    with wave.open(str(path), 'rb') as audio:
        require(audio.getnchannels() == channels and audio.getframerate() == 16000
                and audio.getsampwidth() == 2 and abs(audio.getnframes() / 16000 - seconds) < .15,
                'Decoded audio format/duration mismatch')
        values = struct.unpack('<' + 'h' * audio.getnframes() * channels, audio.readframes(audio.getnframes()))
        require(all(max(abs(v) for v in values[c::channels]) > 1000 for c in range(channels)),
                'Decoded channel is silent')
        frequencies = frequencies or tuple(440 + c * 220 for c in range(channels))
        require(len(frequencies) == channels, 'Expected audio content must identify every channel')
        for channel, frequency in enumerate(frequencies):
            samples = values[channel::channels]
            # Use the central half second, avoiding codec delay/padding. Quadrature
            # energy is insensitive to phase and gain. At least 75% must be the
            # expected tone: allow modest decode noise/drift, reject lost, swapped
            # or equally mixed signals. This is fixture identity, not audio quality.
            start = (len(samples) - 8000) // 2
            samples = samples[start:start + 8000]
            mean = sum(samples) / len(samples)
            samples = [value - mean for value in samples]
            energy = sum(value * value for value in samples)
            real = sum(value * math.cos(2 * math.pi * frequency * n / 16000)
                       for n, value in enumerate(samples))
            imaginary = sum(value * math.sin(2 * math.pi * frequency * n / 16000)
                            for n, value in enumerate(samples))
            require(energy > 0 and 2 * (real * real + imaginary * imaginary)
                    / (len(samples) * energy) >= .75, 'Decoded channel content mismatch')


def audio_smoke(app, root, env):
    engine = app / 'Contents/Resources/engine/engine'
    fixture = root / 'audio'
    fixture.mkdir()
    mono, stereo, system = fixture / 'mono.wav', fixture / 'stereo.wav', fixture / 'system.wav'
    write_wave(mono)
    write_wave(stereo, 2)
    write_wave(system, frequency=660)
    original_hashes = {str(p): digest(p) for p in (mono, stereo, system)}
    # System afconvert produces an audio-only MP4 container. This qualifies
    # accepted MP4 input, not video-track fallback normalization coverage.
    mp4 = fixture / 'audio.mp4'
    run(['/usr/bin/afconvert', '-f', 'mp4f', '-d', 'aac', '-b', '32000', mono, mp4], root, env)
    original_hashes[str(mp4)] = digest(mp4)
    for source, mode, channels in [(mono, 'mixed', ['mic']), (stereo, 'split', ['mic', 'system']),
                                   (mp4, 'mixed', ['mic'])]:
        output = fixture / (source.stem + '-' + mode)
        output.mkdir()
        events = [json.loads(line) for line in run([engine, 'prepare-batch-audio', '--file', source,
                  '--output-dir', output, '--channels', mode], root, env).splitlines()]
        require(any(e.get('event') == 'prepared' and e.get('channels') == channels
                    and abs(e['audioSeconds'] - 1) < .15 for e in events), 'Missing prepared protocol')
        require(sorted(p.name for p in output.iterdir()) == sorted(c + '.wav' for c in channels),
                'Unexpected import temporary files')
        for channel in channels:
            check_wave(output / (channel + '.wav'), frequencies=(660 if channel == 'system' else 440,))
    session = fixture / 'session'
    checkpoints = session / 'checkpoints'
    checkpoints.mkdir(parents=True)
    for channel, source in (('mic', mono), ('system', system)):
        run(['/usr/bin/afconvert', '-f', 'caff', '-d', 'LEF32', source,
             checkpoints / (channel + '-000000.caf')], root, env)
    events = [json.loads(line) for line in run([engine, 'merge-audio', '--dir', session], root, env).splitlines()]
    require(any(e.get('event') == 'audio' and e.get('path') == str(session / 'audio.m4a')
                and abs(e['durationMs'] - 1000) < 150 for e in events)
            and any(e.get('event') == 'done' for e in events), 'Missing merge protocol')
    decoded = fixture / 'merged.wav'
    run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16', session / 'audio.m4a', decoded], root, env)
    check_wave(decoded, channels=2)
    require(not checkpoints.exists(), 'Successful merge left checkpoints')
    # A corrupt checkpoint must fail and remain available, never claim recovery.
    broken = fixture / 'broken/checkpoints'
    broken.mkdir(parents=True)
    bad = broken / 'mic-000000.caf'
    bad.write_bytes(b'synthetic invalid CAF')
    before = digest(bad)
    failed = run([engine, 'merge-audio', '--dir', broken.parent], root, env, expected=64)
    require(any(json.loads(line).get('event') == 'error' for line in failed.splitlines()),
            'Failed merge did not emit error protocol')
    require(digest(bad) == before, 'Failed merge removed checkpoint')
    require(all(digest(Path(p)) == h for p, h in original_hashes.items()), 'Import changed fixture originals')


def execute(args, root):
    validate_inputs(args)
    require(sys.platform == 'darwin', 'Verification requires macOS14 ARM64')
    env = runtime_env(root)
    version = run(['/usr/bin/sw_vers', '-productVersion'], root, env).strip()
    require(version.startswith('14.') and run(['/usr/bin/uname', '-m'], root, env).strip() == 'arm64',
            'Verification requires macOS14 ARM64')
    build = run(['/usr/bin/sw_vers', '-buildVersion'], root, env).strip()
    token = os.environ.get('GITHUB_TOKEN', '')
    require(token, 'GitHub artifact read token is required')
    run_data = api_json('/actions/runs/' + args.run_id, token)
    artifact = api_json('/actions/artifacts/' + args.artifact_id, token)
    validate_metadata(args, run_data, artifact)
    archive = root / 'artifact.zip'
    download(args, token, archive)
    directory = root / 'payload'
    extract_outer(archive, directory, args.version)
    app, before, hashes = verify_payload(directory, args, root, env)
    audio_smoke(app, root, env)
    electron = app / 'Contents/MacOS/DoodleNote'
    env['ELECTRON_RUN_AS_NODE'] = '1'
    raw = run([electron, SCRIPTS / 'mac-candidate-runtime-smoke.cjs', app, root / 'runtime'],
              root, env, timeout=120)
    runtime = json.loads(raw)
    require(runtime.get('passed') is True, 'Runtime smoke did not pass')
    require(inventory(app) == before, 'Runtime changed app bundle')
    verify_app(app, args, root, env)
    require(verify_receipt(directory, args) == hashes, 'Candidate payload changed')
    return {'os': version, 'osBuild': build, 'architecture': 'arm64', 'payloadSHA256': hashes, 'runtime': runtime,
            'checks': ['receipt/signature/ticket/Gatekeeper/manifest', 'ZIP/DMG equality',
                       'audio import and merge protocol', 'unchanged bundle and originals'],
            'limitations': ['no capture, GUI, permissions, VoiceOver or inference',
                            'audio-only MP4 does not prove video normalization fallback',
                            'Electron Node is not minimum Node18 MCP evidence']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('run-id', 'artifact-id', 'candidate-sha', 'version', 'archive-sha256', 'harness-sha'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'passed': False, 'candidateSHA': args.candidate_sha, 'harnessSHA': args.harness_sha,
              'runID': args.run_id, 'artifactID': args.artifact_id, 'version': args.version,
              'archiveSHA256': args.archive_sha256}
    try:
        report.update(execute(args, args.output))
        report['passed'] = True
    except Exception as error:
        # Do not include URL-bearing HTTP exceptions, credential-bearing env or tracebacks.
        report['error'] = str(error) if isinstance(error, ValueError) else type(error).__name__
    finally:
        (args.output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
