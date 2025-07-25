
import os
import json
import requests
from dotenv import load_dotenv
from difflib import SequenceMatcher
import numpy as np
import openai
from openai import OpenAI

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
        q["agent_sources"] = res.get("sources", [])
    except Exception as e:
        print(f"[ERROR] Query failed: {e}")
        q["agent_answer"] = "[ERROR] No response from agent."
    # Scores will be filled below

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def get_embedding(text):
    response = client.embeddings.create(
        input=text,
        model="text-embedding-ada-002"
    )
    return np.array(response.data[0].embedding)

def cosine_similarity(vec1, vec2):
    if np.linalg.norm(vec1) == 0 or np.linalg.norm(vec2) == 0:
        return 0.0
    return float(np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2)))

# Cache expected answer embeddings to avoid redundant API calls
expected_embeddings = {}
for q in questions:
    exp = q["expected_answer"]
    if exp not in expected_embeddings:
        expected_embeddings[exp] = get_embedding(exp)

def semantic_accuracy_score(agent_answer, expected_answer):
    if not agent_answer.strip():
        return 0
    agent_emb = get_embedding(agent_answer)
    expected_emb = expected_embeddings[expected_answer]
    sim = cosine_similarity(agent_emb, expected_emb)
    if sim > 0.85:
        return 1
    elif sim > 0.7:
        return 0.5
    else:
        return 0

def helpfulness_score(agent_answer):
    if not agent_answer.strip():
        return 0
    if "i'm not sure about that" in agent_answer.lower():
        return 0
    return 1

def citation_score(agent_sources, expected_source):
    if not agent_sources:
        return 0
    expected = expected_source.lower()
    return int(any(expected in str(src).lower() for src in agent_sources))

for q in questions:
    q["accuracy_score"] = semantic_accuracy_score(q["agent_answer"], q["expected_answer"])
    q["helpfulness_score"] = helpfulness_score(q["agent_answer"])
    q["citation_score"] = citation_score(q.get("agent_sources", []), q["source"])

print("[INFO] Saving results...")
with open(EVAL_PATH, "w") as f:
    json.dump(questions, f, indent=2)
print(f"[INFO] Evaluation complete. Results saved to {EVAL_PATH}.")

# Summary statistics
num_questions = len(questions)
if num_questions > 0:
    avg_accuracy = sum(q.get("accuracy_score", 0) for q in questions) / num_questions
    avg_helpfulness = sum(q.get("helpfulness_score", 0) for q in questions) / num_questions
    avg_citation = sum(q.get("citation_score", 0) for q in questions) / num_questions
    print("\n=== Evaluation Summary ===")
    print(f"Total questions: {num_questions}")
    print(f"Average Accuracy Score:   {avg_accuracy:.2f}")
    print(f"Average Helpfulness Score: {avg_helpfulness:.2f}")
    print(f"Average Citation Score:    {avg_citation:.2f}")
    print("=========================")
else:
    print("[WARN] No questions found for summary statistics.")
