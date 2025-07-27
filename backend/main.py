# Standard library imports
import os
import time
import io
import base64
import json

# Third-party imports
from dotenv import load_dotenv
from fastapi import FastAPI, Request, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pinecone import Pinecone
from openai import OpenAI

# Local imports
from llm_moderation.guardrails import check_guardrails
from scheduling_tool.google_calendar import ScheduleRequest, schedule_support_event, get_available_times

load_dotenv()

# Initialize Pinecone
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX_NAME"))

# Initialize OpenAI client
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    max_retries=3,
    timeout=30.0
)

# Configuration constants
SIMILARITY_THRESHOLD = 0.3  # Lower threshold to include more relevant matches
TOP_K_RESULTS = 10  # Reduced from 5 for faster processing
OPENAI_MODEL = "gpt-4o-mini"  # Faster model for better performance

# Error messages
EMPTY_QUESTION_ERROR = "I couldn't understand your question. Please try asking again."
PINECONE_ERROR = "Sorry, I'm having trouble accessing the information right now. Please try again."
NO_MATCHES_ERROR = "I'm not sure about that. Please reach out to our support team for more help.\n\nWould you like me to help you schedule a call with our support team?"
SCHEDULING_ERROR = "Sorry, there was an error with scheduling. Let me help you another way."

def guardrails_check(text: str) -> dict:
    """Check if text violates content policy guardrails"""
    return check_guardrails(text)

