from typing import List, Dict
from sqlalchemy.orm import Session
from llm_clients import get_llm_client

class QuestionAgent:
    def __init__(self, model_name: str = "deepseek"):
        self.model_name = model_name

    def generate(self, requirement: str, ambiguity_list: List[Dict[str, str]], db: Session) -> List[str]:
        client = get_llm_client(self.model_name, db)
        questions = []
        for amb in ambiguity_list:
            dim = amb.get("dimension", "未知")
            desc = amb.get("description", "")
            prompt = f"""需求：{requirement}
关于{dim}不明确：{desc}
请生成一个具体的引导性问题，提供选项或示例。每个选项后换行。只输出问题。"""
            q = client.chat([{"role": "user", "content": prompt}], temperature=0.5)
            questions.append(q.strip())
        return questions