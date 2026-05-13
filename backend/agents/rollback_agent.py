import copy
from typing import Any, Tuple, Optional, Dict

class RollbackAgent:
    def __init__(self, max_stack_size: int = 10):
        self.stack = []
        self.max_size = max_stack_size

    def push(self, state: Dict, original_req: str, clarified_spec: dict, current_idx: int):
        """state 为完整快照（字典）"""
        self.stack.append(copy.deepcopy((state, original_req, clarified_spec, current_idx)))
        if len(self.stack) > self.max_size:
            self.stack.pop(0)

    def pop(self) -> Optional[Tuple]:
        return self.stack.pop() if self.stack else None

    def clear(self):
        self.stack.clear()