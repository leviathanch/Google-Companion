
import React, { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Mic, MicOff, Search, AlertCircle, ExternalLink, LayoutGrid, X, Clock, ChevronDown, ChevronRight, Globe, MapPin, Trash2, Bug, Terminal, Brain, FileText, Upload, FilePlus, Cloud, CloudOff, User, Settings, Copy, Check, MonitorPlay, Smile, Frown, ShieldCheck, Lock, LogOut, Pin, Server, SlidersHorizontal, Music } from 'lucide-react';

import { Avatar3D } from './components/Avatar3D';
import { Loader } from './components/Loader';
import { SettingsModal } from './components/SettingsModal';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useGoogleDrive } from './hooks/useGoogleDrive';
import { useRemoteStorage, SearchHistoryItem } from './hooks/useRemoteStorage';
import { ConnectionState, GroundingChunk, GroundingMetadata, Memory, WorkspaceFile, IntegrationsConfig } from './types';

const DEFAULT_CUSTOM_SEARCH_CX = "05458f6c63b8b40ac";
const GIGGLE_URL = "https://storage.googleapis.com/3d_model/audio/giggle.wav";

const App = () => {
  // --- STATES ---
  
  // Google Drive / Auth
  const { login, logout, user: googleUser, accessToken, isSyncing, clientId, setClientId, searchDriveFiles, readDriveFile, getTaskLists, getTasks, addTask, requestDrivePermissions, requestSearchPermissions } = useGoogleDrive();
  const [isClientIdModalOpen, setIsClientIdModalOpen] = useState(false);
  const [tempClientId, setTempClientId] = useState("");
  const [originCopied, setOriginCopied] = useState(false);

  // Remote Storage API
  const { 
      apiUrl, setApiUrl, isApiConfigOpen, setIsApiConfigOpen,
      fetchMemories, saveMemory: saveMemoryApi, deleteMemory: deleteMemoryApi,
      fetchSearchHistory, saveSearchHistoryItem: saveSearchApi, clearSearchHistory: clearSearchApi,
      fetchConfig, saveConfig: saveConfigApi
  } = useRemoteStorage(accessToken);
  const [tempApiUrl, setTempApiUrl] = useState("");

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

  // Animation Gestures
  const [currentGesture, setCurrentGesture] = useState<string | null>(null);

  // Debug
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const debugScrollRef = useRef<HTMLDivElement>(null);
  
  // Audio Refs
  const giggleAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Refs for Logic
  const latestSearchQueryRef = useRef<string>("");

  // --- INITIALIZATION ---
  
  useEffect(() => {
      giggleAudioRef.current = new Audio(GIGGLE_URL);
      giggleAudioRef.current.volume = 0.6; // Set volume slightly lower so it doesn't blast
  }, []);

  const loadLocalMemories = () => {
      try {
          const storedMem = localStorage.getItem('gem_long_term_memory');
          if (storedMem) {
              return JSON.parse(storedMem).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
          }
      } catch (e) {}
      return [];
  };

  const loadLocalHistory = () => {
      try {
          const storedHist = localStorage.getItem('gem_search_history');
          if (storedHist) {
              return JSON.parse(storedHist).map((h: any) => ({ ...h, timestamp: new Date(h.timestamp) }));
          }
      } catch (e) {}
      return [];
  };

  // Load Settings from LocalStorage
  useEffect(() => {
      try {
          const storedConfig = localStorage.getItem('gem_integrations_config');
          if (storedConfig) {
              setIntegrations(JSON.parse(storedConfig));
          }
      } catch (e) {}
  }, []);

  // Save Settings
  const toggleIntegration = async (key: keyof IntegrationsConfig) => {
      // Check for Drive Permissions Upgrade
      if (key === 'workspace' && !integrations.workspace && accessToken) {
          const granted = await requestDrivePermissions();
          if (!granted) return; 
      }

      // Check for Custom Search Permission Upgrade
      if (key === 'personalizedSearch' && !integrations.personalizedSearch && accessToken) {
          const granted = await requestSearchPermissions();
          if (!granted) return;
      }

      setIntegrations(prev => {
          const next = { ...prev, [key]: !prev[key] };
          localStorage.setItem('gem_integrations_config', JSON.stringify(next));
          
          // Trigger Permission request for Notifications if enabled
          if (key === 'notifications' && next.notifications && "Notification" in window && Notification.permission !== "granted") {
              Notification.requestPermission();
          }
          
          // Sync to Cloud
          if (accessToken && apiUrl) {
             saveConfigApi(next);
          }

          return next;
      });
  };

  useEffect(() => {
      // 1. Request Notification permissions if logged in
      if (accessToken && "Notification" in window && Notification.permission !== "granted" && integrations.notifications) {
         Notification.requestPermission();
      }
      
      // 2. Request Geolocation if logged in (for personalized search)
      if (accessToken && "geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(() => {}, () => {});
      }

      // 3. Load Memories & Sync
      const initData = async () => {
        const localMem = loadLocalMemories();
        const localHist = loadLocalHistory();

        if (accessToken && apiUrl) {
            // Try to fetch Config first
            const cloudConfig = await fetchConfig();
            if (cloudConfig) {
                setIntegrations(cloudConfig);
                localStorage.setItem('gem_integrations_config', JSON.stringify(cloudConfig));
            }

            // Try to fetch Memories
            const cloudMemories = await fetchMemories();
            
            if (cloudMemories === null) {
                 // Error (500/404): Fallback to Local
                 setMemories(localMem);
            } else if (cloudMemories.length > 0) {
                 // Cloud has data: Use it
                 setMemories(cloudMemories);
            } else {
                 // Cloud is empty (200 OK, []) but connected.
                 // If we have local memories, SYNC them up (Initialization)
                 if (localMem.length > 0) {
                     console.log("[Sync] Initializing Cloud DB with Local Memories...");
                     setMemories(localMem);
                     for (const m of localMem) await saveMemoryApi(m);
                 } else {
                     setMemories([]);
                 }
            }

            // Same for Search History
            const cloudHistory = await fetchSearchHistory();
            if (cloudHistory === null) {
                 setSearchHistory(localHist);
            } else if (cloudHistory.length > 0) {
                 setSearchHistory(cloudHistory);
            } else {
                 if (localHist.length > 0) {
                      console.log("[Sync] Initializing Cloud History...");
                      setSearchHistory(localHist);
                      for (const h of localHist) await saveSearchApi(h);
                 } else {
                      setSearchHistory([]);
                 }
            }
        } else {
            // Local Only
            setMemories(localMem);
            setSearchHistory(localHist);
        }
      };
      initData();

      // Load Workspace Files (Local only for now)
      try {
          const storedFiles = localStorage.getItem('gem_workspace_files');
          if (storedFiles) {
              setFiles(JSON.parse(storedFiles));
          }
      } catch (e) { console.error("Failed to load workspace files", e); }
  }, [accessToken, apiUrl, fetchMemories, fetchSearchHistory, fetchConfig, integrations.notifications]);

  // --- PERSISTENCE EFFECTS (Local Backup) ---
  useEffect(() => { localStorage.setItem('gem_long_term_memory', JSON.stringify(memories)); }, [memories]);
  useEffect(() => { localStorage.setItem('gem_search_history', JSON.stringify(searchHistory)); }, [searchHistory]);
  useEffect(() => { localStorage.setItem('gem_workspace_files', JSON.stringify(files)); }, [files]);

  // --- HANDLERS ---

  const triggerGesture = useCallback((gestureName: string) => {
      setCurrentGesture(gestureName);
      // Timeout will be handled by Avatar3D useEffect based on clip duration
      setTimeout(() => setCurrentGesture(null), 100); 
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

  // Google Login Handler
  const handleLogin = () => {
      if (!clientId) {
          setIsClientIdModalOpen(true);
      } else {
          login();
      }
  };

  // Memory Handlers
  const handleNoteRemembered = useCallback((note: string) => {
      const newMemory: Memory = { id: Date.now().toString(), text: note, timestamp: new Date() };
      
      // Update State
      setMemories(prev => [newMemory, ...prev]);
      
      // Save to API if available
      if (accessToken && apiUrl) {
          saveMemoryApi(newMemory);
      }
      
      triggerGesture('HeadNod'); // Confirm memory
  }, [triggerGesture, accessToken, apiUrl, saveMemoryApi]);

  const deleteMemory = (id: string) => {
      setMemories(prev => prev.filter(m => m.id !== id));
      if (accessToken && apiUrl) deleteMemoryApi(id);
  };

  // Pin Helper
  const handlePinItem = (type: 'search' | 'file', item: any) => {
      let note = "";
      if (type === 'search') {
          note = `Remember this resource: "${item.title}" - ${item.uri}`;
      } else if (type === 'file') {
          note = `Remember this document: "${item.name}". Type: ${item.type}. Content snippet: ${item.content.slice(0, 150)}...`;
      }
      if (note) handleNoteRemembered(note);
  };

  // Workspace Handlers
  const handleFileSaved = useCallback((fileName: string, content: string) => {
      const newFile: WorkspaceFile = {
          id: Date.now().toString(),
          name: fileName,
          content: content,
          type: 'text/plain',
          lastModified: Date.now()
      };
      setFiles(prev => {
          const existing = prev.findIndex(f => f.name === fileName);
          if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = newFile;
              return updated;
          }
          return [newFile, ...prev];
      });
      triggerGesture('HeadNod'); // Confirm save
  }, [triggerGesture]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const uploadedFiles = event.target.files;
      if (!uploadedFiles) return;

      Array.from(uploadedFiles).forEach((file: File) => {
          const reader = new FileReader();
          reader.onload = (e) => {
              const content = e.target?.result as string;
              const newFile: WorkspaceFile = {
                  id: Date.now() + Math.random().toString(),
                  name: file.name,
                  content: content,
                  type: file.type || 'text/plain',
                  lastModified: file.lastModified
              };
              setFiles(prev => [...prev, newFile]);
          };
          reader.readAsText(file);
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      triggerGesture('HeadNod');
  };

  const deleteFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
  const clearFiles = () => { setFiles([]); localStorage.removeItem('gem_workspace_files'); };

  // --- HOOK INIT ---
  const { connect, disconnect, connectionState, isSpeaking, volume, groundingMetadata, audioAnalyser, logs, clearLogs } = useGeminiLive({
      onNoteRemembered: handleNoteRemembered,
      onFileSaved: handleFileSaved,
      searchDriveFiles: searchDriveFiles,
      readDriveFile: readDriveFile,
      getTaskLists: getTaskLists,
      getTasks: getTasks,
      addTask: addTask,
      integrationsConfig: integrations,
      accessToken: accessToken,
      customSearchCx: DEFAULT_CUSTOM_SEARCH_CX
  });
  
  const handleToggleConnection = async () => {
    if (connectionState === ConnectionState.CONNECTED) {
      await disconnect();
    } else {
      const memoryTexts = memories.map(m => m.text);
      await connect(memoryTexts, files);
    }
  };

  // --- SEARCH HISTORY LOGIC (SMART MERGE) ---
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
        const newSources = incomingChunks.filter(c => c.web).map(c => ({
            title: c.web!.title, uri: c.web!.uri, type: 'web' as const
        }));

        const isRecent = head && (now - head.id < 10000);
        const isSameQuery = head && head.query === currentQuery;

        let newItem: SearchHistoryItem | null = null;

        if (isRecent && isSameQuery) {
            const existingUris = new Set(head.sources.map(s => s.uri));
            const uniqueNewSources = newSources.filter(s => !existingUris.has(s.uri));
            if (uniqueNewSources.length === 0) return prev;
            const updatedHead = { ...head, sources: [...head.sources, ...uniqueNewSources] };
            newItem = updatedHead;
            // Save API Update
            if (accessToken && apiUrl) saveSearchApi(updatedHead);
            return [updatedHead, ...prev.slice(1)];
        } else {
            newItem = {
                id: now, timestamp: new Date(), query: currentQuery, sources: newSources
            };
            // Save API New
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

  // --- UI HELPERS ---
  const formatTime = (date: Date | string | number) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDate = (date: Date | string | number) => new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const copyOrigin = () => {
      navigator.clipboard.writeText(window.location.origin);
      setOriginCopied(true);
      setTimeout(() => setOriginCopied(false), 2000);
  };

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
           <Avatar3D isSpeaking={isSpeaking} audioAnalyser={audioAnalyser} gesture={currentGesture} onTouch={handleAvatarTouch} />
        </Suspense>
        <OrbitControls target={[0, 1.05, 0]} enableZoom={false} enableRotate={false} enablePan={false} />
      </Canvas>

      {/* --- AUTH GATEKEEPER --- */}
      {!isLoggedIn && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-500">
              <div className="bg-slate-900/80 border border-white/10 p-8 rounded-3xl shadow-2xl backdrop-blur-xl max-w-sm w-full text-center transform transition-all hover:scale-105 duration-500">
                  <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_20px_rgba(59,130,246,0.5)]">
                      <ShieldCheck size={32} className="text-white" />
                  </div>
                  <h1 className="text-2xl font-bold text-white mb-2">Gem Companion</h1>
                  <p className="text-slate-400 mb-8 text-sm leading-relaxed">
                      Please sign in to access your workspace, memories, and personal AI companion.
                  </p>
                  <button 
                    onClick={handleLogin}
                    className="w-full bg-white text-slate-900 font-bold py-3 px-6 rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-3 group"
                  >
                      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                      Sign In with Google
                      <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity -ml-2 group-hover:ml-0" />
                  </button>
                  <div className="flex justify-center mt-6">
                      <button onClick={() => setIsApiConfigOpen(true)} className="text-xs text-slate-600 hover:text-blue-400 flex items-center gap-1">
                          <Server size={10} /> Configure API
                      </button>
                      <button onClick={() => setIsClientIdModalOpen(true)} className="ml-4 text-xs text-slate-600 hover:text-blue-400 flex items-center gap-1">
                          <Settings size={10} /> Configure Client
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Header UI - Left Vertical Stack (Icon Only) - HIDDEN WHEN LOGGED OUT */}
      {isLoggedIn && (
      <div className="absolute top-0 left-0 p-6 flex flex-col gap-4 items-start pointer-events-none z-40 max-h-screen">
        {/* Sign Out Button - Always visible at top left */}
        <button onClick={logout} className="pointer-events-auto bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 transition-all hover:bg-red-900/40 hover:border-red-500/30 hover:scale-105 group relative" title="Sign Out">
            <LogOut size={24} className="text-slate-400 group-hover:text-red-400" />
        </button>

        {/* Feature Badges - Vertical Stack */}
        <div className="flex flex-col gap-3 pointer-events-auto">
             <button onClick={() => setIsMemoryDrawerOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 transition-all hover:bg-slate-800/60 hover:scale-105 group relative" title="Memory">
                <Brain size={24} className="text-pink-400" />
                {memories.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-pink-500 text-[10px] text-white shadow-sm ring-2 ring-[#0a0a12]">{memories.length}</span>}
            </button>
             <button onClick={() => setIsWorkspaceDrawerOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 transition-all hover:bg-slate-800/60 hover:scale-105 group relative" title="Documents">
                <LayoutGrid size={24} className="text-emerald-400" />
                {files.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white shadow-sm ring-2 ring-[#0a0a12]">{files.length}</span>}
            </button>
            <button onClick={() => setIsSearchDrawerOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 transition-all hover:bg-slate-800/60 hover:scale-105 group relative" title="Search History">
                <Search size={24} className="text-indigo-400" />
                {searchHistory.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white shadow-sm ring-2 ring-[#0a0a12]">{searchHistory.length}</span>}
            </button>
            
            {/* NEW SETTINGS BUTTON */}
            <button onClick={() => setIsSettingsOpen(true)} className="bg-slate-900/40 backdrop-blur-xl p-3 rounded-2xl shadow-lg border border-white/10 transition-all hover:bg-slate-800/60 hover:scale-105 group relative" title="Extensions & Settings">
                <SlidersHorizontal size={24} className="text-blue-400" />
            </button>
        </div>
      </div>
      )}

      {/* 1. LEFT DRAWER: Memory */}
      <div className={`absolute top-0 left-0 h-full w-80 bg-slate-950/95 backdrop-blur-xl border-r border-white/10 shadow-2xl transform transition-transform duration-300 ease-out z-50 flex flex-col ${isMemoryDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
         <div className="p-6 border-b border-white/10 bg-slate-900/50">
              <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2 text-slate-100">
                      <Brain size={18} className="text-pink-400" />
                      <h2 className="font-bold text-lg">Memory</h2>
                  </div>
                  <button onClick={() => setIsMemoryDrawerOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
              
              <div className="bg-slate-800/50 rounded-lg p-3 border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                      {googleUser?.picture ? <img src={googleUser.picture} className="w-6 h-6 rounded-full" /> : <User size={16} className="text-slate-400" />}
                      <span className="text-xs text-slate-300 truncate max-w-[150px]">{googleUser?.name || 'Google User'}</span>
                  </div>
                  {apiUrl ? (
                      <div title="Synced to Cloud">
                          <Cloud size={14} className="text-indigo-400" />
                      </div>
                  ) : (
                      <div title="Local Only">
                          <CloudOff size={14} className="text-slate-500" />
                      </div>
                  )}
              </div>
          </div>
          
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 p-4 space-y-3">
              {memories.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-center px-6">
                      <Brain size={48} className="mb-4 opacity-20" />
                      <p className="text-sm font-medium">No memories yet.</p>
                      <p className="text-xs opacity-50 mt-2">Gem remembers important details here.</p>
                  </div>
              ) : (
                  memories.map((memory) => (
                      <div key={memory.id} className="bg-slate-900/60 border border-white/5 rounded-xl p-3 group relative">
                          <p className="text-sm text-slate-300 leading-relaxed pr-6">{memory.text}</p>
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                              <span className="text-[10px] text-slate-500 font-mono">{formatDate(memory.timestamp)}</span>
                          </div>
                          <button onClick={() => deleteMemory(memory.id)} className="absolute top-2 right-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><X size={14} /></button>
                      </div>
                  ))
              )}
          </div>
      </div>

      {/* 2. RIGHT DRAWER: Workspace */}
      <div className={`absolute top-0 right-0 h-full w-96 bg-slate-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transform transition-transform duration-300 ease-out z-50 flex flex-col ${isWorkspaceDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2 text-slate-100">
                  <LayoutGrid size={18} className="text-emerald-400" />
                  <h2 className="font-bold text-lg">Documents</h2>
              </div>
              <div className="flex items-center gap-2">
                 <input type="file" multiple accept=".txt,.md,.json,.js,.ts,.tsx,.py,.csv" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                 <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 px-3 py-1.5 rounded-full text-xs font-bold transition-colors border border-emerald-500/30"><Upload size={12} /> Add File</button>
                {files.length > 0 && <button onClick={clearFiles} className="text-slate-400 hover:text-red-400 transition-colors p-2 hover:bg-white/10 rounded-full"><Trash2 size={16} /></button>}
                <button onClick={() => setIsWorkspaceDrawerOpen(false)} className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
              </div>
          </div>
          
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 p-4 space-y-3">
              {files.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-center px-6 border-2 border-dashed border-slate-800 rounded-xl m-4">
                      <FilePlus size={48} className="mb-4 opacity-20" />
                      <p className="text-sm font-medium">No documents.</p>
                      <p className="text-xs mt-2 opacity-60">Upload text files or code here.</p>
                  </div>
              ) : (
                  files.map((file) => (
                      <div key={file.id} className="bg-slate-900/60 border border-white/5 rounded-xl overflow-hidden">
                           <button onClick={() => setExpandedFileId(expandedFileId === file.id ? null : file.id)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors text-left">
                               <div className="flex items-center gap-3 overflow-hidden">
                                   <div className="bg-slate-800 p-2 rounded text-emerald-400"><FileText size={16} /></div>
                                   <div className="min-w-0"><p className="text-sm font-semibold text-slate-200 truncate">{file.name}</p><p className="text-[10px] text-slate-500 font-mono">{(file.content.length / 1024).toFixed(1)} KB • {formatDate(file.lastModified)}</p></div>
                               </div>
                               {expandedFileId === file.id ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
                           </button>
                           {expandedFileId === file.id && (
                               <div className="bg-black/30 border-t border-white/5 p-3">
                                   <div className="flex justify-end mb-2 gap-2">
                                        <button onClick={() => handlePinItem('file', file)} className="text-xs text-pink-400 hover:text-pink-300 flex items-center gap-1"><Pin size={12} /> Pin to Memory</button>
                                        <button onClick={() => deleteFile(file.id)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"><Trash2 size={12} /> Delete</button>
                                   </div>
                                   <pre className="text-[10px] text-slate-400 font-mono bg-black/50 p-2 rounded border border-white/5 overflow-x-auto max-h-60 scrollbar-thin">{file.content.slice(0, 1000)}{file.content.length > 1000 && '... (truncated)'}</pre>
                               </div>
                           )}
                      </div>
                  ))
              )}
          </div>
      </div>

      {/* 3. RIGHT DRAWER (Alt): Search History */}
      <div className={`absolute top-0 right-0 h-full w-96 bg-slate-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transform transition-transform duration-300 ease-out z-50 flex flex-col ${isSearchDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2 text-slate-100">
                  <Search size={18} className="text-indigo-400" />
                  <h2 className="font-bold text-lg">Search History</h2>
              </div>
              <div className="flex items-center gap-2">
                {searchHistory.length > 0 && <button onClick={() => {
                    setSearchHistory([]); 
                    localStorage.removeItem('gem_search_history');
                    if(accessToken && apiUrl) clearSearchApi();
                }} className="text-slate-400 hover:text-red-400 transition-colors p-2 hover:bg-white/10 rounded-full"><Trash2 size={16} /></button>}
                <button onClick={() => setIsSearchDrawerOpen(false)} className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
              </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 p-4 space-y-3">
              {searchHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-center px-6"><Search size={48} className="mb-4 opacity-20" /><p className="text-sm font-medium">No searches yet.</p></div>
              ) : (
                  searchHistory.map((item) => (
                      <div key={item.id} className="bg-slate-900/60 border border-white/5 rounded-xl overflow-hidden">
                          <button onClick={() => setExpandedHistoryIds(prev => { const s = new Set(prev); s.has(item.id) ? s.delete(item.id) : s.add(item.id); return s; })} className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-white/5">
                              <div className="flex-1 pr-4"><p className="text-sm font-semibold text-slate-200 line-clamp-2">{item.query}</p><div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500 font-mono"><Clock size={10} /> {formatTime(item.timestamp)} • <span className="text-indigo-400">{item.sources.length} Sources</span></div></div>
                              {expandedHistoryIds.has(item.id) ? <ChevronDown size={16} className="text-slate-500 mt-1" /> : <ChevronRight size={16} className="text-slate-500 mt-1" />}
                          </button>
                          
                          {/* Open in Google Button (Personalized Search) */}
                          <div className="px-4 pb-2 flex justify-end">
                               <a 
                                 href={`https://www.google.com/search?q=${encodeURIComponent(item.query)}`} 
                                 target="_blank" 
                                 rel="noopener noreferrer"
                                 className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 hover:underline"
                               >
                                   <ExternalLink size={10} /> Open in Google (Personalized)
                               </a>
                          </div>

                          {expandedHistoryIds.has(item.id) && (
                              <div className="bg-black/20 px-3 py-3 space-y-2 border-t border-white/5">
                                  {item.sources.map((source, idx) => (
                                      <div key={idx} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-white/5 group">
                                          <a href={source.uri} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-start gap-2.5 min-w-0">
                                              <div className="mt-0.5 bg-slate-800 p-1 rounded text-indigo-400 flex-shrink-0">{source.type === 'map' ? <MapPin size={12} /> : <Globe size={12} />}</div>
                                              <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-300 truncate group-hover:text-indigo-300">{source.title}</p><p className="text-[10px] text-slate-600 truncate">{source.uri ? new URL(source.uri).hostname : 'Link'}</p></div>
                                          </a>
                                          <button onClick={() => handlePinItem('search', source)} className="text-slate-600 hover:text-pink-400 p-1 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="Pin to Memory"><Pin size={12} /></button>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  ))
              )}
          </div>
      </div>
      
      {(isSearchDrawerOpen || isMemoryDrawerOpen || isWorkspaceDrawerOpen || isApiConfigOpen || isSettingsOpen) && <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => { setIsSearchDrawerOpen(false); setIsMemoryDrawerOpen(false); setIsWorkspaceDrawerOpen(false); setIsApiConfigOpen(false); setIsSettingsOpen(false); }} />}

      {/* SETTINGS MODAL */}
      <SettingsModal 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)} 
          config={integrations} 
          onToggle={toggleIntegration}
      />

      {/* API Configuration Modal */}
      {isApiConfigOpen && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-[70] flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="bg-purple-500/20 p-2 rounded-lg text-purple-400"><Server size={24} /></div>
                      <h2 className="text-xl font-bold text-white">Backend API Configuration</h2>
                  </div>
                  <p className="text-sm text-slate-400 mb-6">
                      Enter the URL of your deployed Firebase Functions API to enable persistent cloud storage for memories and history.
                  </p>
                  
                  <div className="space-y-2 mb-6">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API URL</label>
                      <input 
                          type="text" 
                          value={tempApiUrl} 
                          onChange={(e) => setTempApiUrl(e.target.value)} 
                          placeholder="https://us-central1-your-project.cloudfunctions.net/api"
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                      />
                  </div>
                  <div className="flex justify-end gap-3">
                      <button onClick={() => setIsApiConfigOpen(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Cancel</button>
                      <button 
                        onClick={() => {
                            if(tempApiUrl) {
                                setApiUrl(tempApiUrl);
                                setIsApiConfigOpen(false);
                            }
                        }}
                        disabled={!tempApiUrl}
                        className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg shadow-lg shadow-purple-600/20 transition-all"
                      >
                          Save
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Client ID Modal */}
      {isClientIdModalOpen && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-[60] flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="bg-blue-500/20 p-2 rounded-lg text-blue-400"><Settings size={24} /></div>
                      <h2 className="text-xl font-bold text-white">Configure Google Client</h2>
                  </div>
                  
                  {/* Origin Warning */}
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
                      <div className="flex items-start gap-2">
                          <AlertCircle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                          <div className="space-y-2">
                             <p className="text-xs text-amber-200/90 font-bold">Incorrect Origin Detected</p>
                             <p className="text-[11px] text-amber-200/70 leading-relaxed">
                                The error <code>redirect_uri=storagerelay://...</code> happens because you are running this inside the <strong>AI Studio Preview Pane</strong>.
                             </p>
                             <p className="text-[11px] text-amber-200/70 leading-relaxed">
                                You MUST open this app in a <strong>New Tab</strong> or <strong>Full Screen</strong> to get a valid URL (Origin) that you can whitelist in Google Cloud Console.
                             </p>
                             
                             <div className="flex items-center gap-2 mt-2">
                                <span className="text-[10px] text-slate-400 uppercase font-bold">Your Real Origin:</span>
                                <div className="flex items-center gap-2 bg-black/40 rounded p-1.5 border border-amber-500/20 flex-1 min-w-0">
                                    <code className="text-[10px] font-mono text-slate-300 truncate flex-1">{window.location.origin}</code>
                                    <button onClick={copyOrigin} className="text-slate-400 hover:text-white">
                                        {originCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                    </button>
                                </div>
                             </div>
                             
                             <div className="mt-2 pt-2 border-t border-amber-500/10 flex items-center gap-2 text-[11px] text-amber-200/80">
                                <MonitorPlay size={12} />
                                <span>Click "Open Preview in New Tab" (top right)</span>
                             </div>
                          </div>
                      </div>
                  </div>

                  <div className="space-y-2 mb-6">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Client ID</label>
                      <input 
                          type="text" 
                          value={tempClientId} 
                          onChange={(e) => setTempClientId(e.target.value)} 
                          placeholder="123456789-abc...apps.googleusercontent.com"
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                      />
                      <p className="text-[10px] text-slate-600">
                        Found in <a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-blue-400 hover:underline">Google Cloud Console</a>.
                      </p>
                  </div>
                  <div className="flex justify-end gap-3">
                      <button onClick={() => setIsClientIdModalOpen(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Cancel</button>
                      <button 
                        onClick={() => {
                            if(tempClientId) {
                                setClientId(tempClientId);
                                setIsClientIdModalOpen(false);
                                setTimeout(() => login(), 100);
                            }
                        }}
                        disabled={!tempClientId}
                        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg shadow-lg shadow-blue-600/20 transition-all"
                      >
                          Save & Connect
                      </button>
                  </div>
              </div>
          </div>
      )}

      {showSources && !isSearchDrawerOpen && groundingMetadata && groundingMetadata.groundingChunks?.length >0 && isLoggedIn && (
          <div className="absolute top-24 right-6 w-80 pointer-events-auto animate-in slide-in-from-right-10 duration-300 z-30 bg-slate-900/90 backdrop-blur-xl p-4 rounded-xl shadow-2xl border border-indigo-500/30">
              <div className="flex items-center justify-between mb-3 text-slate-300">
                  <div className="flex items-center gap-2"><Search size={16} className="text-indigo-400"/><h3 className="font-bold text-sm">New Search Results</h3></div>
                  <button onClick={() => setIsSearchDrawerOpen(true)} className="text-[10px] bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 px-2 py-1 rounded">View History</button>
              </div>
              <div className="space-y-2 max-h-40 overflow-hidden">{groundingMetadata.groundingChunks.slice(0, 3).map((chunk, idx) => chunk.web && (<div key={idx} className="flex items-center gap-2 text-xs text-slate-400"><div className="w-1 h-1 rounded-full bg-indigo-500" /><span className="truncate">{chunk.web.title}</span></div>))}</div>
          </div>
      )}

      {/* MAIN CONTROLS - HIDDEN IF NOT LOGGED IN */}
      {isLoggedIn && (
      <>
        <div className="absolute bottom-10 left-0 w-full flex justify-center items-center pointer-events-none z-30">
           <div className="pointer-events-auto flex flex-col items-center gap-5">
              <div className={`flex items-center justify-center h-12 transition-opacity duration-500 ${isSpeaking ? 'opacity-100' : 'opacity-0'}`}>
                 <div className="flex gap-1.5">{[...Array(5)].map((_, i) => (<div key={i} className="w-1.5 bg-indigo-400/80 rounded-full animate-[bounce_1s_infinite] shadow-[0_0_10px_rgba(129,140,248,0.5)]" style={{ height: `${Math.max(10, volume * 40 + (Math.random() * 20))}px`, animationDelay: `${i * 0.1}s` }} />))}</div>
              </div>
              <button onClick={handleToggleConnection} disabled={connectionState === ConnectionState.CONNECTING} className={`group relative flex items-center justify-center w-16 h-16 rounded-full shadow-[0_0_40px_rgba(0,0,0,0.3)] transition-all duration-300 transform hover:scale-105 ${connectionState === ConnectionState.CONNECTED ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'} disabled:opacity-50 border border-white/10`}>
                  {connectionState === ConnectionState.CONNECTED ? <Mic size={28} /> : <MicOff size={28} />}
                  {connectionState === ConnectionState.CONNECTED && <span className="absolute -inset-1 rounded-full border-2 border-red-500/50 animate-ping opacity-50"></span>}
              </button>
              <p className="text-sm text-slate-400 font-medium bg-slate-900/60 px-4 py-1.5 rounded-full backdrop-blur-md shadow-lg border border-white/5">{connectionState === ConnectionState.CONNECTED ? 'Listening...' : 'Tap to Start'}</p>
           </div>
        </div>

        <button onClick={() => setIsDebugOpen(!isDebugOpen)} className="absolute bottom-6 right-6 pointer-events-auto bg-slate-900/40 backdrop-blur-xl p-3 rounded-full shadow-lg border border-white/10 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-all z-40"><Bug size={18} /></button>
        {isDebugOpen && (
          <div className="absolute bottom-20 right-6 w-[500px] max-w-[90vw] h-96 bg-slate-950/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-40 flex flex-col font-mono text-xs">
              <div className="flex items-center justify-between p-3 border-b border-white/10 bg-slate-900/50">
                  <div className="flex items-center gap-2 text-slate-300"><Terminal size={14} /><span className="font-bold">System Logs</span></div>
                  <div className="flex gap-2">
                      <div className="flex items-center gap-1 mr-2 border-r border-white/10 pr-2">
                          <button onClick={() => triggerGesture('HeadNod')} className="text-emerald-400 hover:bg-emerald-400/10 p-1 rounded" title="Test Nod"><Smile size={14}/></button>
                          <button onClick={() => triggerGesture('HeadShake')} className="text-rose-400 hover:bg-rose-400/10 p-1 rounded" title="Test Shake"><Frown size={14}/></button>
                          <button onClick={() => triggerGesture('Rumba')} className="text-yellow-400 hover:bg-yellow-400/10 p-1 rounded" title="Test Rumba"><Music size={14}/></button>
                      </div>
                      <button onClick={clearLogs} className="text-slate-500 hover:text-red-400 px-2 hover:bg-white/5 rounded">Clear</button>
                      <button onClick={() => setIsDebugOpen(false)} className="text-slate-500 hover:text-white px-2 hover:bg-white/5 rounded">Close</button>
                  </div>
              </div>
              <div ref={debugScrollRef} className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
                  {logs.map((log, i) => (
                      <div key={i} className="flex gap-2 items-start text-slate-300 break-all">
                          <span className="text-slate-600 flex-shrink-0">[{log.time}]</span>
                          <span className={`flex-shrink-0 font-bold uppercase text-[10px] px-1.5 py-0.5 rounded ${log.type === 'info' ? 'bg-blue-500/20 text-blue-400' : log.type === 'model' ? 'bg-purple-500/20 text-purple-400' : log.type === 'tool' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'}`}>{log.type}</span>
                          <div className="flex-1"><span>{log.message}</span>{log.data && <pre className="mt-1 p-2 bg-black/30 rounded text-slate-400 overflow-x-auto">{JSON.stringify(log.data, null, 2)}</pre>}</div>
                      </div>
                  ))}
              </div>
          </div>
        )}
      </>
      )}
    </div>
  );
};

export default App;
