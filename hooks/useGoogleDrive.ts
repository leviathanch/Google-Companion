
import { useState, useEffect, useCallback } from 'react';
import { Memory, GoogleUser } from '../types';

// Use provided ID as default fallback if env var is missing
const DEFAULT_CLIENT_ID = "210614270256-h16spgb5htp1r56tskc4gccaactio1a1.apps.googleusercontent.com";
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const MEMORY_FILE_NAME = 'gem_companion_memory.json';

export const useGoogleDrive = () => {
    const [clientId, setClientId] = useState(process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID);
    const [tokenClient, setTokenClient] = useState<any>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [user, setUser] = useState<GoogleUser | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isGoogleLibraryLoaded, setIsGoogleLibraryLoaded] = useState(false);

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

    // 2. Initialize Token Client (Only when Client ID is present)
    useEffect(() => {
        if (!isGoogleLibraryLoaded || !clientId) return;

        try {
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPES,
                // prompt: 'consent' forces the auth screen to appear, useful for debugging origin errors
                prompt: 'consent',
                ux_mode: 'popup', // Explicitly set popup mode
                callback: (tokenResponse: any) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        setAccessToken(tokenResponse.access_token);
                        // Fetch user profile info
                        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                            headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
                        })
                        .then(res => res.json())
                        .then(data => setUser({
                            name: data.name,
                            email: data.email,
                            picture: data.picture
                        }))
                        .catch(err => console.error("Failed to fetch user profile", err));
                    }
                },
            });
            setTokenClient(client);
            
            // Init GAPI for Drive calls
            window.gapi.load('client', async () => {
                await window.gapi.client.init({});
                await window.gapi.client.load('drive', 'v3');
                setIsInitialized(true);
            });

        } catch (error) {
            console.error("Failed to initialize Google Token Client:", error);
        }
    }, [isGoogleLibraryLoaded, clientId]);

    const login = useCallback(() => {
        if (tokenClient) {
            tokenClient.requestAccessToken();
        } else {
            console.warn("Google OAuth client not initialized. Missing Client ID?");
        }
    }, [tokenClient]);

    const logout = useCallback(() => {
        if (accessToken && window.google) {
            window.google.accounts.oauth2.revoke(accessToken, () => {
                setAccessToken(null);
                setUser(null);
            });
        }
    }, [accessToken]);

    // Find the memory file on Drive
    const findMemoryFile = useCallback(async (): Promise<string | null> => {
        if (!window.gapi?.client?.drive) return null;
        try {
            const response = await window.gapi.client.drive.files.list({
                q: `name = '${MEMORY_FILE_NAME}' and trashed = false`,
                fields: 'files(id, name)',
                spaces: 'drive',
            });
            const files = response.result.files;
            if (files && files.length > 0) {
                return files[0].id;
            }
            return null;
        } catch (error) {
            console.error("Error finding memory file", error);
            return null;
        }
    }, []);

    // Load Memories
    const loadMemories = useCallback(async (): Promise<Memory[] | null> => {
        if (!accessToken || !isInitialized) return null;
        setIsSyncing(true);
        try {
            const fileId = await findMemoryFile();
            if (fileId) {
                const response = await window.gapi.client.drive.files.get({
                    fileId: fileId,
                    alt: 'media',
                });
                setIsSyncing(false);
                // Ensure dates are parsed back to Date objects
                return (response.result as Memory[]).map(m => ({...m, timestamp: new Date(m.timestamp)}));
            }
        } catch (error) {
            console.error("Error loading from Drive", error);
        }
        setIsSyncing(false);
        return null;
    }, [accessToken, isInitialized, findMemoryFile]);

    // Save Memories
    const saveMemories = useCallback(async (memories: Memory[]) => {
        if (!accessToken || !isInitialized) return;
        setIsSyncing(true);
        try {
            const fileId = await findMemoryFile();
            const fileContent = JSON.stringify(memories);
            const blob = new Blob([fileContent], { type: 'application/json' });

            if (fileId) {
                // Update existing file
                await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: blob
                });
            } else {
                // Create new file
                const metadata = {
                    name: MEMORY_FILE_NAME,
                    mimeType: 'application/json'
                };
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', blob);

                await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}` },
                    body: form
                });
            }
        } catch (error) {
            console.error("Error saving to Drive", error);
        }
        setIsSyncing(false);
    }, [accessToken, isInitialized, findMemoryFile]);

    return {
        login,
        logout,
        user,
        accessToken,
        isInitialized,
        isSyncing,
        loadMemories,
        saveMemories,
        clientId,
        setClientId
    };
};
