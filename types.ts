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
