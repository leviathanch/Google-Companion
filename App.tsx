
import React, { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Mic, MicOff, Search, AlertCircle, ExternalLink, LayoutGrid, X, Clock, ChevronDown, ChevronRight, Globe, MapPin, Trash2, Bug, Terminal, Brain, FileText, Upload, FilePlus, Cloud, CloudOff, User, Settings, Copy, Check, MonitorPlay, Smile, Frown, ShieldCheck, Lock, LogOut, Pin, Server, SlidersHorizontal, Music, Play, Pause, Keyboard, Send, MessageSquare } from 'lucide-react';

import { Avatar3D } from './components/Avatar3D';
import { Loader } from './components/Loader';
import { SettingsModal } from './components/SettingsModal';
import { YouTubePlayer } from './components/YouTubePlayer';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useGoogleDrive } from './hooks/useGoogleDrive';
import { useRemoteStorage, SearchHistoryItem } from './hooks/useRemoteStorage';
import { ConnectionState, GroundingChunk, GroundingMetadata, Memory, WorkspaceFile, IntegrationsConfig, ChatMessage, MusicState, NotificationItem } from './types';

const DEFAULT_CUSTOM_SEARCH_CX = "05458f6c63b8b40ac";
const GIGGLE_URL = "https://storage.googleapis.com/3d_model/audio/giggle.wav";

