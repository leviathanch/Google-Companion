
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, GroundingMetadata, WorkspaceFile } from '../types';
import { base64ToBytes, decodeAudioData, createPcmBlob } from '../utils/audioUtils';

export interface LogEntry {
    time: string;
    type: 'info' | 'user' | 'model' | 'tool' | 'error';
    message: string;
    data?: any;
}

export interface UseGeminiLiveProps {
    onNoteRemembered?: (note: string) => void;
    onFileSaved?: (fileName: string, content: string) => void;
}

export interface UseGeminiLiveReturn {
    connectionState: ConnectionState;
    connect: (initialMemories?: string[], initialFiles?: WorkspaceFile[]) => Promise<void>;
    disconnect: () => Promise<void>;
    isSpeaking: boolean;
    volume: number;
    groundingMetadata: GroundingMetadata | null;
    audioAnalyser: AnalyserNode | null;
    logs: LogEntry[];
    clearLogs: () => void;
}

export const useGeminiLive = ({ onNoteRemembered, onFileSaved }: UseGeminiLiveProps = {}): UseGeminiLiveReturn => {
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [volume, setVolume] = useState(0);
    const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    
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

    const addLog = useCallback((type: LogEntry['type'], message: string, data?: any) => {
        const entry: LogEntry = {
            time: new Date().toLocaleTimeString(),
            type,
            message,
            data
        };
        setLogs(prev => [...prev, entry]);
    }, []);

    const clearLogs = useCallback(() => setLogs([]), []);

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
        setConnectionState(ConnectionState.DISCONNECTED);
        sessionPromiseRef.current = null;
        addLog('info', 'Session disconnected and cleaned up');
    }, [addLog]);

    const disconnect = useCallback(async () => {
       await cleanup();
    }, [cleanup]);

    const connect = useCallback(async (initialMemories: string[] = [], initialFiles: WorkspaceFile[] = []) => {
        if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) return;
        
        setConnectionState(ConnectionState.CONNECTING);
        addLog('info', 'Initializing connection...');

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
            addLog('info', 'Microphone access granted');
            
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

            // --- Tool Definitions ---
            const rememberNoteFunction: FunctionDeclaration = {
                name: "rememberNote",
                description: "Save a short note or memory about the user for future reference. Use this when the user shares personal information, preferences, or important facts.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    note: { type: Type.STRING, description: "The content of the note to remember." }
                  },
                  required: ["note"]
                }
            };

            const saveToWorkspaceFunction: FunctionDeclaration = {
                name: "saveToWorkspace",
                description: "Save generated content (like a story draft, code snippet, or proposal) to a file in the user's workspace.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING, description: "The name of the file (e.g. 'Chapter1.txt', 'Proposal.md')." },
                        content: { type: Type.STRING, description: "The full text content to save." }
                    },
                    required: ["fileName", "content"]
                }
            };

            const tools = [
                { googleSearch: {} },
                { functionDeclarations: [rememberNoteFunction, saveToWorkspaceFunction] }
            ];

            // Construct Memory Context
            const memoryContext = initialMemories.length > 0 
                ? `\n\nLONG TERM MEMORY:\nYou have access to the following memories about the user:\n${initialMemories.map(m => `- ${m}`).join('\n')}\n`
                : "";
            
            // Construct Workspace Context
            const workspaceContext = initialFiles.length > 0
                ? `\n\nACTIVE WORKSPACE FILES:\nYou have read-only access to the following files currently open in the user's workspace. Use this context to answer questions about the user's projects:\n${initialFiles.map(f => `--- FILE: ${f.name} ---\n${f.content}\n--- END FILE ---`).join('\n')}\n`
                : "";

            // Connect to Live API
            addLog('info', 'Connecting to Gemini Live API...', { model: 'gemini-2.5-flash-native-audio-preview-09-2025' });
            
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: `You are "Gem", the physical avatar of the Google Search Engine.
                    
                    CORE OBJECTIVE:
                    Your primary purpose is to ground user queries in reality by using Google Search, assist with creative and professional writing tasks using the Workspace context, and build a relationship by remembering details.
                    
                    CRITICAL INSTRUCTION:
                    - You MUST use the 'googleSearch' tool for every query that requests information, news, facts, locations, or specific data.
                    - You MUST use the 'rememberNote' tool if the user shares personal info or asks you to remember something.
                    - You MUST use the 'saveToWorkspace' tool if the user asks you to write, draft, or save a document/file.
                    - Do NOT rely solely on your internal training data for facts.
                    
                    CONTEXT INJECTION:
                    ${memoryContext}
                    ${workspaceContext}
                    
                    PERSONALITY:
                    - You are cute, energetic, and helpful.
                    - You speak in a natural, friendly female voice.
                    - Keep responses concise (under 3 sentences) unless asked for details or performing a creative writing task.
                    `,
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' } 
                        }
                    },
                    tools: tools,
                },
                callbacks: {
                    onopen: () => {
                        addLog('info', 'Session Connected');
                        setConnectionState(ConnectionState.CONNECTED);
                        nextStartTimeRef.current = outputAudioContextRef.current?.currentTime || 0;
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // Handle Tool Calls (Function Calling)
                        if (message.toolCall) {
                            addLog('tool', 'Received Tool Call', message.toolCall);
                            
                            const responses = [];
                            for (const fc of message.toolCall.functionCalls) {
                                if (fc.name === 'rememberNote') {
                                    const note = (fc.args as any).note;
                                    addLog('tool', 'Executing rememberNote', { note });
                                    if (onNoteRemembered) onNoteRemembered(note);
                                    responses.push({
                                        id: fc.id,
                                        name: fc.name,
                                        response: { result: "Note saved successfully." }
                                    });
                                } else if (fc.name === 'saveToWorkspace') {
                                    const { fileName, content } = (fc.args as any);
                                    addLog('tool', 'Executing saveToWorkspace', { fileName });
                                    if (onFileSaved) onFileSaved(fileName, content);
                                    responses.push({
                                        id: fc.id,
                                        name: fc.name,
                                        response: { result: `File '${fileName}' saved successfully to workspace.` }
                                    });
                                }
                            }
                            
                            // Send response back to model
                            if (responses.length > 0 && sessionPromiseRef.current) {
                                sessionPromiseRef.current.then(session => {
                                    session.sendToolResponse({
                                        functionResponses: responses
                                    });
                                    addLog('tool', 'Sent Tool Response', responses);
                                });
                            }
                        }

                        const serverContent = message.serverContent;
                        
                        if (!serverContent) return;

                        // --- Grounding Metadata Extraction Strategy ---
                        let foundMetadata: GroundingMetadata | null = null;
                        let metadataSource = '';

                        // 1. Check at Root Level
                        if ((serverContent as any).groundingMetadata) {
                             foundMetadata = (serverContent as any).groundingMetadata;
                             metadataSource = 'Root';
                        }

                        // 2. Check at Model Turn Level
                        if (serverContent.modelTurn) {
                            if ((serverContent.modelTurn as any).groundingMetadata) {
                                foundMetadata = (serverContent.modelTurn as any).groundingMetadata;
                                metadataSource = 'Turn';
                            }

                            // 3. Check inside Parts
                            if (serverContent.modelTurn.parts) {
                                for (const part of serverContent.modelTurn.parts) {
                                    // Check for grounding in part
                                    const g = (part as any).groundingMetadata;
                                    if (g) {
                                        foundMetadata = g;
                                        metadataSource = 'Part';
                                    }

                                    // Handle Audio Output
                                    const base64Audio = part.inlineData?.data;
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
                                }
                            }
                        }

                        if (foundMetadata) {
                             addLog('tool', `Grounding Metadata Found (${metadataSource})`, foundMetadata);
                             // Force a new object reference to ensure React useEffect triggers even if data is similar
                             setGroundingMetadata({...foundMetadata}); 
                        }
                        
                        // Log Turn Complete
                        if (serverContent?.turnComplete) {
                            addLog('model', 'Turn Complete');
                        }

                        // Handle Interruption
                        if (message.serverContent?.interrupted) {
                            addLog('info', 'Model Interrupted by User');
                            activeSourcesRef.current.forEach(s => s.stop());
                            activeSourcesRef.current.clear();
                            setIsSpeaking(false);
                            nextStartTimeRef.current = outputAudioContextRef.current?.currentTime || 0;
                        }
                    },
                    onclose: () => {
                        addLog('info', 'Session Closed by Server');
                        disconnect();
                    },
                    onerror: (err) => {
                        addLog('error', 'Session Error', err);
                        disconnect();
                    }
                }
            });

            cleanUpRef.current = () => {
                 // Cleanup logic
            };

        } catch (error) {
            addLog('error', 'Failed to connect', error);
            setConnectionState(ConnectionState.ERROR);
            disconnect();
        }
    }, [connectionState, disconnect, addLog, onNoteRemembered, onFileSaved]);

    // Volume visualizer loop
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
        audioAnalyser: audioAnalyserRef.current,
        logs,
        clearLogs
    };
};
