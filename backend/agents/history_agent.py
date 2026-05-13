import json
import os
from typing import Dict, List, Optional

class HistoryAgent:
    def __init__(self, storage_file: str = "hllm_memory.json"):
        self.storage_file = storage_file
        self.memory = []
        self._load()

    def _load(self):
        if os.path.exists(self.storage_file):
            try:
                with open(self.storage_file, 'r', encoding='utf-8') as f:
                    self.memory = json.load(f)
            except:
                self.memory = []

    def _save(self):
        with open(self.storage_file, 'w', encoding='utf-8') as f:
            json.dump(self.memory, f, ensure_ascii=False, indent=2)

    def record_success(self, requirement: str, clarified_spec: Dict, final_code: str, quality_score: float = 1.0):
        self.memory.append({
            "requirement": requirement,
            "clarified_spec": clarified_spec,
            "final_code": final_code,
            "quality_score": quality_score
        })
        self._save()

    def get_similar(self, requirement: str) -> Optional[Dict]:
        words = set(requirement.lower().split())
        if not words:
            return None
        best = None
        best_score = 0
        for rec in self.memory:
            score = len(words & set(rec["requirement"].lower().split()))
            if score > best_score:
                best_score = score
                best = rec
        return best if best_score > 0 else None