def is_relevant_question(question: str) -> bool:
    """Check if the question is relevant - let the LLM handle reasoning"""
    question_lower = question.lower()
    
    # Basic validation - question should be substantial
    if len(question.strip()) < 3:
        return False
    
    # Only filter out obviously irrelevant patterns
    irrelevant_patterns = [
        "what is the weather",
        "tell me a joke", 
        "what time is it",
        "how are you",
        "hello",
        "hi",
        "hey"
    ]
    
    # If it matches clearly irrelevant patterns, return False
    if any(pattern in question_lower for pattern in irrelevant_patterns):
        return False
    
    # Let the LLM decide for everything else based on context
    return True

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://127.0.0.1:3000", 
        "http://localhost:3001", 
        "http://127.0.0.1:3001",
        "https://aven-support-agent.vercel.app",
        "https://aven-support-agent-git-main-anirame128.vercel.app",
        "https://aven-support-agent-anirame128.vercel.app"
    ],
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
        test_query = {"inputs": {"text": "test"}, "top_k": 1}
        index.search(namespace="__default__", query=test_query)
        print("✅ Pinecone connection warmed up")
    except Exception as e:
        print(f"⚠️ Pinecone warmup failed: {e}")
    
    # Warm up OpenAI connection
    try:
        client.chat.completions.create(
            model=OPENAI_MODEL,
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
    print("✅ Server shutdown complete")



def run_rag_pipeline(question: str) -> dict:
    """Run the RAG pipeline to answer questions
    
    Args:
        question: The user's question
        
    Returns:
        dict: Response containing answer, sources, and metadata
    """
    question = question.strip()
    
    # Validate input
    if not question or len(question.strip()) < 3:
        return {
            "answer": EMPTY_QUESTION_ERROR,
            "sources": [],
            "latency_ms": 0,
            "error": "Empty or too short question"
        }
    
    # Temporarily disable relevance filtering to debug
    # if not is_relevant_question(question):
    #     return {
    #         "answer": "I'm here to help with Aven financial services. Please ask me questions about Aven cards, applications, payments, or other Aven-related topics. How can I help you with Aven today?",
    #         "sources": [],
    #         "latency_ms": 0,
    #         "error": "Off-topic question"
    #     }
    
    t0 = time.time()
    
    # Search Pinecone
    try:
        res = index.search(
            namespace="__default__",
            query={"inputs": {"text": question}, "top_k": TOP_K_RESULTS},
        )
    except Exception as e:
        print(f"Pinecone search error: {e}")
        return {
            "answer": PINECONE_ERROR,
            "sources": [],
            "latency_ms": int((time.time() - t0) * 1000),
            "error": str(e)
        }
    pinecone_time = time.time() - t0

    matches = res.result["hits"]
    


    # Filter matches by similarity score
    good_matches = [hit for hit in matches if hit.get("_score", 0) > SIMILARITY_THRESHOLD]
    all_matches = matches  # Use all matches for context to improve coverage
    
    # Debug: Print all similarity scores
    print(f"🔍 Found {len(matches)} matches, {len(good_matches)} with good similarity (threshold: {SIMILARITY_THRESHOLD})")
    print("📊 Similarity scores:")
    for i, hit in enumerate(matches):
        score = hit.get("_score", 0)
        source = hit.get("fields", {}).get("source", "unknown")
        print(f"  Match {i+1}: {score:.3f} - {source}")
    
    # Debug: Print question being asked
    print(f"❓ Question: {question}")

        
    if not matches:
        return {
            "answer": NO_MATCHES_ERROR,
            "sources": [],
            "latency_ms": int(pinecone_time * 1000),
            "trigger_schedule": True
        }

    # Build context from all matches, prioritizing good matches
    def extract_text_content(matches):
        """Extract text content from matches, filtering out empty content"""
        texts = []
        
        for hit in matches:
            if "text" in hit["fields"] and hit["fields"]["text"].strip():
                text = hit["fields"]["text"].strip()
                texts.append(text)
        
        return "\n---\n".join(texts)
    
    good_context = extract_text_content(good_matches)
    all_context = extract_text_content(all_matches)
    
    # Combine contexts, prioritizing good matches
    context = good_context + "\n---\n" + all_context if good_context else all_context
    
    # Debug: Print context info after it's built
    print(f"📝 Context length: {len(context)} characters")
    print(f"📝 Context preview: {context[:200]}...")
    




    # Create prompt for LLM
    def build_prompt(context: str, question: str) -> str:
        """Build the prompt for the LLM with consistent formatting"""
        return (
            "You are a helpful assistant for Aven financial services. Answer questions about Aven products, services, policies, and procedures using the provided information. "
            "If someone mentions 'Avon' or similar misspellings, assume they mean 'Aven' and provide helpful information about Aven services. "
            "Answer questions about loan offers, payment estimates, application processes, eligibility, and other financial services topics using the available information. "
            "If the question is completely unrelated to financial services (like weather, jokes, etc.), politely redirect to Aven topics. "
            "Be direct and to the point. Use bullet points when listing requirements. "
            "Keep responses under 100 words. Be brief and actionable.\n\n"
            "If someone asks to schedule a call or speak to a representative, offer to help schedule.\n\n"
            f"Information:\n{context}\n\n"
            f"Question: {question}\n\n"
            "Answer:"
        )
    
    prompt = build_prompt(context, question)

    # Get LLM response
    t1 = time.time()
    try:
        chat_res = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,  # Reduced from 0.2 for faster, more consistent responses
            max_tokens=150,   # Reduced from 200 for more concise responses
            top_p=0.9,        # Add top_p for faster sampling
            timeout=10,       # Reduced timeout for faster responses
        )
        llm_time = time.time() - t1
        answer = chat_res.choices[0].message.content.strip()
        print(f"🤖 LLM Response: {answer}")
    except Exception as e:
        print(f"❌ LLM Error: {e}")
        llm_time = time.time() - t1
        answer = "I'm having trouble processing your request right now. Please try again in a moment."
    
    # Check if we should trigger scheduling
    scheduling_keywords = [
        "schedule", "scheduling", "appointment", "call", "representative", 
        "speak to someone", "talk to someone", "human", "agent", "support call",
        "help me", "assist me", "contact", "reach out"
    ]
    
    # Check for scheduling intent in the question
    question_lower = question.lower()
    has_scheduling_intent = any(keyword in question_lower for keyword in scheduling_keywords)
    
    # Check if LLM response indicates uncertainty or requests for human help
    uncertainty_indicators = [
        "i'm not sure about that",
        "i don't have enough information",
        "please contact support",
        "speak to a representative",
        "call our support team"
    ]
    has_uncertainty = any(indicator in answer.lower() for indicator in uncertainty_indicators)
    
    # Check for affirmative responses to scheduling offers
    affirmative_responses = ["yes", "yeah", "sure", "ok", "okay", "yep", "absolutely", "definitely"]
    is_affirmative_response = any(word in question_lower for word in affirmative_responses)
    
    # Check if the LLM response contains scheduling offer indicators
    scheduling_offer_indicators = [
        "would you like me to help you schedule",
        "schedule a call",
        "help you schedule"
    ]
    is_scheduling_offer_response = any(indicator in answer.lower() for indicator in scheduling_offer_indicators)
    
    should_trigger_schedule = has_scheduling_intent or has_uncertainty or (is_affirmative_response and is_scheduling_offer_response)
    
    # Always return empty sources list
    sources = []
    
    # Build response with consistent structure
    def build_response(answer: str, sources: list, latency_ms: int, **kwargs):
        """Build a consistent response structure"""
        response = {
            "answer": answer,
            "sources": [],  # Always return empty sources
            "latency_ms": latency_ms,
            "details": {
                "pinecone_ms": int(pinecone_time * 1000),
                "llm_ms": int(llm_time * 1000)
            }
        }
        response.update(kwargs)
        return response



    if should_trigger_schedule:
        answer += "\n\nI'd be happy to help you connect with our support team for further assistance."
        answer += "\n\nWould you like me to help you schedule a call with our support team?"
        
        return build_response(
            answer, 
            sources, 
            int((time.time() - t0) * 1000),
            trigger_schedule=should_trigger_schedule
        )

    return build_response(answer, sources, int((time.time() - t0) * 1000))

