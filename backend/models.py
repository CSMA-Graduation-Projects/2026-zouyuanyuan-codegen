from pydantic import BaseModel
from typing import Optional, List, Dict

class RequirementInput(BaseModel):
    requirement: str
    session_id: Optional[str] = None
    mode: Optional[str] = "standard"

class AnswerInput(BaseModel):
    answer: str
    session_id: str

class RollbackInput(BaseModel):
    session_id: str

class CaseMarkRequest(BaseModel):
    session_id: str

class TemplateCreate(BaseModel):
    dimension: str
    question_text: str
    default_answer: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True

class TemplateUpdate(BaseModel):
    dimension: Optional[str] = None
    question_text: Optional[str] = None
    default_answer: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None

class ConfirmAmbiguitiesRequest(BaseModel):
    session_id: str
    ambiguities: List[Dict[str, str]]
    skip_questioning: Optional[bool] = False
    clarified_spec: Optional[Dict[str, str]] = None   # 新增：直接指定澄清规格

class RateCodeRequest(BaseModel):
    session_id: str
    code: str
    user_score: Optional[int] = None
    auto_score: Optional[int] = None

class CompareModelsRequest(BaseModel):
    requirement: str
    clarified_spec: Optional[Dict] = {}
    models: List[str] = ["deepseek", "doubao", "qwen"]

class SaveSpecDocumentRequest(BaseModel):
    session_id: str
    title: Optional[str] = "未命名"
    conversation_history: Optional[List[Dict[str, str]]] = None

class ModelConfigCreate(BaseModel):
    name: str
    api_key: str
    api_base: Optional[str] = None
    model_id: Optional[str] = None
    is_active: bool = True

class TestCodeRequest(BaseModel):
    code: str
    test_code: str

class GenerateTestRequest(BaseModel):
    requirement: str
    code: str