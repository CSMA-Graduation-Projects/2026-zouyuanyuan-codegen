import requests
url = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
headers = {"Authorization": "Bearer ark-561eea18-6903-4ac5-99d8-6bb84ddd82ad-c76df", "Content-Type": "application/json"}
payload = {
    "model": "doubao-1-5-pro-32k-250115",
    "messages": [{"role": "user", "content": "写一个Python函数，计算两个整数的和"}],
    "temperature": 0.2,
    "max_tokens": 4096
}
resp = requests.post(url, json=payload, headers=headers, timeout=60)
print(resp.status_code, resp.text)