@app.post("/ask")
async def ask_question(req: Request):
    data = await req.json()
    question = data.get("question")
    schedule_state = data.get("schedule_state")
    
    if not question:
        return {"error": "No question provided."}
    
    # Use guardrails check
    check = guardrails_check(question)
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
            resp = continue_scheduling_flow(question, schedule_state)
            
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
            sched = start_scheduling_flow()
            result["schedule_state"] = sched.get("schedule_state")
        except Exception as e:
            print(f"Text Schedule Start Error: {e}")
            pass
    
    return result

@app.post("/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    """Convert speech to text using OpenAI's Whisper model"""
    try:
        audio_data = await audio.read()
        audio_file = io.BytesIO(audio_data)
        audio_file.name = "audio.webm"
        
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
            language="en"
        )

    def _text_to_audio(text: str) -> bytes:
        try:
            clean = text.replace("**", "").replace("*", "").replace("- ", "").replace("#", "")
            response = client.audio.speech.create(
                model="tts-1",
                voice="alloy",
                input=clean,
                response_format="mp3",
                speed=1.1
            )
            return response.content
        except Exception as e:
            print(f"❌ TTS Error: {e}")
            raise e

    # ---------- 1.  STT ----------
    try:
        audio_blob = await audio.read()
        
        if len(audio_blob) == 0:
            return _voice_error("No audio data received.", "Empty audio blob")
        
        transcript = _audio_to_text(audio_blob).strip()
        
        if not transcript or len(transcript.strip()) < 3:
            return _voice_error("I couldn't hear anything. Please try speaking again.", "Empty or too short transcript")
            
    except Exception as e:
        print(f"❌ STT Error: {e}")
        return _voice_error("I couldn't understand that audio.", str(e))

    # ---------- 2.  Check for scheduling state ----------
    schedule_state = {}
    try:
        form_data = await request.form()
        if "schedule_state" in form_data:
            schedule_state = json.loads(form_data["schedule_state"])
            print(f"🎤 Voice scheduling state: {schedule_state}")
        else:
            print(f"🎤 No schedule_state in voice request")
    except Exception as e:
        print(f"❌ Error parsing schedule_state: {e}")
        pass

    # ---------- 3a.  Scheduling branch ----------
    if schedule_state and schedule_state.get("active", False):
        print(f"🎤 Entering scheduling branch with transcript: '{transcript}'")
        from scheduling_tool.google_calendar import continue_scheduling_flow
        try:
            resp = continue_scheduling_flow(transcript, schedule_state)

            if resp.get("error"):
                speech = resp["error"]
            else:
                speech = resp["message"]

            audio_out = _text_to_audio(speech)
            response = _voice_json(transcript, speech, audio_out)
            
            if resp.get("done", False):
                response["schedule_state"] = None
            else:
                response["schedule_state"] = resp.get("schedule_state", schedule_state)
                
            return response
            
        except Exception as e:
            print(f"Scheduling Error: {e}")
            audio_out = _text_to_audio("Sorry, there was an error with scheduling. Let me help you another way.")
            return _voice_json(transcript, "Sorry, there was an error with scheduling.", audio_out)

    # ---------- 3b.  Normal RAG branch ----------
    print(f"🎤 Entering RAG branch with transcript: '{transcript}'")
    try:
        rag = run_rag_pipeline(transcript)
    except Exception as e:
        print(f"❌ RAG pipeline error: {e}")
        speech = "Sorry, I'm having trouble processing your request right now. Please try again."
        audio_out = _text_to_audio(speech)
        return _voice_json(transcript, speech, audio_out)

    # If RAG says "trigger_schedule", we START the scheduling flow
    if rag.get("trigger_schedule"):
        print(f"🎤 RAG triggered scheduling for transcript: '{transcript}'")
        from scheduling_tool.google_calendar import start_scheduling_flow
        try:
            sched = start_scheduling_flow()
            speech = sched["message"]
            audio_out = _text_to_audio(speech)
            print(f"🎤 Starting scheduling flow with state: {sched.get('schedule_state')}")
            return _voice_json(
                transcript,
                speech,
                audio_out,
                schedule_state=sched.get("schedule_state")
            )
        except Exception as e:
            print(f"Schedule Start Error: {e}")
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
        voice = body.get("voice", "alloy")
        
        if not text:
            return {"error": "No text provided"}
        
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

@app.post("/schedule-support-call")
async def schedule_support_call(req: ScheduleRequest):
    return schedule_support_event(req)

@app.get("/available-times")
async def available_times():
    return get_available_times()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": time.time()
    }

@app.get("/performance")
async def performance_metrics():
    """Get performance metrics"""
    return {
        "status": "no_cache_enabled",
        "timestamp": time.time()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)