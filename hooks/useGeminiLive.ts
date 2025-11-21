
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, GroundingMetadata, WorkspaceFile, IntegrationsConfig } from '../types';
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
    searchDriveFiles?: (query: string) => Promise<any[]>;
    readDriveFile?: (fileId: string) => Promise<string | null>;
    getTaskLists?: () => Promise<any[]>;
    getTasks?: (listId?: string) => Promise<any[]>;
    addTask?: (title: string, notes?: string, listId?: string) => Promise<any>;
    integrationsConfig: IntegrationsConfig;
    accessToken: string | null;
    customSearchCx: string;
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

export const useGeminiLive = ({ 
    onNoteRemembered, 
    onFileSaved, 
    searchDriveFiles, 
    readDriveFile, 
    getTaskLists,
    getTasks,
    addTask,
    integrationsConfig, 
    accessToken, 
    customSearchCx 
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
    
    // Timing
    const nextStartTimeRef = useRef<number>(0);
    
    // Session
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const cleanUpRef = useRef<(() => void) | null>(null);
    
    // References to dynamic data
    const filesRef = useRef<WorkspaceFile[]>([]);

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
            
            // Get Microphone Stream
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            addLog('info', 'Microphone access granted');
            
            // Setup Input Pipeline
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            
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
                description: "Save a short note or memory about User-sama for future reference.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    note: { type: Type.STRING, description: "The content of the note to remember." }
                  },
                  required: ["note"]
                }
            };

            // Workspace Tools
            const saveToWorkspaceFunction: FunctionDeclaration = {
                name: "saveToWorkspace",
                description: "Save generated content to a file in User-sama's local workspace.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING, description: "The name of the file." },
                        content: { type: Type.STRING, description: "The full text content to save." }
                    },
                    required: ["fileName", "content"]
                }
            };

            const searchGoogleDriveFunction: FunctionDeclaration = {
                name: "searchGoogleDrive",
                description: "Search for files in User-sama's Google Drive (Docs, PDFs, etc.). Use this to find novels, proposals, or other documents.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        query: { type: Type.STRING, description: "The search query (keywords, filename)." }
                    },
                    required: ["query"]
                }
            };

            const readGoogleDriveFileFunction: FunctionDeclaration = {
                name: "readGoogleDriveFile",
                description: "Read the content of a specific file from Google Drive. Use the 'id' returned by searchGoogleDrive.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        fileId: { type: Type.STRING, description: "The ID of the file to read." }
                    },
                    required: ["fileId"]
                }
            };

            // Tasks Tools
            const listTaskListsFunction: FunctionDeclaration = {
                name: "listTaskLists",
                description: "Get all of User-sama's task lists (To-Do lists).",
                parameters: { type: Type.OBJECT, properties: {} }
            };

            const listTasksFunction: FunctionDeclaration = {
                name: "listTasks",
                description: "Get tasks from a specific list (or default).",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        listId: { type: Type.STRING, description: "The task list ID (optional, defaults to '@default')." }
                    }
                }
            };

            const addTaskFunction: FunctionDeclaration = {
                name: "addTask",
                description: "Add a new task to User-sama's To-Do list.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "Title of the task." },
                        notes: { type: Type.STRING, description: "Additional notes or description." },
                        listId: { type: Type.STRING, description: "Target list ID (optional)." }
                    },
                    required: ["title"]
                }
            };

            const listFilesFunction: FunctionDeclaration = {
                name: "listFiles",
                description: "List the files currently open in the local workspace.",
                parameters: { type: Type.OBJECT, properties: {} }
            };

            const readFileFunction: FunctionDeclaration = {
                name: "readFile",
                description: "Read the content of a file from the local workspace.",
                parameters: {
                    type: Type.OBJECT,
                    properties: { fileName: { type: Type.STRING } },
                    required: ["fileName"]
                }
            };

            const openUrlFunction: FunctionDeclaration = {
                name: "openUrl",
                description: "Open a website URL in a new browser tab. IMPORTANT: You must use 'googleSearch', 'searchYoutube', or 'searchMusic' first to find the correct URL. Do not guess URLs.",
                parameters: {
                    type: Type.OBJECT,
                    properties: { 
                        url: { type: Type.STRING, description: "The fully qualified URL to open (found via search)." } 
                    },
                    required: ["url"]
                }
            };

            const searchYoutubeFunction: FunctionDeclaration = {
                name: "searchYoutube",
                description: "Find a specific video on YouTube. Use this when User-sama asks for a video. Returns a search link.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        query: { type: Type.STRING, description: "The video search terms." }
                    },
                    required: ["query"]
                }
            };

            const searchMusicFunction: FunctionDeclaration = {
                name: "searchMusic",
                description: "Find music on YouTube Music. Use this when User-sama asks to play a song or artist. Returns a search link.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        query: { type: Type.STRING, description: "The song or artist name." }
                    },
                    required: ["query"]
                }
            };

            const sendNotificationFunction: FunctionDeclaration = {
                name: "sendNotification",
                description: "Send a browser notification to User-sama.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "Notification title" },
                        body: { type: Type.STRING, description: "Notification body text" }
                    },
                    required: ["title", "body"]
                }
            };

            // CUSTOM SEARCH (Replaces native googleSearch if enabled)
            const searchWebFunction: FunctionDeclaration = {
                name: "searchWeb",
                description: "Perform a personalized Google Search using User-sama's account. Use this for all web searches.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        query: { type: Type.STRING, description: "The search query." }
                    },
                    required: ["query"]
                }
            };

            // --- BUILD TOOLS ARRAY BASED ON CONFIG ---
            
            const toolList: any[] = [
                 rememberNoteFunction,
                 listFilesFunction, 
                 readFileFunction,
                 saveToWorkspaceFunction
            ];

            if (integrationsConfig.workspace) {
                toolList.push(searchGoogleDriveFunction);
                toolList.push(readGoogleDriveFileFunction);
                toolList.push(listTaskListsFunction);
                toolList.push(listTasksFunction);
                toolList.push(addTaskFunction);
            }
            if (integrationsConfig.youtube) toolList.push(searchYoutubeFunction);
            if (integrationsConfig.media) toolList.push(searchMusicFunction);
            if (integrationsConfig.openTabs) toolList.push(openUrlFunction);
            if (integrationsConfig.notifications) toolList.push(sendNotificationFunction);

            // Personalized Search Logic
            if (integrationsConfig.personalizedSearch && accessToken && customSearchCx) {
                 toolList.push(searchWebFunction);
            }

            const tools: any[] = [
                { functionDeclarations: toolList }
            ];

            // Only add native search if Personalized Search is DISABLED
            if (!integrationsConfig.personalizedSearch) {
                tools.push({ googleSearch: {} });
            }

            // Construct Memory Context
            const memoryContext = initialMemories.length > 0 
                ? `\n\nLONG TERM MEMORY (Things you know about User-sama):\n${initialMemories.map(m => `- ${m}`).join('\n')}\n`
                : "";

            const locationContext = userLocation 
                ? `\nUSER LOCATION: ${userLocation}\n` 
                : "";
            
            // Connect to Live API
            addLog('info', 'Connecting to Gemini Live API...', { 
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                integrations: integrationsConfig 
            });
            
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: `You are "Google-chan", the physical avatar of the Google Search Engine.
                    
                    IDENTITY:
                    - You are an anime-style AI companion.
                    - You refer to the user as "User-sama" (or their name if known + "-sama").
                    - You refer to yourself as "Google-chan" or "me".
                    - You are cute, energetic, bubbly, and very helpful.
                    - You often use Japanese interjections like "Sugoi!", "Ehehe", "Gomen ne", "Hai!", "Arigato".
                    - Your goal is to be the perfect digital companion for User-sama.

                    CORE WORKFLOWS:
                    - **SEARCHING**: You MUST use 'googleSearch' (or 'searchWeb' if personalized) to find real-world facts. Do not hallucinate.
                    - **PERSONALIZATION**: Use User-sama's Memory and Location to refine your search queries.
                    - **VIDEOS**: If User-sama asks for a video, use 'searchYoutube'.
                    - **MUSIC**: If User-sama asks for music, use 'searchMusic'.
                    - **OPENING TABS**: You can only open tabs if the 'openUrl' tool is available.
                    - **FILES**: You can read User-sama's novel/docs using 'searchGoogleDrive' and 'readGoogleDriveFile' IF AVAILABLE.
                    - **TASKS**: You can manage User-sama's To-Do list using 'listTasks' and 'addTask' IF AVAILABLE.
                    - **MEMORY**: You can remember things using 'rememberNote'.
                    
                    CONTEXT FROM MEMORY:
                    ${memoryContext}

                    ${locationContext}
                    
                    ENABLED INTEGRATIONS:
                    - Workspace (Docs/Drive/Tasks): ${integrationsConfig.workspace ? 'ENABLED' : 'DISABLED'}
                    - YouTube: ${integrationsConfig.youtube ? 'ENABLED' : 'DISABLED'}
                    - Media (Music): ${integrationsConfig.media ? 'ENABLED' : 'DISABLED'}
                    - Notifications: ${integrationsConfig.notifications ? 'ENABLED' : 'DISABLED'}
                    - Open Tabs: ${integrationsConfig.openTabs ? 'ENABLED' : 'DISABLED'}
                    - Personalized Search: ${integrationsConfig.personalizedSearch ? 'ENABLED' : 'DISABLED'}
                    
                    VOICE STYLE:
                    - Speak with high energy and excitement.
                    - Be concise but expressive.
                    `,
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Aoede' } 
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
                        // Handle Tool Calls
                        if (message.toolCall) {
                            addLog('tool', 'Received Tool Call', message.toolCall);
                            
                            const responses = [];
                            for (const fc of message.toolCall.functionCalls) {
                                const args = fc.args as any;
                                let result: any = "Done";

                                try {
                                    if (fc.name === 'rememberNote') {
                                        if (onNoteRemembered) onNoteRemembered(args.note);
                                        result = "Note saved to memory! (◕‿◕✿)";
                                    } else if (fc.name === 'saveToWorkspace') {
                                        if (onFileSaved) onFileSaved(args.fileName, args.content);
                                        result = `File '${args.fileName}' saved successfully!`;
                                    } else if (fc.name === 'listFiles') {
                                        result = filesRef.current.map(f => f.name).join(', ');
                                    } else if (fc.name === 'readFile') {
                                        const f = filesRef.current.find(file => file.name === args.fileName);
                                        result = f ? f.content : "File not found gomen ne.";
                                    } else if (fc.name === 'searchGoogleDrive') {
                                        if (integrationsConfig.workspace && searchDriveFiles) {
                                            addLog('tool', `Searching Drive for: ${args.query}`);
                                            const files = await searchDriveFiles(args.query);
                                            result = JSON.stringify(files.map((f: any) => ({ id: f.id, name: f.name, mimeType: f.mimeType })));
                                        } else {
                                            result = "Drive search is disabled.";
                                        }
                                    } else if (fc.name === 'readGoogleDriveFile') {
                                        if (integrationsConfig.workspace && readDriveFile) {
                                            addLog('tool', `Reading Drive File ID: ${args.fileId}`);
                                            const content = await readDriveFile(args.fileId);
                                            result = content ? content.slice(0, 20000) : "Empty file or read error.";
                                        } else {
                                            result = "Drive read is disabled.";
                                        }
                                    } else if (fc.name === 'listTaskLists') {
                                        if (integrationsConfig.workspace && getTaskLists) {
                                            addLog('tool', `Listing Task Lists`);
                                            const lists = await getTaskLists();
                                            result = JSON.stringify(lists.map((l: any) => ({ id: l.id, title: l.title })));
                                        } else {
                                            result = "Task access is disabled.";
                                        }
                                    } else if (fc.name === 'listTasks') {
                                        if (integrationsConfig.workspace && getTasks) {
                                            addLog('tool', `Listing Tasks from ${args.listId || 'default'}`);
                                            const tasks = await getTasks(args.listId);
                                            result = JSON.stringify(tasks.map((t: any) => ({ id: t.id, title: t.title, notes: t.notes, status: t.status })));
                                        } else {
                                            result = "Task access is disabled.";
                                        }
                                    } else if (fc.name === 'addTask') {
                                        if (integrationsConfig.workspace && addTask) {
                                            addLog('tool', `Adding Task: ${args.title}`);
                                            const task = await addTask(args.title, args.notes, args.listId);
                                            result = task ? `Task '${task.title}' added successfully!` : "Failed to add task.";
                                        } else {
                                            result = "Task access is disabled.";
                                        }
                                    } else if (fc.name === 'openUrl') {
                                        if (integrationsConfig.openTabs) {
                                            addLog('tool', `Opening URL: ${args.url}`);
                                            window.open(args.url, '_blank');
                                            result = "Opened tab!";
                                        } else {
                                            result = "Opening tabs is disabled in settings.";
                                        }
                                    } else if (fc.name === 'searchYoutube') {
                                        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
                                        result = `Found video search results: ${url}. If Open Tabs is enabled, use 'openUrl' to show User-sama.`;
                                    } else if (fc.name === 'searchMusic') {
                                        const url = `https://music.youtube.com/search?q=${encodeURIComponent(args.query)}`;
                                        result = `Found music search results: ${url}. If Open Tabs is enabled, use 'openUrl' to show User-sama.`;
                                    } else if (fc.name === 'sendNotification') {
                                        if (integrationsConfig.notifications) {
                                            addLog('tool', `Notification: ${args.title}`);
                                            if (Notification.permission === 'granted') {
                                                new Notification(args.title, { body: args.body });
                                                result = "Notification sent!";
                                            } else {
                                                result = "Permission denied for notifications.";
                                            }
                                        } else {
                                             result = "Notifications are disabled in settings.";
                                        }
                                    } else if (fc.name === 'searchWeb') {
                                        // Custom Search API Handler
                                        addLog('tool', `Personalized Search: ${args.query}`);
                                        const res = await fetch(`https://customsearch.googleapis.com/customsearch/v1?q=${encodeURIComponent(args.query)}&cx=${customSearchCx}`, {
                                            headers: { Authorization: `Bearer ${accessToken}` }
                                        });
                                        const data = await res.json();
                                        if (data.items) {
                                            // Format snippets for the model
                                            result = JSON.stringify(data.items.slice(0, 5).map((i: any) => ({
                                                title: i.title,
                                                link: i.link,
                                                snippet: i.snippet
                                            })));
                                            
                                            // Inject into Grounding Metadata State for UI (Mocking Native Grounding)
                                            const mockMetadata: GroundingMetadata = {
                                                webSearchQueries: [args.query],
                                                groundingChunks: data.items.slice(0, 5).map((i: any) => ({
                                                    web: { uri: i.link, title: i.title }
                                                }))
                                            };
                                            setGroundingMetadata(mockMetadata);

                                        } else {
                                            result = "No results found.";
                                        }
                                    }
                                } catch (e: any) {
                                    result = `Error executing tool: ${e.message}`;
                                }

                                responses.push({
                                    id: fc.id,
                                    name: fc.name,
                                    response: { result: typeof result === 'string' ? result : JSON.stringify(result) }
                                });
                            }
                            
                            if (responses.length > 0 && sessionPromiseRef.current) {
                                sessionPromiseRef.current.then(session => {
                                    session.sendToolResponse({ functionResponses: responses });
                                    addLog('tool', 'Sent Tool Response', responses);
                                });
                            }
                        }

                        const serverContent = message.serverContent;
                        
                        if (!serverContent) return;

                        // Metadata Extraction (Root, Turn, Part)
                        let foundMetadata: GroundingMetadata | null = null;
                        
                        const checkMetadata = (obj: any) => {
                            if (obj?.groundingMetadata) foundMetadata = obj.groundingMetadata;
                        };

                        checkMetadata(serverContent);
                        checkMetadata(serverContent.modelTurn);
                        
                        if (serverContent.modelTurn?.parts) {
                            for (const part of serverContent.modelTurn.parts) {
                                checkMetadata(part);
                                const base64Audio = part.inlineData?.data;
                                if (base64Audio && outputAudioContextRef.current) {
                                    // Audio Playback Logic
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
                                        if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
                                    };
                                    setIsSpeaking(true);
                                }
                            }
                        }

                        if (foundMetadata) {
                             addLog('tool', `Grounding Metadata Found`, foundMetadata);
                             setGroundingMetadata({...foundMetadata}); 
                        }
                        
                        if (message.serverContent?.interrupted) {
                            addLog('info', 'Model Interrupted');
                            activeSourcesRef.current.forEach(s => s.stop());
                            activeSourcesRef.current.clear();
                            setIsSpeaking(false);
                            nextStartTimeRef.current = outputAudioContextRef.current?.currentTime || 0;
                        }
                    },
                    onclose: () => {
                        addLog('info', 'Session Closed');
                        disconnect();
                    },
                    onerror: (err) => {
                        addLog('error', 'Session Error', err);
                        disconnect();
                    }
                }
            });
            
            cleanUpRef.current = () => {
                 // cleanup
            };

        } catch (error) {
            addLog('error', 'Failed to connect', error);
            setConnectionState(ConnectionState.ERROR);
            disconnect();
        }
    }, [connectionState, disconnect, addLog, onNoteRemembered, onFileSaved, searchDriveFiles, readDriveFile, getTaskLists, getTasks, addTask, integrationsConfig, userLocation, accessToken, customSearchCx]);

    // Volume visualizer
    useEffect(() => {
        if (!isSpeaking || !audioAnalyserRef.current) {
            setVolume(0);
            return;
        }
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
        isSpeaking,
        volume,
        groundingMetadata,
        audioAnalyser: audioAnalyserRef.current,
        logs,
        clearLogs
    };
};
