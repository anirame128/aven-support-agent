import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pinecone import Pinecone
from openai import OpenAI
import time
import io
import hashlib
import json
import base64
from functools import lru_cache
from llm_moderation.guardrails import check_guardrails
from scheduling_tool.google_calendar import ScheduleRequest, schedule_support_event, get_available_times

load_dotenv()

# Initialize Pinecone with connection pooling
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX_NAME"))

# Initialize OpenAI client with connection pooling
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    max_retries=3,
    timeout=30.0
)

# Simple in-memory cache for responses
response_cache = {}

def get_cache_key(question: str) -> str:
    """Generate a cache key for the question"""
    return hashlib.md5(question.lower().strip().encode()).hexdigest()

@lru_cache(maxsize=1000)
def cached_guardrails_check(text: str) -> dict:
    """Cache guardrails check results"""
    return check_guardrails(text)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"]
)

@app.on_event("startup")
async def startup_event():
    """Warm up connections on startup to reduce cold start latency"""
    print("🚀 Warming up connections...")
    
    # Warm up Pinecone connection
    try:
        # Test Pinecone connection with a simple query
        test_query = {"inputs": {"text": "test"}, "top_k": 1}
        index.search(namespace="__default__", query=test_query)
        print("✅ Pinecone connection warmed up")
    except Exception as e:
        print(f"⚠️ Pinecone warmup failed: {e}")
    
    # Warm up OpenAI connection
    try:
        # Test OpenAI with a simple completion
        client.chat.completions.create(
            model="gpt-4.1-mini-2025-04-14",
            messages=[{"role": "user", "content": "test"}],
            max_tokens=1
        )
        print("✅ OpenAI connection warmed up")
    except Exception as e:
        print(f"⚠️ OpenAI warmup failed: {e}")
    
    print("🎯 Server ready!")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    print("🛑 Shutting down server...")
    # Clear cache
    response_cache.clear()
    print("✅ Cache cleared")

def is_support_question(q: str) -> bool:
    """Check if the question is asking for support/help that would warrant scheduling a call"""
    support_keywords = [
        "call", "contact", "help", "talk to someone", "representative",
        "support", "agent", "can't find", "problem", "issue", "trouble",
        "assistance", "speak to", "speak with", "get help", "need help",
        "account", "payment", "billing", "charge", "transaction", "fraud",
        "lost", "stolen", "damaged", "not working", "error", "failed"
    ]
    q_lower = q.lower()
    return any(k in q_lower for k in support_keywords)

def lines_to_markdown_bullets(text):
    import re
    lines = text.split('\n')
    new_lines = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        # Detect section title (ends with colon or is bold)
        if line and (line.endswith(':') or re.match(r"^\*\*.*\*\*$", line)):
            new_lines.append(line)
            # Look ahead for consecutive non-empty, non-list lines
            j = i + 1
            list_block = []
            while j < len(lines):
                next_line = lines[j].strip()
                if not next_line or next_line.startswith('-') or next_line.startswith('1.') or next_line.endswith(':') or re.match(r"^\*\*.*\*\*$", next_line):
                    break
                list_block.append(f"- {next_line}")
                j += 1
            if list_block:
                new_lines.append('')  # Blank line before list for markdown
                new_lines.extend(list_block)
                i = j - 1
        else:
            new_lines.append(line)
        i += 1
    return '\n'.join(new_lines)

