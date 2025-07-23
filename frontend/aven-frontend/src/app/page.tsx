"use client";
import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import Vapi from '@vapi-ai/web';

// Define the Message type
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
};

export default function Home() {
  const VapiRef = useRef<Vapi | null>(null);
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! Ask me anything about Aven." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [inactivityTimer, setInactivityTimer] = useState<NodeJS.Timeout | null>(null);
  const [autoStopEnabled, setAutoStopEnabled] = useState(true);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID!;



  useEffect(() => {
    if (!VapiRef.current && typeof window !== 'undefined') {
      VapiRef.current = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_API_KEY!);
    }
  }, []);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg: Message = { role: "user", content: input };
    setMessages((msgs) => [...msgs, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: input })
      });
      const data = await res.json();
      setMessages((msgs) => [
        ...msgs,
        { role: "assistant", content: data.answer, sources: data.sources } as Message
      ]);
    } catch (err) {
      setMessages((msgs) => [
        ...msgs,
        { role: "assistant", content: "Sorry, there was an error." } as Message
      ]);
    }
    setLoading(false);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  // Auto-stop function
  const stopVoiceSession = () => {
    setIsRecording(false);
    setIsThinking(false);
    setIsAssistantSpeaking(false);
    setIsProcessingSpeech(false);
    setVoiceLoading(false);
    setCurrentTranscript("");
    setErrorMessage("");
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      setInactivityTimer(null);
    }
    VapiRef.current?.stop();
  };

  // Reset inactivity timer
  const resetInactivityTimer = () => {
    if (!autoStopEnabled) return; // Skip if auto-stop is disabled
    
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    // Auto-stop after 2 minutes of inactivity (more lenient)
    const timer = setTimeout(() => {
      console.log('Auto-stopping voice session due to inactivity');
      stopVoiceSession();
    }, 120000); // 2 minutes
    setInactivityTimer(timer);
  };

  // Enhanced voice handler with better state management
  const handleVoice = async () => {
    if (isRecording) {
      // Stop recording
      stopVoiceSession();
      return;
    }

    // Check microphone permissions first
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop the test stream
    } catch (err) {
      console.error('Microphone permission denied:', err);
      alert('Please enable microphone access to use voice chat.');
      return;
    }

    // Start recording
    setVoiceLoading(true);
    setIsRecording(true);
    setCurrentTranscript("");
    setErrorMessage(""); // Clear any previous errors
    resetInactivityTimer(); // Start inactivity timer
    const vapi = VapiRef.current!;

    // Set up event listeners
    vapi.on('call-start', () => {
      console.log('Voice call started');
      setVoiceLoading(false);
    });

    vapi.on('call-end', () => {
      console.log('Voice call ended');
      stopVoiceSession();
    });

    vapi.on('error', (err) => {
      console.error('Vapi SDK Error:', err);
      console.error('Error details:', {
        message: err.message,
        code: err.code,
        type: err.type,
        stack: err.stack
      });
      
      // Handle specific error types
      if (err.message && err.message.includes('ejection')) {
        console.log('Voice session was terminated by server');
        setErrorMessage("Voice session ended. Please try again.");
      } else if (err.message && err.message.includes('network')) {
        console.log('Network connection issue');
        setErrorMessage("Network connection issue. Please check your internet.");
      } else if (err.message && err.message.includes('authentication') || err.message && err.message.includes('unauthorized')) {
        console.log('Authentication error - check API key');
        setErrorMessage("Authentication error. Please check your API configuration.");
      } else if (err.message && err.message.includes('rate limit')) {
        console.log('Rate limit exceeded');
        setErrorMessage("Too many requests. Please wait a moment and try again.");
      } else {
        setErrorMessage("Voice chat error. Please try again.");
      }
      
      stopVoiceSession();
    });

    vapi.on('speech-start', () => {
      console.log('User started speaking');
      resetInactivityTimer(); // Reset timer when user speaks
    });

    vapi.on('speech-end', async () => {
      console.log('User stopped speaking');
      
      // Prevent multiple processing
      if (isProcessingSpeech) {
        console.log('Already processing speech, skipping...');
        return;
      }
      
      setIsProcessingSpeech(true);
      setIsThinking(true);
      resetInactivityTimer();

      // Get transcript and call backend
      const transcript = currentTranscript.trim();
      if (!transcript) {
        setIsThinking(false);
        setIsProcessingSpeech(false);
        return;
      }

      try {
        const res = await fetch("http://127.0.0.1:8000/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: transcript })
        });
        const data = await res.json();

        // Speak the response
        await vapi.say(data.answer, false);

        // Add to text chat panel
        setMessages(msgs => [...msgs, { role: "assistant", content: data.answer, sources: data.sources }]);

      } catch (err) {
        console.error('Backend request failed:', err);
        await vapi.say("Sorry, I ran into an issue while looking that up.", false);
      }

      // Cleanup
      setCurrentTranscript("");
      setIsThinking(false);
      setIsProcessingSpeech(false);
    });

    // Add more event listeners to prevent premature stopping
    vapi.on('volume-level', () => {
      resetInactivityTimer(); // Reset timer on any audio activity
    });

    vapi.on('call-start', () => {
      console.log('Voice call started');
      setVoiceLoading(false);
      resetInactivityTimer(); // Reset timer when call starts
    });

    vapi.on('message', (msg) => {
      console.log('Vapi message:', msg);
      if (msg.type === 'transcript' && msg.role === 'user') {
        setCurrentTranscript(msg.transcript || "");
        resetInactivityTimer(); // Reset timer when user speaks
      }
      if (msg.type === 'assistant' && msg.role === 'assistant') {
        setIsThinking(false);
        resetInactivityTimer(); // Reset timer when assistant responds
      }
      // When assistant starts speaking, stop thinking state and show speaking
      if (msg.type === 'speech-start' && msg.role === 'assistant') {
        setIsThinking(false);
        setIsAssistantSpeaking(true);
        resetInactivityTimer(); // Reset timer when assistant speaks
      }
      // When assistant stops speaking
      if (msg.type === 'speech-end' && msg.role === 'assistant') {
        setIsAssistantSpeaking(false);
        resetInactivityTimer(); // Reset timer when assistant stops speaking
      }
      // Reset timer for any message activity
      if (msg.type && msg.role) {
        resetInactivityTimer();
      }
    });

    try {
      await vapi.start(VAPI_ASSISTANT_ID);
    } catch (err) {
      console.error('vapi.start() failed:', err);
      stopVoiceSession();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-xl glass flex flex-col h-[600px] border border-gray-200 overflow-hidden">
        {/* Mode Toggle */}
        <div className="flex justify-center gap-4 p-2">
          <button
            className={`px-4 py-2 rounded transition-colors ${mode === 'text' ? 'bg-gray-300' : 'bg-gray-100'}`}
            onClick={() => setMode('text')}
          >
            Text Chat
          </button>
          <button
            className={`px-4 py-2 rounded transition-colors ${mode === 'voice' ? 'bg-gray-300' : 'bg-gray-100'}`}
            onClick={() => setMode('voice')}
          >
            Voice Chat
          </button>
        </div>
        
        {/* Only show chat UI in text mode */}
        {mode === 'text' && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`text-sm ${msg.role === "user" ? "text-right" : "text-left"}`}>
                  <div className={`inline-block px-3 py-2 bubble`}>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 text-xs text-gray-500">
                        Sources: {msg.sources.filter(Boolean).map((src: string, j: number) => (
                          <a key={j} href={src} target="_blank" rel="noopener noreferrer" className="underline mr-1">[{j+1}]</a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 px-4 py-3 rounded-2xl loading-bg shadow-md text-base animate-fade-in">
                    <svg className="animate-spin h-6 w-6 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                    </svg>
                    <span className="ml-2">Aven is thinking…</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={sendMessage} className="flex p-2 glass">
              <input
                className="flex-1 px-3 py-2 rounded-lg input-grey text-black focus:outline-none focus:ring-2 focus:ring-gray-400"
                type="text"
                placeholder="Ask a question about Aven..."
                value={input}
                onChange={e => setInput(e.target.value)}
                disabled={loading}
                autoFocus
              />
              <button
                type="submit"
                className="ml-2 px-4 py-2 rounded-lg btn-black disabled:opacity-50"
                disabled={loading || !input.trim()}
              >
                Send
              </button>
            </form>
          </>
        )}
        
        {/* Enhanced Voice mode UI */}
        {mode === 'voice' && (
          <div className="flex flex-col items-center justify-center flex-1 p-4">
            {/* Error Message Display */}
            {errorMessage && (
              <div className="w-full max-w-md bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <div className="text-sm text-red-600">{errorMessage}</div>
              </div>
            )}

            {/* Voice Control Button - Centered and Larger */}
            <button
              onClick={handleVoice}
              disabled={voiceLoading}
              className={`
                relative w-32 h-32 rounded-full flex items-center justify-center text-white font-medium
                transition-all duration-300 transform hover:scale-105 active:scale-95
                ${isRecording 
                  ? 'bg-black hover:bg-gray-800 shadow-lg shadow-gray-200' 
                  : 'bg-gray-700 hover:bg-gray-800 shadow-lg shadow-gray-200'
                }
                ${voiceLoading ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {/* Recording Animation */}
              {isRecording && (
                <div className="absolute inset-0 rounded-full border-4 border-gray-400 animate-ping"></div>
              )}
              
              {/* Icon - Larger */}
              {voiceLoading ? (
                <svg className="animate-spin h-12 w-12" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                </svg>
              ) : isRecording ? (
                <svg className="h-12 w-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z"/>
                </svg>
              ) : (
                <svg className="h-12 w-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3z"/>
                  <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
