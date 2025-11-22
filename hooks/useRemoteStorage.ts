
import { useState, useCallback, useEffect } from 'react';
import { Memory, IntegrationsConfig, ChatMessage } from '../types';

export interface SearchHistoryItem {
    id: number;
    timestamp: Date;
    query: string;
    sources: { title: string; uri: string; type: 'web' | 'map' }[];
}

const API_URL_KEY = 'gem_api_url';
// The deployed Firebase Function URL provided by the user
const DEFAULT_API_URL = "https://api-foizhujlta-uc.a.run.app";

export const useRemoteStorage = (accessToken: string | null) => {
    // Use localStorage value if present, otherwise fall back to the default deployed URL
    const [apiUrl, setApiUrl] = useState(localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL);
    const [isApiConfigOpen, setIsApiConfigOpen] = useState(false);
    
    const saveApiUrl = (url: string) => {
        // Remove trailing slash if present
        const cleanUrl = url.replace(/\/$/, "");
        setApiUrl(cleanUrl);
        localStorage.setItem(API_URL_KEY, cleanUrl);
    };

    // --- MEMORIES ---

    const fetchMemories = useCallback(async (): Promise<Memory[] | null> => {
        if (!accessToken || !apiUrl) return null;
        try {
            const res = await fetch(`${apiUrl}/memories`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) {
                const text = await res.text();
                console.error(`[API] Fetch Memories Failed (${res.status}):`, text);
                return null;
            }
            const data = await res.json();
            // Convert timestamp strings back to Date objects
            return data.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
        } catch (e) {
            console.error("[API] Failed to fetch memories", e);
            return null;
        }
    }, [accessToken, apiUrl]);

    const saveMemory = useCallback(async (memory: Memory) => {
        if (!accessToken || !apiUrl) return;
        try {
            const res = await fetch(`${apiUrl}/memories`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(memory)
            });
            if (!res.ok) {
                const text = await res.text();
                console.error(`[API] Save Memory Failed (${res.status}):`, text);
            }
        } catch (e) {
            console.error("[API] Failed to save memory", e);
        }
    }, [accessToken, apiUrl]);

    const deleteMemory = useCallback(async (id: string) => {
        if (!accessToken || !apiUrl) return;
        try {
            const res = await fetch(`${apiUrl}/memories/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) {
                const text = await res.text();
                console.error(`[API] Delete Memory Failed (${res.status}):`, text);
            }
        } catch (e) {
            console.error("[API] Failed to delete memory", e);
        }
    }, [accessToken, apiUrl]);

    // --- SEARCH HISTORY ---

    const fetchSearchHistory = useCallback(async (): Promise<SearchHistoryItem[] | null> => {
        if (!accessToken || !apiUrl) return null;
        try {
            const res = await fetch(`${apiUrl}/search_history`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) {
                const text = await res.text();
                console.error(`[API] Fetch History Failed (${res.status}):`, text);
                return null;
            }
            const data = await res.json();
            return data.map((h: any) => ({ ...h, timestamp: new Date(h.timestamp) }));
        } catch (e) {
            console.error("[API] Failed to fetch search history", e);
            return null;
        }
    }, [accessToken, apiUrl]);

    const saveSearchHistoryItem = useCallback(async (item: SearchHistoryItem) => {
        if (!accessToken || !apiUrl) return;
        try {
            const res = await fetch(`${apiUrl}/search_history`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(item)
            });
            if (!res.ok) {
                const text = await res.text();
                console.error(`[API] Save History Item Failed (${res.status}):`, text);
            }
        } catch (e) {
            console.error("[API] Failed to save search item", e);
        }
    }, [accessToken, apiUrl]);

    const clearSearchHistory = useCallback(async () => {
        if (!accessToken || !apiUrl) return;
        try {
            const res = await fetch(`${apiUrl}/search_history`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) {
                const text = await res.text();
                console.error(`[API] Clear History Failed (${res.status}):`, text);
            }
        } catch (e) {
            console.error("[API] Failed to clear search history", e);
        }
    }, [accessToken, apiUrl]);

    // --- CHAT HISTORY ---

    const fetchChatHistory = useCallback(async (): Promise<ChatMessage[] | null> => {
        if (!accessToken || !apiUrl) return null;
        try {
            // Reusing the generic structure, assuming you implement a /chat_history endpoint on backend
            // similar to /memories but for ChatMessage
            const res = await fetch(`${apiUrl}/chat_history`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
        } catch (e) {
            console.error("[API] Failed to fetch chat history", e);
            return null;
        }
    }, [accessToken, apiUrl]);

    const saveChatMessage = useCallback(async (message: ChatMessage) => {
        if (!accessToken || !apiUrl) return;
        try {
            await fetch(`${apiUrl}/chat_history`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(message)
            });
        } catch (e) {
            console.error("[API] Failed to save chat message", e);
        }
    }, [accessToken, apiUrl]);

    const clearChatHistory = useCallback(async () => {
        if (!accessToken || !apiUrl) return;
        try {
            await fetch(`${apiUrl}/chat_history`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` }
            });
        } catch (e) {
            console.error("[API] Failed to clear chat history", e);
        }
    }, [accessToken, apiUrl]);


    // --- SETTINGS CONFIGURATION ---

    const fetchConfig = useCallback(async (): Promise<IntegrationsConfig | null> => {
        if (!accessToken || !apiUrl) return null;
        try {
            const res = await fetch(`${apiUrl}/settings`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.error("[API] Failed to fetch settings", e);
            return null;
        }
    }, [accessToken, apiUrl]);

    const saveConfig = useCallback(async (config: IntegrationsConfig) => {
        if (!accessToken || !apiUrl) return;
        try {
            await fetch(`${apiUrl}/settings`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
        } catch (e) {
            console.error("[API] Failed to save settings", e);
        }
    }, [accessToken, apiUrl]);

    return {
        apiUrl,
        setApiUrl: saveApiUrl,
        isApiConfigOpen,
        setIsApiConfigOpen,
        fetchMemories,
        saveMemory,
        deleteMemory,
        fetchSearchHistory,
        saveSearchHistoryItem,
        clearSearchHistory,
        fetchChatHistory,
        saveChatMessage,
        clearChatHistory,
        fetchConfig,
        saveConfig
    };
};
