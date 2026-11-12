"""Match classroom faces to the students of a group.

Same approach as vision_model/app/main.py (cosine similarity, best reference per
student, Hungarian one-to-one assignment, ambiguity margin), extended for:
  * a review band (REVIEW_THRESHOLD <= score < PRESENT_THRESHOLD → "à vérifier");
  * several photos of one scan (G·C·D): each photo is matched on its own, then
    results are merged per student, so a student seen on 2 overlapping photos
    counts once.
"""

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from .settings import AMBIGUITY_MARGIN, PRESENT_THRESHOLD, REVIEW_THRESHOLD

RANK = {"absent": 0, "needs_review": 1, "present": 2}


def _normalise(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return m / norms


@dataclass
class StudentRefs:
    ids: list
    refs: np.ndarray  # (R, 512) all references, normalised
    owner: np.ndarray  # (R,) column index of the student owning each reference

    @classmethod
    def build(cls, students: list[dict]) -> "StudentRefs":
        ids, refs, owner = [], [], []
        for s in students:
            vectors = [v for v in s.get("embeddings", []) if v and len(v) == 512]
            if not vectors:
                continue
            col = len(ids)
            ids.append(s["id"])
            refs.extend(vectors)
            owner.extend([col] * len(vectors))
        matrix = _normalise(np.asarray(refs, dtype=np.float32)) if refs else np.zeros((0, 512), np.float32)
        return cls(ids, matrix, np.asarray(owner, dtype=np.int64))

    def similarity(self, faces: np.ndarray) -> np.ndarray:
        """(F, S): for each face, the best score over each student's references."""
        sims = np.full((len(faces), len(self.ids)), -1.0, dtype=np.float32)
        if len(faces) == 0 or len(self.ids) == 0:
            return sims
        per_ref = _normalise(faces) @ self.refs.T  # (F, R)
        for col in range(len(self.ids)):
            sims[:, col] = per_ref[:, self.owner == col].max(axis=1)
        return sims


@dataclass
class Evidence:
    status: str = "absent"
    similarity: float | None = None
    best_raw: float = -1.0
    seen_in: list = field(default_factory=list)

    def offer(self, status: str, score: float, image_index: int):
        if RANK[status] > RANK[self.status] or (
            status == self.status and (self.similarity is None or score > self.similarity)
        ):
            self.status, self.similarity = status, round(float(score), 4)
        if image_index not in self.seen_in:
            self.seen_in.append(image_index)


def match_image(sims: np.ndarray):
    """Hungarian assignment on one photo → list of (face, col, status, score, margin, rival_col)."""
    out = []
    if sims.size == 0:
        return out
    rows, cols = linear_sum_assignment(-sims)
    for f, c in zip(rows, cols):
        score = float(sims[f, c])
        others = np.delete(sims[f], c)
        second = float(others.max()) if others.size else -1.0
        rival = None
        if others.size:
            masked = sims[f].copy()
            masked[c] = -np.inf
            rival = int(masked.argmax())
        margin = score - second

        if score >= PRESENT_THRESHOLD and margin >= AMBIGUITY_MARGIN:
            status = "present"
        elif score >= REVIEW_THRESHOLD:
            status = "needs_review"  # in the review band, or two students too close
        else:
            status = None  # unknown face
        out.append((int(f), int(c), status, score, margin, rival if second >= PRESENT_THRESHOLD else None))
    return out


def recognise(faces_per_image: list[list[dict]], students: list[dict]) -> dict:
    refs = StudentRefs.build(students)
    evidence = {sid: Evidence() for sid in refs.ids}
    images, faces_total, unknown_total = [], 0, 0

    for idx, faces in enumerate(faces_per_image):
        emb = np.asarray([f["embedding"] for f in faces], dtype=np.float32).reshape(-1, 512)
        sims = refs.similarity(emb)
        if sims.size:
            for col, sid in enumerate(refs.ids):
                evidence[sid].best_raw = max(evidence[sid].best_raw, float(sims[:, col].max()))

        recognised = review = 0
        assigned = set()
        for f, c, status, score, margin, rival in match_image(sims):
            if status is None:
                continue
            assigned.add(f)
            evidence[refs.ids[c]].offer(status, score, idx)
            if status == "present":
                recognised += 1
            else:
                review += 1
                # Ambiguous between two students: both need a look (as in vision_model).
                if rival is not None and margin < AMBIGUITY_MARGIN:
                    evidence[refs.ids[rival]].offer("needs_review", float(sims[f, rival]), idx)

        unknown = len(faces) - len(assigned)
        faces_total += len(faces)
        unknown_total += unknown
        images.append({"index": idx, "faces": len(faces), "recognised": recognised, "review": review, "unknown": unknown})

    return {
        "students": [
            {
                "id": sid,
                "status": ev.status,
                "similarity": ev.similarity,
                "best_similarity": round(ev.best_raw, 4) if ev.best_raw > -1 else None,
                "seen_in": ev.seen_in,
            }
            for sid, ev in evidence.items()
        ],
        "faces_total": faces_total,
        # Faces on overlapping photos may be counted twice here.
        "unknown_faces": unknown_total,
        "images": images,
        "thresholds": {"present": PRESENT_THRESHOLD, "review": REVIEW_THRESHOLD, "margin": AMBIGUITY_MARGIN},
    }
