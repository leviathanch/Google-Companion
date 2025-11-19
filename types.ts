
export interface AudioBufferData {
    buffer: AudioBuffer;
    playStartTime: number;
    duration: number;
}

export interface VisualizerData {
    volume: number;
    isSpeaking: boolean;
}

export enum ConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    ERROR = 'error'
}

export interface GroundingChunk {
    web?: {
        uri: string;
        title: string;
    };
}

export interface GroundingMetadata {
    groundingChunks: GroundingChunk[];
    groundingSupports?: any[];
    webSearchQueries?: string[];
}

export interface Memory {
    id: string;
    text: string;
    timestamp: Date;
}

export interface WorkspaceFile {
    id: string;
    name: string;
    content: string;
    type: string;
    lastModified: number;
}

export interface GoogleUser {
    name: string;
    email: string;
    picture: string;
}

declare global {
    interface Window {
        google: any;
        gapi: any;
    }
}