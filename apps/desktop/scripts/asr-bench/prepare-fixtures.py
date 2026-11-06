#!/usr/bin/env python3
"""Download, verify and cut the ASR benchmark fixtures (Python 3 stdlib only).

    python3 -I prepare-fixtures.py <cache-dir> [--manifest manifest.json]

Every source in the manifest is downloaded once into <cache-dir>/sources and
must match its pinned SHA256. Prepared 16 kHz mono WAV files and an index with
references land in <cache-dir>/prepared. Prepared audio is checked against the
manifest's pinned hashes, so both platforms score the exact same samples.
Audio never belongs in git.

Developer helper (used once to choose the AMI clips in the manifest):

    python3 -I prepare-fixtures.py <cache-dir> --select-ami ES2004a IS1009a
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import urllib.request
import wave
import xml.etree.ElementTree as ET
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
NITE = '{http://nite.sourceforge.net/}'


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(source, directory):
    path = os.path.join(directory, source['file'])
    if os.path.exists(path) and sha256_file(path) == source['sha256']:
        return path
    partial = path + '.partial'
    print(f"downloading {source['url']}", file=sys.stderr)
    with urllib.request.urlopen(source['url'], timeout=120) as response, open(partial, 'wb') as out:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    actual = sha256_file(partial)
    if actual != source['sha256']:
        os.remove(partial)
        raise SystemExit(f"{source['id']}: SHA256 {actual} does not match the manifest")
    os.replace(partial, path)
    return path


def read_wav(data):
    with wave.open(io.BytesIO(data) if isinstance(data, bytes) else data, 'rb') as w:
        if w.getsampwidth() != 2:
            raise SystemExit('only 16-bit PCM sources are supported')
        rate, channels = w.getframerate(), w.getnchannels()
        frames = w.readframes(w.getnframes())
    if channels != 1:
        raise SystemExit('only mono sources are supported')
    return rate, frames


def resample_16k(rate, frames):
    if rate == 16000:
        return frames
    import array
    src = array.array('h')
    src.frombytes(frames)
    ratio = rate / 16000
    out = array.array('h', [0]) * int(len(src) / ratio)
    for i in range(len(out)):
        pos = i * ratio
        k = int(pos)
        frac = pos - k
        a = src[k]
        b = src[k + 1] if k + 1 < len(src) else a
        out[i] = int(round(a + (b - a) * frac))
    return out.tobytes()


def write_wav(path, frames):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(frames)


def ami_words(zip_path, meeting):
    """All transcribed words of a meeting: (start, end, speaker, text, punc)."""
    words = []
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            match = re.match(rf'words/{meeting}\.([A-Z])\.words\.xml$', name)
            if not match:
                continue
            root = ET.fromstring(archive.read(name))
            for element in root:
                if element.tag != 'w' or element.get('starttime') is None:
                    continue
                text = (element.text or '').strip()
                if not text:
                    continue
                words.append((float(element.get('starttime')), float(element.get('endtime')),
                              match.group(1), text, element.get('punc') == 'true'))
    words.sort(key=lambda w: (w[0], w[1]))
    return words


def ami_segments(zip_path, meeting):
    segments = []
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            match = re.match(rf'segments/{meeting}\.([A-Z])\.segments\.xml$', name)
            if not match:
                continue
            root = ET.fromstring(archive.read(name))
            for element in root:
                if element.tag == 'segment':
                    segments.append((float(element.get('transcriber_start')),
                                     float(element.get('transcriber_end')), match.group(1)))
    return sorted(segments)


def join_words(words):
    text = ''
    for _, _, _, token, punc in words:
        text += token if punc or not text else ' ' + token
    return text


def select_ami(zip_path, meeting, count=12):
    words = ami_words(zip_path, meeting)
    candidates = []
    for start, end, speaker in ami_segments(zip_path, meeting):
        if not 4 <= end - start <= 20:
            continue
        lo, hi = start - 0.3, end + 0.3
        inside = [w for w in words if w[2] == speaker and start - 0.05 <= w[0] and w[1] <= end + 0.05]
        if sum(1 for w in inside if not w[4]) < 6:
            continue
        intruders = [w for w in words if w not in inside and w[1] > lo and w[0] < hi and not w[4]]
        if intruders:
            continue
        candidates.append((start, end, speaker, join_words(inside)))
    if len(candidates) > count:
        step = len(candidates) / count
        candidates = [candidates[int(i * step)] for i in range(count)]
    return [{'meeting': meeting, 'speaker': s, 'start': round(a - 0.25, 3), 'end': round(b + 0.25, 3),
             'reference': ref} for a, b, s, ref in candidates]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('cache')
    parser.add_argument('--manifest', default=os.path.join(HERE, 'manifest.json'))
    parser.add_argument('--select-ami', nargs='*')
    args = parser.parse_args()
    manifest = json.load(open(args.manifest, encoding='utf-8'))
    sources_dir = os.path.join(args.cache, 'sources')
    prepared_dir = os.path.join(args.cache, 'prepared')
    os.makedirs(sources_dir, exist_ok=True)
    os.makedirs(prepared_dir, exist_ok=True)
    sources = {s['id']: s for s in manifest['sources']}
    paths = {}

    def source_path(source_id):
        if source_id not in paths:
            paths[source_id] = fetch(sources[source_id], sources_dir)
        return paths[source_id]

    if args.select_ami is not None:
        clips = []
        for meeting in args.select_ami:
            clips += select_ami(source_path('ami-annotations'), meeting)
        json.dump(clips, sys.stdout, indent=1)
        return

    index = []
    mismatches = []
    tar_cache = {}
    for fixture in manifest['fixtures']:
        out = os.path.join(prepared_dir, fixture['id'] + '.wav')
        entry = {'id': fixture['id'], 'set': fixture['set'], 'wav': out,
                 'license': sources[fixture['source']]['license']}
        kind = fixture['kind']
        if kind == 'tar-member':
            archive_path = source_path(fixture['source'])
            if archive_path not in tar_cache:
                tar_cache[archive_path] = tarfile.open(archive_path, 'r:*')
            data = tar_cache[archive_path].extractfile(fixture['member']).read()
            rate, frames = read_wav(data)
            frames = resample_16k(rate, frames)
            entry['reference'] = fixture['reference']
        elif kind in ('ami-clip', 'ami-meeting'):
            rate, frames = read_wav(source_path(fixture['source']))
            if rate != 16000:
                raise SystemExit('AMI sources are 16 kHz')
            words = ami_words(source_path('ami-annotations'), fixture['meeting'])
            if kind == 'ami-clip':
                a, b = int(fixture['start'] * 16000), int(fixture['end'] * 16000)
                frames = frames[a * 2:b * 2]
                entry['reference'] = fixture['reference']
                entry['offsetSec'] = fixture['start']
            else:
                speakers = fixture.get('speakers')
                kept = [w for w in words if speakers is None or w[2] in speakers]
                entry['reference'] = join_words(kept)
                # Word timings for timestamp-drift analysis.
                timings = [{'w': w[3], 's': w[0], 'e': w[1]} for w in kept if not w[4]]
                timing_path = os.path.join(prepared_dir, fixture['id'] + '.words.json')
                json.dump(timings, open(timing_path, 'w', encoding='utf-8'))
                entry['wordTimings'] = timing_path
        else:
            raise SystemExit(f'unknown fixture kind {kind}')
        write_wav(out, frames)
        entry['seconds'] = len(frames) / 2 / 16000
        entry['sha256'] = sha256_file(out)
        if fixture.get('sha256') and fixture['sha256'] != entry['sha256']:
            mismatches.append(fixture['id'])
        if fixture.get('pairWith'):
            entry['pairWith'] = fixture['pairWith']
        index.append(entry)
    json.dump({'normalization': manifest['normalization'], 'fixtures': index},
              open(os.path.join(prepared_dir, 'index.json'), 'w', encoding='utf-8'), indent=1)
    print(f'prepared {len(index)} fixtures in {prepared_dir}', file=sys.stderr)
    if mismatches:
        raise SystemExit(f'prepared audio does not match pinned hashes: {mismatches}')


if __name__ == '__main__':
    main()
