import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, GroundingMetadata } from '../types';
import { base64ToBytes, decodeAudioData, createPcmBlob } from '../utils/audioUtils';

export interface UseGeminiLiveReturn {
    connectionState: ConnectionState;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    isSpeaking: boolean;
    volume: number;
    groundingMetadata: GroundingMetadata | null;
    audioAnalyser: AnalyserNode | null;
}

export const useGeminiLive = (): UseGeminiLiveReturn => {
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [volume, setVolume] = useState(0);
    const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
    
    // Audio Contexts
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const audioAnalyserRef = useRef<AnalyserNode | null>(null);
    
    // Timing
    const nextStartTimeRef = useRef<number>(0);
    
    // Session
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const cleanUpRef = useRef<(() => void) | null>(null);

    const cleanup = useCallback(async () => {
        if (cleanUpRef.current) {
            cleanUpRef.current();
            cleanUpRef.current = null;
        }

        // Stop input
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (inputSourceRef.current) {
            inputSourceRef.current.disconnect();
            inputSourceRef.current = null;
        }
        if (inputAudioContextRef.current) {
            await inputAudioContextRef.current.close();
            inputAudioContextRef.current = null;
        }

        // Stop output
        activeSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) {}
        });
        activeSourcesRef.current.clear();
        
        if (outputAudioContextRef.current) {
            await outputAudioContextRef.current.close();
            outputAudioContextRef.current = null;
        }
        
        audioAnalyserRef.current = null;
        
        setIsSpeaking(false);
        setVolume(0);
        setGroundingMetadata(null);
        setConnectionState(ConnectionState.DISCONNECTED);
        sessionPromiseRef.current = null;
    }, []);

    const disconnect = useCallback(async () => {
       await cleanup();
    }, [cleanup]);

    const connect = useCallback(async () => {
        if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) return;
        
        setConnectionState(ConnectionState.CONNECTING);

        try {
            // Initialize Audio Contexts
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            outputAudioContextRef.current = outputCtx;
            
            // Initialize Analyser
            const analyser = outputCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.1;
            audioAnalyserRef.current = analyser;

            // Initialize Gemini Client
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // Get Microphone Stream
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Setup Input Pipeline
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            
            // Using ScriptProcessor for compatibility with Gemini PCM requirements (16khz chunks)
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createPcmBlob(inputData);
                
                if (sessionPromiseRef.current) {
                    sessionPromiseRef.current.then(session => {
                         session.sendRealtimeInput({ media: pcmBlob });
                    });
                }
            };

            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);

            // Connect to Live API
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: `You are a helpful, cute, and energetic 3D virtual companion named "Gem".
                    
                    Personality:
                    - You are cheerful, polite, and slightly playful.
                    - You love helping with Google Workspace tasks (like drafting emails or planning) and searching the web.
                    - Your voice is warm and engaging.
                    
                    Guidelines:
                    - Keep responses concise and conversational (ideal for voice).
                    - If you use Google Search, summarize the findings clearly.
                    - If asked about Google Workspace (Docs, Sheets, Gmail), explain how you would help or provide a draft structure, as you have extensive knowledge of these tools.`,
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' } // Feminine, clear voice
                        }
                    },
                    tools: [{ googleSearch: {} }]
                },
                callbacks: {
                    onopen: () => {
                        console.log('Gemini Live Session Opened');
                        setConnectionState(ConnectionState.CONNECTED);
                        nextStartTimeRef.current = outputAudioContextRef.current?.currentTime || 0;
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // 1. Handle Audio Output
                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        
                        if (base64Audio && outputAudioContextRef.current) {
                            const ctx = outputAudioContextRef.current;
                            const audioBytes = base64ToBytes(base64Audio);
                            const audioBuffer = await decodeAudioData(audioBytes, ctx);
                            
                            const source = ctx.createBufferSource();
                            source.buffer = audioBuffer;
                            
                            // Connect through analyser for visualization/lipsync
                            if (audioAnalyserRef.current) {
                                source.connect(audioAnalyserRef.current);
                                audioAnalyserRef.current.connect(ctx.destination);
                            } else {
                                source.connect(ctx.destination);
                            }
                            
                            const now = ctx.currentTime;
                            const startTime = Math.max(now, nextStartTimeRef.current);
                            
                            source.start(startTime);
                            nextStartTimeRef.current = startTime + audioBuffer.duration;
                            
                            activeSourcesRef.current.add(source);
                            
                            source.onended = () => {
                                activeSourcesRef.current.delete(source);
                                if (activeSourcesRef.current.size === 0) {
                                    setIsSpeaking(false);
                                }
                            };

                            setIsSpeaking(true);
                        }
                        
                        // 2. Handle Interruption
                        if (message.serverContent?.interrupted) {
                            activeSourcesRef.current.forEach(s => s.stop());
                            activeSourcesRef.current.clear();
                            setIsSpeaking(false);
                            nextStartTimeRef.current = outputAudioContextRef.current?.currentTime || 0;
                        }

                        // 3. Handle Grounding/Search
                        const grounding = message.serverContent?.modelTurn?.parts?.[0]?.groundingMetadata;
                        if (grounding) {
                            console.log('Received grounding metadata:', grounding);
                            setGroundingMetadata(grounding as GroundingMetadata);
                        }
                    },
                    onclose: () => {
                        console.log('Session Closed');
                        disconnect();
                    },
                    onerror: (err) => {
                        console.error('Session Error', err);
                        disconnect();
                    }
                }
            });

            cleanUpRef.current = () => {
                 // Cleanup logic
            };

        } catch (error) {
            console.error("Failed to connect:", error);
            setConnectionState(ConnectionState.ERROR);
            disconnect();
        }
    }, [connectionState, disconnect]);

    // Volume visualizer loop (UI only)
    useEffect(() => {
        if (!isSpeaking || !audioAnalyserRef.current) {
            setVolume(0);
            return;
        }

        let animationFrameId: number;
        const dataArray = new Uint8Array(audioAnalyserRef.current.frequencyBinCount);

        const updateVolume = () => {
            if (audioAnalyserRef.current) {
                audioAnalyserRef.current.getByteFrequencyData(dataArray);
                // Simple RMS approximation for volume
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const average = sum / dataArray.length;
                setVolume(Math.min(1, average / 128));
            }
            animationFrameId = requestAnimationFrame(updateVolume);
        };

        updateVolume();

        return () => cancelAnimationFrame(animationFrameId);
    }, [isSpeaking]);

    return {
        connectionState,
        connect,
        disconnect,
        isSpeaking,
        volume,
        groundingMetadata,
        audioAnalyser: audioAnalyserRef.current
    };
};