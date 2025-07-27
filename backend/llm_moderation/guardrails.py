import re
import openai
from typing import Dict, List
from functools import lru_cache

# ---------- OpenAI Moderation ----------

@lru_cache(maxsize=1000)
def check_moderation(text: str) -> Dict:
    """
    Uses OpenAI Moderation API to check for content policy violations.
    Cached to avoid repeated API calls for similar content.
    """
    try:
        response = openai.Moderation.create(input=text)
        return response["results"][0]
    except Exception as e:
        return {"flagged": False, "error": str(e)}


# ---------- Custom Regex-Based Filters ----------

SENSITIVE_PATTERNS = {
    "personal_data": r"\b(SSN|social security number|home address|date of birth)\b",
    "legal_advice": r"\b(lawsuit|attorney|lawyer|legal advice|court|settlement|file a claim|sue)\b",
    "financial_advice": r"\b(invest|stock|retirement|buy|sell|portfolio|wealth management|tax advice|IRA|Roth IRA)\b"
}

@lru_cache(maxsize=1000)
def check_custom_guardrails(text: str) -> List[str]:
    """
    Returns a list of violation types if any patterns are matched.
    Cached to avoid repeated regex processing.
    """
    violations = []
    for label, pattern in SENSITIVE_PATTERNS.items():
        if re.search(pattern, text, re.IGNORECASE):
            violations.append(label)
    return violations


# ---------- Combined Guardrail Check ----------

@lru_cache(maxsize=1000)
def check_guardrails(text: str) -> Dict:
    """
    Runs both OpenAI moderation and custom guardrails.
    Returns a dict with:
        - 'blocked': bool
        - 'reason': str
        - 'moderation': full OpenAI result (optional)
        - 'violations': list of custom flags
    
    Cached to avoid repeated processing for similar inputs.
    """
    result = {
        "blocked": False,
        "reason": "",
        "moderation": {},
        "violations": []
    }

    # 1. Custom pattern check first (faster than API call)
    violations = check_custom_guardrails(text)
    if violations:
        result["blocked"] = True
        result["reason"] = "Custom Guardrail Violation"
        result["violations"] = violations
        return result

    # 2. OpenAI Moderation (only if custom check passes)
    moderation = check_moderation(text)
    result["moderation"] = moderation
    if moderation.get("flagged", False):
        result["blocked"] = True
        result["reason"] = "OpenAI Moderation Policy Violation"

    return result 