import urllib.request
import json
import base64

data = {
    "text": "test",
    "image": base64.b64encode(b"0" * (5 * 1024 * 1024)).decode("utf-8"),
    "role": "reason_deep"
}

req = urllib.request.Request(
    "http://localhost:5173/api/analyze",
    data=json.dumps(data).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as response:
        print(response.status)
        print(response.read().decode("utf-8"))
except Exception as e:
    print(f"Error: {e}")
