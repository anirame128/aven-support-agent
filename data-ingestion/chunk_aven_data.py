# chunk_aven_data.py

import json
import os
import tiktoken

# Load the raw crawled data
with open("aven_data/aven_crawled_raw.json", "r") as f:
    raw_pages = json.load(f)

# Use GPT-3.5 tokenizer to count tokens accurately for embedding later
encoder = tiktoken.encoding_for_model("gpt-3.5-turbo")

def chunk_text(text, max_tokens=500):
    words = text.split()
    chunks = []
    current = []

    for word in words:
        current.append(word)
        token_count = len(encoder.encode(" ".join(current)))
        if token_count > max_tokens:
            chunks.append(" ".join(current))
            current = []

    if current:
        chunks.append(" ".join(current))
    return chunks

# Clean + chunk pages
all_chunks = []
for page in raw_pages:
    url = page["url"]
    text = page["text"]

    if not text or len(text.strip()) < 50:
        continue  # skip low-value pages

    chunks = chunk_text(text)
    for chunk in chunks:
        all_chunks.append({
            "text": chunk,
            "metadata": {
                "source": url
            }
        })

# Save to aven_chunked.json
os.makedirs("aven_data", exist_ok=True)
with open("aven_data/aven_chunked.json", "w") as f:
    json.dump(all_chunks, f, indent=2)

print(f"✅ Chunked {len(raw_pages)} pages into {len(all_chunks)} chunks.")
