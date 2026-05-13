import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ast
import uuid
import json
import re
import subprocess
import tempfile
import threading
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from pydantic import BaseModel

from models import (
    RequirementInput, AnswerInput, RollbackInput, CaseMarkRequest,
    TemplateCreate, TemplateUpdate, ConfirmAmbiguitiesRequest,
    RateCodeRequest, CompareModelsRequest, SaveSpecDocumentRequest,
    TestCodeRequest, GenerateTestRequest,
)
from orchestrator import Orchestrator, ConversationState
from database import get_db, User, SessionRecord, HighQualityCase, ClarificationTemplate, CodeRating, SpecDocument, ModelConfig, TestResult, Skill, SkillTemplate, AssessmentQuestion, AssessmentRecord
from auth import get_current_user, get_current_admin, create_access_token, get_password_hash, authenticate_user, verify_password
from llm_clients import get_llm_client, reload_model_configs
from agents.code_agent import CodeAgent
from dotenv import load_dotenv
from logger import setup_logger

from sqlalchemy import func, desc
from sqlalchemy.orm import Session as OrmSession

# 条件导入 resource (仅 Unix)
try:
    import resource
    HAS_RESOURCE = True
except ImportError:
    HAS_RESOURCE = False
    resource = None

load_dotenv()

logger = setup_logger("main")

app = FastAPI(title="智能代码生成系统", version="5.3")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# 全局会话缓存和锁
sessions_lock = threading.RLock()
sessions: Dict[str, Orchestrator] = {}


# ---------- 辅助函数 ----------
def _filter_by_user(query, current_user: User, db: OrmSession):
    if not current_user.is_admin:
        user_session_ids = db.query(SessionRecord.session_id).filter(
            SessionRecord.user_id == current_user.id
        ).subquery()
        query = query.filter(CodeRating.session_id.in_(user_session_ids))
    return query


def auto_save_spec_document(session_id: str, orch: Orchestrator, db: Session):
    try:
        doc = db.query(SpecDocument).filter(SpecDocument.session_id == session_id).first()
        raw_req = orch.original_requirement.strip()
        title = raw_req[:20] + ("..." if len(raw_req) > 30 else "")
        if not title:
            title = "未命名需求"
        if doc:
            doc.original_requirement = orch.original_requirement
            doc.clarified_spec = orch.clarified_spec
            doc.conversation_history = orch.get_conversation_history()
            doc.final_code = orch.last_generated_code
            if not doc.title or doc.title.startswith("需求_"):
                doc.title = title
        else:
            doc = SpecDocument(
                session_id=session_id,
                title=title,
                original_requirement=orch.original_requirement,
                clarified_spec=orch.clarified_spec,
                conversation_history=orch.get_conversation_history(),
                final_code=orch.last_generated_code
            )
            db.add(doc)
        db.commit()
    except Exception as e:
        logger.error(f"自动保存规格文档失败: {e}")


def init_default_models():
    try:
        db = next(get_db())
    except Exception as e:
        logger.error(f"数据库连接失败，无法初始化模型配置: {e}")
        return
    try:
        existing_names = [c.name for c in db.query(ModelConfig).all()]
        model_configs = [
            ("deepseek", os.getenv("DEEPSEEK_API_KEY"), "https://api.deepseek.com/v1", None),
            ("doubao", os.getenv("ARK_API_KEY"), "https://ark.cn-beijing.volces.com/api/v3/chat/completions", "doubao-1-5-pro-32k-250115"),
            ("qwen", os.getenv("DASHSCOPE_API_KEY"), "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-turbo"),
        ]
        for name, api_key, api_base, model_id in model_configs:
            if not api_key:
                logger.warning(f"未提供 {name} 的 API Key，跳过自动创建")
                continue
            if name not in existing_names:
                cfg = ModelConfig(name=name, api_key=api_key, api_base=api_base, model_id=model_id, is_active=True)
                db.add(cfg)
                logger.info(f"已自动创建模型: {name}")
        db.commit()
        reload_model_configs(db)
        if db.query(ModelConfig).filter(ModelConfig.is_active == True).count() == 0:
            logger.warning("系统中没有任何启用的模型配置，请通过管理界面手动添加并启用至少一个模型")
    except Exception as e:
        logger.exception("初始化默认模型失败")
    finally:
        db.close()


def init_assessment_questions(db: Session):
    if db.query(AssessmentQuestion).count() == 0:
        questions = [
            {"question_text": "以下哪种算法不属于机器学习算法？", "options": ["A. 决策树", "B. 冒泡排序", "C. 支持向量机", "D. 神经网络"], "correct_answers": ["B"], "type": "single", "score": 5, "category": "基础"},
            {"question_text": "大数据处理的主要框架包括？", "options": ["A. Hadoop", "B. Spark", "C. Excel", "D. Storm"], "correct_answers": ["A", "B", "D"], "type": "multiple", "score": 8, "category": "大数据"},
            {"question_text": "百度的深度学习平台是 PaddlePaddle。", "options": ["A. 正确", "B. 错误"], "correct_answers": ["A"], "type": "single", "score": 3, "category": "AI"},
        ]
        for q in questions:
            db.add(AssessmentQuestion(**q))
        db.commit()


def get_orch(sid: str, user: User, db: Session):
    with sessions_lock:
        if sid in sessions:
            return sessions[sid]
    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid, SessionRecord.user_id == user.id).first()
    if not record:
        raise HTTPException(404, "会话不存在")
    orch = Orchestrator(model_name=record.model_name or "deepseek")
    if record.orchestrator_state:
        orch.restore_from_state(record.orchestrator_state)
    with sessions_lock:
        sessions[sid] = orch
    return sessions[sid]


def save_orch_state(sid: str, orch: Orchestrator, db: Session):
    with sessions_lock:
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
        if record:
            record.orchestrator_state = orch.get_full_state()
            # 不在内部 commit，由调用方决定事务边界


