"""Posture rules on YOLOv8-pose keypoints → class-level counts.

COCO keypoints: 0 nose, 1/2 eyes, 3/4 ears, 5/6 shoulders, 7/8 elbows, 9/10 wrists.
Image y grows downwards. Thresholds are first guesses: calibrate them on real
classroom photos from the Pi camera.
"""

import numpy as np

VIS = 0.5  # keypoint visibility threshold
NOSE, L_EYE, R_EYE, L_EAR, R_EAR, L_SH, R_SH, L_WR, R_WR = 0, 1, 2, 3, 4, 5, 6, 9, 10

# Head down when the nose is less than this × shoulder width above the shoulder line.
HEAD_DOWN_RATIO = 0.25


def _vis(kps, i):
    return kps[i, 2] >= VIS


def hand_up(kps) -> bool:
    ref_y = None
    if _vis(kps, NOSE):
        ref_y = kps[NOSE, 1]
    elif _vis(kps, L_EYE) or _vis(kps, R_EYE):
        ref_y = min(kps[i, 1] for i in (L_EYE, R_EYE) if _vis(kps, i))
    if ref_y is None:
        return False
    return any(_vis(kps, w) and kps[w, 1] < ref_y for w in (L_WR, R_WR))


def head_down(kps) -> bool | None:
    """True / False, or None when the shoulders are not visible (can't tell)."""
    if not (_vis(kps, L_SH) and _vis(kps, R_SH)):
        return None
    shoulder_y = (kps[L_SH, 1] + kps[R_SH, 1]) / 2
    width = abs(kps[L_SH, 0] - kps[R_SH, 0]) or 1.0
    if _vis(kps, NOSE):
        return (shoulder_y - kps[NOSE, 1]) < HEAD_DOWN_RATIO * width
    # Nose hidden but ears visible: looking down / away.
    return _vis(kps, L_EAR) or _vis(kps, R_EAR)


def face_visible(kps) -> bool:
    return _vis(kps, NOSE) and (_vis(kps, L_EYE) or _vis(kps, R_EYE))


def _inside(point, box, pad):
    x, y = point
    x1, y1, x2, y2 = box
    return x1 - pad <= x <= x2 + pad and y1 - pad <= y <= y2 + pad


def assign_phones(persons, phones):
    """Each phone goes to at most one person: the one with the closest wrist, or whose box contains it."""
    holders = set()
    for ph in phones:
        x1, y1, x2, y2 = ph["box"]
        centre = np.array([(x1 + x2) / 2, (y1 + y2) / 2])
        best, best_d = None, np.inf
        for i, p in enumerate(persons):
            bw = p["box"][2] - p["box"][0]
            if not _inside(centre, p["box"], pad=0.25 * bw):
                continue
            wrists = [p["kps"][w, :2] for w in (L_WR, R_WR) if _vis(p["kps"], w)]
            d = min((np.linalg.norm(centre - w) for w in wrists), default=np.linalg.norm(centre - p["box"][:2]))
            if d < best_d:
                best, best_d = i, d
        if best is not None:
            holders.add(best)
    return holders


def summarise(persons, phones) -> dict:
    holders = assign_phones(persons, phones)
    counts = {"persons": len(persons), "attentive": 0, "phone": len(holders), "head_down": 0, "hand_up": 0}
    for i, p in enumerate(persons):
        kps = p["kps"]
        up = hand_up(kps)
        down = head_down(kps)
        counts["hand_up"] += int(up)
        counts["head_down"] += int(bool(down))
        if up or (i not in holders and not down and face_visible(kps)):
            counts["attentive"] += 1
    return counts
