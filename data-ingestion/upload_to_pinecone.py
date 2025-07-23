# upload_to_pinecone.py

import os
import json
from pinecone import Pinecone
from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX_NAME"))

with open("aven_data/aven_chunked.json", "r") as f:
    chunks = json.load(f)

BATCH_SIZE = 50
namespace = "__default__"

print(f"🔄 Uploading chunks with field 'text' to match Pinecone's field mapping...")

for i in tqdm(range(0, len(chunks), BATCH_SIZE)):
    batch = chunks[i:i + BATCH_SIZE]
    records = []
    for j, chunk in enumerate(batch):
        records.append({
            "_id": f"aven-{i + j}",
            "text": chunk["text"],  # 🔥 must match your Pinecone field mapping
            "source": chunk["metadata"]["source"]  # optional metadata
        })
    index.upsert_records(namespace, records)

print(f"\n✅ Uploaded {len(chunks)} records using Pinecone SDK v3 integrated embedding.")