const App = () => {
  // --- STATES ---
  
  // Google Drive / Auth
  const { login, logout, user: googleUser, accessToken, isSyncing, clientId, setClientId, searchDriveFiles, readDriveFile, getTaskLists, getTasks, addTask, requestDrivePermissions, requestSearchPermissions, requestYoutubePermissions } = useGoogleDrive();
  const [isClientIdModalOpen, setIsClientIdModalOpen] = useState(false);
  const [tempClientId, setTempClientId] = useState("");
  const [originCopied, setOriginCopied] = useState(false);

  // Remote Storage API
  const { 
      apiUrl, setApiUrl, isApiConfigOpen, setIsApiConfigOpen,
      fetchMemories, saveMemory: saveMemoryApi, deleteMemory: deleteMemoryApi,
      fetchSearchHistory, saveSearchHistoryItem: saveSearchApi, deleteSearchHistoryItem: deleteSearchApi, clearSearchHistory: clearSearchApi,
      fetchChatHistory, saveChatMessage: saveChatApi, clearChatHistory: clearChatApi,
      fetchConfig, saveConfig: saveConfigApi,
      fetchNotifications, markNotificationRead
  } = useRemoteStorage(accessToken);
  const [tempApiUrl, setTempApiUrl] = useState("");
  
  // API Key: Prioritize LocalStorage override, then Environment Variable
  const [googleApiKey, setGoogleApiKey] = useState(localStorage.getItem('gem_google_api_key') || process.env.API_KEY || "");
  const [tempGoogleApiKey, setTempGoogleApiKey] = useState("");

  // Memory
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isMemoryDrawerOpen, setIsMemoryDrawerOpen] = useState(false);
  
  // Workspace
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [isWorkspaceDrawerOpen, setIsWorkspaceDrawerOpen] = useState(false);
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search History
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [isSearchDrawerOpen, setIsSearchDrawerOpen] = useState(false);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<number>>(new Set());
  const [showSources, setShowSources] = useState(false);

  // Chat History
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Settings & Integrations
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Default all to FALSE as requested
  const [integrations, setIntegrations] = useState<IntegrationsConfig>({
      workspace: false,
      youtube: false,
      media: false,
      notifications: false,
      openTabs: false,
      personalizedSearch: false
  });

  // Animation Gestures & Expressions
  const [currentGesture, setCurrentGesture] = useState<string | null>(null);
  const [currentExpression, setCurrentExpression] = useState<string>("neutral");
  
  // Music Player & Dance State
  const [musicState, setMusicState] = useState<MusicState | null>(null);
  const [debugDance, setDebugDance] = useState(false);

  // Debug
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const debugScrollRef = useRef<HTMLDivElement>(null);
  
  // Text Chat Mode
  const [isTextMode, setIsTextMode] = useState(false);
  const [textInput, setTextInput] = useState("");
  
  // Audio Refs
  const giggleAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Refs for Logic
  const latestSearchQueryRef = useRef<string>("");

  // Notifications
  const notificationPollInterval = useRef<any>(null);

  // --- INITIALIZATION ---
  
  useEffect(() => {
      giggleAudioRef.current = new Audio(GIGGLE_URL);
      giggleAudioRef.current.volume = 0.6; // Set volume slightly lower so it doesn't blast
  }, []);

  const loadLocalMemories = () => {
      try {
          const stored = localStorage.getItem('gem_long_term_memory');
          if (stored) return JSON.parse(stored).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
      } catch (e) {}
      return [];
  };

  const loadLocalHistory = () => {
      try {
          const stored = localStorage.getItem('gem_search_history');
          if (stored) return JSON.parse(stored).map((h: any) => ({ ...h, timestamp: new Date(h.timestamp) }));
      } catch (e) {}
      return [];
  };

  const loadLocalChat = () => {
      try {
          const stored = localStorage.getItem('gem_chat_history');
          if (stored) return JSON.parse(stored).map((c: any) => ({ ...c, timestamp: new Date(c.timestamp) }));
      } catch (e) {}
      return [];
  };

  // Load Settings
  useEffect(() => {
      try {
          const stored = localStorage.getItem('gem_integrations_config');
          if (stored) setIntegrations(JSON.parse(stored));
      } catch (e) {}
  }, []);

  // Save Settings
  const toggleIntegration = async (key: keyof IntegrationsConfig) => {
      if (key === 'workspace' && !integrations.workspace && accessToken) {
          const granted = await requestDrivePermissions();
          if (!granted) return; 
      }
      if (key === 'personalizedSearch' && !integrations.personalizedSearch && accessToken) {
          const granted = await requestSearchPermissions();
          if (!granted) return;
      }
      if ((key === 'youtube' || key === 'media') && !integrations.youtube && !integrations.media && accessToken) {
          const granted = await requestYoutubePermissions();
          if (!granted) return;
      }

      setIntegrations(prev => {
          const next = { ...prev, [key]: !prev[key] };
          localStorage.setItem('gem_integrations_config', JSON.stringify(next));
          if (key === 'notifications' && next.notifications && "Notification" in window && Notification.permission !== "granted") {
              Notification.requestPermission();
          }
          if (accessToken && apiUrl) saveConfigApi(next);
          return next;
      });
  };

  useEffect(() => {
      if (accessToken && "Notification" in window && Notification.permission !== "granted" && integrations.notifications) {
         Notification.requestPermission();
      }
      if (accessToken && "geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(() => {}, () => {});
      }

      // Load Data
      const initData = async () => {
        const localMem = loadLocalMemories();
        const localHist = loadLocalHistory();
        const localChat = loadLocalChat();

        if (accessToken && apiUrl) {
            const cloudConfig = await fetchConfig();
            if (cloudConfig) {
                setIntegrations(cloudConfig);
                localStorage.setItem('gem_integrations_config', JSON.stringify(cloudConfig));
            }

            const cloudMemories = await fetchMemories();
            setMemories(cloudMemories !== null ? cloudMemories : localMem);

            const cloudHistory = await fetchSearchHistory();
            setSearchHistory(cloudHistory !== null ? cloudHistory : localHist);

            const cloudChat = await fetchChatHistory();
            setChatHistory(cloudChat !== null ? cloudChat : localChat);
        } else {
            setMemories(localMem);
            setSearchHistory(localHist);
            setChatHistory(localChat);
        }
      };
      initData();

      try {
          const storedFiles = localStorage.getItem('gem_workspace_files');
          if (storedFiles) setFiles(JSON.parse(storedFiles));
      } catch (e) {}
  }, [accessToken, apiUrl, fetchMemories, fetchSearchHistory, fetchChatHistory, fetchConfig, integrations.notifications]);

  // --- NOTIFICATION POLLING ---
  useEffect(() => {
      if (!accessToken || !apiUrl || !integrations.notifications) {
          if (notificationPollInterval.current) {
              clearInterval(notificationPollInterval.current);
              notificationPollInterval.current = null;
          }
          return;
      }

      const pollNotifications = async () => {
          const notifications = await fetchNotifications();
          if (notifications && notifications.length > 0) {
              notifications.forEach(async (n) => {
                  if (!n.read) {
                      // 1. Browser Notification
                      if (Notification.permission === 'granted') {
                          new Notification(n.title, { body: n.body });
                      }
                      
                      // 2. Inject into Chat (Give her agency)
                      const chatMsg: ChatMessage = {
                          id: Date.now().toString() + '-proactive',
                          role: 'model',
                          text: `Hey! I found something interesting: ${n.title} - ${n.body}`,
                          timestamp: new Date()
                      };
                      setChatHistory(prev => [...prev, chatMsg]);
                      if(accessToken && apiUrl) saveChatApi(chatMsg);
                      
                      // 3. Mark Read
                      await markNotificationRead(n.id);
                  }
              });
          }
      };

      // Poll every 60 seconds
      notificationPollInterval.current = setInterval(pollNotifications, 60000);
      // Initial poll
      pollNotifications();

      return () => {
          if (notificationPollInterval.current) clearInterval(notificationPollInterval.current);
      };
  }, [accessToken, apiUrl, integrations.notifications, fetchNotifications, markNotificationRead, saveChatApi]);


  // --- PERSISTENCE EFFECTS ---
  useEffect(() => { localStorage.setItem('gem_long_term_memory', JSON.stringify(memories)); }, [memories]);
  useEffect(() => { localStorage.setItem('gem_search_history', JSON.stringify(searchHistory)); }, [searchHistory]);
  useEffect(() => { localStorage.setItem('gem_chat_history', JSON.stringify(chatHistory)); }, [chatHistory]);
  useEffect(() => { localStorage.setItem('gem_workspace_files', JSON.stringify(files)); }, [files]);

  // --- HANDLERS ---

  const triggerGesture = useCallback((gestureName: string) => {
      setCurrentGesture(gestureName);
      setTimeout(() => setCurrentGesture(null), 100); 
  }, []);

  const handleExpressionChange = useCallback((expression: string) => {
      setCurrentExpression(expression);
      if (expression !== 'neutral') {
          setTimeout(() => setCurrentExpression('neutral'), 1000);
      }
  }, []);

  const handleAvatarTouch = useCallback((bodyPart: string) => {
      if (bodyPart === 'chest') {
          triggerGesture('HeadShake');
          if (giggleAudioRef.current) {
              giggleAudioRef.current.currentTime = 0;
              giggleAudioRef.current.play().catch(e => console.warn("Audio playback failed:", e));
          }
      }
  }, [triggerGesture]);

  const handleLogin = () => {
      if (!clientId) setIsClientIdModalOpen(true);
      else login();
  };

  const handleNoteRemembered = useCallback((note: string) => {
      const newMemory: Memory = { id: Date.now().toString(), text: note, timestamp: new Date() };
      setMemories(prev => [newMemory, ...prev]);
      if (accessToken && apiUrl) saveMemoryApi(newMemory);
      triggerGesture('HeadNod');
  }, [triggerGesture, accessToken, apiUrl, saveMemoryApi]);

  const deleteMemory = (id: string) => {
      setMemories(prev => prev.filter(m => m.id !== id));
      if (accessToken && apiUrl) deleteMemoryApi(id);
  };

  const handlePinItem = (type: 'search' | 'file', item: any) => {
      let note = "";
      if (type === 'search') note = `Remember this resource: "${item.title}" - ${item.uri}`;
      else if (type === 'file') note = `Remember this document: "${item.name}". Type: ${item.type}.`;
      if (note) handleNoteRemembered(note);
  };

  const handleFileSaved = useCallback((fileName: string, content: string) => {
      const newFile: WorkspaceFile = {
          id: Date.now().toString(),
          name: fileName,
          content: content,
          type: 'text/plain',
          lastModified: Date.now()
      };
      setFiles(prev => {
          const idx = prev.findIndex(f => f.name === fileName);
          if (idx >= 0) { const up = [...prev]; up[idx] = newFile; return up; }
          return [newFile, ...prev];
      });
      triggerGesture('HeadNod');
  }, [triggerGesture]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const uploadedFiles = event.target.files;
      if (!uploadedFiles) return;
      Array.from(uploadedFiles).forEach((file: File) => {
          const reader = new FileReader();
          reader.onload = (e) => {
              setFiles(prev => [...prev, {
                  id: Date.now() + Math.random().toString(),
                  name: file.name,
                  content: e.target?.result as string,
                  type: file.type || 'text/plain',
                  lastModified: file.lastModified
              }]);
          };
          reader.readAsText(file);
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      triggerGesture('HeadNod');
  };

  const deleteFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
  const clearFiles = () => { setFiles([]); localStorage.removeItem('gem_workspace_files'); };

  const handlePlayMusic = useCallback((val: string, type: 'id' | 'query' = 'query') => { 
      setMusicState({ type, value: val }); 
  }, []);

  const handleChatUpdate = useCallback((message: ChatMessage) => {
      setChatHistory(prev => [...prev, message]);
      if (accessToken && apiUrl) saveChatApi(message);
  }, [accessToken, apiUrl, saveChatApi]);

  const handleDeleteSearchItem = (id: number) => {
      setSearchHistory(prev => prev.filter(item => item.id !== id));
      if (accessToken && apiUrl) deleteSearchApi(id);
  };

  const saveGoogleApiKey = () => {
      if (tempGoogleApiKey) {
          setGoogleApiKey(tempGoogleApiKey);
          localStorage.setItem('gem_google_api_key', tempGoogleApiKey);
          setTempGoogleApiKey("");
          setIsApiConfigOpen(false);
      }
  };

  const resetApp = () => {
      localStorage.clear();
      window.location.reload();
  };

  // --- HOOK INIT ---
  const { connect, disconnect, sendTextMessage, connectionState, isSpeaking, volume, groundingMetadata, audioAnalyser, logs, clearLogs } = useGeminiLive({
      onNoteRemembered: handleNoteRemembered,
      onFileSaved: handleFileSaved,
      onPlayMusic: handlePlayMusic,
      onChatUpdate: handleChatUpdate,
      onExpressionChange: handleExpressionChange,
      searchDriveFiles: searchDriveFiles,
      readDriveFile: readDriveFile,
      getTaskLists: getTaskLists,
      getTasks: getTasks,
      addTask: addTask,
      integrationsConfig: integrations,
      accessToken: accessToken,
      customSearchCx: DEFAULT_CUSTOM_SEARCH_CX,
      // Gate Mic: When Music is Playing OR Text Mode is Active
      isMusicPlaying: !!musicState || isTextMode,
      apiKey: googleApiKey
  });
  
  const handleToggleConnection = async () => {
    if (connectionState === ConnectionState.CONNECTED) {
      await disconnect();
    } else {
      const memoryTexts = memories.map(m => m.text);
      await connect(memoryTexts, files);
    }
  };

  // Scroll chat to bottom
  useEffect(() => {
      if (isChatDrawerOpen && chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
  }, [chatHistory, isChatDrawerOpen]);

  // --- SEARCH HISTORY LOGIC ---
  useEffect(() => {
    if (!groundingMetadata) return;
    const { webSearchQueries, groundingChunks } = groundingMetadata;
    const incomingQuery = webSearchQueries?.[0];
    const incomingChunks = groundingChunks || [];
    if (incomingQuery) latestSearchQueryRef.current = incomingQuery;
    const currentQuery = latestSearchQueryRef.current;
    if (!currentQuery && incomingChunks.length === 0) return;

    setSearchHistory(prev => {
        const now = Date.now();
        const head = prev[0];
        const newSources = incomingChunks.filter(c => c.web).map(c => ({ title: c.web!.title, uri: c.web!.uri, type: 'web' as const }));
        const isRecent = head && (now - head.id < 10000);
        const isSameQuery = head && head.query === currentQuery;

        if (isRecent && isSameQuery) {
            const existingUris = new Set(head.sources.map(s => s.uri));
            const uniqueNewSources = newSources.filter(s => !existingUris.has(s.uri));
            if (uniqueNewSources.length === 0) return prev;
            const updatedHead = { ...head, sources: [...head.sources, ...uniqueNewSources] };
            if (accessToken && apiUrl) saveSearchApi(updatedHead);
            return [updatedHead, ...prev.slice(1)];
        } else {
            const newItem: SearchHistoryItem = { id: now, timestamp: new Date(), query: currentQuery, sources: newSources };
            if (accessToken && apiUrl) saveSearchApi(newItem);
            return [newItem, ...prev];
        }
    });

    if (incomingChunks.length > 0) {
        setShowSources(true);
        const timer = setTimeout(() => setShowSources(false), 8000);
        return () => clearTimeout(timer);
    }
  }, [groundingMetadata, accessToken, apiUrl, saveSearchApi]);

  useEffect(() => {
    if (isDebugOpen && debugScrollRef.current) {
        debugScrollRef.current.scrollTop = debugScrollRef.current.scrollHeight;
    }
  }, [logs, isDebugOpen]);

  const formatTime = (date: Date | string | number) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDate = (date: Date | string | number) => new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const copyOrigin = () => { navigator.clipboard.writeText(window.location.origin); setOriginCopied(true); setTimeout(() => setOriginCopied(false), 2000); };
  const isLoggedIn = !!accessToken;

  return (
    <div className="relative w-full h-screen bg-[#0a0a12] overflow-hidden font-sans">
      <div className="absolute inset-0 bg-gradient-to-b from-[#13131f] to-[#050508]" />
      
      <Canvas camera={{ position: [0, 1.4, 3.5], fov: 28 }} shadows={false}>
        {/* @ts-ignore */}
        <fog attach="fog" args={['#0a0a12', 5, 12]} />
        {/* @ts-ignore */}
        <hemisphereLight args={['#fff0f0', '#f0f0ff', 0.2]} />
        {/* @ts-ignore */}
        <ambientLight intensity={0.3} />
        <Suspense fallback={<Loader />}>
           <Avatar3D 
             isSpeaking={isSpeaking} 
             audioAnalyser={audioAnalyser} 
             gesture={currentGesture} 
             expression={currentExpression}
             isDancing={!!musicState || debugDance} 
             onTouch={handleAvatarTouch} 
           />
        </Suspense>
        <OrbitControls target={[0, 1.05, 0]} enableZoom={false} enableRotate={false} enablePan={false} />
      </Canvas>

      {/* AUTH OVERLAY */}
      {!isLoggedIn && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-500">
              <div className="bg-slate-900/80 border border-white/10 p-8 rounded-3xl shadow-2xl backdrop-blur-xl max-w-sm w-full text-center">
                  <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_20px_rgba(59,130,246,0.5)]">
                      <ShieldCheck size={32} className="text-white" />
                  </div>
                  <h1 className="text-2xl font-bold text-white mb-2">Gem Companion</h1>
                  <p className="text-slate-400 mb-8 text-sm leading-relaxed">Sign in to access your workspace, memories, and personal AI companion.</p>
                  <button onClick={handleLogin} className="w-full bg-white text-slate-900 font-bold py-3 px-6 rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-3 group">
                      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" /> Sign In with Google <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity -ml-2 group-hover:ml-0" />
                  </button>
                  <div className="flex justify-center mt-6">
                      <button onClick={() => setIsApiConfigOpen(true)} className="text-xs text-slate-600 hover:text-blue-400 flex items-center gap-1"><Server size={10} /> Configure API</button>
                      <button onClick={() => setIsClientIdModalOpen(true)} className="ml-4 text-xs text-slate-600 hover:text-blue-400 flex items-center gap-1"><Settings size={10} /> Configure Client</button>
                  </div>
              </div>
          </div>
      )}

      {/* SIDEBAR */}
      {isLoggedIn && (
      <div className="absolute top-0 left-0 p-6 flex flex-col gap-4 items-start pointer-events-none z-40 max-h-screen">
        <button onClick={logout} className="pointer-events-auto bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 transition-all hover:bg-red-900/40 hover:border-red-500/30 hover:scale-105 group relative"><LogOut size={24} className="text-slate-400 group-hover:text-red-400" /></button>
        <div className="flex flex-col gap-3 pointer-events-auto">
             <button onClick={() => setIsMemoryDrawerOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 hover:bg-slate-800/60 relative">
                <Brain size={24} className="text-pink-400" />
                {memories.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-pink-500 text-[10px] text-white">{memories.length}</span>}
            </button>
             <button onClick={() => setIsWorkspaceDrawerOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 hover:bg-slate-800/60 relative">
                <LayoutGrid size={24} className="text-emerald-400" />
                {files.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">{files.length}</span>}
            </button>
            <button onClick={() => setIsSearchDrawerOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 hover:bg-slate-800/60 relative">
                <Search size={24} className="text-indigo-400" />
                {searchHistory.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white">{searchHistory.length}</span>}
            </button>
            <button onClick={() => setIsChatDrawerOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 hover:bg-slate-800/60 relative">
                <MessageSquare size={24} className="text-cyan-400" />
                {chatHistory.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-[10px] text-white">{chatHistory.length}</span>}
            </button>
            <button onClick={() => setIsSettingsOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 hover:bg-slate-800/60 relative"><SlidersHorizontal size={24} className="text-blue-400" /></button>
        </div>
      </div>
      )}

      {/* DRAWERS */}
      {/* Memory Drawer */}
      <div className={`absolute top-0 left-0 h-full w-80 bg-slate-950/95 backdrop-blur-xl border-r border-white/10 shadow-2xl transition-transform duration-300 z-50 flex flex-col ${isMemoryDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
         <div className="p-6 border-b border-white/10 bg-slate-900/50 flex justify-between items-center">
              <div className="flex items-center gap-2 text-slate-100"><Brain size={18} className="text-pink-400" /><h2 className="font-bold text-lg">Memory</h2></div>
              <button onClick={() => setIsMemoryDrawerOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {memories.map((m) => (
                  <div key={m.id} className="bg-slate-900/60 border border-white/5 rounded-xl p-3 group relative">
                      <p className="text-sm text-slate-300 leading-relaxed pr-6">{m.text}</p>
                      <span className="text-[10px] text-slate-500 font-mono mt-2 block">{formatDate(m.timestamp)}</span>
                      <button onClick={() => deleteMemory(m.id)} className="absolute top-2 right-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><X size={14} /></button>
                  </div>
              ))}
          </div>
      </div>

      {/* Chat History Drawer */}
      <div className={`absolute top-0 right-0 h-full w-96 bg-slate-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 z-50 flex flex-col ${isChatDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2 text-slate-100"><MessageSquare size={18} className="text-cyan-400" /><h2 className="font-bold text-lg">Chat History</h2></div>
              <div className="flex gap-2">
                  <button onClick={() => { setChatHistory([]); if(accessToken && apiUrl) clearChatApi(); }} className="text-slate-400 hover:text-red-400 p-2 hover:bg-white/10 rounded-full"><Trash2 size={16} /></button>
                  <button onClick={() => setIsChatDrawerOpen(false)} className="text-slate-400 hover:text-white p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
              </div>
          </div>
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-700">
              {chatHistory.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-3 rounded-xl text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none'}`}>
                          <p>{msg.text}</p>
                          <span className="text-[10px] opacity-50 block mt-1 text-right">{formatTime(msg.timestamp)}</span>
                      </div>
                  </div>
              ))}
          </div>
      </div>

      {/* Search History Drawer */}
      <div className={`absolute top-0 right-0 h-full w-96 bg-slate-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 z-50 flex flex-col ${isSearchDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2 text-slate-100"><Search size={18} className="text-indigo-400" /><h2 className="font-bold text-lg">Search History</h2></div>
              <button onClick={() => setIsSearchDrawerOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {searchHistory.map((item) => (
                  <div key={item.id} className="bg-slate-900/60 border border-white/5 rounded-xl overflow-hidden group relative">
                      <div className="p-3 hover:bg-white/5 cursor-pointer" onClick={() => setExpandedHistoryIds(prev => { const s = new Set(prev); s.has(item.id) ? s.delete(item.id) : s.add(item.id); return s; })}>
                          <div className="pr-6">
                              <p className="text-sm font-semibold text-slate-200 truncate">{item.query}</p>
                              <div className="flex justify-between mt-2 text-[10px] text-slate-500">
                                  <span>{formatTime(item.timestamp)} • {item.sources.length} Sources</span>
                                  {expandedHistoryIds.has(item.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </div>
                          </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteSearchItem(item.id); }} className="absolute top-3 right-3 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                      {expandedHistoryIds.has(item.id) && (
                          <div className="bg-black/20 px-3 py-3 space-y-2 border-t border-white/5">
                              <div className="flex items-center justify-between text-xs text-slate-300 border-b border-white/5 pb-2 mb-2">
                                  <span className="text-slate-500">Actions</span>
                                  <div title="Open query in Google Search" className="cursor-pointer">
                                      <a href={`https://www.google.com/search?q=${encodeURIComponent(item.query)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
                                          <ExternalLink size={12}/> Open in Google
                                      </a>
                                  </div>
                              </div>
                              {item.sources.map((s, i) => (
                                  <div key={i} className="flex items-center justify-between text-xs text-slate-300">
                                      <div className="flex items-center gap-2 truncate flex-1">
                                          <div title={s.title} className="truncate hover:text-indigo-400 flex-1">
                                              <a href={s.uri} target="_blank" rel="noopener noreferrer" className="truncate hover:text-indigo-400 flex-1">{s.title}</a>
                                          </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                          <button onClick={() => handlePinItem('search', s)} title="Pin to Memory" className="text-slate-600 hover:text-pink-400"><Pin size={12} /></button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              ))}
          </div>
      </div>

      {/* Workspace Drawer (Omitted for brevity, same structure) */}
      <div className={`absolute top-0 right-0 h-full w-96 bg-slate-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 z-50 flex flex-col ${isWorkspaceDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2 text-slate-100"><LayoutGrid size={18} className="text-emerald-400" /><h2 className="font-bold text-lg">Documents</h2></div>
              <div className="flex gap-2">
                 <input type="file" multiple accept=".txt,.md,.json,.js,.ts,.tsx" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                 <button onClick={() => fileInputRef.current?.click()} className="bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full text-xs font-bold border border-emerald-500/30 flex gap-1 items-center"><Upload size={12}/> Add</button>
                 <button onClick={() => setIsWorkspaceDrawerOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {files.map(f => (
                  <div key={f.id} className="bg-slate-900/60 border border-white/5 rounded-xl overflow-hidden">
                      <div className="p-3 flex justify-between items-center hover:bg-white/5 cursor-pointer" onClick={() => setExpandedFileId(expandedFileId === f.id ? null : f.id)}>
                          <div className="flex items-center gap-2 overflow-hidden">
                              <FileText size={16} className="text-emerald-400 flex-shrink-0"/>
                              <span className="text-sm text-slate-200 truncate">{f.name}</span>
                          </div>
                          {expandedFileId === f.id ? <ChevronDown size={14} className="text-slate-500"/> : <ChevronRight size={14} className="text-slate-500"/>}
                      </div>
                      {expandedFileId === f.id && (
                          <div className="bg-black/30 border-t border-white/5 p-3">
                              <div className="flex justify-end mb-2 gap-2">
                                  <button onClick={() => handlePinItem('file', f)} className="text-pink-400 text-xs flex gap-1 items-center"><Pin size={10}/> Pin</button>
                                  <button onClick={() => deleteFile(f.id)} className="text-red-400 text-xs flex gap-1 items-center"><Trash2 size={10}/> Delete</button>
                              </div>
                              <pre className="text-[10px] text-slate-400 font-mono bg-black/50 p-2 rounded overflow-auto max-h-40">{f.content.slice(0, 500)}</pre>
                          </div>
                      )}
                  </div>
              ))}
          </div>
      </div>

      {(isSearchDrawerOpen || isMemoryDrawerOpen || isWorkspaceDrawerOpen || isApiConfigOpen || isSettingsOpen || isChatDrawerOpen) && <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => { setIsSearchDrawerOpen(false); setIsMemoryDrawerOpen(false); setIsWorkspaceDrawerOpen(false); setIsApiConfigOpen(false); setIsSettingsOpen(false); setIsChatDrawerOpen(false); }} />}

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={integrations} onToggle={toggleIntegration} />

      {/* MUSIC PLAYER */}
      {musicState && (
          <YouTubePlayer 
            videoId={musicState.type === 'id' ? musicState.value : undefined}
            searchQuery={musicState.type === 'query' ? musicState.value : undefined}
            onClose={() => setMusicState(null)}
          />
      )}

      {/* API Config & Client ID Modals */}
      {isApiConfigOpen && (
          <div className="absolute inset-0 bg-black/80 z-[70] flex items-center justify-center p-4">
              <div className="bg-slate-900 p-6 rounded-2xl w-full max-w-md border border-white/10">
                  <h2 className="text-white font-bold mb-4">API Config</h2>
                  
                  <label className="text-xs text-slate-400 block mb-1">Backend API URL (Firebase)</label>
                  <input value={tempApiUrl} onChange={e => setTempApiUrl(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded p-2 text-white mb-4" placeholder="https://..." />
                  
                  <label className="text-xs text-slate-400 block mb-1">Google API Key (Search/YouTube)</label>
                  <input value={tempGoogleApiKey} onChange={e => setTempGoogleApiKey(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded p-2 text-white mb-4" placeholder="AIza..." type="password" />
                  
                  <div className="flex justify-end gap-2">
                      <button onClick={() => setIsApiConfigOpen(false)} className="text-slate-400 px-4">Cancel</button>
                      <button onClick={() => { 
                          if(tempApiUrl) setApiUrl(tempApiUrl); 
                          saveGoogleApiKey();
                          setIsApiConfigOpen(false); 
                      }} className="bg-blue-600 text-white px-4 py-2 rounded">Save</button>
                  </div>
              </div>
          </div>
      )}
      {isClientIdModalOpen && (
          <div className="absolute inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
              <div className="bg-slate-900 p-6 rounded-2xl w-full max-w-md border border-white/10">
                  <h2 className="text-white font-bold mb-4">Client ID</h2>
                  <input value={tempClientId} onChange={e => setTempClientId(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded p-2 text-white mb-4" placeholder="Client ID" />
                  <div className="flex justify-end gap-2"><button onClick={() => setIsClientIdModalOpen(false)} className="text-slate-400 px-4">Cancel</button><button onClick={() => { if(tempClientId) { setClientId(tempClientId); setIsClientIdModalOpen(false); setTimeout(login, 100); }}} className="bg-blue-600 text-white px-4 py-2 rounded">Save</button></div>
              </div>
          </div>
      )}

      {/* MAIN CONTROLS */}
      {isLoggedIn && (
        <div className="absolute bottom-10 left-0 w-full flex justify-center pointer-events-none z-30">
           <div className="pointer-events-auto flex flex-col items-center gap-5">
              {!isTextMode && <div className={`h-12 flex items-center gap-1 transition-opacity ${isSpeaking ? 'opacity-100' : 'opacity-0'}`}>{[...Array(5)].map((_, i) => <div key={i} className="w-1 bg-indigo-400 rounded-full animate-bounce" style={{ height: Math.max(10, volume * 40) + 'px', animationDelay: i * 0.1 + 's' }} />)}</div>}
              
              <div className="flex items-end gap-4">
                  <button onClick={() => setIsTextMode(!isTextMode)} className="bg-slate-900/60 p-3 rounded-full border border-white/10 text-slate-400 hover:text-white">{isTextMode ? <Mic size={20} /> : <Keyboard size={20} />}</button>
                  {isTextMode ? (
                      connectionState === ConnectionState.CONNECTED ? (
                          <div className="flex gap-2 bg-slate-900/80 p-2 rounded-2xl border border-white/10 w-80">
                              <input type="text" value={textInput} onChange={e => setTextInput(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&textInput.trim()){ sendTextMessage(textInput); setTextInput(''); }}} className="flex-1 bg-transparent text-white px-2 outline-none text-sm" placeholder="Type..." autoFocus />
                              <button onClick={() => { if(textInput.trim()) { sendTextMessage(textInput); setTextInput(''); }}} className="bg-blue-600 p-2 rounded-xl text-white"><Send size={16}/></button>
                          </div>
                      ) : (
                          <button onClick={handleToggleConnection} className="bg-indigo-600 text-white font-bold py-3 px-6 rounded-full flex items-center gap-2">Start Chat</button>
                      )
                  ) : (
                      <button onClick={handleToggleConnection} className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 ${connectionState === ConnectionState.CONNECTED ? 'bg-red-500' : 'bg-indigo-600'}`}>{connectionState === ConnectionState.CONNECTED ? <Mic size={24} className="sm:w-7 sm:h-7" /> : <MicOff size={24} className="sm:w-7 sm:h-7" />}</button>
                  )}
                  <div className="w-12" />
              </div>
           </div>
        </div>
      )}

      {/* Debug Log */}
      <button onClick={() => setIsDebugOpen(!isDebugOpen)} className="absolute bottom-6 right-6 pointer-events-auto bg-slate-900/40 p-3 rounded-full text-slate-400 hover:text-indigo-400 z-40"><Bug size={18} /></button>
      {isDebugOpen && (
          <div className="absolute bottom-20 right-6 w-[500px] h-96 bg-slate-950/95 border border-white/10 rounded-xl z-40 flex flex-col font-mono text-xs">
              <div className="p-2 border-b border-white/10 flex justify-between bg-slate-900/50"><span className="text-slate-300 font-bold">Logs</span><div className="flex gap-2"><button onClick={() => setDebugDance(!debugDance)} className="text-yellow-400"><Music size={14}/></button><button onClick={resetApp} className="text-red-400">Reset App</button><button onClick={clearLogs} className="text-red-400">Clear</button><button onClick={() => setIsDebugOpen(false)}>X</button></div></div>
              <div ref={debugScrollRef} className="flex-1 overflow-y-auto p-2 space-y-1">
                  {logs.map((l, i) => (
                      <div key={i} className="text-slate-300">
                          <span className="text-slate-500">[{l.time}]</span> <span className="text-blue-400">{l.type}</span> {l.message}
                          {l.data && <div className="text-[10px] text-slate-500 bg-black/30 p-1 rounded mt-1 overflow-x-auto whitespace-pre-wrap break-all">{typeof l.data === 'string' ? l.data : JSON.stringify(l.data, null, 2)}</div>}
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
