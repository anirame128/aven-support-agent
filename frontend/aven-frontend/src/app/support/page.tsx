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

// Add ScheduleState type

type ScheduleState = {
  active: boolean;
  stage: "offered" | "selecting-time" | "collecting-info" | "confirming" | "done" | "cancelled";
  selectedTime?: string;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
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

  // Helper: parse yes/no
  const isYes = (msg: string) => /^(yes|yep|sure|ok|yeah|y)$/i.test(msg.trim());
  const isNo = (msg: string) => /^(no|nope|nah|n)$/i.test(msg.trim());

  // Helper: parse email
  const isEmail = (str: string) => /\S+@\S+\.\S+/.test(str);
  // Helper: parse phone
  const isPhone = (str: string) => /\d{3}[\s-]?\d{3}[\s-]?\d{4}/.test(str);

  // Text chat handler
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Scheduling flow interception
    if (scheduleState && scheduleState.active) {
      await handleSchedulingFlow(input.trim());
      setInput("");
      return;
    }

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
      // Scheduling trigger
      if (data.trigger_schedule) {
        setScheduleState({ active: true, stage: "offered" });
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

  // Scheduling flow handler
  const handleSchedulingFlow = async (userInput: string) => {
    // Step through the stages
    if (!scheduleState) return;
    if (scheduleState.stage === "offered") {
      if (isYes(userInput)) {
        // Fetch available times
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: "Fetching available times..." }
        ]);
        const times = await fetch(`${API_URL}/available-times`).then(res => res.json());
        setScheduleState({ ...scheduleState, stage: "selecting-time" });
        setMessages(msgs => [
          ...msgs,
          {
            role: "assistant",
            content: `Here are some available times:\n\n${(times.available_times || []).slice(0, 5).map((t: string) => `- ${new Date(t).toLocaleString()}`).join('\n')}\n\nPlease reply with your preferred time.`
          }
        ]);
      } else if (isNo(userInput)) {
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: "No problem! If you change your mind, just let me know." }
        ]);
        setScheduleState(null);
      } else {
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: "Would you like me to help you schedule a call with Aven's support team? (Yes or No)" }
        ]);
      }
    } else if (scheduleState.stage === "selecting-time") {
      // Try to parse a valid ISO time from user input
      const times = await fetch(`${API_URL}/available-times`).then(res => res.json());
      const allTimes: string[] = times.available_times || [];
      let selectedISO = allTimes.find(t => {
        const local = new Date(t).toLocaleString().toLowerCase();
        return userInput.toLowerCase().includes(local.toLowerCase());
      });
      if (!selectedISO) {
        // Try direct ISO match
        selectedISO = allTimes.find(t => userInput.includes(t));
      }
      if (!selectedISO) {
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: "Sorry, I couldn't match that to an available time. Please copy-paste or re-type your preferred time from the list above." }
        ]);
        return;
      }
      setScheduleState(prev => ({ ...prev!, stage: "collecting-info", selectedTime: selectedISO }));
      setMessages(msgs => [
        ...msgs,
        {
          role: "assistant",
          content: "Great! Please provide the following details:\n\n- Full Name\n- Email\n- Phone Number\n- Any additional notes (optional)\n\nYou can send all at once or one by one."
        }
      ]);
    } else if (scheduleState.stage === "collecting-info") {
      // Parse info
      let { name, email, phone, notes } = scheduleState;
      const lines = userInput.split(/\n|,|;/).map(l => l.trim());
      for (const line of lines) {
        if (!name && line.split(' ').length >= 2 && !isEmail(line) && !isPhone(line)) name = line;
        if (!email && isEmail(line)) email = line;
        if (!phone && isPhone(line)) phone = line;
        if (!notes && line.toLowerCase().includes('note')) notes = line;
      }
      // Fallback: try to parse all at once
      if (!name && !email && !phone && lines.length === 3) {
        [name, email, phone] = lines;
      }
      setScheduleState(prev => ({ ...prev!, name, email, phone, notes }));
      if (name && email && phone) {
        setScheduleState(prev => ({ ...prev!, stage: "confirming" }));
        setMessages(msgs => [
          ...msgs,
          {
            role: "assistant",
            content: `Just to confirm:\n\n- Time: ${new Date(scheduleState.selectedTime!).toLocaleString()}\n- Name: ${name}\n- Email: ${email}\n- Phone: ${phone}\n- Notes: ${notes || "None"}\n\nShould I go ahead and schedule this? (Yes/No)`
          }
        ]);
      } else {
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: `Missing info. Please provide your${!name ? ' name,' : ''}${!email ? ' email,' : ''}${!phone ? ' phone,' : ''}`.replace(/,$/, ".") }
        ]);
      }
    } else if (scheduleState.stage === "confirming") {
      if (isYes(userInput)) {
        // Schedule the call
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: "Scheduling your call..." }
        ]);
        await fetch(`${API_URL}/schedule-support-call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: scheduleState.name,
            email: scheduleState.email,
            datetime: scheduleState.selectedTime,
            phone: scheduleState.phone || "",
            notes: scheduleState.notes || ""
          }),
        });
        setMessages(msgs => [
          ...msgs,
          {
            role: "assistant",
            content: "✅ Your call is scheduled! An email has been sent to your inbox. Is there anything else I can help with?"
          }
        ]);
        setScheduleState(null);
      } else if (isNo(userInput)) {
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: "No problem! If you change your mind, just let me know." }
        ]);
        setScheduleState(null);
      } else {
        setMessages(msgs => [
          ...msgs,
          { role: "assistant", content: "Should I go ahead and schedule this? (Yes/No)" }
        ]);
      }
    }
  };

  // Scheduling flow: offer prompt when triggered
  useEffect(() => {
    if (scheduleState?.stage === "offered") {
      setMessages(msgs => [
        ...msgs,
        {
          role: "assistant",
          content: "Would you like me to help you schedule a call with Aven's support team? (Yes or No)"
        }
      ]);
    }
  }, [scheduleState?.stage]);

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