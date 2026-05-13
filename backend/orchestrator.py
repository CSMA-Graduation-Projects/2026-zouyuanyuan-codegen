import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from enum import Enum
from typing import Dict, Any, Optional, Tuple, List
import re
from sqlalchemy.orm import Session
from agents.analyzer_agent import AnalyzerAgent
from agents.question_agent import QuestionAgent
from agents.code_agent import CodeAgent
from agents.history_agent import HistoryAgent
from agents.rollback_agent import RollbackAgent
from logger import setup_logger

logger = setup_logger("orchestrator")

class ConversationState(Enum):
    WAITING_INPUT = 1
    DETECTING = 2
    EDITING_AMBIGUITIES = 3
    WAITING_CLARIFICATION = 4
    CONFIRMED = 5
    GENERATING_CODE = 6

class Orchestrator:
    def __init__(self, model_name: str = "deepseek"):
        self.state = ConversationState.WAITING_INPUT
        self.original_requirement = ""
        self.clarified_spec: Dict[str, str] = {}
        self.current_questions: List[str] = []
        self.current_question_index = 0
        self.ambiguity_list: List[Dict[str, str]] = []
        self.conversation_history: List[Dict[str, str]] = []
        self.generation_mode = "standard"
        self.last_generated_code = ""
        self.last_baseline_code = ""
        self.model_name = model_name
        self.skill_ambiguities: List[Dict[str, str]] = []

        self.analyzer = AnalyzerAgent(model_name=model_name)
        self.questioner = QuestionAgent(model_name=model_name)
        self.coder = CodeAgent(model_name=model_name)
        self.history = HistoryAgent()
        self.rollback = RollbackAgent()

    def set_model(self, model_name: str):
        self.model_name = model_name
        self.analyzer = AnalyzerAgent(model_name=model_name)
        self.questioner = QuestionAgent(model_name=model_name)
        self.coder = CodeAgent(model_name=model_name)

    def set_generation_mode(self, mode: str):
        if mode in ["standard", "explanatory", "minimal"]:
            self.generation_mode = mode

    def _normalize_answer(self, answer: str, question_text: str) -> str:
        ans = answer.strip()
        if not re.match(r'^[a-zA-Z0-9]$', ans):
            return ans.lower()
        if question_text:
            pattern = r'(?:^|\n)\s*' + re.escape(ans) + r'[\.\s]+([^\n]+)'
            match = re.search(pattern, question_text, re.MULTILINE)
            if match:
                option_text = match.group(1).strip()
                option_text = re.split(r'[，,。]', option_text)[0].strip()
                if option_text:
                    return option_text
        return ans.lower()

    def receive_requirement(self, requirement: str, db: Session) -> List[Dict[str, str]]:
        self.original_requirement = requirement.strip()
        self.conversation_history.append({"role": "user", "content": requirement})
        self.state = ConversationState.DETECTING
        self.rollback.push(self.get_full_state(), self.original_requirement, self.clarified_spec.copy(), self.current_question_index)
        self.ambiguity_list = self.analyzer.analyze(self.original_requirement, db)
        if not self.ambiguity_list:
            self.ambiguity_list = [
                {"dimension": "输入规格", "description": "输入的数据类型、格式、范围？"},
                {"dimension": "输出规格", "description": "期望的输出类型和格式？"},
                {"dimension": "异常处理", "description": "对错误输入如何响应？"}
            ]
        if self.skill_ambiguities:
            existing_dims = {a["dimension"] for a in self.ambiguity_list}
            for sa in self.skill_ambiguities:
                if sa["dimension"] not in existing_dims:
                    self.ambiguity_list.append({
                        "dimension": sa["dimension"],
                        "description": sa["description"]
                    })
            for sa in self.skill_ambiguities:
                if sa.get("default_answer"):
                    self.clarified_spec[sa["dimension"]] = sa["default_answer"]
            self.skill_ambiguities = []
        similar = self.history.get_similar(self.original_requirement)
        if similar:
            self.conversation_history.append({"role": "system", "content": f"【参考历史】{similar['clarified_spec']}"})
        self.state = ConversationState.EDITING_AMBIGUITIES
        return self.ambiguity_list

    def update_ambiguities(self, new_ambiguities: List[Dict[str, str]], db: Session) -> Optional[str]:
        self.ambiguity_list = new_ambiguities
        if not self.ambiguity_list:
            self.state = ConversationState.CONFIRMED
            return None
        remaining_amb = []
        for amb in self.ambiguity_list:
            dim = amb.get("dimension", "")
            if dim not in self.clarified_spec:
                remaining_amb.append(amb)
        if remaining_amb:
            self.current_questions = self.questioner.generate(self.original_requirement, remaining_amb, db)
            while len(self.current_questions) < len(remaining_amb):
                self.current_questions.append("请补充上述信息。")
        else:
            self.current_questions = []
        self.current_question_index = 0
        self.state = ConversationState.WAITING_CLARIFICATION
        return self.current_questions[0] if self.current_questions else None

    def receive_answer(self, answer: str, db: Session) -> Tuple[Optional[str], bool]:
        if self.state != ConversationState.WAITING_CLARIFICATION:
            if self.current_question_index < len(self.current_questions):
                self.state = ConversationState.WAITING_CLARIFICATION
            else:
                self.state = ConversationState.CONFIRMED
                return None, True
        self.rollback.push(self.get_full_state(), self.original_requirement, self.clarified_spec.copy(), self.current_question_index)
        current_q = self.current_questions[self.current_question_index] if self.current_question_index < len(self.current_questions) else ""
        norm_ans = self._normalize_answer(answer, current_q)
        self.conversation_history.append({"role": "user", "content": answer})
        if self.current_question_index >= len(self.ambiguity_list):
            self.state = ConversationState.CONFIRMED
            return None, True
        key = self.ambiguity_list[self.current_question_index].get("dimension", f"q{self.current_question_index+1}")
        self.clarified_spec[key] = norm_ans
        self.current_question_index += 1
        if self.current_question_index < len(self.current_questions):
            return self.current_questions[self.current_question_index], False
        else:
            self.state = ConversationState.CONFIRMED
            return None, True

    def _regenerate_questions_from(self, start_idx: int, db: Session):
        sub = self.ambiguity_list[start_idx:]
        new_qs = self.questioner.generate(self.original_requirement, sub, db)
        self.current_questions = self.current_questions[:start_idx] + new_qs

    def get_full_state(self) -> Dict:
        return {
            "state": self.state.value,
            "original_requirement": self.original_requirement,
            "clarified_spec": self.clarified_spec.copy(),
            "current_questions": self.current_questions.copy(),
            "current_question_index": self.current_question_index,
            "ambiguity_list": self.ambiguity_list.copy(),
            "conversation_history": self.conversation_history.copy(),
            "generation_mode": self.generation_mode,
            "last_generated_code": self.last_generated_code,
            "last_baseline_code": self.last_baseline_code,
            "model_name": self.model_name,
            "skill_ambiguities": self.skill_ambiguities.copy()
        }

    def restore_from_state(self, state: Dict):
        # 直接使用 ConversationState，避免循环导入
        self.state = ConversationState(state["state"])
        self.original_requirement = state["original_requirement"]
        self.clarified_spec = state["clarified_spec"].copy()
        self.current_questions = state["current_questions"].copy()
        self.current_question_index = state["current_question_index"]
        self.ambiguity_list = state["ambiguity_list"].copy()
        self.conversation_history = state["conversation_history"].copy()
        self.generation_mode = state["generation_mode"]
        self.last_generated_code = state["last_generated_code"]
        self.last_baseline_code = state.get("last_baseline_code", "")
        self.model_name = state["model_name"]
        self.skill_ambiguities = state.get("skill_ambiguities", []).copy()

    def generate_code(self, db: Session) -> Tuple[str, str, List[str], str]:
        if self.state != ConversationState.CONFIRMED:
            raise Exception("需求尚未澄清完成")
        self.state = ConversationState.GENERATING_CODE
        try:
            baseline_code, _ = self.coder.generate(
                self.original_requirement, {}, db,
                mode=self.generation_mode, similar_code=None, is_baseline=True
            )
            self.last_baseline_code = baseline_code
            similar = self.history.get_similar(self.original_requirement)
            similar_code = similar.get("final_code") if similar else None
            code, explanation = self.coder.generate(
                self.original_requirement, self.clarified_spec, db,
                mode=self.generation_mode, similar_code=similar_code, is_baseline=False
            )
            self.last_generated_code = code
            suggestions = []
            if "password" in code.lower() or "secret" in code.lower():
                suggestions.append("⚠️ 检测到敏感关键词，请勿硬编码凭据。")
            if "exec(" in code or "eval(" in code:
                suggestions.append("⚠️ 使用了exec/eval，存在代码注入风险。")
            if "sql" in code.lower() and "+" in code and "sql" in code.lower():
                suggestions.append("🔒 检测到SQL字符串拼接，建议使用参数化查询。")
            self.history.record_success(self.original_requirement, self.clarified_spec, code, 1.0)
            self.state = ConversationState.WAITING_INPUT
            return code, explanation, suggestions, baseline_code
        except Exception as e:
            logger.exception("代码生成失败")
            self.state = ConversationState.CONFIRMED
            raise e

    def get_conversation_history(self) -> List[Dict[str, str]]:
        return self.conversation_history

    def get_clarified_spec(self) -> Dict[str, Any]:
        return {"original": self.original_requirement, "details": self.clarified_spec}