import json
import re
from typing import List, Dict
from sqlalchemy.orm import Session
from llm_clients import get_llm_client
from logger import setup_logger

logger = setup_logger("analyzer_agent")

class AnalyzerAgent:
    def __init__(self, model_name: str = "deepseek"):
        self.model_name = model_name

    def analyze(self, requirement: str, db: Session) -> List[Dict[str, str]]:
        client = get_llm_client(self.model_name, db)
        prompt = f"""你是一个严谨的软件需求分析师。根据以下需求，生成一个 JSON 数组，每个元素包含 "dimension" 和 "description" 字段，描述需求中的模糊点或不明确的细节。
需求：{requirement}
输出示例：[{{"dimension": "输入规格", "description": "输入数据的类型、格式、范围？"}}, ...]
只输出 JSON 数组，不要有其他文本。"""
        
        response = client.chat([{"role": "user", "content": prompt}], temperature=0.3)
        # 改进正则：匹配第一个 JSON 数组
        match = re.search(r'\[\s*\{.*?\}\s*\]', response, re.DOTALL)
        if match:
            try:
                items = json.loads(match.group())
                if isinstance(items, list) and all("dimension" in i and "description" in i for i in items):
                    return items
            except json.JSONDecodeError as e:
                logger.warning(f"JSON解析失败: {e}, 原始响应片段: {response[:300]}")
        # 后备通用检查清单
        logger.info("使用默认模糊点清单")
        default_ambiguities = [
            {"dimension": "输入规格", "description": "输入数据的类型、格式、范围、有效性？"},
            {"dimension": "输出规格", "description": "输出的类型、格式、返回方式？"},
            {"dimension": "边界条件", "description": "输入为空、最大、最小值时的行为？"},
            {"dimension": "异常处理", "description": "如何处理非法输入或运行时错误？"},
            {"dimension": "性能约束", "description": "是否有时间或空间复杂度要求？"},
            {"dimension": "编程语言/框架", "description": "期望使用哪种编程语言或框架？"}
        ]
        return default_ambiguities