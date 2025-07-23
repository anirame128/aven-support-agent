import os, json
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pinecone import Pinecone
import openai as OpenRouterClient
import re

load_dotenv()

# Initialize Pinecone
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX_NAME"))

# Initialize OpenRouter chat client
chat_client = OpenRouterClient.OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
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
    question = question.strip()[:1000]
    res = index.search(
        namespace="__default__",
        query={"inputs": {"text": question}, "top_k": 10}
    )
    matches = res.result["hits"]
    if not matches:
        return "I'm not sure about that. Please reach out to Aven's support team for more help.", []
    context = "\n---\n".join(
        hit["fields"]["text"] for hit in matches if "text" in hit["fields"] and hit["fields"]["text"].strip()
    )
    if "aven.com" not in context:
        context += "\n\nYou can apply for an Aven card at https://www.aven.com."
    prompt = (
        "You are Aven's helpful, accurate, and friendly support assistant.\n\n"
        "Use ONLY the information below to answer the user's question.\n"
        "If the answer is not there, say 'I'm not sure about that' or 'I don't have that information right now'—do NOT make anything up.\n\n"
        "When responding:\n"
        "- Format your answer using markdown:\n"
        "  - Use **bold** section titles\n"
        "  - Use bullet points (start each item with '-') or numbered lists (start with '1.') for details\n"
        "  - Add inline [links](https://example.com) when URLs are available\n"
        "  - Keep tone friendly, clear, and helpful\n"
        "- When listing requirements or steps, ALWAYS use markdown list syntax (not just line breaks). For example:\n"
        "  - Correct: '- Be a U.S. resident' or '1. Go to the website'\n"
        "  - Incorrect: 'Be a U.S. resident' (no dash)\n"
        "- Do NOT repeat the question or include a header like 'Based on the context'\n"
        "- Do NOT mention the word 'context' or refer to where the info came from\n\n"
        f"Information:\n{context}\n\n"
        f"User Question: {question}\n\n"
        "Answer:"
    )
    chat_res = chat_client.chat.completions.create(
        model="moonshotai/kimi-k2:free",  # Cheaper alternative
        messages=[{"role":"user", "content": prompt}],
        temperature=0.2,
    )
    answer = chat_res.choices[0].message.content.strip()
    answer = lines_to_markdown_bullets(answer)
    sources = list({s for s in (hit["fields"].get("source") for hit in matches) if s})
    return answer, sources

@app.post("/ask")
async def ask_question(req: Request):
    question = (await req.json()).get("question")
    if not question:
        return {"error": "No question provided."}
    answer, sources = run_rag_pipeline(question)
    return {"answer": answer, "sources": sources}


