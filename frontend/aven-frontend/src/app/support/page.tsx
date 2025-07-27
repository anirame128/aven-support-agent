'use client';
import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from "react-markdown";
import styles from './Support.module.css';

// Web Speech API types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any;
  }
}

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
  // const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [scheduleState, setScheduleState] = useState<ScheduleState | null>(null);
  const scheduleStateRef = useRef<ScheduleState | null>(null);
  
  // Voice recording refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isRecordingActiveRef = useRef(false);
  const hasSpokenRef = useRef(false);
  const restartInProgressRef = useRef(false);
  const isManualStopRef = useRef(false);
  const audioEnabledRef = useRef(false);
  
  // Web Speech API refs
  const speechRecognitionRef = useRef<Window['webkitSpeechRecognition'] | null>(null);
  const isSpeechRecognitionSupported = useRef(false);
  const browserSTTRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Helper function to safely restart recording loop
  const safelyRestartRecording = () => {
    console.log("🧪 Restart check — isRecordingActiveRef:", isRecordingActiveRef.current, "mediaRecorder.state:", mediaRecorderRef.current?.state);
    
    if (!isRecordingActiveRef.current) {
      console.log("⛔ Recording loop manually stopped by user");
      return;
    }

    if (restartInProgressRef.current) {
      console.log("⏳ Restart already in progress, skipping...");
      return;
    }

    restartInProgressRef.current = true;
    console.log("🔁 Restarting recording loop...");
    
    // Delay slightly to ensure previous stop cleanup completes
    setTimeout(() => {
      startRecording().finally(() => {
        restartInProgressRef.current = false;
      });
    }, 200);
  };

  // Initialize audio context and enable audio
  const initializeAudio = async () => {
    try {
      // Create audio context if it doesn't exist
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
        console.log("🔊 Audio context created");
      }

      // Resume audio context if suspended
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
        console.log("🔊 Audio context resumed");
      }

      // Create a silent audio buffer to "prime" the audio system
      const buffer = audioContextRef.current.createBuffer(1, 1, 22050);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.start(0);
      source.stop(0.001);

      audioEnabledRef.current = true;
      setAudioEnabled(true);
      setAudioBlocked(false);
      console.log("🔊 Audio system initialized and enabled");
    } catch (error) {
      console.warn("🔇 Failed to initialize audio:", error);
    }
  };
  
  // Check microphone and speech recognition support
  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.mediaDevices) {
      setMicSupported(true);
      
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        console.warn("⚠️ Microphone access requires HTTPS. Voice features may not work on HTTP.");
      }
    }
    
    // Check for Web Speech API support
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      if (SpeechRecognition) {
        isSpeechRecognitionSupported.current = true;
        console.log("✅ Web Speech API supported");
      } else {
        console.warn("⚠️ Web Speech API not supported, will use fallback");
      }
    }
  }, []);
  
  // Auto-scroll for chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Debug scheduleState changes
  useEffect(() => {
    console.log("📋 scheduleState changed:", scheduleState);
    scheduleStateRef.current = scheduleState;
  }, [scheduleState]);

  // Initialize audio on first user interaction
  useEffect(() => {
    const handleFirstClick = () => {
      if (!audioEnabledRef.current) {
        console.log("🔊 Enabling audio on global click");
        initializeAudio();
      }
      window.removeEventListener('click', handleFirstClick);
    };

    window.addEventListener('click', handleFirstClick);

    return () => window.removeEventListener('click', handleFirstClick);
  }, []);

  // Helper to get backend API URL
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  // Helper: parse yes/no (unused - handled by backend)
  // const isYes = (msg: string) => /^(yes|yep|sure|ok|yeah|y)$/i.test(msg.trim());
  // const isNo = (msg: string) => /^(no|nope|nah|n)$/i.test(msg.trim());

  // Helper: parse email (unused - handled by backend)
  // const isEmail = (str: string) => /\S+@\S+\.\S+/.test(str);
  // Helper: parse phone (unused - handled by backend)
  // const isPhone = (str: string) => /\d{3}[\s-]?\d{3}[\s-]?\d{4}/.test(str);

  // Detect silence and stop recording
  const detectSilence = (analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.fftSize);
    let silenceStart: number | null = null;
    const silenceDelay = 1500; // 1.5 seconds of silence
    const voiceThreshold = 10; // Increased from 8 for better sensitivity
    const minSpeakingTime = 2000; // 2 seconds before silence allowed to trigger stop
    const recordingStartTime = Date.now();

    const check = () => {
      if (!isRecordingActiveRef.current) return;
      
      analyser.getByteTimeDomainData(data);
      const max = Math.max(...data.map(v => Math.abs(v - 128)));
      const elapsedTime = Date.now() - recordingStartTime;

      if (max >= voiceThreshold) {
        // User is speaking
        hasSpokenRef.current = true;
        silenceStart = null;
        console.log("🎙️ User is speaking");
      } else if (hasSpokenRef.current && max < voiceThreshold) {
        // User has spoken and is now silent
        if (!silenceStart) silenceStart = Date.now();
        else if (Date.now() - silenceStart > silenceDelay && elapsedTime > minSpeakingTime) {
          console.log("🔇 Silence detected after speech — stopping current recording");
          stopCurrentRecording();
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
    if (!input.trim() || loading) return;

    // Enable audio on any user interaction
    if (!audioEnabledRef.current) {
      console.log("🔊 Enabling audio on text input");
      initializeAudio();
    }

    const userMsg: Message = { role: "user", content: input };
    setMessages((msgs) => [...msgs, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const requestBody: { question: string; schedule_state?: ScheduleState | null } = { question: input };
      
      // Add schedule state if we're in a scheduling flow
      if (scheduleState && scheduleState.active) {
        console.log("📋 Adding schedule_state to text request:", scheduleState);
        requestBody.schedule_state = scheduleState;
      } else {
        console.log("📋 No active scheduleState for text request");
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
        console.log("📋 Updating scheduleState from text response:", data.schedule_state);
        setScheduleState(data.schedule_state);
      } else {
        console.log("📋 No new scheduleState in text response");
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

  // Scheduling flow handler - now handled by backend (unused)
  // const handleSchedulingFlow = async (userInput: string) => {
  //   // This is now handled by the backend via the /ask endpoint
  //   // The backend will process the scheduling flow and return the appropriate response
  //   console.log("📋 Scheduling flow handled by backend for input:", userInput);
  // };

  // Start browser speech recognition
  const startBrowserSTT = () => {
    if (!isSpeechRecognitionSupported.current) {
      console.log("⚠️ Browser STT not supported, falling back to MediaRecorder");
      return false;
    }

    // Don't start if already active
    if (speechRecognitionRef.current) {
      console.log("🎤 Browser STT already active, skipping start");
      return true;
    }
    
    // Clear any stale refs to prevent stuck states
    if (speechRecognitionRef.current === null && isRecording) {
      console.log("🎤 Clearing stale recording state");
      setIsRecording(false);
    }

    try {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      
      recognition.onstart = () => {
        console.log("🎤 Browser STT started");
        setIsRecording(true);
      };
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = async (event: any) => {
        const transcript = event.results[0][0].transcript;
        console.log("🎤 Browser STT transcript:", transcript);
        
        if (transcript && transcript.trim().length > 0) {
          await processVoiceInputWithBrowserSTT(transcript);
        }
      };
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        console.error("🎤 Browser STT error:", event.error);
        
        // Clear the ref since this instance has failed
        speechRecognitionRef.current = null;
        setIsRecording(false);
        
        if (event.error === 'no-speech') {
          console.log("🎤 No speech detected");
        } else if (event.error === 'aborted') {
          console.log("🎤 Browser STT aborted - this is expected when stopping");
          // Don't restart if it was aborted (manually stopped)
          return;
        } else if (event.error === 'not-allowed') {
          console.log("🎤 Browser STT not allowed - microphone permission denied");
          // Don't restart if permission is denied
          isRecordingActiveRef.current = false; // Stop the recording loop
          return;
        }
        
        // For other errors, don't restart immediately to avoid loops
        console.log("🎤 Browser STT error - not restarting to avoid loops");
      };
      
      recognition.onend = () => {
        console.log("🎤 Browser STT ended");
        setIsRecording(false);
        
        // Clear the ref since this instance has ended
        speechRecognitionRef.current = null;
        
        // Clear any pending restart timeout
        if (browserSTTRestartTimeoutRef.current) {
          clearTimeout(browserSTTRestartTimeoutRef.current);
          browserSTTRestartTimeoutRef.current = null;
        }
        
        // Don't restart if manually stopped
        if (isManualStopRef.current) {
          console.log("🎤 Manual stop detected - not restarting browser STT");
          return;
        }
        
        // Only restart immediately if no audio is playing
        if (isRecordingActiveRef.current) {
          if (!audioRef.current || audioRef.current.ended || audioRef.current.paused) {
            browserSTTRestartTimeoutRef.current = setTimeout(() => {
              if (isRecordingActiveRef.current && !isManualStopRef.current) {
                console.log("🎤 Restarting browser STT after delay");
                startBrowserSTT();
              }
              browserSTTRestartTimeoutRef.current = null;
            }, 200); // Increased delay to prevent rapid restarts
          } else {
            console.log("⏳ Audio is playing, browser STT will restart when audio finishes");
          }
        }
      };
      
      speechRecognitionRef.current = recognition;
      
      try {
        recognition.start();
        return true;
      } catch (error) {
        console.error("🎤 Browser STT start error:", error);
        // Clear the ref if start fails
        speechRecognitionRef.current = null;
        return false;
      }
    } catch (error) {
      console.error("🎤 Browser STT creation error:", error);
      return false;
    }
  };

  // Start voice recording
  const startRecording = async () => {
    console.log("startRecording() called — isRecordingActive:", isRecordingActiveRef.current, ", isRecording:", isRecording);
    
    if (!micSupported) {
      alert("Microphone access is not supported in your browser.");
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      console.log("🔇 Already recording, skipping start");
      return;
    }

    // 🔁 Ensure loop is active when starting recording
    isRecordingActiveRef.current = true;
    isManualStopRef.current = false; // Reset manual stop flag

    // Enable audio on first user interaction
    if (!audioEnabledRef.current) {
      console.log("🔊 Enabling audio on first user interaction");
      initializeAudio();
    }

    // Try browser STT first if supported
    if (isSpeechRecognitionSupported.current) {
      console.log("🎤 Attempting to use browser STT");
      const browserSTTSuccess = startBrowserSTT();
      if (browserSTTSuccess) {
        return; // Browser STT is handling the recording
      }
      console.log("🎤 Browser STT failed, falling back to MediaRecorder");
      
      // Clear any stale state from failed browser STT
      if (speechRecognitionRef.current === null && isRecording) {
        console.log("🎤 Clearing stale state from failed browser STT");
        setIsRecording(false);
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 44100,
          channelCount: 1,
        },
      });

      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
        // Only process audio if it wasn't a manual stop
        if (!isManualStopRef.current && audioChunksRef.current.length > 0) {
          // Use browser STT if supported, otherwise fall back to backend STT
          if (isSpeechRecognitionSupported.current) {
            console.log("🎤 Using browser STT for processing");
            // Browser STT is handled separately, so we don't process audio here
          } else {
            console.log("🎤 Using backend STT for processing");
            const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
            await processVoiceInput(audioBlob);
          }
        } else if (isManualStopRef.current) {
          console.log("🛑 Manual stop - not processing audio");
        }

        // Clean up audio nodes
        stream.getTracks().forEach((track) => track.stop());
        sourceRef.current?.disconnect();
        analyserRef.current?.disconnect();

        // Reset MediaRecorder reference
        mediaRecorderRef.current = null;

        // Reset manual stop flag
        isManualStopRef.current = false;

        // 🔁 Only restart if recording loop is still active (not manually stopped)
        if (isRecordingActiveRef.current) {
          if (!audioRef.current || audioRef.current.ended || audioRef.current.paused) {
            safelyRestartRecording();
          } else {
            console.log("⏳ Waiting for audio to finish before restarting recording...");
            audioRef.current.onended = null; // Clean up previous listeners
            audioRef.current.onended = () => {
              console.log("🔊 Audio finished — restarting recording...");
              safelyRestartRecording();
            };
          }
        } else {
          console.log("⛔ Recording loop manually stopped - not restarting");
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      hasSpokenRef.current = false;
      // setVoiceTranscript("");

      // Clear restart lock after successful start
      restartInProgressRef.current = false;

      // Interrupt any playing audio when starting to record
      interruptAudio();

      // Begin silence detection loop
      detectSilence(analyser);

    } catch (error) {
      console.error("Error accessing microphone:", error);
      
      // 🔧 Reset recording state on error
      setIsRecording(false);
      isRecordingActiveRef.current = false;
      restartInProgressRef.current = false;
      
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

  // Stop current recording session (for silence detection)
  const stopCurrentRecording = () => {
    console.log("🔇 Stopping current recording session");
    
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

  // Stop voice recording (manually by user)
  const stopRecording = () => {
    console.log("🛑 Stopping recording");
    isRecordingActiveRef.current = false;
    isManualStopRef.current = true; // Mark as manual stop
    restartInProgressRef.current = false; // Prevent any pending restarts
    
    // Clear any pending browser STT restart timeouts
    if (browserSTTRestartTimeoutRef.current) {
      clearTimeout(browserSTTRestartTimeoutRef.current);
      browserSTTRestartTimeoutRef.current = null;
    }
    
    // Stop browser STT if active
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current = null;
      } catch (error) {
        console.warn("🔇 Browser STT stop error:", error);
      }
    }
    
    // Stop any audio that might be playing
    if (audioRef.current && !audioRef.current.paused) {
      console.log("🔇 Stopping audio playback");
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
    
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

  // Process voice input using browser STT
  const processVoiceInputWithBrowserSTT = async (transcript: string) => {
    console.log("🎤 Processing voice input with browser STT...");
    console.log("📋 Current scheduleState before request:", scheduleState);
    console.log("📋 scheduleState type:", typeof scheduleState);
    console.log("📋 scheduleState === null:", scheduleState === null);
    console.log("📋 scheduleStateRef.current:", scheduleStateRef.current);
    setLoading(true);
    
    try {
      // Create request body for text-based processing
      const requestBody: { question: string; schedule_state?: ScheduleState | null } = { question: transcript };
      
      // Add schedule state if we're in a scheduling flow
      const currentScheduleState = scheduleStateRef.current;
      if (currentScheduleState && currentScheduleState.active) {
        console.log("📋 Adding schedule_state to request:", currentScheduleState);
        requestBody.schedule_state = currentScheduleState;
      } else {
        console.log("📋 No active scheduleState, not adding to request");
      }
      
      // Send to ask endpoint (same as text mode)
      const response = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error && data.error !== "Off-topic question") {
        throw new Error(data.error);
      }
      
      const { answer, sources, schedule_state: newScheduleState } = data;
      
      console.log("🎤 Received answer:", answer);
      console.log("📋 Received schedule_state:", newScheduleState);
      
      // Add user message to chat immediately
      const userMsg: Message = { role: "user", content: transcript };
      setMessages((msgs) => [...msgs, userMsg]);
      
      // Update schedule state from response
      if (newScheduleState !== undefined) {
        console.log("📋 Updating scheduleState from response:", newScheduleState);
        setScheduleState(newScheduleState);
      } else {
        console.log("📋 No new scheduleState in response");
      }
      
      // Generate and play audio response first
      await generateAndPlayAudio(answer);
      
      // Add assistant message to chat after audio is generated
      const assistantMsg: Message = { 
        role: "assistant", 
        content: answer, 
        sources: sources 
      };
      setMessages((msgs) => [...msgs, assistantMsg]);
      
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
      
      // 🔁 Only restart loop if recording was active (not just audio playback errors)
      if (isRecordingActiveRef.current) {
        console.log("🔁 Restarting voice loop after error");
        safelyRestartRecording();
      }
    }
    
    setLoading(false);
  };

  // Generate and play audio response
  const generateAndPlayAudio = async (text: string) => {
    try {
      console.log("🔊 Generating audio for:", text);
      
      const response = await fetch(`${API_URL}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      if (audioRef.current) {
        // 🧹 Clear previous playback and listeners
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = ''; // Reset src
        audioRef.current.onended = null;
        audioRef.current.onplay = null;

        // 👂 Set up new source
        audioRef.current.src = audioUrl;

        audioRef.current.onended = () => {
          console.log("🔊 Audio playback ended");
          setIsPlaying(false);
          URL.revokeObjectURL(audioUrl);
          
          // Restart browser STT if still active and not manually stopped
          if (isRecordingActiveRef.current && isSpeechRecognitionSupported.current && !isManualStopRef.current) {
            console.log("🔊 Audio finished — restarting browser STT...");
            
            // Clear any pending restart timeout
            if (browserSTTRestartTimeoutRef.current) {
              clearTimeout(browserSTTRestartTimeoutRef.current);
              browserSTTRestartTimeoutRef.current = null;
            }
            
            // Add a longer delay to allow browser to restore microphone access
            browserSTTRestartTimeoutRef.current = setTimeout(() => {
              if (isRecordingActiveRef.current && !isManualStopRef.current) {
                console.log("🎤 Restarting browser STT after audio finished");
                // Try to restart, but handle permission errors gracefully
                const success = startBrowserSTT();
                if (!success) {
                  console.log("🎤 Browser STT restart failed, user may need to click microphone again");
                  // Don't keep trying to restart if it fails
                  isRecordingActiveRef.current = false;
                }
              }
              browserSTTRestartTimeoutRef.current = null;
            }, 500); // Increased delay to allow browser to restore permissions
          } else {
            console.log("🎤 Not restarting browser STT - manual stop or not active");
          }
        };

        audioRef.current.onplay = () => {
          console.log("🔊 Audio playback started");
          setIsPlaying(true);
        };

        // Play audio
        await audioRef.current.play();
        console.log("🔊 Audio playback successful");
        setAudioBlocked(false);
      } else {
        console.warn("🔇 No audio element available");
      }
    } catch (error) {
      console.error("Error generating audio:", error);
      setAudioBlocked(true);
    }
  };

  // Process voice input through backend (fallback for unsupported browsers)
  const processVoiceInput = async (audioBlob: Blob) => {
    console.log("🎤 Processing voice input with backend STT...");
    console.log("📋 Current scheduleState before request:", scheduleState);
    console.log("📋 scheduleState type:", typeof scheduleState);
    console.log("📋 scheduleState === null:", scheduleState === null);
    console.log("📋 scheduleStateRef.current:", scheduleStateRef.current);
    setLoading(true);
    
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      // Add schedule state if we're in a scheduling flow - use ref to avoid closure issues
      const currentScheduleState = scheduleStateRef.current;
      if (currentScheduleState && currentScheduleState.active) {
        console.log("📋 Adding schedule_state to FormData:", currentScheduleState);
        formData.append('schedule_state', JSON.stringify(currentScheduleState));
      } else {
        console.log("📋 No active scheduleState, not adding to FormData");
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
      
      if (data.error && data.error !== "Off-topic question") {
        throw new Error(data.error);
      }
      
      const { transcript, answer, sources, audio_data, schedule_state: newScheduleState } = data;
      
      console.log("🎤 Received transcript:", transcript);
      console.log("📋 Received schedule_state:", newScheduleState);
      console.log("🔊 Received audio_data length:", audio_data ? audio_data.length : 0);
      
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
        console.log("📋 Updating scheduleState from response:", newScheduleState);
        setScheduleState(newScheduleState);
      } else {
        console.log("📋 No new scheduleState in response");
      }
      
      // Play audio response if available
      if (audio_data) {
        console.log("🔊 Playing audio response...");
        console.log("🔊 Audio data length:", audio_data.length);
        
        const audioBytes = Uint8Array.from(atob(audio_data), c => c.charCodeAt(0));
        const responseAudioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
        console.log("🔊 Audio blob size:", responseAudioBlob.size, "bytes");
        const audioUrl = URL.createObjectURL(responseAudioBlob);
        
        if (audioRef.current) {
          // 🧹 Clear previous playback and listeners
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current.src = ''; // Reset src
          audioRef.current.onended = null;
          audioRef.current.onplay = null;

          // 👂 Set up new source
          audioRef.current.src = audioUrl;

          audioRef.current.onended = () => {
            console.log("🔊 Audio playback ended");
            setIsPlaying(false);
            URL.revokeObjectURL(audioUrl);
            
            // 🔁 Loop restart happens in mediaRecorder.onstop, not here
          };

          audioRef.current.onplay = () => {
            console.log("🔊 Audio playback started");
            setIsPlaying(true);
          };

          // Add debugging event listeners
          audioRef.current.oncanplaythrough = () => {
            console.log("🔊 Audio ready to play");
          };

          audioRef.current.onerror = () => {
            console.warn("⚠️ Audio element error:", audioRef.current?.error);
          };

          audioRef.current.onloadstart = () => {
            console.log("🔊 Audio loading started");
          };

          audioRef.current.onloadeddata = () => {
            console.log("🔊 Audio data loaded");
          };

          // Try to play audio with better error handling
          const playAudio = async () => {
            try {
              // Ensure audio context is resumed
              if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
                console.log("🔊 Audio context resumed");
              }
              
              // Set source and load audio
              audioRef.current!.src = audioUrl;
              audioRef.current!.load(); // Force reload
              
              // Wait a moment for audio to be ready
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Play audio
              await audioRef.current!.play();
              console.log("🔊 Audio playback successful");
              setAudioBlocked(false);
            } catch (playError) {
              console.warn("🔇 Audio playback blocked by browser:", playError);
              
              // Try different strategies for autoplay
              if (playError instanceof Error) {
                if (playError.name === 'NotAllowedError') {
                  console.log("🔇 Autoplay blocked - user interaction required");
                  // Only set blocked flag if audio hasn't been enabled yet
                  if (!audioEnabledRef.current) {
                    setAudioBlocked(true);
                  }
                  return;
                }
              }
              
              // Retry once for other errors
              console.log("🔁 Retrying audio playback...");
              setTimeout(async () => {
                try {
                  await audioRef.current?.play();
                  console.log("🔊 Audio playback retry successful");
                  setAudioBlocked(false);
                } catch (e) {
                  console.error("Playback failed again:", e);
                  if (!audioEnabledRef.current) {
                    setAudioBlocked(true);
                  }
                }
              }, 100);
            }
          };

          // Attempt to play
          await playAudio();
        } else {
          console.warn("🔇 No audio element available");
        }
      } else {
        console.log("🔇 No audio data received");
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
      
      // 🔁 Only restart loop if recording was active (not just audio playback errors)
      if (isRecordingActiveRef.current) {
        console.log("🔁 Restarting voice loop after error");
        safelyRestartRecording();
      }
    }
    
    setLoading(false);
  };

  // Toggle recording
  const toggleRecording = () => {
    console.log("🎚️ Toggling recording — activeRef:", isRecordingActiveRef.current, "isRecording:", isRecording, "isPlaying:", isPlaying);
    
    // Enable audio on any user interaction
    if (!audioEnabledRef.current) {
      console.log("🔊 Enabling audio on user interaction");
      initializeAudio();
    }
    
    // Unlock autoplay with silent play/pause
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.src = "";
      try {
        audioRef.current.play().then(() => {
          audioRef.current?.pause();
          console.log("🎯 Autoplay unlocked via silent play");
        }).catch(() => {
          console.log("🎯 Autoplay unlock failed (expected on first try)");
        });
      } catch {}
    }
    
    // If recording or playing, stop everything completely
    if (isRecording || isPlaying) {
      console.log("🛑 Stopping everything completely");
      
      // Stop recording if active
      if (isRecording) {
        stopRecording();
      }
      
      // Stop any audio that might be playing and clear all listeners
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.onplay = null;
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.oncanplaythrough = null;
        audioRef.current.onloadstart = null;
        audioRef.current.onloadeddata = null;
        setIsPlaying(false);
      }
      
      // Ensure we're completely out of voice mode
      setIsPlaying(false);
      setIsRecording(false);
      
      return; // Exit voice mode completely
    } else {
      // Start new recording session
      startRecording();
    }
  };

  // Stop audio playback (unused)
  // const stopPlayback = () => {
  //   if (audioRef.current) {
  //     audioRef.current.pause();
  //     audioRef.current.currentTime = 0;
  //     setIsPlaying(false);
  //   }
  // };

  // Interrupt audio playback when user starts speaking
  const interruptAudio = () => {
    if (isPlaying && audioRef.current) {
      console.log("�� Interrupting audio playback");
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

                {/* Audio blocked indicator */}
                {audioBlocked && !audioEnabledRef.current && (
                  <div className={styles.audioBlocked}>
                    <div className={styles.audioBlockedMessage}>
                      🔊 Audio playback is blocked. 
                      <button 
                        onClick={() => {
                          setAudioBlocked(false);
                          initializeAudio();
                          // Try to play any queued audio
                          if (audioRef.current && !audioRef.current.paused) {
                            audioRef.current.play().catch(() => {
                              setAudioBlocked(true);
                            });
                          }
                        }}
                        className={styles.enableAudioButton}
                      >
                        Enable Audio
                      </button>
                    </div>
                  </div>
                )}



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
                    className={styles.voiceButton + (isRecording || isPlaying ? ' ' + styles.recording : '')}
                    onClick={toggleRecording}
                    disabled={loading || !micSupported}
                    title={isRecording ? "Stop recording" : isPlaying ? "Stop audio" : "Start recording"}
                    aria-label={isRecording ? "Stop recording" : isPlaying ? "Stop audio" : "Start recording"}
                  >
                    {/* Mic SVG icon when not recording/playing, Stop icon when recording or playing */}
                    {isRecording || isPlaying ? (
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
                <audio 
                  ref={audioRef} 
                  style={{ display: 'none' }} 
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}