# ---------- 增强的可测试性检查 ----------
def is_code_testable(code: str) -> dict:
    if not code or not isinstance(code, str):
        return {"testable": False, "reason": "代码为空"}
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"testable": False, "reason": f"语法错误: {e.msg} (第 {e.lineno} 行)"}
    
    functions = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    if not functions:
        return {"testable": False, "reason": "代码中没有定义任何函数，请确保至少包含一个 def 定义的函数"}
    
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and isinstance(node.test, ast.Compare):
            if (hasattr(node.test, 'left') and hasattr(node.test.left, 'id') and node.test.left.id == '__name__' and
                hasattr(node.test, 'comparators') and len(node.test.comparators) > 0 and
                hasattr(node.test.comparators[0], 'value') and node.test.comparators[0].value == '__main__'):
                return {"testable": False, "reason": "代码包含 if __name__ == '__main__' 入口，请移除"}
    
    gui_keywords = ['pyqt', 'tkinter', 'pygame', 'matplotlib', 'wxpython', 'kivy', 'pyside', 'flask', 'django', 'fastapi', 'streamlit', 'gradio', 'html', 'javascript']
    code_lower = code.lower()
    for kw in gui_keywords:
        if kw in code_lower:
            return {"testable": False, "reason": f"代码包含 GUI/Web 框架关键字 '{kw}'，不支持自动测试"}
    return {"testable": True, "reason": "可测试"}


