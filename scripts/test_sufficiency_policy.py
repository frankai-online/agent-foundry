#!/usr/bin/env python3
"""Exercise Python schema/semantic parity without model calls or database writes."""
import copy
import unittest
from pathlib import Path
from validate_aps import load, structural, semantic

ROOT = Path(__file__).resolve().parents[1]
class ScopedPolicyTests(unittest.TestCase):
    def setUp(self):
        self.doc = load(ROOT / "tests/fixtures/aps/1.5-alpha/scoped-sufficiency-valid.json")
    def errors(self, doc):
        return structural(doc) + semantic(doc)
    def test_valid_and_legacy(self):
        self.assertEqual(self.errors(self.doc), [])
        self.assertEqual(self.errors(load(ROOT / "tests/fixtures/aps/1.5-alpha/minimal-valid.json")), [])
    def test_contradictory_and_incomplete_policies(self):
        def mutate(path, value):
            doc = copy.deepcopy(self.doc)
            dest = doc["sufficiency"]["answerability_policy"]
            for key in path[:-1]:
                dest = dest[key]
            dest[path[-1]] = value
            return doc
        mutations = [
            (["retrieval_conditions"], ["Retrieve permitted missing information"], "INV-026"),
            (["retrieval_mode"], "CONDITIONAL", "INV-026"),
            (["clarification", "do_not_ask_when"], ["Permitted retrieval can fill the gap"], "INV-026"),
            (["clarification", "ask_when"], ["Ask only if retrieval fails"], "INV-026"),
            (["capability_requirements"], [], "INV-027"),
            (["capability_requirements"], None, "INV-027"),
            (["capability_requirements"], [None, None], "INV-027"),
            (["capability_requirements"], [{"capability_id": [], "required_information": 42}, {}], "INV-027"),
            (["requirement_scope"], "ALL_CAPABILITIES", "INV-027"),
            (["required_information"], ["Source text has been supplied.", "Source text is missing."], "INV-027"),
        ]
        for path, value, expected in mutations:
            with self.subTest(path=path, value=value):
                errors = self.errors(mutate(path, value))
                self.assertTrue(any(expected in e for e in errors), errors)
    def test_missing_duplicate_unknown_and_tampered_branches(self):
        for kind in ["missing", "duplicate", "unknown", "tampered", "global-lost"]:
            with self.subTest(kind=kind):
                doc = copy.deepcopy(self.doc)
                ap = doc["sufficiency"]["answerability_policy"]
                branches = ap["capability_requirements"]
                if kind == "missing": del ap["capability_requirements"]
                elif kind == "duplicate": branches[1] = copy.deepcopy(branches[0])
                elif kind == "unknown": branches[1]["capability_id"] = "unknown"
                elif kind == "tampered": branches[0]["required_information"].pop()
                else: ap["required_information"] = []
                self.assertTrue(any("INV-027" in e for e in self.errors(doc)))
    def test_new_engine_cannot_strip_contract_to_masquerade_as_legacy(self):
        ap = self.doc["sufficiency"]["answerability_policy"]
        for field in ["requirement_scope", "capability_requirements", "retrieval_mode"]:
            del ap[field]
        self.assertTrue(any("INV-026" in e or "INV-027" in e for e in self.errors(self.doc)))

if __name__ == "__main__":
    unittest.main()
