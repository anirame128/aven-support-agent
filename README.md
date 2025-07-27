# Aven Support Agent

An AI-powered customer support assistant for Aven financial services, built with FastAPI, OpenAI, and Pinecone vector database.

## Overview

This project provides an intelligent customer support system that can:
- Answer questions about Aven's financial services using RAG (Retrieval-Augmented Generation)
- Handle voice interactions with speech-to-text and text-to-speech capabilities
- Schedule support calls with human representatives
- Provide 24/7 automated customer support

## Features

- **RAG-powered Q&A**: Uses OpenAI GPT-4o-mini with Pinecone vector database for accurate responses
- **Voice Interface**: Web Speech API for browser-based voice interactions
- **Call Scheduling**: Google Calendar integration for booking support calls
- **Content Moderation**: OpenAI moderation API and custom guardrails
- **Multi-modal Support**: Text and voice interaction capabilities

## Tech Stack

**Backend:** Python, FastAPI, OpenAI API, Web Speech API, Pinecone, Google Calendar API, Docker, Uvicorn, Pydantic, Python-dotenv, Python-multipart, Tiktoken

**Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, Web Speech API, React Markdown, @tailwindcss/typography

**Data Processing:** Playwright, Tiktoken, Numpy, Tqdm

## Project Structure

```
aven-support-agent/
├── backend/                 # FastAPI backend server
│   ├── main.py             # Main API endpoints
│   ├── scheduling_tool/    # Google Calendar integration
│   ├── llm_moderation/     # Content filtering
│   ├── requirements.txt    # Python dependencies
│   ├── Dockerfile          # Container configuration
│   └── docker-compose.yml  # Local development setup
├── data-ingestion/         # Data processing pipeline
│   ├── crawl_aven.py       # Web scraping script
│   ├── chunk_aven_data.py  # Text chunking
│   ├── upload_to_pinecone.py # Vector database upload
│   ├── evaluate_agent.py   # Performance evaluation
│   ├── evaluation_set/     # Test questions and answers
│   └── requirements.txt    # Data processing dependencies
├── frontend/               # Next.js frontend
│   └── aven-frontend/      # React application
│       ├── src/app/        # Next.js app router
│       └── package.json    # Node.js dependencies
├── tailwind.config.js      # Tailwind CSS configuration
└── README.md              # Project documentation
```

## Prerequisites

- Python 3.11+
- Node.js 18+
- Docker and Docker Compose
- Google Cloud Platform account
- OpenAI API key
- Pinecone API key

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd aven-support-agent
```

### 2. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
cd frontend/aven-frontend
npm install
```

### 4. Environment Configuration

Create `.env` files in both `backend/` and `data-ingestion/` directories:

**Backend `.env`:**
```env
OPENAI_API_KEY=your_openai_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_index_name
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REFRESH_TOKEN=your_google_refresh_token
```

**Data-ingestion `.env`:**
```env
OPENAI_API_KEY=your_openai_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_index_name
NEXT_PUBLIC_API_URL=http://localhost:8080
```

**Frontend `.env`:**
```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

## Running the Application

### Backend Server

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

### Frontend Development Server

```bash
cd frontend/aven-frontend
npm run dev
```

### Docker Deployment

```bash
cd backend
docker-compose up --build
```

## API Endpoints

### `/ask` - Text-based Q&A
**POST** `/ask`
```json
{
  "question": "What are Aven's loan requirements?",
  "schedule_state": null
}
```

### `/voice-ask` - Voice-based Q&A with Audio
**POST** `/voice-ask`
- Accepts audio file (multipart/form-data)
- Returns transcript, answer, and audio response

### `/stt` - Speech-to-Text Conversion
**POST** `/stt`
- Accepts audio file
- Returns transcript

### `/tts` - Text-to-Speech Conversion
**POST** `/tts`
```json
{
  "text": "Hello, how can I help you?",
  "voice": "alloy"
}
```

### `/schedule-support-call` - Call Scheduling
**POST** `/schedule-support-call`
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "datetime": "2025-01-15T14:00:00-05:00",
  "phone": "+1234567890",
  "notes": "General inquiry"
}
```

### `/available-times` - Get Available Time Slots
**GET** `/available-times`
- Returns list of available appointment times

### `/health` - Health Check
**GET** `/health`
- Returns server status and timestamp