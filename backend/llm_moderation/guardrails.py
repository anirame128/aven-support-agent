import re
import openai
from typing import Dict, List

# ---------- OpenAI Moderation ----------

def check_moderation(text: str) -> Dict:
    """
    Uses OpenAI Moderation API to check for content policy violations.
    """
    try:
        response = openai.Moderation.create(input=text)
        return response["results"][0]
    except Exception as e:
        return {"flagged": False, "error": str(e)}


# ---------- Custom Regex-Based Filters ----------

SENSITIVE_PATTERNS = {
    "personal_data": r"\b(SSN|social security number|email address|home address|phone number|date of birth)\b",
    "legal_advice": r"\b(lawsuit|attorney|lawyer|legal advice|court|settlement|file a claim|sue)\b",
    "financial_advice": r"\b(invest|stock|retirement|buy|sell|portfolio|wealth management|tax advice|IRA|Roth IRA)\b"
}

def check_custom_guardrails(text: str) -> List[str]:
    """
    Returns a list of violation types if any patterns are matched.
    """
    violations = []
    for label, pattern in SENSITIVE_PATTERNS.items():
        if re.search(pattern, text, re.IGNORECASE):
            violations.append(label)
    return violations


# ---------- Combined Guardrail Check ----------

def check_guardrails(text: str) -> Dict:
    """
    Runs both OpenAI moderation and custom guardrails.
    Returns a dict with:
        - 'blocked': bool
        - 'reason': str
        - 'moderation': full OpenAI result (optional)
        - 'violations': list of custom flags
    """
    result = {
        "blocked": False,
        "reason": "",
        "moderation": {},
        "violations": []
    }

    # 1. OpenAI Moderation
    moderation = check_moderation(text)
    result["moderation"] = moderation
    if moderation.get("flagged", False):
        result["blocked"] = True
        result["reason"] = "OpenAI Moderation Policy Violation"
        return result

    # 2. Custom pattern check
    violations = check_custom_guardrails(text)
    if violations:
        result["blocked"] = True
        result["reason"] = "Custom Guardrail Violation"
        result["violations"] = violations

    return result 