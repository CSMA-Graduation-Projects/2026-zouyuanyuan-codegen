from sqlalchemy import create_engine, Column, String, Integer, Text, Boolean, JSON, DateTime, Index, Float, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:password@localhost:3306/codegen")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(200), nullable=False)
    is_admin = Column(Boolean, default=False)
    professional_weight = Column(Integer, nullable=True)          # 用户专业权重 0-100
    assessment_completed = Column(Boolean, default=False)
    assessment_score = Column(Integer, nullable=True)
    assessment_time = Column(DateTime, nullable=True)

class SessionRecord(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True)
    session_id = Column(String(36), unique=True, index=True, nullable=False)
    user_id = Column(Integer, index=True, nullable=False)
    model_name = Column(String(50), nullable=True)
    has_activity = Column(Boolean, default=False)
    has_generated_code = Column(Boolean, default=False)
    requirement = Column(Text, nullable=True)
    final_code = Column(Text, nullable=True)
    baseline_code = Column(Text, nullable=True)
    orchestrator_state = Column(JSON, nullable=True)

class HighQualityCase(Base):
    __tablename__ = "high_quality_cases"
    id = Column(Integer, primary_key=True)
    session_id = Column(String(36), index=True, nullable=False)
    requirement = Column(Text, nullable=False)
    clarified_spec = Column(JSON, nullable=False)
    final_code = Column(Text, nullable=False)
    marked_by = Column(Integer, index=True)
    quality_score = Column(Integer, default=0)
    model_name = Column(String(50))

class ClarificationTemplate(Base):
    __tablename__ = "clarification_templates"
    id = Column(Integer, primary_key=True)
    dimension = Column(String(100), nullable=False)
    question_text = Column(Text, nullable=False)
    default_answer = Column(String(200), nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    user_id = Column(Integer, nullable=False, index=True)

class ModelConfig(Base):
    __tablename__ = "model_configs"
    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    api_key = Column(String(200), nullable=False)
    api_base = Column(String(200), nullable=True)
    model_id = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)

class CodeRating(Base):
    __tablename__ = "code_ratings"
    id = Column(Integer, primary_key=True)
    session_id = Column(String(36), nullable=False, index=True)
    model_name = Column(String(50), nullable=False)
    code = Column(Text, nullable=False)
    auto_score = Column(Integer, nullable=True)
    user_score = Column(Integer, nullable=True)
    quality_score = Column(Integer, nullable=True)
    feedback = Column(Text, nullable=True)

class SpecDocument(Base):
    __tablename__ = "spec_documents"
    id = Column(Integer, primary_key=True)
    session_id = Column(String(36), unique=True, nullable=False, index=True)
    title = Column(String(200), nullable=True)
    original_requirement = Column(Text, nullable=False)
    clarified_spec = Column(JSON, nullable=False)
    conversation_history = Column(JSON, nullable=True)
    final_code = Column(Text, nullable=True)
    version = Column(Integer, default=1)

class TestResult(Base):
    __tablename__ = "test_results"
    id = Column(Integer, primary_key=True)
    session_id = Column(String(36), nullable=False, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    experimental_pass_rate = Column(Float, nullable=False)
    baseline_pass_rate = Column(Float, nullable=False)
    experimental_passed = Column(Boolean, nullable=False)
    baseline_passed = Column(Boolean, nullable=False)
    test_code = Column(Text, nullable=True)

    __table_args__ = (
        Index('idx_test_results_user', 'user_id'),
    )

class Skill(Base):
    __tablename__ = "skills"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    user_id = Column(Integer, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class SkillTemplate(Base):
    __tablename__ = "skill_templates"
    id = Column(Integer, primary_key=True)
    skill_id = Column(Integer, nullable=False, index=True)
    template_id = Column(Integer, nullable=False, index=True)
    sort_order = Column(Integer, default=0)

class AssessmentQuestion(Base):
    __tablename__ = "assessment_questions"
    id = Column(Integer, primary_key=True)
    question_text = Column(Text, nullable=False)
    options = Column(JSON, nullable=False)
    correct_answers = Column(JSON, nullable=False)
    type = Column(String(20), default="single")
    score = Column(Integer, default=5)
    category = Column(String(100), nullable=True)
    sort_order = Column(Integer, default=0)

class AssessmentRecord(Base):
    __tablename__ = "assessment_records"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    score = Column(Integer, nullable=False)
    total_possible = Column(Integer, nullable=False)
    percentage = Column(Float, nullable=False)
    answers = Column(JSON, nullable=False)
    completed_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()