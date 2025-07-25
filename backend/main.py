import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pinecone import Pinecone
from openai import OpenAI
import time
import io
from llm_moderation.guardrails import check_guardrails
from scheduling_tool.google_calendar import ScheduleRequest, schedule_support_event, get_available_times

load_dotenv()

# Initialize Pinecone
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX_NAME"))

# Initialize OpenAI client
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),  # Make sure to add this to your .env file
)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

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
    
    t0 = time.time()
    res = index.search(
        namespace="__default__",
        query={"inputs": {"text": question}, "top_k": 10}
    )
    pinecone_time = time.time() - t0

    matches = res.result["hits"]
    # Custom logic for join/apply/link questions
    join_keywords = [
        "join", "apply", "application", "sign up", "get a card", "get aven card", "link to join", "link to apply", "where is the link", "sign up now"
    ]
    lower_q = question.lower()
    is_join_intent = any(k in lower_q for k in join_keywords)

    if not matches and is_join_intent:
        return {
            "answer": "You can apply for an Aven card at [https://www.aven.com](https://www.aven.com).",
            "sources": ["https://www.aven.com"],
            "latency_ms": int(pinecone_time * 1000)
        }
    if not matches:
        return {
            "answer": "I'm not sure about that. Please reach out to Aven's support team for more help.",
            "sources": [],
            "latency_ms": int(pinecone_time * 1000),
            "trigger_schedule": True
        }

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
        return {
            "answer": "You can apply for an Aven card at [https://www.aven.com](https://www.aven.com).",
            "sources": ["https://www.aven.com"],
            "latency_ms": int((time.time() - t0) * 1000)
        }

    # If the LLM says "I'm not sure about that", direct to support
    if "i'm not sure about that" in answer.lower():
        answer += "\n\nFor further assistance, please contact support@aven.com or visit [https://www.aven.com/call](https://www.aven.com/call)."
        return {
            "answer": answer,
            "sources": sources,
            "latency_ms": int((time.time() - t0) * 1000),
            "details": {
                "pinecone_ms": int(pinecone_time * 1000),
                "llm_ms": int(llm_time * 1000)
            },
            "trigger_schedule": True
        }

    return {
        "answer": answer,
        "sources": sources,
        "latency_ms": int((time.time() - t0) * 1000),  # ⏱ Total latency
        "details": {
            "pinecone_ms": int(pinecone_time * 1000),
            "llm_ms": int(llm_time * 1000)
        }
    }

@app.post("/ask")
async def ask_question(req: Request):
    question = (await req.json()).get("question")
    if not question:
        return {"error": "No question provided."}
    
    # Guardrails check
    check = check_guardrails(question)
    if check["blocked"]:
        reason = check["reason"]
        violations = check.get("violations", [])
        return {
            "answer": "I'm sorry, but I can't help with that request.",
            "sources": [],
            "violations": violations
        }
    
    result = run_rag_pipeline(question)
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
async def voice_ask(audio: UploadFile = File(...)):
    """Complete voice-to-voice pipeline: STT -> RAG -> TTS"""
    try:
        # Step 1: Speech to Text
        audio_data = await audio.read()
        audio_file = io.BytesIO(audio_data)
        audio_file.name = "audio.webm"
        
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="text"
        )
        
        # Step 2: Get answer from RAG pipeline
        result = run_rag_pipeline(transcript)
        answer = result["answer"]
        
        # Step 3: Text to Speech
        # Clean the answer for speech (remove markdown)
        clean_answer = answer.replace("**", "").replace("*", "").replace("- ", "").replace("#", "")
        
        tts_response = client.audio.speech.create(
            model="tts-1",
            voice="alloy",  # Can be: alloy, echo, fable, onyx, nova, shimmer
            input=clean_answer,
            response_format="mp3"
        )
        
        # Return JSON response with audio data and metadata
        import base64
        audio_base64 = base64.b64encode(tts_response.content).decode('utf-8')
        
        return {
            "transcript": transcript,
            "answer": answer,
            "sources": result.get("sources", []),
            "audio_data": audio_base64,
            "audio_format": "mp3"
        }
        
    except Exception as e:
        print(f"Voice Ask Error: {e}")
        return {"error": "Failed to process voice request", "details": str(e)}

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