def run_rag_pipeline(question):
    question = question.strip()
    
    # Validate input
    if not question or len(question.strip()) < 3:
        return {
            "answer": "I couldn't understand your question. Please try asking again.",
            "sources": [],
            "latency_ms": 0,
            "error": "Empty or too short question"
        }
    
    # Check cache first
    cache_key = get_cache_key(question)
    if cache_key in response_cache:
        cached_result = response_cache[cache_key]
        cached_result["cached"] = True
        return cached_result
    
    t0 = time.time()
    
    try:
        # Optimize: Use async search if possible, or implement connection pooling
        res = index.search(
            namespace="__default__",
            query={"inputs": {"text": question}, "top_k": 10}
        )
    except Exception as e:
        print(f"Pinecone search error: {e}")
        return {
            "answer": "Sorry, I'm having trouble accessing the information right now. Please try again.",
            "sources": [],
            "latency_ms": int((time.time() - t0) * 1000),
            "error": str(e)
        }
    pinecone_time = time.time() - t0

    matches = res.result["hits"]
    # Custom logic for join/apply/link questions
    join_keywords = [
        "join", "apply", "application", "sign up", "get a card", "get aven card", "link to join", "link to apply", "where is the link", "sign up now"
    ]
    lower_q = question.lower()
    is_join_intent = any(k in lower_q for k in join_keywords)

    if not matches and is_join_intent:
        result = {
            "answer": "You can apply for an Aven card at [https://www.aven.com](https://www.aven.com).",
            "sources": ["https://www.aven.com"],
            "latency_ms": int(pinecone_time * 1000)
        }
        response_cache[cache_key] = result
        return result
        
    if not matches:
        # Only trigger schedule if it's a true support request
        should_trigger_schedule = is_support_question(question)
        
        result = {
            "answer": "I'm not sure about that. Please reach out to Aven's support team for more help.",
            "sources": [],
            "latency_ms": int(pinecone_time * 1000),
            "trigger_schedule": should_trigger_schedule
        }
        
        print(f"🤖 No matches found for: '{question}' - trigger_schedule: {should_trigger_schedule}")
        
        response_cache[cache_key] = result
        return result

    context = "\n---\n".join(
        hit["fields"]["text"] for hit in matches
        if "text" in hit["fields"] and hit["fields"]["text"].strip()
    )

    if "aven.com" not in context:
        context += "\n\nYou can apply for an Aven card at https://www.aven.com."

    prompt = (
        "You are Aven's friendly and accurate support assistant. Only answer using the information provided below. "
        "If the answer isn't there, say 'I'm not sure about that' — don't make anything up.\n\n"
        "**Instructions:**\n"
        "- Use markdown (e.g., **bold**, - bullet points)\n"
        "- Be clear, helpful, and concise\n"
        "- Don't repeat the question or mention the source/context\n\n"
        f"Information:\n{context}\n\n"
        f"User Question: {question}\n\n"
        "Answer:"
    )

    t1 = time.time()
    chat_res = client.chat.completions.create(
        model="gpt-3.5-turbo",  # Fast and cost-effective, or use "gpt-4" for better quality
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=500,  # Optional: limit response length to control costs
    )
    llm_time = time.time() - t1

    answer = chat_res.choices[0].message.content.strip()
    answer = lines_to_markdown_bullets(answer)
    sources = list({s for s in (hit["fields"].get("source") for hit in matches) if s})

    # If the LLM still says "I'm not sure about that" and it's a join/apply question, override the answer
    if is_join_intent and "i'm not sure about that" in answer.lower():
        result = {
            "answer": "You can apply for an Aven card at [https://www.aven.com](https://www.aven.com).",
            "sources": ["https://www.aven.com"],
            "latency_ms": int((time.time() - t0) * 1000)
        }
        response_cache[cache_key] = result
        return result

    # If the LLM says "I'm not sure about that", direct to support
    if "i'm not sure about that" in answer.lower():
        answer += "\n\nFor further assistance, please contact support@aven.com or visit [https://www.aven.com/call](https://www.aven.com/call)."
        
        # Only trigger schedule if it's a true support request
        should_trigger_schedule = is_support_question(question)
        
        result = {
            "answer": answer,
            "sources": sources,
            "latency_ms": int((time.time() - t0) * 1000),
            "details": {
                "pinecone_ms": int(pinecone_time * 1000),
                "llm_ms": int(llm_time * 1000)
            },
            "trigger_schedule": should_trigger_schedule
        }
        
        # Add logging to see why it keeps triggering
        print(f"🤖 Final answer: {answer[:80]}... trigger_schedule: {should_trigger_schedule} (support_question: {is_support_question(question)})")
        
        response_cache[cache_key] = result
        return result

    result = {
        "answer": answer,
        "sources": sources,
        "latency_ms": int((time.time() - t0) * 1000),  # ⏱ Total latency
        "details": {
            "pinecone_ms": int(pinecone_time * 1000),
            "llm_ms": int(llm_time * 1000)
        }
    }
    response_cache[cache_key] = result
    return result

