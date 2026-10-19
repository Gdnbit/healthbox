"""Independent starter-data contract, not a clinical-validity test."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class StarterCatalogTests(unittest.TestCase):
    def load(self, name):
        return json.loads((ROOT / "config" / "open-source-catalogs" / name).read_text(encoding="utf-8"))

    def test_measurement_starter_has_no_codes_thresholds_or_observations(self):
        catalog = self.load("test_library.json")
        self.assertEqual(len(catalog["tests"]), 13)
        self.assertEqual(catalog["_license"], "Apache-2.0")
        names = []
        for entry in catalog["tests"]:
            names.append(entry["test_name"])
            self.assertNotIn("test_code", entry)
            self.assertNotIn("reference_range", entry)
            self.assertNotIn("numeric_value", entry)
            self.assertEqual(entry["default_unit"], "")
            self.assertEqual(entry["result_type"], "quantitative")
        self.assertEqual(len(set(names)), len(names))

    def test_vaccine_starter_has_no_who_identifiers_or_brands(self):
        catalog = self.load("vaccine_library.json")
        self.assertEqual(len(catalog["vaccines"]), 3)
        self.assertEqual(catalog["_license"], "Apache-2.0")
        for entry in catalog["vaccines"]:
            self.assertIsNone(entry["who_code"])
            self.assertIsNone(entry["default_manufacturer"])
            self.assertFalse(entry["is_combined"])
            self.assertEqual(len(entry["disease_keys"]), 1)

    def test_panels_are_organizational_labels_not_prescriptive_definitions(self):
        catalog = self.load("panel_library.json")
        self.assertEqual(len(catalog["panels"]), 3)
        self.assertEqual(catalog["_license"], "Apache-2.0")
        for entry in catalog["panels"]:
            self.assertNotIn("required_tests", entry)
            self.assertNotIn("interval", entry)


if __name__ == "__main__":
    unittest.main()
