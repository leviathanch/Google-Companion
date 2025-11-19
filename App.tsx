import React, { Suspense, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Mic, MicOff, Search, AlertCircle, ExternalLink, LayoutGrid } from 'lucide-react';

import { Avatar3D } from './components/Avatar3D';
import { Loader } from './components/Loader';
import { useGeminiLive } from './hooks/useGeminiLive';
import { ConnectionState } from './types';

const App = () => {
  const { connect, disconnect, connectionState, isSpeaking, volume, groundingMetadata } = useGeminiLive();
  const [showSources, setShowSources] = useState(false);

  // Auto-show sources when new metadata arrives
  useEffect(() => {
    if (groundingMetadata && groundingMetadata.groundingChunks?.length > 0) {
      setShowSources(true);
      const timer = setTimeout(() => setShowSources(false), 10000); // Hide after 10s
      return () => clearTimeout(timer);
    }
  }, [groundingMetadata]);

  const handleToggleConnection = async () => {
    if (connectionState === ConnectionState.CONNECTED) {
      await disconnect();
    } else {
      await connect();
    }
  };

  const getStatusColor = () => {
    switch (connectionState) {
      case ConnectionState.CONNECTED: return 'bg-emerald-400';
      case ConnectionState.CONNECTING: return 'bg-yellow-400';
      case ConnectionState.ERROR: return 'bg-red-500';
      default: return 'bg-slate-400';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case ConnectionState.CONNECTED: return 'Gemini Connected';
      case ConnectionState.CONNECTING: return 'Connecting...';
      case ConnectionState.ERROR: return 'Connection Error';
      default: return 'Ready to Connect';
    }
  };

  return (
    <div className="relative w-full h-screen bg-[#0a0a12] overflow-hidden">
      {/* Dark Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#13131f] to-[#050508]" />
      
      {/* 3D Scene */}
      <Canvas camera={{ position: [0, 1.4, 3.5], fov: 28 }}>
        {/* Dark Fog for seamless blending */}
        {/* @ts-ignore */}
        <fog attach="fog" args={['#0a0a12', 5, 12]} />
        
        {/* 
           Anime Lighting Setup 
           1. HemisphereLight: Soft, even global illumination (Sky vs Ground) 
           2. AmbientLight: Base brightness filler
        */}
        {/* @ts-ignore */}
        <hemisphereLight args={['#fff0f0', '#f0f0ff', 0.1]} />
        {/* @ts-ignore */}
        <ambientLight intensity={0.15} />
        
        <Suspense fallback={<Loader />}>
           <Avatar3D isSpeaking={isSpeaking} />
        </Suspense>
        
        <OrbitControls 
            target={[0, 1.05, 0]} 
            enableZoom={false}
            enableRotate={false}
            enablePan={false}
        />
      </Canvas>

      {/* Header UI - Dark Theme */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none">
        <div className="pointer-events-auto bg-slate-900/40 backdrop-blur-xl p-4 rounded-2xl shadow-2xl flex items-center space-x-4 border border-white/10 ring-1 ring-black/20">
          <div className="relative">
             <div className={`w-3 h-3 rounded-full ${getStatusColor()} shadow-[0_0_15px_currentColor]`} />
             {connectionState === ConnectionState.CONNECTED && (
                 <div className="absolute top-0 left-0 w-3 h-3 rounded-full bg-emerald-400 animate-ping opacity-50" />
             )}
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100 tracking-tight">Gem Companion</h1>
            <p className="text-xs text-slate-400 font-medium tracking-wide">{getStatusText()}</p>
          </div>
        </div>

        {/* Feature Badges - Dark Theme */}
        <div className="flex gap-2">
             <div className="pointer-events-auto bg-slate-900/40 backdrop-blur-xl p-2 px-4 rounded-full shadow-lg border border-white/10 flex items-center gap-2 text-xs text-slate-300 font-semibold transition-transform hover:scale-105">
                <LayoutGrid size={14} className="text-indigo-400" />
                <span>Workspace</span>
            </div>
            <div className="pointer-events-auto bg-slate-900/40 backdrop-blur-xl p-2 px-4 rounded-full shadow-lg border border-white/10 flex items-center gap-2 text-xs text-slate-300 font-semibold transition-transform hover:scale-105">
                <Search size={14} className="text-indigo-400" />
                <span>Search</span>
            </div>
        </div>
      </div>

      {/* Grounding Sources Card - Dark Theme */}
      {showSources && groundingMetadata && groundingMetadata.groundingChunks?.length > 0 && (
          <div className="absolute top-24 right-6 w-80 pointer-events-auto animate-in slide-in-from-right-10 duration-300">
              <div className="bg-slate-900/80 backdrop-blur-xl p-4 rounded-xl shadow-2xl border border-white/10 ring-1 ring-black/40">
                  <div className="flex items-center gap-2 mb-3 text-slate-300">
                      <Search size={16} className="text-indigo-400"/>
                      <h3 className="font-bold text-sm">Sources</h3>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                      {groundingMetadata.groundingChunks.map((chunk, idx) => (
                          chunk.web ? (
                            <a 
                                key={idx}
                                href={chunk.web.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block group p-2 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/10"
                            >
                                <div className="flex items-start justify-between">
                                    <span className="text-xs font-medium text-slate-200 line-clamp-2 group-hover:text-indigo-300 transition-colors">
                                        {chunk.web.title}
                                    </span>
                                    <ExternalLink size={12} className="text-slate-500 flex-shrink-0 mt-0.5" />
                                </div>
                            </a>
                          ) : null
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* Controls - Dark Theme */}
      <div className="absolute bottom-10 left-0 w-full flex justify-center items-center pointer-events-none z-50">
         <div className="pointer-events-auto flex flex-col items-center gap-5">
            
            {/* Speaking Indicator Wave - Glowing */}
            <div className={`flex items-center justify-center h-12 transition-opacity duration-500 ${isSpeaking ? 'opacity-100' : 'opacity-0'}`}>
               <div className="flex gap-1.5">
                  {[...Array(5)].map((_, i) => (
                     <div 
                        key={i} 
                        className="w-1.5 bg-indigo-400/80 rounded-full animate-[bounce_1s_infinite] shadow-[0_0_10px_rgba(129,140,248,0.5)]" 
                        style={{ 
                            height: `${Math.max(10, volume * 40 + (Math.random() * 20))}px`,
                            animationDelay: `${i * 0.1}s`
                        }} 
                     />
                  ))}
               </div>
            </div>

            <button
                onClick={handleToggleConnection}
                disabled={connectionState === ConnectionState.CONNECTING}
                className={`
                    group relative flex items-center justify-center w-16 h-16 rounded-full shadow-[0_0_40px_rgba(0,0,0,0.3)] transition-all duration-300 transform hover:scale-105
                    ${connectionState === ConnectionState.CONNECTED 
                        ? 'bg-red-500 hover:bg-red-600 text-white' 
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'}
                    disabled:opacity-50 disabled:cursor-not-allowed border border-white/10
                `}
            >
                {connectionState === ConnectionState.CONNECTED ? <Mic size={28} /> : <MicOff size={28} />}
                
                {/* Pulse ring when connected */}
                {connectionState === ConnectionState.CONNECTED && (
                     <span className="absolute -inset-1 rounded-full border-2 border-red-500/50 animate-ping opacity-50"></span>
                )}
            </button>
            
            <p className="text-sm text-slate-400 font-medium bg-slate-900/60 px-4 py-1.5 rounded-full backdrop-blur-md shadow-lg border border-white/5">
                {connectionState === ConnectionState.CONNECTED ? 'Listening...' : 'Tap to Start'}
            </p>
         </div>
      </div>
      
      {/* Error Toast - Dark Theme */}
      {connectionState === ConnectionState.ERROR && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-950/90 border border-red-500/30 text-red-200 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 max-w-md pointer-events-auto backdrop-blur-xl">
            <AlertCircle className="flex-shrink-0 text-red-400" />
            <div>
                <p className="font-bold">Connection Failed</p>
                <p className="text-sm text-red-200/80">Ensure your API Key is valid and microphone permissions are granted.</p>
                <button onClick={() => window.location.reload()} className="mt-2 text-xs font-bold uppercase tracking-wide underline hover:text-white">Reload</button>
            </div>
          </div>
      )}
    </div>
  );
};

export default App;