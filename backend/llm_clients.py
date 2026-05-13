import os
import requests
import json
import threading
import time
from typing import List, Dict, Optional
from sqlalchemy.orm import Session

_model_configs_cache = {}
_cache_timestamp = 0
_cache_lock = threading.RLock()

def reload_model_configs(db: Session):
    global _model_configs_cache, _cache_timestamp
    with _cache_lock:
        from database import ModelConfig
        configs = db.query(ModelConfig).filter(ModelConfig.is_active == True).all()
        _model_configs_cache = {cfg.name: cfg for cfg in configs}
        _cache_timestamp = int(time.time() * 1000)

def get_model_config(model_name: str, db: Session):
    with _cache_lock:
        if not _model_configs_cache:
            reload_model_configs(db)
        cfg = _model_configs_cache.get(model_name)
        if not cfg:
            raise ValueError(f"模型 {model_name} 未启用或不存在")
        return cfg

class BaseLLMClient:
    def chat(self, messages: List[Dict], temperature: float = 0.7, max_tokens: int = 2048) -> str:
        raise NotImplementedError

class DeepSeekClient(BaseLLMClient):
    def __init__(self, api_key: str, base_url: str = "https://api.deepseek.com/v1"):
        self.api_key = api_key
        self.base_url = base_url
    def chat(self, messages, temperature=0.7, max_tokens=2048):
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {"model": "deepseek-chat", "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        resp = requests.post(f"{self.base_url}/chat/completions", json=payload, headers=headers, timeout=120)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

class DouBaoClient(BaseLLMClient):
    def __init__(self, api_key: str, endpoint: str, model_id: str):
        self.api_key = api_key
        self.endpoint = endpoint
        self.model_id = model_id

    def chat(self, messages, temperature=0.7, max_tokens=2048):
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": self.model_id,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        print(f"[DOUBAO] 请求 URL: {self.endpoint}")
        print(f"[DOUBAO] 模型 ID: {self.model_id}")
        print(f"[DOUBAO] 消息长度: {len(str(messages))}")
        try:
            resp = requests.post(self.endpoint, json=payload, headers=headers, timeout=120)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except requests.exceptions.Timeout:
            print("[DOUBAO] 请求超时（120秒）")
            raise Exception("豆包模型响应超时，请稍后重试")
        except Exception as e:
            print(f"[DOUBAO] 请求失败: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"[DOUBAO] 响应状态码: {e.response.status_code}")
                print(f"[DOUBAO] 响应内容: {e.response.text[:500]}")
            raise

class QwenClient(BaseLLMClient):
    def __init__(self, api_key: str, base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"):
        self.api_key = api_key
        self.base_url = base_url
    def chat(self, messages, temperature=0.7, max_tokens=2048):
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {"model": "qwen-turbo", "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        resp = requests.post(f"{self.base_url}/chat/completions", json=payload, headers=headers, timeout=120)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

def get_llm_client(model_name: str, db: Session):
    cfg = get_model_config(model_name, db)
    name_lower = cfg.name.lower()
    if "deepseek" in name_lower:
        return DeepSeekClient(api_key=cfg.api_key, base_url=cfg.api_base or "https://api.deepseek.com/v1")
    elif "doubao" in name_lower:
        model_id = cfg.model_id if cfg.model_id else "doubao-1-5-pro-32k-250115"
        return DouBaoClient(
            api_key=cfg.api_key,
            endpoint=cfg.api_base or "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
            model_id=model_id
        )
    elif "qwen" in name_lower:
        return QwenClient(api_key=cfg.api_key, base_url=cfg.api_base or "https://dashscope.aliyuncs.com/compatible-mode/v1")
    else:
        try:
            from openai import OpenAI
            openai_client = OpenAI(api_key=cfg.api_key, base_url=cfg.api_base)
            def _chat(messages, temperature, max_tokens):
                resp = openai_client.chat.completions.create(
                    model=cfg.name,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens
                )
                return resp.choices[0].message.content
            return type('GenericClient', (), {'chat': _chat})()
        except ImportError:
            raise ValueError(f"未知模型类型 {cfg.name}，且未安装openai库")