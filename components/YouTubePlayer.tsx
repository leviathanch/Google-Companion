
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface YouTubePlayerProps {
  videoId?: string;
  searchQuery?: string;
  onClose: () => void;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({ videoId, searchQuery, onClose }) => {
  const playerRef = useRef<HTMLDivElement>(null);
  const playerInstanceRef = useRef<any>(null);

  useEffect(() => {
    // 1. Load API if not present
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    // 2. Initialize Player
    const initPlayer = () => {
      if (!playerRef.current || !window.YT) return;

      // Destroy existing instance if any
      if (playerInstanceRef.current) {
        playerInstanceRef.current.destroy();
      }

      const playerConfig: any = {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          controls: 1,
        },
        events: {
          onStateChange: (event: any) => {
            // YT.PlayerState.ENDED === 0
            if (event.data === 0) {
              onClose();
            }
          },
          onError: (e: any) => {
             console.warn("YouTube Player Error:", e);
             // Auto-close on unplayable videos to prevent stuck UI
             if (e.data === 100 || e.data === 101 || e.data === 150) {
                 onClose();
             }
          }
        },
      };

      if (videoId) {
        playerConfig.videoId = videoId;
      } else if (searchQuery) {
        playerConfig.playerVars.listType = 'search';
        playerConfig.playerVars.list = searchQuery;
      }

      playerInstanceRef.current = new window.YT.Player(playerRef.current, playerConfig);
    };

    // Check if API is ready or wait for it
    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      // Store previous handler to avoid overwriting other potential players on page
      const previousReady = window.onYouTubeIframeAPIReady; 
      window.onYouTubeIframeAPIReady = () => {
        if (previousReady) previousReady();
        initPlayer();
      };
    }

    return () => {
      if (playerInstanceRef.current) {
        try { playerInstanceRef.current.destroy(); } catch(e) {}
      }
    };
  }, [videoId, searchQuery, onClose]);

  return (
    <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-30 bg-black rounded-2xl overflow-hidden shadow-2xl border border-red-500/30 w-80 animate-in slide-in-from-bottom-10 duration-300">
      <div className="bg-red-900/90 backdrop-blur-md p-2 flex justify-between items-center border-b border-white/10">
        <span className="text-xs text-white font-bold truncate px-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/>
            {videoId ? 'Now Playing' : `Search: ${searchQuery}`}
        </span>
        <button onClick={onClose} className="text-white/80 hover:text-white bg-black/20 hover:bg-black/40 rounded-full p-1 transition-colors">
            <X size={14} />
        </button>
      </div>
      <div className="aspect-video bg-black relative">
        <div ref={playerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
