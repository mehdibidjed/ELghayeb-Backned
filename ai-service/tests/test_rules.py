import unittest

import numpy as np

from elghayeb_ai.behavior.rules import summarise


def person(nose=(50, 20), shoulders=((30, 60), (70, 60)), wrists=((30, 100), (70, 100)), eyes=True, box=(0, 0, 100, 200)):
    kps = np.zeros((17, 3), dtype=np.float32)
    if nose:
        kps[0] = (*nose, 1)
    if eyes:
        kps[1] = (45, 15, 1)
        kps[2] = (55, 15, 1)
    kps[5] = (*shoulders[0], 1)
    kps[6] = (*shoulders[1], 1)
    kps[9] = (*wrists[0], 1)
    kps[10] = (*wrists[1], 1)
    return {"box": np.array(box, dtype=np.float32), "score": 0.9, "kps": kps}


class RulesTest(unittest.TestCase):
    def test_attentive(self):
        self.assertEqual(summarise([person()], []), {"persons": 1, "attentive": 1, "phone": 0, "head_down": 0, "hand_up": 0})

    def test_head_down(self):
        c = summarise([person(nose=(50, 55))], [])  # nose almost on the shoulder line
        self.assertEqual((c["head_down"], c["attentive"]), (1, 0))

    def test_hand_up_counts_as_attentive(self):
        c = summarise([person(wrists=((30, 5), (70, 100)))], [])
        self.assertEqual((c["hand_up"], c["attentive"]), (1, 1))

    def test_phone_goes_to_the_nearest_person_only(self):
        a = person(box=(0, 0, 100, 200))
        b = person(box=(300, 0, 400, 200), nose=(350, 20), shoulders=((330, 60), (370, 60)), wrists=((330, 100), (370, 100)))
        phone = {"box": np.array([25, 95, 35, 110], dtype=np.float32), "score": 0.8}
        c = summarise([a, b], [phone])
        self.assertEqual((c["phone"], c["attentive"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
