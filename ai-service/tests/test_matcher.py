"""python -m unittest discover -s tests   (from ai-service/, with the venv)"""

import unittest

import numpy as np

from elghayeb_ai.matcher import recognise

rng = np.random.default_rng(0)


def unit(v):
    return v / np.linalg.norm(v)


def face_like(ref, cos):
    """A vector with exactly cosine `cos` to `ref`."""
    noise = unit(rng.normal(size=512))
    noise = unit(noise - noise @ ref * ref)
    return unit(cos * ref + np.sqrt(1 - cos**2) * noise)


A, B, C = (unit(rng.normal(size=512)) for _ in range(3))
STUDENTS = [{"id": 1, "embeddings": [A.tolist()]}, {"id": 2, "embeddings": [B.tolist()]}, {"id": 3, "embeddings": [C.tolist()]}]


def faces(*vectors):
    return [{"embedding": v} for v in vectors]


def by_id(result):
    return {s["id"]: s for s in result["students"]}


class MatcherTest(unittest.TestCase):
    def test_present_review_absent(self):
        r = by_id(recognise([faces(face_like(A, 0.7), face_like(B, 0.4))], STUDENTS))
        self.assertEqual(r[1]["status"], "present")
        self.assertEqual(r[2]["status"], "needs_review")  # 0.35 <= 0.4 < 0.45
        self.assertEqual(r[3]["status"], "absent")

    def test_dedup_across_gcd_photos(self):
        # Student 1 on the left and centre photos (overlap): counted once, best score kept.
        res = recognise([faces(face_like(A, 0.6)), faces(face_like(A, 0.8)), faces()], STUDENTS)
        r = by_id(res)
        self.assertEqual(r[1]["status"], "present")
        self.assertAlmostEqual(r[1]["similarity"], 0.8, places=3)
        self.assertEqual(r[1]["seen_in"], [0, 1])
        self.assertEqual(res["faces_total"], 2)

    def test_review_upgraded_by_another_photo(self):
        r = by_id(recognise([faces(face_like(B, 0.4)), faces(face_like(B, 0.6))], STUDENTS))
        self.assertEqual(r[2]["status"], "present")

    def test_unknown_face(self):
        res = recognise([faces(unit(rng.normal(size=512)))], STUDENTS)
        self.assertEqual(res["unknown_faces"], 1)
        self.assertTrue(all(s["status"] == "absent" for s in res["students"]))

    def test_one_face_cannot_mark_two_students(self):
        # One face, similar to both A and B: Hungarian gives it to one, margin too small → review both.
        mixed = unit(A + B)
        r = by_id(recognise([faces(mixed)], STUDENTS))
        self.assertEqual({r[1]["status"], r[2]["status"]}, {"needs_review"})

    def test_students_without_embeddings_are_ignored(self):
        res = recognise([faces(face_like(A, 0.9))], STUDENTS + [{"id": 4, "embeddings": []}])
        self.assertNotIn(4, by_id(res))


if __name__ == "__main__":
    unittest.main()
