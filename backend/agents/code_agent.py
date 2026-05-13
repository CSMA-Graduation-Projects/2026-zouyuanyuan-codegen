import re
import ast
from typing import Dict, Tuple, Optional, List
from sqlalchemy.orm import Session
from llm_clients import get_llm_client


class CodeAgent:
    def __init__(self, model_name: str = "deepseek"):
        self.model_name = model_name

    def _validate_syntax(self, code: str) -> Tuple[bool, Optional[str]]:
        """检查代码语法是否正确，返回 (是否有效, 错误信息)"""
        try:
            ast.parse(code)
            return True, None
        except SyntaxError as e:
            return False, f"第 {e.lineno} 行: {e.msg}"

    def _extract_function_names(self, code: str) -> List[str]:
        """从代码中提取所有顶层函数名"""
        try:
            tree = ast.parse(code)
            return [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
        except SyntaxError:
            return []

    def _ensure_function_defined(self, code: str) -> str:
        """如果代码没有函数定义，则尝试将整个代码包装为一个函数"""
        if self._extract_function_names(code):
            return code
        return f"def generated_function():\n    return {repr(code)}"

    def _build_generation_prompt(self, original_requirement: str, clarified_spec: Dict[str, str],
                                 mode: str, similar_code: Optional[str]) -> str:
        details = "\n".join([f"- {k}: {v}" for k, v in clarified_spec.items()])
        mode_instruction = {
            "standard": "生成健壮的代码，包含输入校验，对无效输入必须抛出 TypeError 或 ValueError，不要返回 None 或错误码。",
            "explanatory": "在标准模式基础上添加详细中文注释。",
            "minimal": "仅实现核心功能，无错误处理，但必须保证输入合法时正确运行。"
        }.get(mode, "生成健壮的代码。")

        highlight_instruction = """
另外，要求对代码中根据澄清信息生成的关键部分，添加特殊注释，格式为：
# CLARIFIED: 维度名称
例如：
def add(a, b):
    # CLARIFIED: 输入规格 - 假设输入为整数
    if not isinstance(a, int) or not isinstance(b, int):
        raise TypeError("输入必须是整数")
    return a + b
这样可以使前端高亮显示这些行。每个澄清项至少对应一条这样的注释。
"""

        similar_section = f"\n参考相似案例代码：\n\n{similar_code[:1500]}\n\n请在此基础上根据当前需求调整。" if similar_code else ""

        return f"""原始需求：{original_requirement}
澄清细节：
{details}
要求：{mode_instruction}
{highlight_instruction}
{similar_section}
严格约束：
1. 必须是一个纯 Python 函数，使用 def 定义，函数名应当清晰表达功能。
2. 必须包含完整的类型注解（例如 def func(a: int, b: int) -> int）。
3. 对于参数类型错误、空值、越界等情况，必须 raise TypeError 或 ValueError，绝对不要返回 None、-1 或其他特殊值。
4. 不要包含 if __name__ == "__main__": 块。
5. 不要使用 GUI 或 Web 框架代码（如 tkinter, pygame, flask 等）。
6. 只输出代码，用```python ... ```包裹。
"""

    def _generate_with_retry(self, prompt: str, db: Session, max_retries: int = 2) -> str:
        """生成代码并验证语法，失败则重试"""
        client = get_llm_client(self.model_name, db)
        for attempt in range(max_retries + 1):
            response = client.chat([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=4096)
            match = re.search(r'```(?:\w+)?\s*\n(.*?)\n```', response, re.DOTALL)
            code = match.group(1).strip() if match else response.strip()
            code = re.sub(r'\*\*.*?\*\*', '', code)
            code = self._ensure_function_defined(code)
            valid, error = self._validate_syntax(code)
            if valid:
                return code
            if attempt < max_retries:
                prompt = f"""之前生成的代码存在语法错误，请修正后重新生成。
错误信息：{error}
原代码：
```python
{code}
请输出修正后的完整代码，使用python ...包裹，并确保包含至少一个 def 函数定义，并且每个澄清项对应的代码块都要有 # CLARIFIED: 维度名 注释。"""
            else:
                return code
        return code

    def generate(self, original_requirement: str, clarified_spec: Dict[str, str], db: Session,
                 mode: str = "standard", similar_code: Optional[str] = None,
                 is_baseline: bool = False) -> Tuple[str, str]:
        """生成代码（带语法验证和重试）"""
        if is_baseline:
            prompt = f"""原始需求：{original_requirement}
请直接生成满足上述需求的纯 Python 函数代码。要求：

代码必须语法正确，可直接运行。

必须包含至少一个 def 定义的函数，并带有类型注解。

对于非法输入，必须抛出 TypeError 或 ValueError，不要返回特殊值。

不要包含 if name == "main": 入口。

不要使用 GUI 库或 Web 框架。

只输出代码，用python ...包裹。
"""
        else:
            prompt = self._build_generation_prompt(original_requirement, clarified_spec, mode, similar_code)

        code = self._generate_with_retry(prompt, db)
        explanation = "代码已生成" if not is_baseline else "基线代码已生成"
        return code, explanation