def extract_function_names(code: str) -> List[str]:
    try:
        tree = ast.parse(code)
        return [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    except SyntaxError:
        return []


def _set_rlimits():
    """设置子进程资源限制（仅 Unix）"""
    if HAS_RESOURCE:
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
            resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        except Exception as e:
            logger.warning(f"设置资源限制失败: {e}")
    else:
        # Windows 不支持，跳过
        pass


# ---------- Pydantic 模型定义 ----------
class UserCreate(BaseModel):
    username: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    username: str
    is_admin: bool
    assessment_completed: bool


class CheckTestableRequest(BaseModel):
    experimental_code: str
    baseline_code: str


class TestResultSave(BaseModel):
    session_id: str
    experimental_pass_rate: float
    baseline_pass_rate: float
    experimental_passed: bool
    baseline_passed: bool
    test_code: Optional[str] = None


class AssessmentSubmit(BaseModel):
    answers: Dict[int, List[str]]


class SkillCreate(BaseModel):
    name: str
    description: Optional[str] = None
    template_ids: List[int] = []


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    template_ids: Optional[List[int]] = None


class AdminUserUpdateWeight(BaseModel):
    professional_weight: Optional[int] = None


class ModelConfigCreate(BaseModel):
    name: str
    api_key: str
    api_base: Optional[str] = None
    model_id: Optional[str] = None
    is_active: bool = True


class AdminUserCreate(BaseModel):
    username: str
    password: str
    is_admin: bool = False


class AdminUserUpdate(BaseModel):
    username: Optional[str] = None
    is_admin: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


class UpdateUserScoreRequest(BaseModel):
    session_id: str
    user_score: int


# ---------- API 路由 ----------
@app.post("/api/check_testable")
def check_testable(req: CheckTestableRequest, current_user: User = Depends(get_current_user)):
    exp_result = is_code_testable(req.experimental_code)
    base_result = is_code_testable(req.baseline_code)
    return {
        "experimental_testable": exp_result["testable"],
        "baseline_testable": base_result["testable"],
        "experimental_reason": exp_result["reason"],
        "baseline_reason": base_result["reason"]
    }


@app.post("/api/generate_test_code")
def generate_test_code(req: GenerateTestRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    func_names = extract_function_names(req.code)
    if not func_names:
        raise HTTPException(400, "代码中未定义任何函数，无法生成测试")
    function_hint = f"待测代码中定义了以下函数：{', '.join(func_names)}。请针对这些函数编写测试，重点测试主要功能函数。"
    
    security_warning = """注意：生成的测试代码只能使用 pytest 和标准库，禁止包含任何文件操作（如 open、write）、网络请求（如 requests）、系统调用（如 os.system、subprocess）或危险函数（如 eval、exec）。"""
    
    try:
        client = get_llm_client("deepseek", db)
        prompt = f"""你是一个严谨的测试工程师。根据以下需求和代码，生成完整的 pytest 测试代码。
{function_hint}
{security_warning}
要求：
1. 测试代码首行必须为 `from solution import *`。
2. 分析代码中每个函数的错误处理方式：
   - 如果函数使用 `raise` 抛出异常（例如 ValueError, TypeError），则测试非法输入时必须使用 `pytest.raises` 断言异常。
   - 如果函数返回特殊值（如 None、-1）表示错误，则测试应断言返回值等于该特殊值。
3. 测试必须覆盖正常情况、边界情况（空列表、零、None 等）以及异常情况。
4. 只输出纯 Python 测试代码，不要任何解释或 markdown 标记。
5. 确保测试可独立运行，仅依赖 pytest 和 solution 模块。

需求：{req.requirement}
待测代码：
{req.code}"""
        response = client.chat([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=2048)
        test_code = response.strip()
        code_match = re.search(r'(?:```(?:python)?\s*)?(.+?)(?:\s*```)?$', test_code, re.DOTALL)
        if code_match:
            test_code = code_match.group(1).strip()
        if "import solution" not in test_code and "from solution" not in test_code:
            test_code = "from solution import *\n" + test_code
        dangerous = ['os.system', 'subprocess', 'eval(', 'exec(', '__import__', 'open(', 'requests.']
        for d in dangerous:
            if d in test_code:
                logger.warning(f"生成的测试代码包含危险关键字: {d}")
                raise HTTPException(400, f"生成的测试代码包含不允许的关键字: {d}")
        return {"test_code": test_code, "success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("生成测试代码失败")
        raise HTTPException(500, f"生成测试代码失败: {str(e)}")


@app.post("/api/test_code")
def test_code(req: TestCodeRequest, current_user: User = Depends(get_current_user)):
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            code_file = os.path.join(tmpdir, "solution.py")
            with open(code_file, "w", encoding="utf-8") as f:
                f.write(req.code)
            test_file = os.path.join(tmpdir, "test_solution.py")
            test_content = req.test_code.strip()
            if "import solution" not in test_content and "from solution" not in test_content:
                test_content = "from solution import *\n" + test_content
            with open(test_file, "w", encoding="utf-8") as f:
                f.write(test_content)
            
            env = os.environ.copy()
            env["PYTHONPATH"] = tmpdir
            # 仅在 Unix 上使用 preexec_fn
            preexec_fn = _set_rlimits if HAS_RESOURCE else None
            
            result = subprocess.run(
                ["pytest", test_file, "-v", "--tb=no", "--disable-warnings"],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=30,
                preexec_fn=preexec_fn,
                env=env
            )
            output = result.stdout + result.stderr
            passed_match = re.search(r"(\d+) passed", output)
            failed_match = re.search(r"(\d+) failed", output)
            error_match = re.search(r"(\d+) error", output)
            passed = int(passed_match.group(1)) if passed_match else 0
            failed = int(failed_match.group(1)) if failed_match else 0
            errors = int(error_match.group(1)) if error_match else 0
            total = passed + failed + errors
            if total > 0 and failed == 0 and errors == 0:
                pass_rate = 100.0
            else:
                pass_rate = 0.0
            return {
                "pass_rate": pass_rate,
                "total": total,
                "passed": passed,
                "failed": failed,
                "errors": errors,
                "output": output
            }
    except subprocess.TimeoutExpired:
        logger.warning("测试执行超时")
        raise HTTPException(500, "测试执行超时（30秒）")
    except Exception as e:
        logger.exception("测试运行失败")
        raise HTTPException(500, f"测试运行失败: {str(e)}")


@app.post("/api/test_results/save")
def save_test_result(req: TestResultSave, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session_rec = db.query(SessionRecord).filter(SessionRecord.session_id == req.session_id, SessionRecord.user_id == current_user.id).first()
    if not session_rec:
        raise HTTPException(404, "会话不存在或无权限")
    test_result = TestResult(
        session_id=req.session_id,
        user_id=current_user.id,
        experimental_pass_rate=req.experimental_pass_rate,
        baseline_pass_rate=req.baseline_pass_rate,
        experimental_passed=req.experimental_passed,
        baseline_passed=req.baseline_passed,
        test_code=req.test_code
    )
    db.add(test_result)
    db.commit()
    return {"message": "测试结果已保存"}


@app.get("/api/test_results")
def get_test_results(current_user: User = Depends(get_current_user), db: Session = Depends(get_db), limit: int = 200, offset: int = 0):
    query = db.query(TestResult).filter(TestResult.user_id == current_user.id).order_by(TestResult.id.desc())
    total = query.count()
    items = query.offset(offset).limit(limit).all()
    result_list = []
    for item in items:
        session_rec = db.query(SessionRecord).filter(SessionRecord.session_id == item.session_id).first()
        result_list.append({
            "id": item.id,
            "session_id": item.session_id,
            "requirement": session_rec.requirement if session_rec else "",
            "experimental_pass_rate": item.experimental_pass_rate,
            "baseline_pass_rate": item.baseline_pass_rate,
            "experimental_passed": item.experimental_passed,
            "baseline_passed": item.baseline_passed,
        })
    return {"total": total, "items": result_list}


@app.get("/api/assessment/questions")
def get_assessment_questions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    questions = db.query(AssessmentQuestion).order_by(AssessmentQuestion.sort_order).all()
    return [
        {
            "id": q.id,
            "question_text": q.question_text,
            "options": q.options,
            "type": q.type,
            "score": q.score,
            "category": q.category
        }
        for q in questions
    ]


@app.post("/api/assessment/submit")
def submit_assessment(data: AssessmentSubmit, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.is_admin:
        raise HTTPException(403, "管理员无需参加测评")
    if current_user.assessment_completed:
        raise HTTPException(400, "您已完成测评，不能重复参加")
    questions = db.query(AssessmentQuestion).order_by(AssessmentQuestion.sort_order).all()
    if not questions:
        raise HTTPException(500, "测评题目未配置，请联系管理员")
    total_score = 0
    for q in questions:
        user_ans = data.answers.get(q.id, [])
        if q.type == "multiple":
            is_correct = set(q.correct_answers) == set(user_ans)
        else:
            is_correct = user_ans == q.correct_answers
        if is_correct:
            total_score += q.score
    total_possible = sum(q.score for q in questions)
    percentage = (total_score / total_possible) * 100 if total_possible > 0 else 0
    professional_weight = int(round(percentage))
    record = AssessmentRecord(
        user_id=current_user.id,
        score=total_score,
        total_possible=total_possible,
        percentage=percentage,
        answers=data.answers
    )
    db.add(record)
    current_user.professional_weight = professional_weight
    current_user.assessment_completed = True
    current_user.assessment_score = total_score
    current_user.assessment_time = datetime.utcnow()
    db.commit()
    return {
        "total_score": total_score,
        "total_possible": total_possible,
        "percentage": percentage,
        "professional_weight": professional_weight
    }


@app.get("/api/assessment/status")
def get_assessment_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.is_admin:
        return {"completed": True, "professional_weight": 100, "assessment_score": 100}
    return {
        "completed": current_user.assessment_completed,
        "professional_weight": current_user.professional_weight,
        "assessment_score": current_user.assessment_score
    }


@app.get("/api/user/weight")
def get_user_weight(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.is_admin:
        return {"professional_weight": 100, "assessment_completed": True, "message": "管理员拥有最高权重 100%"}
    return {
        "professional_weight": current_user.professional_weight,
        "assessment_completed": current_user.assessment_completed,
        "assessment_score": current_user.assessment_score
    }


@app.get("/api/skills")
def list_skills(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    skills = db.query(Skill).filter(Skill.user_id == current_user.id).all()
    result = []
    for s in skills:
        linked = db.query(SkillTemplate.template_id).filter(SkillTemplate.skill_id == s.id).all()
        template_ids = [lt[0] for lt in linked]
        result.append({"id": s.id, "name": s.name, "description": s.description, "template_ids": template_ids})
    return result


@app.post("/api/skills")
def create_skill(skill: SkillCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_skill = Skill(name=skill.name, description=skill.description, user_id=current_user.id)
    db.add(new_skill)
    db.flush()
    for idx, tid in enumerate(skill.template_ids):
        st = SkillTemplate(skill_id=new_skill.id, template_id=tid, sort_order=idx)
        db.add(st)
    db.commit()
    return {"id": new_skill.id, "message": "创建成功"}


@app.put("/api/skills/{skill_id}")
def update_skill(skill_id: int, skill: SkillUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_skill = db.query(Skill).filter(Skill.id == skill_id, Skill.user_id == current_user.id).first()
    if not db_skill:
        raise HTTPException(404, "技能不存在")
    if skill.name is not None:
        db_skill.name = skill.name
    if skill.description is not None:
        db_skill.description = skill.description
    if skill.template_ids is not None:
        db.query(SkillTemplate).filter(SkillTemplate.skill_id == skill_id).delete()
        for idx, tid in enumerate(skill.template_ids):
            st = SkillTemplate(skill_id=skill_id, template_id=tid, sort_order=idx)
            db.add(st)
    db.commit()
    return {"message": "更新成功"}


@app.delete("/api/skills/{skill_id}")
def delete_skill(skill_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_skill = db.query(Skill).filter(Skill.id == skill_id, Skill.user_id == current_user.id).first()
    if not db_skill:
        raise HTTPException(404, "技能不存在")
    db.query(SkillTemplate).filter(SkillTemplate.skill_id == skill_id).delete()
    db.delete(db_skill)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/skills/apply/{skill_id}")
def apply_skill(skill_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    skill = db.query(Skill).filter(Skill.id == skill_id, Skill.user_id == current_user.id).first()
    if not skill:
        raise HTTPException(404, "技能不存在")
    linked = db.query(SkillTemplate).filter(SkillTemplate.skill_id == skill_id).order_by(SkillTemplate.sort_order).all()
    template_ids = [lt.template_id for lt in linked]
    if not template_ids:
        raise HTTPException(400, "技能没有关联任何模板")
    templates = db.query(ClarificationTemplate).filter(ClarificationTemplate.id.in_(template_ids)).all()
    template_map = {t.id: t for t in templates}
    ordered_templates = [template_map[tid] for tid in template_ids if tid in template_map]
    if not ordered_templates:
        raise HTTPException(400, "技能关联的模板无效")
    
    sid = str(uuid.uuid4())
    session_record = SessionRecord(session_id=sid, user_id=current_user.id, model_name="deepseek")
    db.add(session_record)
    db.commit()
    
    orch = Orchestrator(model_name="deepseek")
    skill_amb = []
    for t in ordered_templates:
        skill_amb.append({
            "dimension": t.dimension,
            "description": t.question_text,
            "default_answer": t.default_answer or ""
        })
    orch.skill_ambiguities = skill_amb
    orch.state = ConversationState.WAITING_INPUT
    save_orch_state(sid, orch, db)
    db.commit()
    
    return {
        "session_id": sid,
        "skill_ambiguities": skill_amb
    }


@app.post("/api/cases/mark")
def mark_case(req: CaseMarkRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session_rec = db.query(SessionRecord).filter(SessionRecord.session_id == req.session_id, SessionRecord.user_id == current_user.id).first()
    if not session_rec:
        raise HTTPException(404, "会话不存在或无权限")
    if not session_rec.final_code:
        raise HTTPException(400, "该会话尚未生成代码")
    spec_doc = db.query(SpecDocument).filter(SpecDocument.session_id == req.session_id).first()
    clarified_spec = spec_doc.clarified_spec if spec_doc else {}
    user = db.query(User).filter(User.id == current_user.id).first()
    user_weight = user.professional_weight if user.professional_weight is not None else 70
    rating = db.query(CodeRating).filter(CodeRating.session_id == req.session_id).order_by(desc(CodeRating.id)).first()
    auto_score = rating.auto_score if rating else 70
    user_score = rating.user_score if rating else 70
    if user_weight == 100:
        quality_score = user_score
    elif user_weight == 0:
        quality_score = auto_score
    else:
        quality_score = int(user_score * (user_weight / 100) + auto_score * ((100 - user_weight) / 100))
    model_name = session_rec.model_name or "deepseek"
    existing_case = db.query(HighQualityCase).filter(HighQualityCase.session_id == req.session_id).first()
    if existing_case:
        existing_case.quality_score = quality_score
        existing_case.final_code = session_rec.final_code
        existing_case.requirement = session_rec.requirement
        existing_case.clarified_spec = clarified_spec
        existing_case.model_name = model_name
        db.commit()
        return {"message": "已更新"}
    new_case = HighQualityCase(
        session_id=req.session_id,
        requirement=session_rec.requirement,
        clarified_spec=clarified_spec,
        final_code=session_rec.final_code,
        marked_by=current_user.id,
        quality_score=quality_score,
        model_name=model_name
    )
    db.add(new_case)
    db.commit()
    return {"message": "已收录"}


@app.put("/api/admin/users/{user_id}/weight")
def update_user_weight(user_id: int, data: AdminUserUpdateWeight, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    user.professional_weight = data.professional_weight
    db.commit()
    return {"message": "权重已更新", "professional_weight": user.professional_weight}


@app.get("/api/admin/weights")
def get_user_weights(current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "professional_weight": u.professional_weight,
            "assessment_completed": u.assessment_completed,
            "assessment_score": u.assessment_score
        }
        for u in users
    ]


@app.post("/api/register", response_model=Token)
def register(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(400, "用户名已存在")
    hashed = get_password_hash(user.password)
    db_user = User(username=user.username, hashed_password=hashed, is_admin=False)
    db.add(db_user)
    db.commit()
    token = create_access_token(data={"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/login", response_model=LoginResponse)
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = authenticate_user(db, user.username, user.password)
    if not db_user:
        raise HTTPException(401, "用户名或密码错误")
    token = create_access_token(data={"sub": user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": db_user.username,
        "is_admin": db_user.is_admin,
        "assessment_completed": db_user.assessment_completed if not db_user.is_admin else True
    }


@app.post("/api/change-password")
def change_password(req: ChangePasswordRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(req.old_password, current_user.hashed_password):
        raise HTTPException(400, "原密码错误")
    current_user.hashed_password = get_password_hash(req.new_password)
    db.commit()
    return {"message": "密码修改成功"}


@app.get("/api/verify")
def verify_token(current_user: User = Depends(get_current_user)):
    return {"valid": True, "username": current_user.username}


@app.get("/api/session/{session_id}/status")
def get_session_status(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orch = get_orch(session_id, current_user, db)
    current_question = None
    if (orch.state == ConversationState.WAITING_CLARIFICATION and orch.current_question_index < len(orch.current_questions)):
        current_question = orch.current_questions[orch.current_question_index]
    return {
        "session_id": session_id,
        "state": orch.state.value,
        "awaiting_answer": (orch.state == ConversationState.WAITING_CLARIFICATION),
        "current_question": current_question,
        "conversation_history": orch.get_conversation_history()
    }


@app.post("/api/start")
def start_session(model: str = "deepseek", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    model_cfg = db.query(ModelConfig).filter(ModelConfig.name == model, ModelConfig.is_active == True).first()
    if not model_cfg:
        raise HTTPException(400, f"模型 {model} 未配置或未启用")
    sid = str(uuid.uuid4())
    session_record = SessionRecord(session_id=sid, user_id=current_user.id, model_name=model)
    db.add(session_record)
    db.commit()
    sessions[sid] = Orchestrator(model_name=model)
    return {"session_id": sid}


@app.post("/api/detect")
def detect(req: RequirementInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orch = get_orch(req.session_id, current_user, db)
    session_record = db.query(SessionRecord).filter(SessionRecord.session_id == req.session_id).first()
    if session_record:
        if not session_record.has_activity:
            session_record.has_activity = True
            session_record.requirement = req.requirement
            db.commit()
        if req.mode:
            orch.set_generation_mode(req.mode)
        try:
            ambiguities = orch.receive_requirement(req.requirement, db)
            save_orch_state(req.session_id, orch, db)
            db.commit()
            return ambiguities
        except Exception as e:
            logger.exception("模糊点识别失败")
            raise HTTPException(500, f"模糊点识别失败: {str(e)}")


@app.post("/api/confirm_ambiguities")
def confirm_ambiguities(req: ConfirmAmbiguitiesRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orch = get_orch(req.session_id, current_user, db)
    if orch.state != ConversationState.EDITING_AMBIGUITIES:
        raise HTTPException(400, "当前状态不允许编辑模糊点")
    
    orch.update_ambiguities(req.ambiguities, db)
    
    if req.skip_questioning:
        if req.clarified_spec:
            orch.clarified_spec = req.clarified_spec
        orch.state = ConversationState.CONFIRMED
        try:
            code, exp, sugg, baseline_code = orch.generate_code(db)
            session_record = db.query(SessionRecord).filter(SessionRecord.session_id == req.session_id).first()
            if session_record and not session_record.has_generated_code:
                session_record.has_generated_code = True
                session_record.final_code = code
                session_record.baseline_code = baseline_code
                db.commit()
            auto_save_spec_document(req.session_id, orch, db)
            save_orch_state(req.session_id, orch, db)
            db.commit()
            return {
                "success": True,
                "ready": True,
                "code": code,
                "baseline_code": baseline_code,
                "explanation": exp,
                "security_suggestions": sugg
            }
        except Exception as e:
            orch.state = ConversationState.EDITING_AMBIGUITIES
            logger.exception("代码生成失败")
            raise HTTPException(500, f"代码生成失败: {str(e)}")
    else:
        first_question = orch.current_questions[0] if orch.current_questions else None
        save_orch_state(req.session_id, orch, db)
        db.commit()
        return {"success": True, "first_question": first_question}


@app.post("/api/answer")
def answer(ans: AnswerInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orch = get_orch(ans.session_id, current_user, db)
    session_record = db.query(SessionRecord).filter(SessionRecord.session_id == ans.session_id).first()
    if session_record and not session_record.has_activity:
        session_record.has_activity = True
        db.commit()
    if orch.state != ConversationState.WAITING_CLARIFICATION:
        return {"ready": False, "question": "当前没有待回答的问题，请重新输入需求。"}
    try:
        q, ready = orch.receive_answer(ans.answer, db)
    except Exception as e:
        logger.exception("接收答案处理出错")
        return {"ready": False, "question": f"处理出错: {str(e)}"}
    if ready:
        code, exp, sugg, baseline_code = orch.generate_code(db)
        if session_record and not session_record.has_generated_code:
            session_record.has_generated_code = True
            session_record.final_code = code
            session_record.baseline_code = baseline_code
            db.commit()
        auto_save_spec_document(ans.session_id, orch, db)
        save_orch_state(ans.session_id, orch, db)
        db.commit()
        return {
            "ready": True,
            "code": code,
            "baseline_code": baseline_code,
            "explanation": exp,
            "security_suggestions": sugg
        }
    else:
        save_orch_state(ans.session_id, orch, db)
        db.commit()
        return {"ready": False, "question": q}


@app.post("/api/rollback")
def rollback(roll: RollbackInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orch = get_orch(roll.session_id, current_user, db)
    prev = orch.rollback.pop()
    if not prev:
        raise HTTPException(400, "无历史状态")
    full_state, _, _, _ = prev
    orch.restore_from_state(full_state)
    if orch.current_question_index < len(orch.current_questions):
        orch.state = ConversationState.WAITING_CLARIFICATION
    else:
        orch.state = ConversationState.CONFIRMED
    session_record = db.query(SessionRecord).filter(SessionRecord.session_id == roll.session_id).first()
    if orch.state == ConversationState.CONFIRMED:
        code, exp, sugg, baseline_code = orch.generate_code(db)
        if session_record and not session_record.has_generated_code:
            session_record.has_generated_code = True
            session_record.final_code = code
            session_record.baseline_code = baseline_code
            db.commit()
        auto_save_spec_document(roll.session_id, orch, db)
        save_orch_state(roll.session_id, orch, db)
        db.commit()
        return {
            "success": True,
            "ready": True,
            "code": code,
            "baseline_code": baseline_code,
            "explanation": exp,
            "security_suggestions": sugg
        }
    else:
        save_orch_state(roll.session_id, orch, db)
        db.commit()
        return {
            "success": True,
            "ready": False,
            "question": orch.current_questions[orch.current_question_index]
        }


@app.delete("/api/session/{session_id}")
def delete_session(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with sessions_lock:
        if session_id in sessions:
            del sessions[session_id]
    db.query(TestResult).filter(TestResult.session_id == session_id).delete()
    db.query(SessionRecord).filter(SessionRecord.session_id == session_id).delete()
    db.commit()
    return {"message": "已删除"}


@app.get("/api/session/{session_id}/summary")
def get_summary(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    spec_doc = db.query(SpecDocument).filter(SpecDocument.session_id == session_id).first()
    if spec_doc:
        rating = db.query(CodeRating).filter(CodeRating.session_id == session_id).order_by(desc(CodeRating.id)).first()
        rating_info = {"auto_score": rating.auto_score if rating else None, "user_score": rating.user_score if rating else None}
        return {
            "original_requirement": spec_doc.original_requirement,
            "clarified_spec": spec_doc.clarified_spec,
            "conversation_history": spec_doc.conversation_history or [],
            "final_code": spec_doc.final_code,
            "rating": rating_info
        }
    try:
        orch = get_orch(session_id, current_user, db)
        final_code = orch.last_generated_code
        if not final_code:
            session_rec = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
            if session_rec:
                final_code = session_rec.final_code
        rating = db.query(CodeRating).filter(CodeRating.session_id == session_id).order_by(desc(CodeRating.id)).first()
        rating_info = {"auto_score": rating.auto_score if rating else None, "user_score": rating.user_score if rating else None}
        return {
            "original_requirement": orch.original_requirement,
            "clarified_spec": orch.clarified_spec,
            "conversation_history": orch.get_conversation_history(),
            "final_code": final_code,
            "rating": rating_info
        }
    except HTTPException:
        session_rec = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
        if session_rec:
            rating = db.query(CodeRating).filter(CodeRating.session_id == session_id).order_by(desc(CodeRating.id)).first()
            rating_info = {"auto_score": rating.auto_score if rating else None, "user_score": rating.user_score if rating else None}
            return {
                "original_requirement": session_rec.requirement or "",
                "clarified_spec": {},
                "conversation_history": [],
                "final_code": session_rec.final_code,
                "rating": rating_info
            }
        else:
            raise HTTPException(404, "会话详情不存在")


@app.get("/api/model_configs")
def list_model_configs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    configs = db.query(ModelConfig).filter(ModelConfig.is_active == True).all()
    return [{"name": c.name, "api_base": c.api_base, "model_id": c.model_id, "is_active": c.is_active} for c in configs]


@app.post("/api/model_configs")
def create_model_config(cfg: ModelConfigCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if db.query(ModelConfig).filter(ModelConfig.name == cfg.name).first():
        raise HTTPException(400, "模型名称已存在")
    new_cfg = ModelConfig(name=cfg.name, api_key=cfg.api_key, api_base=cfg.api_base, model_id=cfg.model_id, is_active=cfg.is_active)
    db.add(new_cfg)
    db.commit()
    reload_model_configs(db)
    return {"message": "创建成功", "name": cfg.name}


@app.put("/api/model_configs/{name}")
def update_model_config(name: str, cfg: ModelConfigCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    db_cfg = db.query(ModelConfig).filter(ModelConfig.name == name).first()
    if not db_cfg:
        raise HTTPException(404, "模型不存在")
    db_cfg.api_key = cfg.api_key
    db_cfg.api_base = cfg.api_base
    db_cfg.model_id = cfg.model_id
    db_cfg.is_active = cfg.is_active
    db.commit()
    reload_model_configs(db)
    return {"message": "更新成功"}


@app.delete("/api/model_configs/{name}")
def delete_model_config(name: str, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    db_cfg = db.query(ModelConfig).filter(ModelConfig.name == name).first()
    if not db_cfg:
        raise HTTPException(404, "模型不存在")
    db.delete(db_cfg)
    db.commit()
    reload_model_configs(db)
    return {"message": "删除成功"}


@app.get("/api/stats")
def get_stats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    total_sessions = db.query(SessionRecord).filter(SessionRecord.user_id == current_user.id, SessionRecord.has_activity == True).count()
    total_cases = db.query(HighQualityCase).filter(HighQualityCase.marked_by == current_user.id).count()
    avg_score = db.query(func.avg(CodeRating.user_score)).filter(
        CodeRating.user_score.isnot(None),
        CodeRating.session_id.in_(db.query(SessionRecord.session_id).filter(SessionRecord.user_id == current_user.id))
    ).scalar() or 0
    return {
        "totalSessions": total_sessions,
        "totalCodeGen": total_cases,
        "avgScore": round(avg_score, 1),
        "coverageCount": 0,
        "trendData": [],
        "compareData": [],
        "modelData": []
    }


@app.get("/api/sessions")
def list_user_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions_db = db.query(SessionRecord).filter(SessionRecord.user_id == current_user.id, SessionRecord.has_generated_code == True).order_by(SessionRecord.id.desc()).all()
    result = []
    for s in sessions_db:
        rating = db.query(CodeRating).filter(CodeRating.session_id == s.session_id).order_by(desc(CodeRating.id)).first()
        result.append({
            "session_id": s.session_id,
            "requirement": s.requirement or "未记录需求",
            "final_code": s.final_code,
            "model_name": s.model_name,
            "auto_score": rating.auto_score if rating else None,
            "user_score": rating.user_score if rating else None,
        })
    return result


@app.post("/api/rate_code")
def rate_code(req: RateCodeRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session_rec = db.query(SessionRecord).filter(SessionRecord.session_id == req.session_id, SessionRecord.user_id == current_user.id).first()
    if not session_rec:
        raise HTTPException(404, "会话不存在")
    model_name = session_rec.model_name or "deepseek"
    if req.auto_score is not None:
        auto_score = req.auto_score
        suggestion = "自动评分由前端提供"
    else:
        try:
            client = get_llm_client("deepseek", db)
        except Exception:
            default_model = db.query(ModelConfig).filter(ModelConfig.is_active == True).first()
            if not default_model:
                raise HTTPException(500, "没有可用的模型进行评分")
            client = get_llm_client(default_model.name, db)
        prompt = f"请为以下代码评分（0-100分），并给出简短改进建议。\n代码：\n{req.code}\n输出格式：分数:xx 建议:xxxx"
        try:
            resp = client.chat([{"role": "user", "content": prompt}], temperature=0.3)
            score_match = re.search(r'分数[:：]\s*(\d+)', resp)
            auto_score = int(score_match.group(1)) if score_match else 70
            suggestion = re.sub(r'分数[:：]\s*\d+', '', resp).strip()
        except Exception as e:
            auto_score = 70
            suggestion = f"评分失败，默认70分。错误: {str(e)}"
    user_score = req.user_score
    if user_score is not None:
        rating = CodeRating(
            session_id=req.session_id,
            model_name=model_name,
            code=req.code,
            auto_score=auto_score,
            user_score=user_score,
            quality_score=user_score,
            feedback=suggestion
        )
        db.add(rating)
        db.commit()
        display_score = user_score
    else:
        display_score = auto_score
    return {"auto_score": auto_score, "user_score": user_score, "score": display_score, "suggestion": suggestion}


@app.post("/api/update_user_score")
def update_user_score(req: UpdateUserScoreRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rating = db.query(CodeRating).filter(CodeRating.session_id == req.session_id).order_by(desc(CodeRating.id)).first()
    if not rating:
        raise HTTPException(404, "未找到该会话的评分记录")
    rating.user_score = req.user_score
    rating.quality_score = req.user_score
    db.commit()
    high_quality_case = db.query(HighQualityCase).filter(HighQualityCase.session_id == req.session_id).first()
    if high_quality_case:
        high_quality_case.quality_score = req.user_score
        db.commit()
    return {"message": "更新成功", "user_score": req.user_score}


@app.get("/api/cases")
def list_cases(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.is_admin:
        cases = db.query(HighQualityCase).order_by(HighQualityCase.id.desc()).all()
    else:
        cases = db.query(HighQualityCase).filter(HighQualityCase.marked_by == current_user.id).all()
    return [{"id": c.id, "requirement": c.requirement, "final_code": c.final_code, "quality_score": c.quality_score, "model_name": c.model_name} for c in cases]


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: int, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    case = db.query(HighQualityCase).filter(HighQualityCase.id == case_id).first()
    if not case:
        raise HTTPException(404, "案例不存在")
    db.delete(case)
    db.commit()
    return {"message": "已删除"}


@app.get("/api/templates")
def list_templates(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tmpls = db.query(ClarificationTemplate).filter(ClarificationTemplate.user_id == current_user.id).order_by(ClarificationTemplate.sort_order).all()
    return [{"id": t.id, "dimension": t.dimension, "question_text": t.question_text, "default_answer": t.default_answer, "sort_order": t.sort_order, "is_active": t.is_active} for t in tmpls]


@app.post("/api/templates")
def create_template(tmpl: TemplateCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new = ClarificationTemplate(**tmpl.dict(), user_id=current_user.id)
    db.add(new)
    db.commit()
    return {"id": new.id}


@app.put("/api/templates/{tid}")
def update_template(tid: int, tmpl: TemplateUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_tmpl = db.query(ClarificationTemplate).filter(ClarificationTemplate.id == tid, ClarificationTemplate.user_id == current_user.id).first()
    if not db_tmpl:
        raise HTTPException(404, "模板不存在或无权访问")
    for k, v in tmpl.dict(exclude_unset=True).items():
        setattr(db_tmpl, k, v)
    db.commit()
    return {"message": "已更新"}


@app.delete("/api/templates/{tid}")
def delete_template(tid: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_tmpl = db.query(ClarificationTemplate).filter(ClarificationTemplate.id == tid, ClarificationTemplate.user_id == current_user.id).first()
    if not db_tmpl:
        raise HTTPException(404, "模板不存在或无权访问")
    db.delete(db_tmpl)
    db.commit()
    return {"message": "已删除"}


@app.get("/api/skills/list")
def list_skills_old(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dimensions = db.query(ClarificationTemplate.dimension).filter(ClarificationTemplate.user_id == current_user.id, ClarificationTemplate.is_active == True).distinct().all()
    return [{"name": d[0]} for d in dimensions]


@app.get("/api/skills/{skill_name}/templates")
def get_templates_by_skill(skill_name: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tmpls = db.query(ClarificationTemplate).filter(ClarificationTemplate.user_id == current_user.id, ClarificationTemplate.dimension == skill_name, ClarificationTemplate.is_active == True).order_by(ClarificationTemplate.sort_order).all()
    return [{"id": t.id, "dimension": t.dimension, "question_text": t.question_text, "default_answer": t.default_answer, "sort_order": t.sort_order, "is_active": t.is_active} for t in tmpls]


@app.get("/api/spec_documents")
def list_spec_documents(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    docs = db.query(SpecDocument).join(SessionRecord, SpecDocument.session_id == SessionRecord.session_id).filter(SessionRecord.user_id == current_user.id).all()
    return [{"id": d.id, "session_id": d.session_id, "title": d.title, "original_requirement": d.original_requirement, "clarified_spec": d.clarified_spec} for d in docs]


@app.post("/api/spec_documents")
def save_spec_document(req: SaveSpecDocumentRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orch = get_orch(req.session_id, current_user, db)
    doc = db.query(SpecDocument).filter(SpecDocument.session_id == req.session_id).first()
    if doc:
        doc.title = req.title or doc.title
        doc.original_requirement = orch.original_requirement
        doc.clarified_spec = orch.clarified_spec
        doc.conversation_history = req.conversation_history or orch.get_conversation_history()
        doc.final_code = orch.last_generated_code
    else:
        new_doc = SpecDocument(session_id=req.session_id, title=req.title or "未命名", original_requirement=orch.original_requirement, clarified_spec=orch.clarified_spec, conversation_history=req.conversation_history or orch.get_conversation_history(), final_code=orch.last_generated_code)
        db.add(new_doc)
    db.commit()
    return {"message": "保存成功"}


@app.delete("/api/spec_documents/{doc_id}")
def delete_spec_document(doc_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.query(SpecDocument).filter(SpecDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "规格文档不存在")
    session_rec = db.query(SessionRecord).filter(SessionRecord.session_id == doc.session_id).first()
    if not session_rec:
        raise HTTPException(404, "关联会话不存在")
    if not current_user.is_admin and session_rec.user_id != current_user.id:
        raise HTTPException(403, "无权删除此规格文档")
    db.delete(doc)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/compare_models")
def compare_models(req: CompareModelsRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    results = []
    for model in req.models:
        try:
            cfg = db.query(ModelConfig).filter(ModelConfig.name == model, ModelConfig.is_active == True).first()
            if not cfg:
                results.append({"model": model, "error": f"模型 {model} 未启用或不存在"})
                continue
            agent = CodeAgent(model_name=model)
            code, _ = agent.generate(req.requirement, req.clarified_spec or {}, db, mode="standard")
            try:
                rating_client = get_llm_client("deepseek", db)
            except:
                rating_client = get_llm_client(model, db)
            score_prompt = f"为以下代码评分(0-100):\n{code}\n只输出数字。"
            score_resp = rating_client.chat([{"role": "user", "content": score_prompt}], temperature=0.3)
            score_match = re.search(r'\d+', score_resp)
            score = int(score_match.group()) if score_match else 70
            results.append({"model": model, "code": code, "score": score})
        except Exception as e:
            results.append({"model": model, "error": str(e)})
    return results


@app.get("/api/admin/users")
def list_users(current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [{"id": u.id, "username": u.username, "is_admin": u.is_admin, "professional_weight": u.professional_weight, "assessment_completed": u.assessment_completed, "assessment_score": u.assessment_score} for u in users]


@app.post("/api/admin/users")
def create_user(user: AdminUserCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(400, "用户名已存在")
    hashed = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed, is_admin=user.is_admin)
    if user.is_admin:
        new_user.assessment_completed = True
        new_user.professional_weight = 100
        new_user.assessment_score = 100
        new_user.assessment_time = datetime.utcnow()
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"id": new_user.id, "username": new_user.username, "is_admin": new_user.is_admin}


@app.put("/api/admin/users/{user_id}")
def update_user(user_id: int, update: AdminUserUpdate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    if update.username is not None:
        existed = db.query(User).filter(User.username == update.username, User.id != user_id).first()
        if existed:
            raise HTTPException(400, "用户名已存在")
        user.username = update.username
    if update.is_admin is not None:
        if user.id == current_user.id and update.is_admin is False:
            raise HTTPException(400, "不能将自己降级为普通用户")
        user.is_admin = update.is_admin
        if update.is_admin and not user.assessment_completed:
            user.assessment_completed = True
            user.professional_weight = 100
            user.assessment_score = 100
            user.assessment_time = datetime.utcnow()
    db.commit()
    return {"message": "更新成功"}


@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: int, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(400, "不能删除自己")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    if user.is_admin:
        admin_count = db.query(User).filter(User.is_admin == True).count()
        if admin_count <= 1:
            raise HTTPException(400, "不能删除最后一个管理员账号")
    db.delete(user)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/admin/users/{user_id}/reset-password")
def reset_password(user_id: int, req: ResetPasswordRequest, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    user.hashed_password = get_password_hash(req.new_password)
    db.commit()
    return {"message": "密码已重置"}


@app.get("/api/analysis/overview")
def get_analysis_overview(current_user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)):
    query = db.query(CodeRating)
    query = _filter_by_user(query, current_user, db)
    total_evaluated = query.count()
    avg_user = query.filter(CodeRating.user_score.isnot(None)).with_entities(func.avg(CodeRating.user_score)).scalar()
    if avg_user is not None:
        overall_avg = avg_user
    else:
        avg_auto = query.filter(CodeRating.auto_score.isnot(None)).with_entities(func.avg(CodeRating.auto_score)).scalar()
        overall_avg = avg_auto if avg_auto is not None else 0
    overall_avg = round(overall_avg, 1)
    return {"total_evaluated": total_evaluated, "overall_avg_score": overall_avg}


@app.get("/api/analysis/trend")
def get_analysis_trend(current_user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)):
    query = db.query(CodeRating)
    query = _filter_by_user(query, current_user, db)
    ratings = query.order_by(desc(CodeRating.id)).limit(10).all()
    ratings.reverse()
    trend_data = []
    for idx, rating in enumerate(ratings, 1):
        score = rating.user_score if rating.user_score is not None else rating.auto_score
        if score is None:
            continue
        trend_data.append({"round": idx, "score": score})
    return {"trend": trend_data}


@app.get("/api/analysis/model_comparison")
def get_model_comparison(current_user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)):
    query = db.query(CodeRating)
    query = _filter_by_user(query, current_user, db)
    user_scores = query.filter(CodeRating.user_score.isnot(None)).with_entities(CodeRating.model_name, func.avg(CodeRating.user_score).label("avg_score")).group_by(CodeRating.model_name).all()
    result = {model: round(avg, 1) for model, avg in user_scores}
    auto_scores = query.filter(CodeRating.auto_score.isnot(None)).with_entities(CodeRating.model_name, func.avg(CodeRating.auto_score).label("avg_score")).group_by(CodeRating.model_name).all()
    for model, avg in auto_scores:
        if model not in result:
            result[model] = round(avg, 1)
    data = [{"model": k, "score": v} for k, v in result.items()]
    return {"models": data}


def init_admin():
    db = next(get_db())
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            admin = User(username="admin", hashed_password=get_password_hash("admin123"), is_admin=True, assessment_completed=True, professional_weight=100, assessment_score=100, assessment_time=datetime.utcnow())
            db.add(admin)
            db.commit()
            logger.info("默认管理员已创建: admin / admin123")
        else:
            if not admin.assessment_completed:
                admin.assessment_completed = True
                admin.professional_weight = 100
                db.commit()
    except Exception as e:
        logger.exception("初始化管理员失败")
    finally:
        db.close()


@app.on_event("startup")
def startup():
    init_admin()
    init_default_models()
    from database import Base, engine
    Base.metadata.create_all(bind=engine)
    db = next(get_db())
    init_assessment_questions(db)
    db.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", reload=True)