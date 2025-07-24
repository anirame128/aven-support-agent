
import os
import json
import requests
from dotenv import load_dotenv
from difflib import SequenceMatcher

load_dotenv()

# Get API URL from environment
API_URL = os.environ.get("NEXT_PUBLIC_API_URL")
if not API_URL:
    raise EnvironmentError("NEXT_PUBLIC_API_URL environment variable must be set.")

EVAL_PATH = "evaluation_set/evaluation_scoring_set_v2.json"

print("[INFO] Loading evaluation set...")
with open(EVAL_PATH) as f:
    questions = json.load(f)
print(f"[INFO] Loaded {len(questions)} questions.")

print("[INFO] Starting evaluation...")
for idx, q in enumerate(questions, 1):
    print(f"[INFO] ({idx}/{len(questions)}) Evaluating: {q['question']}")
    payload = {"question": q["question"]}
    try:
        r = requests.post(f"{API_URL}/ask", json=payload, timeout=60)
        r.raise_for_status()
        res = r.json()
        print(f"[DEBUG] Response: {res}")
        q["agent_answer"] = res.get("answer", "")
    except Exception as e:
        print(f"[ERROR] Query failed: {e}")
        q["agent_answer"] = "[ERROR] No response from agent."
    # Scores will be filled below

# Simple scoring logic
def simple_accuracy_score(agent_answer, expected_answer):
    ratio = SequenceMatcher(None, agent_answer.lower(), expected_answer.lower()).ratio()
    return 1 if ratio > 0.7 else 0

def helpfulness_score(agent_answer):
    if not agent_answer.strip():
        return 0
    if "i'm not sure about that" in agent_answer.lower():
        return 0
    return 1

def citation_score(agent_answer, source):
    return 1 if source.lower() in agent_answer.lower() else 0

for q in questions:
    q["accuracy_score"] = simple_accuracy_score(q["agent_answer"], q["expected_answer"])
    q["helpfulness_score"] = helpfulness_score(q["agent_answer"])
    q["citation_score"] = citation_score(q["agent_answer"], q["source"])

print("[INFO] Saving results...")
with open(EVAL_PATH, "w") as f:
    json.dump(questions, f, indent=2)
print(f"[INFO] Evaluation complete. Results saved to {EVAL_PATH}.")
