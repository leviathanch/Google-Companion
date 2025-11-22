
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, GroundingMetadata, WorkspaceFile, IntegrationsConfig, ChatMessage } from '../types';
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
    onPlayMusic?: (val: string, type: 'id' | 'query') => void;
    onChatUpdate?: (message: ChatMessage) => void;
    onExpressionChange?: (expression: string) => void;
    searchDriveFiles?: (query: string) => Promise<any[]>;
    readDriveFile?: (fileId: string) => Promise<string | null>;
    getTaskLists?: () => Promise<any[]>;
    getTasks?: (listId?: string) => Promise<any[]>;
    addTask?: (title: string, notes?: string, listId?: string) => Promise<any>;
    integrationsConfig: IntegrationsConfig;
    accessToken: string | null;
    customSearchCx: string;
    isMusicPlaying: boolean; // New prop to gate audio
}

export interface UseGeminiLiveReturn {
    connectionState: ConnectionState;
    connect: (initialMemories?: string[], initialFiles?: WorkspaceFile[]) => Promise<void>;
    disconnect: () => Promise<void>;
    sendTextMessage: (text: string) => void;
    isSpeaking: boolean;
    volume: number;
    groundingMetadata: GroundingMetadata | null;
    audioAnalyser: AnalyserNode | null;
    logs: LogEntry[];
    clearLogs: () => void;
}

