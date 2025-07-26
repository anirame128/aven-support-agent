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

// ScheduleState type
type ScheduleState = {
  active: boolean;
  stage: "offering_schedule" | "awaiting_time" | "awaiting_contact" | "confirming" | "done" | "cancelled";
  selectedTime?: string;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  available_times?: string[];
  chosen_time?: string;
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
  const [scheduleState, setScheduleState] = useState<ScheduleState | null>(null);
  
  // Voice recording refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingActiveRef = useRef(false);
  const hasSpokenRef = useRef(false);
  
  // Check microphone support
  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.mediaDevices) {
      setMicSupported(true);
      
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        console.warn("⚠️ Microphone access requires HTTPS. Voice features may not work on HTTP.");
      }
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

  // Helper: parse yes/no
  const isYes = (msg: string) => /^(yes|yep|sure|ok|yeah|y)$/i.test(msg.trim());
  const isNo = (msg: string) => /^(no|nope|nah|n)$/i.test(msg.trim());

  // Helper: parse email
  const isEmail = (str: string) => /\S+@\S+\.\S+/.test(str);
  // Helper: parse phone
  const isPhone = (str: string) => /\d{3}[\s-]?\d{3}[\s-]?\d{4}/.test(str);

  // Detect silence and stop recording
  const detectSilence = (analyser: AnalyserNode, mediaRecorder: MediaRecorder) => {
    const data = new Uint8Array(analyser.fftSize);
    let silenceStart: number | null = null;
    const silenceDelay = 1500; // 1.5 seconds of silence
    const voiceThreshold = 8;

    const check = () => {
      if (!isRecordingActiveRef.current) return;
      
      analyser.getByteTimeDomainData(data);
      const max = Math.max(...data.map(v => Math.abs(v - 128)));

      if (max >= voiceThreshold) {
        // User is speaking
        hasSpokenRef.current = true;
        silenceStart = null;
      } else if (hasSpokenRef.current && max < voiceThreshold) {
        // User has spoken and is now silent
        if (!silenceStart) silenceStart = Date.now();
        else if (Date.now() - silenceStart > silenceDelay) {
          console.log("🔇 Silence detected after speech — stopping recording");
          stopRecording();
          return;
        }
      }

      if (isRecordingActiveRef.current) {
        requestAnimationFrame(check);
      }
    };

    requestAnimationFrame(check);
  };

  // Text chat handler
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((msgs) => [...msgs, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const requestBody: { question: string; schedule_state?: ScheduleState } = { question: input };
      
      // Add schedule state if we're in a scheduling flow
      if (scheduleState && scheduleState.active) {
        requestBody.schedule_state = scheduleState;
      }
      
      const res = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setMessages((msgs) => [
        ...msgs,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources
        } as Message
      ]);
      
      // Update schedule state from response
      if (data.schedule_state !== undefined) {
        setScheduleState(data.schedule_state);
      }
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

  // Scheduling flow handler - now handled by backend
  const handleSchedulingFlow = async (userInput: string) => {
    // This is now handled by the backend via the /ask endpoint
    // The backend will process the scheduling flow and return the appropriate response
    console.log("📋 Scheduling flow handled by backend for input:", userInput);
  };

  // Start voice recording
  const startRecording = async () => {
    if (!micSupported) {
      alert("Microphone access is not supported in your browser.");
      return;
    }

    if (isRecordingActiveRef.current) {
      console.log("🔇 Already recording, skipping start");
      return;
    }

    // 🔁 Ensure loop is active when starting recording
    isRecordingActiveRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 44100,
          channelCount: 1,
        },
      });

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          await processVoiceInput(audioBlob);
        }

        // Clean up audio nodes
        stream.getTracks().forEach((track) => track.stop());
        sourceRef.current?.disconnect();
        analyserRef.current?.disconnect();
      };

      mediaRecorder.start();
      setIsRecording(true);
      hasSpokenRef.current = false;
      setVoiceTranscript("");

      // Interrupt any playing audio when starting to record
      interruptAudio();

      // Begin silence detection loop
      detectSilence(analyser, mediaRecorder);

    } catch (error) {
      console.error("Error accessing microphone:", error);
      
      // 🔧 Reset recording state on error
      setIsRecording(false);
      isRecordingActiveRef.current = false;
      
      let errorMsg = "Could not access microphone. Please check permissions.";
      
      if (error instanceof Error) {
        if (error.name === "NotAllowedError" || error.message.includes("permission")) {
          errorMsg = "Microphone access was denied. Please allow microphone permissions in your browser settings and try again.";
        } else if (error.name === "NotSupportedError") {
          errorMsg = "Microphone access is not supported in your browser. Please try a different browser.";
        } else if (error.message.includes("not allowed")) {
          errorMsg = "Voice recording is not allowed. Please ensure you're using HTTPS and check your browser settings.";
        }
      }
      
      alert(errorMsg);
    }
  };

  // Stop voice recording
  const stopRecording = () => {
    console.log("🛑 Stopping recording");
    isRecordingActiveRef.current = false;
    
    // 🔧 Guard against double stop calls
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.warn("🔇 MediaRecorder stop error:", error);
      }
    }
    setIsRecording(false);
  };

  // Process voice input through backend
  const processVoiceInput = async (audioBlob: Blob) => {
    console.log("🎤 Processing voice input...");
    setLoading(true);
    
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      // Add schedule state if we're in a scheduling flow
      if (scheduleState && scheduleState.active) {
        formData.append('schedule_state', JSON.stringify(scheduleState));
      }
      
      // Send to voice-ask endpoint
      const response = await fetch(`${API_URL}/voice-ask`, {
        method: "POST",
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const { transcript, answer, sources, audio_data, schedule_state: newScheduleState } = data;
      
      console.log("🎤 Received transcript:", transcript);
      console.log("📋 Received schedule_state:", newScheduleState);
      console.log("🔊 Received audio_data length:", audio_data ? audio_data.length : 0);
      
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
      
      // Update schedule state from voice response
      if (newScheduleState !== undefined) {
        setScheduleState(newScheduleState);
      }
      
      // Play audio response if available
      if (audio_data) {
        console.log("🔊 Playing audio response...");
        const audioBytes = Uint8Array.from(atob(audio_data), c => c.charCodeAt(0));
        const responseAudioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(responseAudioBlob);
        
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          audioRef.current.onended = () => {
            console.log("🔊 Audio playback ended");
            setIsPlaying(false);
            URL.revokeObjectURL(audioUrl);
            
            // 🔁 Restart voice loop after audio ends
            if (isRecordingActiveRef.current) {
              console.log("🔁 Restarting voice loop after audio playback");
              startRecording();
            }
          };
          audioRef.current.onplay = () => {
            console.log("🔊 Audio playback started");
            setIsPlaying(true);
          };
          
          try {
            await audioRef.current.play();
          } catch (playError) {
            console.warn("🔇 Audio playback blocked by browser:", playError);
            
            // 🔁 Restart voice loop if audio playback fails
            if (isRecordingActiveRef.current) {
              console.log("🔁 Restarting voice loop after audio playback failure");
              startRecording();
            }
          }
        } else {
          // 🔁 Restart voice loop if no audio ref
          if (isRecordingActiveRef.current) {
            console.log("🔁 Restarting voice loop (no audio ref)");
            startRecording();
          }
        }
      } else {
        // 🔁 Restart voice loop if no audio data
        if (isRecordingActiveRef.current) {
          console.log("🔁 Restarting voice loop (no audio data)");
          startRecording();
        }
      }
      
    } catch (error) {
      console.error('Error processing voice input:', error);
      
      let errorMsg = "Sorry, there was an error processing your voice input.";
      
      if (error instanceof Error) {
        if (error.message.includes("permission") || error.message.includes("denied")) {
          errorMsg = "Microphone access is required for voice interaction. Please allow microphone permissions in your browser and try again.";
        } else if (error.message.includes("not allowed")) {
          errorMsg = "Voice recording is not allowed. Please check your browser settings and ensure you're using HTTPS.";
        } else {
          errorMsg = `Sorry, there was an error processing your voice input: ${error.message}`;
        }
      }
      
      setMessages((msgs) => [
        ...msgs,
        { 
          role: "assistant", 
          content: errorMsg 
        } as Message
      ]);
      
      // 🔁 Always restart voice loop after any error
      if (isRecordingActiveRef.current) {
        console.log("🔁 Restarting voice loop after error");
        startRecording();
      }
    }
    
    setLoading(false);
  };

  // Toggle recording
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      // 🔧 Prevent double recording by checking active state
      if (!isRecordingActiveRef.current) {
        startRecording();
      } else {
        console.log("🔇 Recording already active, ignoring toggle");
      }
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

  // Interrupt audio playback when user starts speaking
  const interruptAudio = () => {
    if (isPlaying && audioRef.current) {
      console.log("🔇 Interrupting audio playback");
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
                        {msg.sources && msg.sources.length > 0 && !msg.content.includes("I'm not sure about that") && (
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
                    {/* Mic SVG icon when not recording, Stop icon when recording */}
                    {isRecording ? (
                      <svg className={styles.voiceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                      </svg>
                    ) : (
                      <svg className={styles.voiceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="22" x2="12" y2="18" />
                      </svg>
                    )}
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