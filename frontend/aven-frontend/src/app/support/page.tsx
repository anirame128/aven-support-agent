'use client';
import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from "react-markdown";
import styles from './Support.module.css';

// Define the Message type
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
};

export default function SupportPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! Ask me anything about Aven." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Check microphone support
  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.mediaDevices) {
      setMicSupported(true);
    }
  }, []);
  
  // Auto-scroll for chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Helper to get backend API URL
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  // Text chat handler
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    const userMsg: Message = { role: "user", content: input };
    setMessages((msgs) => [...msgs, userMsg]);
    setInput("");
    setLoading(true);
    
    try {
      const res = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: input })
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      setMessages((msgs) => [
        ...msgs,
        { 
          role: "assistant", 
          content: data.answer, 
          sources: data.sources 
        } as Message
      ]);
    } catch (err) {
      console.error('Error sending message:', err);
      setMessages((msgs) => [
        ...msgs,
        { 
          role: "assistant", 
          content: "Sorry, there was an error connecting to the server." 
        } as Message
      ]);
    }
    
    setLoading(false);
  };

  // Start voice recording using MediaRecorder
  const startRecording = async () => {
    if (!micSupported) {
      alert('Microphone access is not supported in your browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 44100,
          channelCount: 1
        } 
      });
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processVoiceInput(audioBlob);
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      setVoiceTranscript('');
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  // Stop voice recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Process voice input through OpenAI STT and TTS
  const processVoiceInput = async (audioBlob: Blob) => {
    setLoading(true);
    
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      // Send to voice-ask endpoint for complete pipeline
      const response = await fetch(`${API_URL}/voice-ask`, {
        method: "POST",
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Parse JSON response
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const { transcript, answer, sources, audio_data } = data;
      
      // Update transcript display
      setVoiceTranscript(transcript);
      
      // Add messages to chat
      const userMsg: Message = { role: "user", content: transcript };
      const assistantMsg: Message = { 
        role: "assistant", 
        content: answer, 
        sources: sources 
      };
      
      setMessages((msgs) => [...msgs, userMsg, assistantMsg]);
      
      // Convert base64 audio to blob and play
      const audioBytes = Uint8Array.from(atob(audio_data), c => c.charCodeAt(0));
      const responseAudioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(responseAudioBlob);
      
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.onended = () => {
          setIsPlaying(false);
          URL.revokeObjectURL(audioUrl);
        };
        audioRef.current.onplay = () => setIsPlaying(true);
        await audioRef.current.play();
      }
      
    } catch (error) {
      console.error('Error processing voice input:', error);
      const errorMsg = "Sorry, there was an error processing your voice input.";
      setMessages((msgs) => [
        ...msgs,
        { 
          role: "assistant", 
          content: errorMsg 
        } as Message
      ]);
    }
    
    setLoading(false);
  };

  // Toggle recording
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Stop audio playback
  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  return (
    <div className={styles.supportPage}>
      <div className={styles.container}>
        {/* Header Section */}
        <div className={styles.row}>
          <div className={styles.col12}>
            <div className={styles.headerSection}>
              <div className={styles.small}>SUPPORT</div>
              <h2 className={styles.heading}>How can we help?</h2>
            </div>
          </div>
        </div>

        {/* Support Agent Section */}
        <div className={styles.row}>
          <div className={styles.col12}>
            <div className={styles.agentContainer}>
              <div className={styles.agentWrapper}>
                {/* Chat container */}
                <div className={styles.chatContainer} ref={chatContainerRef}>
                  {messages.map((msg, i) => (
                    <div 
                      key={i} 
                      className={`${styles.message} ${msg.role === "user" ? styles.userMessage : styles.assistantMessage}`}
                    >
                      <div className={styles.messageBubble}>
                        {msg.role === "assistant" ? (
                          <div className={styles.markdownContent}>
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ) : (
                          msg.content
                        )}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className={styles.sources}>
                            Sources: {msg.sources.filter(Boolean).map((src, j) => (
                              <a 
                                key={j} 
                                href={src} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className={styles.sourceLink}
                              >
                                [{j + 1}]
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className={styles.loadingMessage}>
                      <div className={styles.loadingBubble}>
                        <span>Aven is thinking...</span>
                      </div>
                    </div>
                  )}
                </div>
                {/* Input form with mic and send button */}
                <form onSubmit={sendMessage} className={styles.inputForm}>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="Ask a question about Aven..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                  <button
                    type="button"
                    className={styles.voiceButton + (isRecording ? ' ' + styles.recording : '')}
                    onClick={toggleRecording}
                    disabled={loading || !micSupported}
                    title={isRecording ? "Stop recording" : "Start recording"}
                    aria-label={isRecording ? "Stop recording" : "Start recording"}
                  >
                    {/* Mic SVG icon */}
                    <svg className={styles.voiceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="22" x2="12" y2="18" />
                    </svg>
                  </button>
                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={loading || !input.trim()}
                    aria-label="Send"
                  >
                    {/* Arrow icon */}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                </form>
                {/* Hidden audio element for playback */}
                <audio ref={audioRef} style={{ display: 'none' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}