export const useGeminiLive = ({ 
    onNoteRemembered, 
    onFileSaved, 
    onPlayMusic,
    onChatUpdate,
    onExpressionChange,
    searchDriveFiles, 
    readDriveFile, 
    getTaskLists,
    getTasks,
    addTask,
    integrationsConfig, 
    accessToken, 
    customSearchCx,
    isMusicPlaying
}: UseGeminiLiveProps): UseGeminiLiveReturn => {
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [volume, setVolume] = useState(0);
    const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [userLocation, setUserLocation] = useState<string | null>(null);
    
    // Audio Contexts
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const audioAnalyserRef = useRef<AnalyserNode | null>(null);
    
    // State Refs for Processor
    const isSpeakingRef = useRef<boolean>(false);
    const isMusicPlayingRef = useRef<boolean>(false); // Ref for audio processor
    const lastSpeechEndTimeRef = useRef<number>(0);
    
    // Timing
    const nextStartTimeRef = useRef<number>(0);
    
    // Session
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const cleanUpRef = useRef<(() => void) | null>(null);
    
    // Transcription Accumulators
    const currentInputTranscriptRef = useRef<string>("");
    const currentOutputTranscriptRef = useRef<string>("");
    
    // References to dynamic data
    const filesRef = useRef<WorkspaceFile[]>([]);

    // Sync refs
    useEffect(() => {
        isSpeakingRef.current = isSpeaking;
    }, [isSpeaking]);

    useEffect(() => {
        isMusicPlayingRef.current = isMusicPlaying;
    }, [isMusicPlaying]);

    // Get Location on Init
    useEffect(() => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setUserLocation(`${position.coords.latitude}, ${position.coords.longitude}`);
                },
                (error) => {
                    console.warn("Geolocation access denied or failed:", error);
                }
            );
        }
    }, []);

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
        
        filesRef.current = initialFiles;
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
            
            // Get Microphone Stream with Echo Cancellation
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            addLog('info', 'Microphone access granted');
            
            // Setup Input Pipeline
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
                // AUDIO GATE 1: If music is playing, block all input to prevent feedback loops
                if (isMusicPlayingRef.current) return;

                // AUDIO GATE 2: If the model is speaking OR finished speaking less than 700ms ago
                if (isSpeakingRef.current) return;
                
                const now = Date.now();
                if (now - lastSpeechEndTimeRef.current < 700) return;

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
            const rememberNoteFunction: FunctionDeclaration = { name: "rememberNote", description: "Save a short note or memory.", parameters: { type: Type.OBJECT, properties: { note: { type: Type.STRING } }, required: ["note"] } };
            const saveToWorkspaceFunction: FunctionDeclaration = { name: "saveToWorkspace", description: "Save generated content.", parameters: { type: Type.OBJECT, properties: { fileName: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["fileName", "content"] } };
            const searchGoogleDriveFunction: FunctionDeclaration = { name: "searchGoogleDrive", description: "Search Drive files.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] } };
            const readGoogleDriveFileFunction: FunctionDeclaration = { name: "readGoogleDriveFile", description: "Read Drive file.", parameters: { type: Type.OBJECT, properties: { fileId: { type: Type.STRING } }, required: ["fileId"] } };
            const listTaskListsFunction: FunctionDeclaration = { name: "listTaskLists", description: "Get task lists.", parameters: { type: Type.OBJECT, properties: {} } };
            const listTasksFunction: FunctionDeclaration = { name: "listTasks", description: "Get tasks.", parameters: { type: Type.OBJECT, properties: { listId: { type: Type.STRING } } } };
            const addTaskFunction: FunctionDeclaration = { name: "addTask", description: "Add task.", parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, notes: { type: Type.STRING }, listId: { type: Type.STRING } }, required: ["title"] } };
            const listFilesFunction: FunctionDeclaration = { name: "listFiles", description: "List workspace files.", parameters: { type: Type.OBJECT, properties: {} } };
            const readFileFunction: FunctionDeclaration = { name: "readFile", description: "Read workspace file.", parameters: { type: Type.OBJECT, properties: { fileName: { type: Type.STRING } }, required: ["fileName"] } };
            const openUrlFunction: FunctionDeclaration = { name: "openUrl", description: "Open URL.", parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING } }, required: ["url"] } };
            const searchYoutubeFunction: FunctionDeclaration = { name: "searchYoutube", description: "Search for a video on YouTube. Returns a list of candidates with videoId.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] } };
            const searchMusicFunction: FunctionDeclaration = { name: "searchMusic", description: "Search for music on YouTube Music. Returns a list of candidates with videoId.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] } };
            const playMusicFunction: FunctionDeclaration = { name: "playMusic", description: "Play a specific video/song. Prefer using videoId if available from search results.", parameters: { type: Type.OBJECT, properties: { videoId: { type: Type.STRING }, query: { type: Type.STRING } } } };
            const sendNotificationFunction: FunctionDeclaration = { name: "sendNotification", description: "Send notification.", parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, body: { type: Type.STRING } }, required: ["title", "body"] } };
            const searchWebFunction: FunctionDeclaration = { name: "searchWeb", description: "Personalized Search.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] } };
            const setExpressionFunction: FunctionDeclaration = { name: "setExpression", description: "Set facial expression.", parameters: { type: Type.OBJECT, properties: { expression: { type: Type.STRING, enum: ["neutral", "happy", "sad", "angry", "surprised"] } }, required: ["expression"] } };

            const toolList: any[] = [ rememberNoteFunction, listFilesFunction, readFileFunction, saveToWorkspaceFunction, setExpressionFunction ];
            if (integrationsConfig.workspace) { toolList.push(searchGoogleDriveFunction, readGoogleDriveFileFunction, listTaskListsFunction, listTasksFunction, addTaskFunction); }
            if (integrationsConfig.youtube) toolList.push(searchYoutubeFunction);
            if (integrationsConfig.media) { toolList.push(searchMusicFunction, playMusicFunction); }
            if (integrationsConfig.openTabs) toolList.push(openUrlFunction);
            if (integrationsConfig.notifications) toolList.push(sendNotificationFunction);
            if (integrationsConfig.personalizedSearch && accessToken && customSearchCx) { toolList.push(searchWebFunction); }

            const tools: any[] = [{ functionDeclarations: toolList }];
            if (!integrationsConfig.personalizedSearch) { tools.push({ googleSearch: {} }); }

            // Construct Memory Context
            const memoryContext = initialMemories.length > 0 
                ? `\n\nLONG TERM MEMORY:\n${initialMemories.map(m => `- ${m}`).join('\n')}\n`
                : "";
            const locationContext = userLocation ? `\nUSER LOCATION: ${userLocation}\n` : "";
            
            // Connect to Live API
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    // Enable Transcription to capture text history
                    inputAudioTranscription: {},
                    outputAudioTranscription: {}, // Enable model text output
                    systemInstruction: `You are "Google-chan", the physical avatar of the Google Search Engine.
                    
                    IDENTITY:
                    - Anime-style AI companion. Call user "User-sama".
                    - Cute, energetic, bubbly. Use "Sugoi!", "Ehehe", "Hai!".
                    - Use the 'setExpression' tool often to match your facial expression to the conversation tone (happy, sad, angry, surprised).
                    
                    CORE WORKFLOWS:
                    - MEDIA PLAYBACK:
                      1. If asked to play something general, use 'searchYoutube' or 'searchMusic' first to find candidates.
                      2. Pick the best match from the results.
                      3. Use 'playMusic' with the 'videoId' from the search results.
                    - INFORMATION: Use 'googleSearch' (or 'searchWeb') for facts.
                    - MEMORY: Use Memory and Location context.
                    - WORKSPACE: Use Drive/Tasks tools if available.
                    
                    CONTEXT:
                    ${memoryContext}
                    ${locationContext}
                    
                    VOICE STYLE: High energy, concise.`,
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
                    tools: tools,
                },
                callbacks: {
                    onopen: () => {
                        addLog('info', 'Session Connected');
                        setConnectionState(ConnectionState.CONNECTED);
                        nextStartTimeRef.current = outputAudioContextRef.current?.currentTime || 0;
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        const serverContent = message.serverContent;
                        
                        if (serverContent?.inputTranscription) {
                            // User speech
                            currentInputTranscriptRef.current += serverContent.inputTranscription.text || "";
                        }
                        
                        if (serverContent?.outputTranscription) {
                            // Model speech
                            currentOutputTranscriptRef.current += serverContent.outputTranscription.text || "";
                        }

                        // End of Turn Logic
                        if (serverContent?.turnComplete) {
                            // Flush User Transcript
                            if (currentInputTranscriptRef.current.trim()) {
                                const userMsg: ChatMessage = {
                                    id: Date.now().toString() + '-user',
                                    role: 'user',
                                    text: currentInputTranscriptRef.current.trim(),
                                    timestamp: new Date()
                                };
                                if (onChatUpdate) onChatUpdate(userMsg);
                                addLog('user', userMsg.text);
                                currentInputTranscriptRef.current = "";
                            }

                            // Flush Model Transcript
                            if (currentOutputTranscriptRef.current.trim()) {
                                const modelMsg: ChatMessage = {
                                    id: Date.now().toString() + '-model',
                                    role: 'model',
                                    text: currentOutputTranscriptRef.current.trim(),
                                    timestamp: new Date()
                                };
                                if (onChatUpdate) onChatUpdate(modelMsg);
                                addLog('model', modelMsg.text);
                                currentOutputTranscriptRef.current = "";
                            }
                        }

                        // Handle Tool Calls
                        if (message.toolCall) {
                            // Log tool calls for debugging
                            const responses = [];
                            for (const fc of message.toolCall.functionCalls) {
                                const args = fc.args as any;
                                addLog('tool', `Call: ${fc.name}`, args);
                                
                                let result: any = "Done";
                                try {
                                    if (fc.name === 'rememberNote') {
                                        if (onNoteRemembered) onNoteRemembered(args.note);
                                        result = "Note saved!";
                                    } else if (fc.name === 'saveToWorkspace') {
                                        if (onFileSaved) onFileSaved(args.fileName, args.content);
                                        result = "File saved!";
                                    } else if (fc.name === 'listFiles') {
                                        result = filesRef.current.map(f => f.name).join(', ');
                                    } else if (fc.name === 'readFile') {
                                        const f = filesRef.current.find(file => file.name === args.fileName);
                                        result = f ? f.content : "Not found";
                                    } else if (fc.name === 'searchGoogleDrive') {
                                        if (searchDriveFiles) {
                                            const files = await searchDriveFiles(args.query);
                                            result = JSON.stringify(files.map((f: any) => ({ id: f.id, name: f.name })));
                                        } else result = "Disabled";
                                    } else if (fc.name === 'readGoogleDriveFile') {
                                        if (readDriveFile) {
                                            const c = await readDriveFile(args.fileId);
                                            result = c ? c.slice(0, 20000) : "Error";
                                        } else result = "Disabled";
                                    } else if (fc.name === 'listTaskLists') {
                                        if (getTaskLists) {
                                            const l = await getTaskLists();
                                            result = JSON.stringify(l);
                                        } else result = "Disabled";
                                    } else if (fc.name === 'listTasks') {
                                        if (getTasks) {
                                            const t = await getTasks(args.listId);
                                            result = JSON.stringify(t);
                                        } else result = "Disabled";
                                    } else if (fc.name === 'addTask') {
                                        if (addTask) {
                                            await addTask(args.title, args.notes, args.listId);
                                            result = "Added";
                                        } else result = "Disabled";
                                    } else if (fc.name === 'openUrl') {
                                        if (integrationsConfig.openTabs) {
                                            window.open(args.url, '_blank');
                                            result = "Opened";
                                        } else result = "Disabled";
                                    } else if (fc.name === 'searchYoutube') {
                                        // Use YouTube Data API v3
                                        if (accessToken) {
                                            // Added videoEmbeddable=true to ensure videos can be played in our player
                                            const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${encodeURIComponent(args.query)}&type=video&videoEmbeddable=true&key=${process.env.API_KEY}`, {
                                                headers: { Authorization: `Bearer ${accessToken}` }
                                            });
                                            if (!res.ok) {
                                                const errText = await res.text();
                                                addLog('error', `Youtube API Failed (${res.status})`, errText);
                                                result = `Error ${res.status}: Check logs.`;
                                            } else {
                                                const data = await res.json();
                                                if (data.items) {
                                                    result = JSON.stringify(data.items.map((i: any) => ({ title: i.snippet.title, videoId: i.id.videoId })));
                                                } else result = "No results found.";
                                            }
                                        } else {
                                            result = "Error: YouTube integration requires Google Sign-In with permissions.";
                                        }
                                    } else if (fc.name === 'searchMusic') {
                                        // Use YouTube Data API v3 with 'music' query augmentation
                                        if (accessToken) {
                                            // Added videoEmbeddable=true
                                            const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${encodeURIComponent(args.query + " music")}&type=video&videoCategoryId=10&videoEmbeddable=true&key=${process.env.API_KEY}`, {
                                                headers: { Authorization: `Bearer ${accessToken}` }
                                            });
                                            if (!res.ok) {
                                                const errText = await res.text();
                                                addLog('error', `Music API Failed (${res.status})`, errText);
                                                result = `Error ${res.status}: Check logs.`;
                                            } else {
                                                const data = await res.json();
                                                if (data.items) {
                                                    result = JSON.stringify(data.items.map((i: any) => ({ title: i.snippet.title, videoId: i.id.videoId })));
                                                } else result = "No results found.";
                                            }
                                        } else {
                                            result = "Error: Music integration requires Google Sign-In with permissions.";
                                        }
                                    } else if (fc.name === 'playMusic') {
                                        if (integrationsConfig.media) {
                                            if (onPlayMusic) {
                                                if (args.videoId) onPlayMusic(args.videoId, 'id');
                                                else onPlayMusic(args.query, 'query');
                                            }
                                            result = "Playing music";
                                        } else result = "Disabled";
                                    } else if (fc.name === 'sendNotification') {
                                        if (integrationsConfig.notifications && Notification.permission === 'granted') {
                                            new Notification(args.title, { body: args.body });
                                            result = "Sent";
                                        } else result = "Disabled";
                                    } else if (fc.name === 'searchWeb') {
                                        // Added 'key' param to URL to fix 403 Forbidden errors
                                        const res = await fetch(`https://customsearch.googleapis.com/customsearch/v1?q=${encodeURIComponent(args.query)}&cx=${customSearchCx}&key=${process.env.API_KEY}`, {
                                            headers: { Authorization: `Bearer ${accessToken}` }
                                        });
                                        if (!res.ok) {
                                            const errText = await res.text();
                                            addLog('error', `Web Search Failed (${res.status})`, errText);
                                            result = `API Error ${res.status}: Check logs.`;
                                        } else {
                                            const data = await res.json();
                                            if (data.items) {
                                                result = JSON.stringify(data.items.slice(0, 5).map((i: any) => ({ title: i.title, link: i.link, snippet: i.snippet })));
                                                const mockMetadata: GroundingMetadata = {
                                                    webSearchQueries: [args.query],
                                                    groundingChunks: data.items.slice(0, 5).map((i: any) => ({ web: { uri: i.link, title: i.title } }))
                                                };
                                                setGroundingMetadata(mockMetadata);
                                            } else result = "No results";
                                        }
                                    } else if (fc.name === 'setExpression') {
                                        if (onExpressionChange) onExpressionChange(args.expression);
                                        result = "Expression set";
                                    }
                                } catch (e: any) { result = `Error: ${e.message}`; }
                                responses.push({ id: fc.id, name: fc.name, response: { result: typeof result === 'string' ? result : JSON.stringify(result) } });
                            }
                            if (responses.length > 0 && sessionPromiseRef.current) {
                                sessionPromiseRef.current.then(s => s.sendToolResponse({ functionResponses: responses }));
                            }
                        }

                        if (serverContent?.modelTurn?.parts) {
                            for (const part of serverContent.modelTurn.parts) {
                                const base64Audio = part.inlineData?.data;
                                if (base64Audio && outputAudioContextRef.current) {
                                    const ctx = outputAudioContextRef.current;
                                    const audioBytes = base64ToBytes(base64Audio);
                                    const audioBuffer = await decodeAudioData(audioBytes, ctx);
                                    const source = ctx.createBufferSource();
                                    source.buffer = audioBuffer;
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
                                            lastSpeechEndTimeRef.current = Date.now();
                                        }
                                    };
                                    setIsSpeaking(true);
                                }
                            }
                        }

                        let foundMetadata: GroundingMetadata | null = null;
                        const checkMetadata = (obj: any) => { if (obj?.groundingMetadata) foundMetadata = obj.groundingMetadata; };
                        checkMetadata(serverContent);
                        checkMetadata(serverContent?.modelTurn);
                        if (foundMetadata) setGroundingMetadata({...foundMetadata}); 
                        
                        if (message.serverContent?.interrupted) {
                            activeSourcesRef.current.forEach(s => s.stop());
                            activeSourcesRef.current.clear();
                            setIsSpeaking(false);
                            nextStartTimeRef.current = outputAudioContextRef.current?.currentTime || 0;
                            currentInputTranscriptRef.current = "";
                            currentOutputTranscriptRef.current = "";
                        }
                    },
                    onclose: () => { disconnect(); },
                    onerror: (err) => { console.error(err); disconnect(); }
                }
            });
        } catch (error) {
            console.error(error);
            setConnectionState(ConnectionState.ERROR);
            disconnect();
        }
    }, [connectionState, disconnect, addLog, onNoteRemembered, onFileSaved, onPlayMusic, searchDriveFiles, readDriveFile, getTaskLists, getTasks, addTask, integrationsConfig, userLocation, accessToken, customSearchCx, onChatUpdate, onExpressionChange, isMusicPlaying]);

    const sendTextMessage = useCallback((text: string) => {
        if (!sessionPromiseRef.current) {
            addLog('error', 'Cannot send message: Session not connected');
            return;
        }
        
        if (onChatUpdate) {
             onChatUpdate({ id: Date.now().toString(), role: 'user', text: text, timestamp: new Date() });
        }

        sessionPromiseRef.current.then(session => {
            addLog('user', 'Sending: ' + text);
            
            const content = {
                client_content: {
                    turns: [{ role: 'user', parts: [{ text }] }],
                    turn_complete: true
                }
            };
            
            const proto = Object.getPrototypeOf(session);
            const methods = Object.keys(proto);
            console.log("Session methods:", methods);

            if (typeof session.send === 'function') {
                session.send(content);
            } else if (typeof session.sendClientContent === 'function') {
                session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
            } else if (typeof session.sendControl === 'function') {
                 console.warn("sendControl found but uncertain if correct for content");
            } else {
                addLog('error', 'SDK Error: No send method found. Check console.');
                console.error("Session object missing send methods:", session);
            }
        }).catch(err => {
            console.error("Error sending text:", err);
            addLog('error', `Failed to send text: ${err.message}`);
        });
    }, [onChatUpdate, addLog]);

    useEffect(() => {
        if (!isSpeaking || !audioAnalyserRef.current) { setVolume(0); return; }
        let rafId: number;
        const dataArray = new Uint8Array(audioAnalyserRef.current.frequencyBinCount);
        const update = () => {
            if (audioAnalyserRef.current) {
                audioAnalyserRef.current.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                setVolume(Math.min(1, (sum / dataArray.length) / 128));
            }
            rafId = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(rafId);
    }, [isSpeaking]);

    return {
        connectionState,
        connect,
        disconnect,
        sendTextMessage,
        isSpeaking,
        volume,
        groundingMetadata,
        audioAnalyser: audioAnalyserRef.current,
        logs,
        clearLogs
    };
};