@app.post("/ask")
async def ask_question(req: Request):
    data = await req.json()
    question = data.get("question")
    schedule_state = data.get("schedule_state")
    
    if not question:
        return {"error": "No question provided."}
    
    # Use cached guardrails check
    check = cached_guardrails_check(question)
    if check["blocked"]:
        reason = check["reason"]
        violations = check.get("violations", [])
        return {
            "answer": "I'm sorry, but I can't help with that request.",
            "sources": [],
            "violations": violations
        }
    
    # Check if we're in a scheduling flow
    if schedule_state and schedule_state.get("active", False):
        from scheduling_tool.google_calendar import continue_scheduling_flow
        try:
            print(f"🔄 Text scheduling flow - question: '{question}', state: {schedule_state}")
            resp = continue_scheduling_flow(question, schedule_state)
            print(f"📋 Text scheduling response: {resp}")
            
            if resp.get("error"):
                answer = resp["error"]
            else:
                answer = resp["message"]
            
            result = {
                "answer": answer,
                "sources": [],
                "schedule_state": resp.get("schedule_state", schedule_state) if not resp.get("done", False) else None
            }
            return result
            
        except Exception as e:
            print(f"Text Scheduling Error: {e}")
            return {
                "answer": "Sorry, there was an error with scheduling. Let me help you another way.",
                "sources": []
            }
    
    # Normal RAG flow
    result = run_rag_pipeline(question)
    
    # If RAG says "trigger_schedule", we START the scheduling flow
    if result.get("trigger_schedule"):
        from scheduling_tool.google_calendar import start_scheduling_flow
        try:
            print(f"🚀 Starting text scheduling flow due to trigger_schedule")
            sched = start_scheduling_flow()
            result["answer"] = sched["message"]
            result["schedule_state"] = sched.get("schedule_state")
        except Exception as e:
            print(f"Text Schedule Start Error: {e}")
            # Fall back to normal RAG response
            pass
    
    return result

@app.post("/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    """Convert speech to text using OpenAI's Whisper model"""
    try:
        # Read the audio file
        audio_data = await audio.read()
        
        # Create a file-like object
        audio_file = io.BytesIO(audio_data)
        audio_file.name = "audio.webm"  # Set a filename for OpenAI API
        
        # Use OpenAI's speech-to-text API
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="text"
        )
        
        return {"transcript": transcript}
        
    except Exception as e:
        print(f"STT Error: {e}")
        return {"error": "Failed to transcribe audio", "details": str(e)}

@app.post("/voice-ask")
async def voice_ask(
    background_tasks: BackgroundTasks,
    request: Request,
    audio: UploadFile = File(...)
):
    """
    STT ➜ RAG ➜ decide if we need to schedule
    If `schedule_state` exists we continue the voice scheduling flow,
    otherwise we fall back to plain RAG (+TTS).
    """
    # ---------- helpers ----------
    def _audio_to_text(blob: bytes) -> str:
        audio_file = io.BytesIO(blob)
        audio_file.name = "audio.webm"
        return client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="text",
            language="en"  # Specify language for faster processing
        )

    def _text_to_audio(text: str) -> bytes:
        try:
            clean = text.replace("**", "").replace("*", "").replace("- ", "").replace("#", "")
            print(f"🔊 TTS input: '{clean}'")
            response = client.audio.speech.create(
                model="tts-1",
                voice="alloy",
                input=clean,
                response_format="mp3",
                speed=1.1  # Slightly faster speech
            )
            print(f"🔊 TTS response size: {len(response.content)} bytes")
            return response.content
        except Exception as e:
            print(f"❌ TTS Error: {e}")
            raise e

    # ---------- 1.  STT ----------
    try:
        audio_blob = await audio.read()
        print(f"📁 Audio blob size: {len(audio_blob)} bytes")
        
        if len(audio_blob) == 0:
            return _voice_error("No audio data received.", "Empty audio blob")
        
        transcript = _audio_to_text(audio_blob).strip()
        
        # Debug logging
        print(f"🎤 Transcript: '{transcript}'")
        
        # Check if transcript is empty or too short
        if not transcript or len(transcript.strip()) < 3:
            return _voice_error("I couldn't hear anything. Please try speaking again.", "Empty or too short transcript")
            
    except Exception as e:
        print(f"❌ STT Error: {e}")
        return _voice_error("I couldn't understand that audio.", str(e))

    # ---------- 2.  Check for scheduling state ----------
    # Try to get schedule_state from form data or request body
    schedule_state = {}
    try:
        # Check if there's additional form data
        form_data = await request.form()
        if "schedule_state" in form_data:
            schedule_state = json.loads(form_data["schedule_state"])
            print(f"📋 Received schedule_state: {schedule_state}")
    except Exception as e:
        print(f"❌ Error parsing schedule_state: {e}")
        # If no form data or parsing fails, continue with empty state
        pass

    # ---------- 3a.  Scheduling branch ----------
    print(f"🔍 Checking scheduling branch - schedule_state: {schedule_state}, active: {schedule_state.get('active', False) if schedule_state else False}")
    if schedule_state and schedule_state.get("active", False):
        from scheduling_tool.google_calendar import continue_scheduling_flow
        try:
            print(f"🔄 Scheduling flow - transcript: '{transcript}', state: {schedule_state}")
            resp = continue_scheduling_flow(transcript, schedule_state)
            print(f"📋 Scheduling response: {resp}")
            # resp = { stage: ..., message: ..., done: bool, error?: str, schedule_state?: dict }

            if resp.get("error"):
                speech = resp["error"]
            else:
                speech = resp["message"]

            audio_out = _text_to_audio(speech)
            response = _voice_json(transcript, speech, audio_out)
            
            # Update schedule state in response
            if resp.get("done", False):
                response["schedule_state"] = None  # Clear state when done
            else:
                response["schedule_state"] = resp.get("schedule_state", schedule_state)
                
            return response
            
        except Exception as e:
            print(f"Scheduling Error: {e}")
            audio_out = _text_to_audio("Sorry, there was an error with scheduling. Let me help you another way.")
            return _voice_json(transcript, "Sorry, there was an error with scheduling.", audio_out)

    # ---------- 3b.  Normal RAG branch ----------
    try:
        print(f"🔍 Running RAG pipeline for transcript: '{transcript}'")
        rag = run_rag_pipeline(transcript)
        print(f"📋 RAG result: {rag}")
    except Exception as e:
        print(f"❌ RAG pipeline error: {e}")
        speech = "Sorry, I'm having trouble processing your request right now. Please try again."
        audio_out = _text_to_audio(speech)
        return _voice_json(transcript, speech, audio_out)

    # If RAG says "trigger_schedule", we START the scheduling flow
    if rag.get("trigger_schedule"):
        from scheduling_tool.google_calendar import start_scheduling_flow
        try:
            print(f"🚀 Starting scheduling flow due to trigger_schedule")
            sched = start_scheduling_flow()
            speech = sched["message"]
            audio_out = _text_to_audio(speech)
            return _voice_json(
                transcript,
                speech,
                audio_out,
                schedule_state=sched.get("schedule_state")
            )
        except Exception as e:
            print(f"Schedule Start Error: {e}")
            # Fall back to normal RAG response
            pass

    # Plain answer
    speech = rag["answer"]
    sources = rag.get("sources", [])
    audio_out = _text_to_audio(speech)
    return _voice_json(transcript, speech, audio_out, sources=sources)


