
import { useState, useEffect, useCallback, useRef } from 'react';
import { Memory, GoogleUser } from '../types';

// Use provided ID as default fallback
const DEFAULT_CLIENT_ID = "210614270256-ppo1vmagl3roimn5duo8ma98ev6fla6d.apps.googleusercontent.com";

// Scopes split for granular permissions
// Added 'tasks' scope for Todo management
const BASE_SCOPES = 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email openid';
const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/tasks';
const SEARCH_SCOPES = 'https://www.googleapis.com/auth/cse';
const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

const TOKEN_STORAGE_KEY = 'gem_google_access_token';
const TOKEN_EXPIRY_KEY = 'gem_google_token_expiry';
const CLIENT_ID_STORAGE_KEY = 'gem_google_client_id';

export const useGoogleDrive = () => {
    const [clientId, setClientId] = useState(process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID);
    const [tokenClient, setTokenClient] = useState<any>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [user, setUser] = useState<GoogleUser | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isGoogleLibraryLoaded, setIsGoogleLibraryLoaded] = useState(false);

    // Ref to store the promise resolver for granular permission requests
    const permissionResolverRef = useRef<((granted: boolean) => void) | null>(null);

    // 1. Load Google Scripts
    useEffect(() => {
        const checkGoogle = setInterval(() => {
            if (window.google && window.google.accounts && window.gapi) {
                clearInterval(checkGoogle);
                setIsGoogleLibraryLoaded(true);
            }
        }, 500);
        return () => clearInterval(checkGoogle);
    }, []);

    const logout = useCallback(() => {
        console.log("[Auth] Logging out and clearing session...");
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
        localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
        
        setAccessToken(null);
        setUser(null);
        
        if (window.gapi?.client) window.gapi.client.setToken(null);
        
        if (accessToken && window.google) {
            try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) {}
        }
    }, [accessToken]);

    const handleTokenResponse = useCallback((tokenResponse: any) => {
        if (tokenResponse && tokenResponse.access_token) {
            const token = tokenResponse.access_token;
            const expiresIn = tokenResponse.expires_in;
            const expiryTime = Date.now() + (expiresIn * 1000);

            console.log("[Auth] Received new token.");
            setAccessToken(token);
            
            localStorage.setItem(TOKEN_STORAGE_KEY, token);
            localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
            localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);

            if (window.gapi?.client) {
                window.gapi.client.setToken(tokenResponse);
            }
            
            // Check for pending permission request (Granular Upgrade)
            if (permissionResolverRef.current) {
                 permissionResolverRef.current(true);
                 permissionResolverRef.current = null;
            }

            // Fetch Profile (Only needed if we don't have it yet)
            fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
            })
            .then(res => res.json())
            .then(data => setUser({
                name: data.name,
                email: data.email,
                picture: data.picture
            }))
            .catch(err => console.error("Failed to fetch user profile", err));
        } else {
            // Handle denial/close for granular request
             if (permissionResolverRef.current) {
                 permissionResolverRef.current(false);
                 permissionResolverRef.current = null;
            }
        }
    }, [clientId]);

    // 2. Initialize Token Client & Restore Session
    useEffect(() => {
        if (!isGoogleLibraryLoaded || !clientId) return;

        const initGapi = async () => {
            try {
                await new Promise<void>((resolve) => window.gapi.load('client', resolve));
                await window.gapi.client.init({});
                // Load APIs
                await window.gapi.client.load('drive', 'v3');
                await window.gapi.client.load('tasks', 'v1');
                
                const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
                const storedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
                const storedClientId = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
                const now = Date.now();

                // Basic validation: Expiry and Client ID match
                if (storedToken && storedExpiry && storedClientId === clientId && now < parseInt(storedExpiry)) {
                    // Optimistic Restore
                    window.gapi.client.setToken({ access_token: storedToken });
                    setAccessToken(storedToken);
                    
                    // Silent User Info Fetch
                    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                        headers: { Authorization: `Bearer ${storedToken}` }
                    })
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        if (data) {
                            setUser({
                                name: data.name,
                                email: data.email,
                                picture: data.picture
                            });
                        } else {
                            console.warn("[Auth] Stored token might be stale.");
                        }
                    })
                    .catch(() => { });
                }
                setIsInitialized(true);
            } catch (error) {
                console.error("[Auth] Failed to initialize GAPI:", error);
            }
        };

        initGapi();

        try {
            // Default client for Login (Base Scopes)
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: BASE_SCOPES,
                prompt: 'consent',
                ux_mode: 'popup',
                callback: handleTokenResponse,
            });
            setTokenClient(client);
        } catch (error) {
            console.error("Failed to initialize Google Token Client:", error);
        }
    }, [isGoogleLibraryLoaded, clientId, handleTokenResponse]);


    // --- MEMORIES (Local Storage Only) ---
    
    const loadMemories = useCallback(async (): Promise<Memory[] | null> => {
        return null;
    }, []);

    const saveMemory = useCallback(async (memory: Memory) => {
    }, []);


    // --- GOOGLE DRIVE RAG (Read-Only) ---

    const searchDriveFiles = useCallback(async (query: string) => {
        if (!accessToken || !window.gapi?.client?.drive) return [];
        try {
            const response = await window.gapi.client.drive.files.list({
                q: `name contains '${query}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
                fields: 'files(id, name, mimeType, description)',
                pageSize: 10
            });
            return response.result.files || [];
        } catch (error) {
            console.error("[Drive RAG] Error searching Drive:", error);
            return [];
        }
    }, [accessToken]);

    const readDriveFile = useCallback(async (fileId: string): Promise<string | null> => {
        if (!accessToken || !window.gapi?.client?.drive) return null;
        try {
            const meta = await window.gapi.client.drive.files.get({ fileId, fields: 'mimeType' });
            const mimeType = meta.result.mimeType;

            if (mimeType === 'application/vnd.google-apps.document') {
                const response = await window.gapi.client.drive.files.export({
                    fileId,
                    mimeType: 'text/plain'
                });
                return response.body;
            } else {
                const response = await window.gapi.client.drive.files.get({
                    fileId,
                    alt: 'media'
                });
                return response.body || (typeof response.result === 'string' ? response.result : JSON.stringify(response.result));
            }
        } catch (error) {
            console.error("[Drive RAG] Error reading file:", error);
            return null;
        }
    }, [accessToken]);

    // --- GOOGLE TASKS ---

    const getTaskLists = useCallback(async () => {
        if (!accessToken || !window.gapi?.client?.tasks) return [];
        try {
            const response = await window.gapi.client.tasks.tasklists.list();
            return response.result.items || [];
        } catch (error) {
            console.error("[Tasks] Error fetching lists:", error);
            return [];
        }
    }, [accessToken]);

    const getTasks = useCallback(async (tasklistId: string = '@default') => {
        if (!accessToken || !window.gapi?.client?.tasks) return [];
        try {
            const response = await window.gapi.client.tasks.tasks.list({
                tasklist: tasklistId,
                showCompleted: false,
                maxResults: 20
            });
            return response.result.items || [];
        } catch (error) {
            console.error("[Tasks] Error fetching tasks:", error);
            return [];
        }
    }, [accessToken]);

    const addTask = useCallback(async (title: string, notes?: string, tasklistId: string = '@default') => {
        if (!accessToken || !window.gapi?.client?.tasks) return null;
        try {
            const response = await window.gapi.client.tasks.tasks.insert({
                tasklist: tasklistId,
                resource: { title, notes }
            });
            return response.result;
        } catch (error) {
            console.error("[Tasks] Error adding task:", error);
            return null;
        }
    }, [accessToken]);


    const login = useCallback(() => {
        if (tokenClient) {
            tokenClient.requestAccessToken();
        } else {
            console.warn("Google Token Client not ready.");
        }
    }, [tokenClient]);

    // Generic Scope Request Helper
    const requestPermissions = useCallback(async (scope: string): Promise<boolean> => {
        if (!window.google || !clientId) return false;
        
        // Check existing
        if (window.google.accounts.oauth2.hasGrantedAllScopes(
            { access_token: accessToken, scope: BASE_SCOPES },
            scope
        )) {
            return true;
        }

        return new Promise((resolve) => {
            permissionResolverRef.current = resolve;
            
            const upgradeClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: `${BASE_SCOPES} ${scope}`,
                prompt: 'consent',
                ux_mode: 'popup',
                callback: handleTokenResponse
            });
            
            upgradeClient.requestAccessToken();
        });
    }, [clientId, accessToken, handleTokenResponse]);

    const requestDrivePermissions = useCallback(() => requestPermissions(DRIVE_SCOPES), [requestPermissions]);
    const requestSearchPermissions = useCallback(() => requestPermissions(SEARCH_SCOPES), [requestPermissions]);
    const requestYoutubePermissions = useCallback(() => requestPermissions(YOUTUBE_SCOPES), [requestPermissions]);

    return {
        login,
        logout,
        user,
        accessToken,
        isInitialized,
        isSyncing,
        loadMemories,
        saveMemory,
        searchDriveFiles,
        readDriveFile,
        getTaskLists,
        getTasks,
        addTask,
        requestDrivePermissions,
        requestSearchPermissions,
        requestYoutubePermissions,
        clientId,
        setClientId
    };
};
