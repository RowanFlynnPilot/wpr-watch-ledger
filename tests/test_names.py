"""Name matching is the join every source depends on. Run: python -m unittest discover tests"""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from refresh import canonicalize, pretty_name, resolve_county, load_city_county  # noqa: E402

SAME = [
    ("Marathon County Sheriff's Office", "Marathon County WI SO", "Marathon Co Sheriff", "Marathon County Sheriff’s Office"),
    ("Wausau Police Department", "Wausau WI PD", "City of Wausau Police Department", "Wausau PD"),
    ("St. Croix County Sheriff's Office", "Saint Croix County SO", "St Croix Co SO"),
    ("Fond du Lac Police Department", "Fond Du Lac WI PD"),
    ("Village of Rothschild Police Department", "Rothschild PD"),
    ("La Crosse Police Department", "La Crosse WI PD"),
]
DIFFERENT = [
    ("Town of Delavan Police Department", "City of Delavan Police Department"),
    ("Marathon County Sheriff's Office", "Marathon City Police Department"),
    ("Green Bay Police Department", "Green Lake Police Department"),
    ("Dane County Sheriff's Office", "Dunn County Sheriff's Office"),
    ("Milwaukee Police Department", "Milwaukee County Sheriff's Office"),
]

class Names(unittest.TestCase):
    def test_variants_collapse(self):
        for group in SAME:
            keys = {canonicalize(n) for n in group}
            self.assertEqual(len(keys), 1, f"{group} -> {keys}")

    def test_distinct_agencies_stay_distinct(self):
        for a, b in DIFFERENT:
            self.assertNotEqual(canonicalize(a), canonicalize(b), f"{a} == {b}")

    def test_canonical_is_stable(self):
        for group in SAME:
            k = canonicalize(group[0])
            self.assertEqual(canonicalize(k), k)

    def test_house_style(self):
        self.assertEqual(pretty_name("Lafayette Co SO"), "Lafayette County Sheriff's Office")
        self.assertEqual(pretty_name("Sharon PD"), "Sharon Police Department")
        self.assertEqual(pretty_name("Town Of Delavan PD"), "Town of Delavan Police Department")
        self.assertEqual(pretty_name("Jackson County Sheriff’s Office"), "Jackson County Sheriff's Office")
        self.assertEqual(pretty_name("RIG DTF"), "RIG DTF")

class Counties(unittest.TestCase):
    def test_name_and_municipality_rules(self):
        cc = load_city_county()
        self.assertEqual(resolve_county(canonicalize("Columbia County Sheriff's Office"), cc), "Columbia County")
        for muni in ("Franklin", "Glendale", "Whitefish Bay"):
            self.assertEqual(resolve_county(canonicalize(f"{muni} Police Department"), cc), "Milwaukee County")
        self.assertIsNone(resolve_county(canonicalize("RIG DTF"), cc))


if __name__ == "__main__":
    unittest.main()