# ---------- tiny helpers ----------
def _voice_json(transcript: str, answer: str, audio_bytes: bytes, **kw):
    return {
        "transcript": transcript,
        "answer": answer,
        "audio_data": base64.b64encode(audio_bytes).decode(),
        "audio_format": "mp3",
        **kw
    }

def _voice_error(msg: str, details: str):
    return {
        "transcript": "",
        "answer": msg,
        "audio_data": "",
        "error": details
    }

@app.post("/tts")
async def text_to_speech(req: Request):
    """Convert text to speech using OpenAI's TTS API"""
    try:
        body = await req.json()
        text = body.get("text", "").strip()
        voice = body.get("voice", "alloy")  # Default voice
        
        if not text:
            return {"error": "No text provided"}
        
        # Clean text for speech (remove markdown formatting)
        clean_text = text.replace("**", "").replace("*", "").replace("- ", "").replace("#", "")
        
        response = client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=clean_text,
            response_format="mp3"
        )
        
        return StreamingResponse(
            io.BytesIO(response.content),
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=speech.mp3"}
        )
        
    except Exception as e:
        print(f"TTS Error: {e}")
        return {"error": "Failed to convert text to speech", "details": str(e)}

@app.post("/rag_query")
async def rag_query(req: Request):
    body = await req.json()
    question = body.get("question", "").strip()
    if not question:
        return {"context": "", "sources": []}

    res = index.search(
        namespace="__default__",
        query={"inputs": {"text": question}, "top_k": 10}
    )
    matches = res.result["hits"]
    if not matches:
        return {"context": "", "sources": []}

    context = "\n---\n".join(
        hit["fields"]["text"] for hit in matches
        if "text" in hit["fields"] and hit["fields"]["text"].strip()
    )
    sources = list({hit["fields"].get("source") for hit in matches if hit["fields"].get("source")})

    return {"context": context, "sources": sources}

@app.post("/schedule-support-call")
async def schedule_support_call(req: ScheduleRequest):
    return schedule_support_event(req)

@app.get("/available-times")
async def available_times():
    return get_available_times()

@app.get("/health")
async def health_check():
    """Health check endpoint with performance metrics"""
    return {
        "status": "healthy",
        "cache_size": len(response_cache),
        "timestamp": time.time()
    }

@app.get("/performance")
async def performance_metrics():
    """Get performance metrics"""
    return {
        "cache_hits": len([r for r in response_cache.values() if r.get("cached", False)]),
        "cache_size": len(response_cache),
        "total_requests": len(response_cache)
    }