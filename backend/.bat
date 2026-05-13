@echo off
cd /d F:\IntelligentCodeGenerationSystem\backend
call venv\Scripts\activate
uvicorn main:app --reload
pause