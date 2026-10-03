import hashlib
import random
import tempfile
import unittest
from pathlib import Path
from score import diarization, percentile, score, verify_artifacts, word_error


def segment(start, end, speaker):
    return dict(start=start, end=end, speaker=speaker)


class ScoringTests(unittest.TestCase):
    def test_unicode_and_word_errors(self):
        for text in ('Mødet er åbent', 'Über das Projekt', 'Décision prise', 'Mañana sí', 'Meeting starts'):
            self.assertEqual(word_error(text, text.upper())['wer'], 0)
        self.assertEqual(word_error('one two three', 'one four')['errors'], 2)
        self.assertIsNone(word_error('', 'hallucination')['wer'])
        self.assertEqual(word_error('', 'hallucination')['errors'], 1)

    def test_bitvector_matches_independent_dynamic_program(self):
        rng = random.Random(241)
        for _ in range(300):
            left = [rng.choice(['a', 'b', 'c']) for _ in range(rng.randrange(30))]
            right = [rng.choice(['a', 'b', 'c']) for _ in range(rng.randrange(30))]
            row = list(range(len(right) + 1))
            for i, a in enumerate(left, 1):
                next_row = [i]
                for j, b in enumerate(right, 1):
                    next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j-1] + (a != b)))
                row = next_row
            self.assertEqual(word_error(' '.join(left), ' '.join(right))['errors'], row[-1])

    def test_two_hour_sized_transcript(self):
        reference = ' '.join('word' + str(i) for i in range(18000))
        hypothesis = reference.replace('word9000', 'replacement')
        self.assertEqual(word_error(reference, hypothesis)['errors'], 1)
        with self.assertRaises(ValueError):
            word_error([], 'bad')

    def test_permutation_and_duplicate_union(self):
        reference = [segment(0, 1, 'a'), segment(1, 2, 'b')]
        hypothesis = [segment(0, 1, 'y'), segment(0, 1, 'y'), segment(1, 2, 'x')]
        self.assertEqual(diarization(reference, hypothesis, 2)['der'], 0)

    def test_overlap_miss(self):
        value = diarization([segment(0, 2, 'a'), segment(1, 2, 'b')], [segment(0, 2, 'x')], 2)
        self.assertAlmostEqual(value['der'], 1 / 3)
        self.assertEqual(value['overlap_der'], .5)

    def test_global_mapping_does_not_hide_midmeeting_identity_switch(self):
        reference = [segment(0, 1, 'a'), segment(1, 2, 'b'), segment(2, 3, 'a'), segment(3, 4, 'b')]
        hypothesis = [segment(0, 1, 'x'), segment(1, 3, 'y'), segment(3, 4, 'x')]
        self.assertEqual(diarization(reference, hypothesis, 4)['der'], .5)

    def test_false_alarm_and_silence(self):
        value = diarization([segment(0, 1, 'a')], [segment(0, 3, 'x')], 3)
        self.assertEqual(value['der'], 2)
        value = diarization([], [segment(0, 3, 'x')], 3)
        self.assertIsNone(value['der'])
        self.assertEqual(value['false_alarm'], 3)

    def test_invalid_times_rejected(self):
        for end in (float('nan'), 4, -1):
            with self.assertRaises(ValueError):
                diarization([segment(0, end, 'a')], [], 3)
        with self.assertRaises(ValueError):
            diarization([segment(0, 1, str(i)) for i in range(5)], [], 2)

    def test_nearest_rank_and_absence(self):
        self.assertEqual(percentile(list(range(1, 101)), .95), 95)
        self.assertIsNone(percentile([], .95))
        with self.assertRaises(ValueError):
            percentile([-1], .95)

    def test_hash_rejection_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'model'
            path.write_bytes(b'model')
            item = {'path': 'model', 'size': 5, 'sha256': hashlib.sha256(b'model').hexdigest()}
            self.assertEqual(verify_artifacts({'files': [item]}, directory)['verified_bytes'], 5)
            with self.assertRaises(ValueError):
                verify_artifacts({'files': [item, dict(item, path='./model')]}, directory)
            path.write_bytes(b'other')
            with self.assertRaises(ValueError):
                verify_artifacts({'files': [item]}, directory)
            item['path'] = '../escape'
            with self.assertRaises(ValueError):
                verify_artifacts({'files': [item]}, directory)

    def test_synthetic_never_qualifies_and_identity_is_not_permuted(self):
        run = dict(schema_version=1, language='da', evidence_kind='synthetic', duration_seconds=2,
                   reference_text='Hej', hypothesis_text='hej', reference_segments=[], hypothesis_segments=[],
                   identity_decisions=[{'expected': 'a', 'assigned': 'b'}, {'expected': None, 'assigned': 'a'}],
                   retrieval_probes=[{'relevant_ids': ['old-note'], 'retrieved_ids': ['old-note', 'trash'],
                                      'forbidden_ids': ['trash']}])
        result = score(run)
        self.assertFalse(result['release_qualified'])
        self.assertEqual(result['identity']['wrong_accepts'], 2)
        self.assertEqual(result['identity']['unknown_false_accepts'], 1)
        self.assertEqual(result['retrieval']['macro_recall_at_5'], 1)
        self.assertEqual(result['retrieval']['forbidden_hits'], 1)
        run['evidence_kind'] = 'physical-human-speech'
        with self.assertRaises(ValueError):
            score(run)


if __name__ == '__main__':
    unittest.main()
