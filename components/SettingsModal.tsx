
import React from 'react';
import { X, Mail, FileText, HardDrive, Calendar, Youtube, Music, Bell, Monitor, Search, Globe, Info } from 'lucide-react';
import { IntegrationsConfig } from '../types';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: IntegrationsConfig;
    onToggle: (key: keyof IntegrationsConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onToggle }) => {
    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-[80] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-[#1e1e1e] border border-white/10 rounded-3xl shadow-2xl max-w-2xl w-full h-[80vh] flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#1e1e1e]">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Extensions</h2>
                        <p className="text-sm text-gray-400 mt-1">Manage how Google-chan interacts with your apps and services.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-gray-700">
                    
                    {/* Productivity Section */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider ml-1">Productivity</h3>
                        
                        <div className="bg-[#2a2a2a] rounded-2xl p-5 border border-white/5 relative overflow-hidden group">
                            <div className="flex items-start justify-between">
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center shadow-lg">
                                        <HardDrive size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-white">Google Workspace</h4>
                                        <p className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                                            Allow Google-chan to access your content to summarise, find, and get quick answers from your own documents.
                                        </p>
                                        
                                        {/* Sub-service icons */}
                                        <div className="flex flex-wrap gap-3 mt-4">
                                            <div className="flex items-center gap-1.5 text-xs text-gray-300 bg-black/20 px-2 py-1 rounded border border-white/5">
                                                <Mail size={12} className="text-red-400" /> Gmail
                                            </div>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-300 bg-black/20 px-2 py-1 rounded border border-white/5">
                                                <FileText size={12} className="text-blue-400" /> Docs
                                            </div>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-300 bg-black/20 px-2 py-1 rounded border border-white/5">
                                                <HardDrive size={12} className="text-green-400" /> Drive
                                            </div>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-300 bg-black/20 px-2 py-1 rounded border border-white/5">
                                                <Calendar size={12} className="text-blue-400" /> Calendar
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Toggle */}
                                <button 
                                    onClick={() => onToggle('workspace')}
                                    className={`w-12 h-6 rounded-full transition-colors duration-300 relative ${config.workspace ? 'bg-blue-500' : 'bg-gray-600'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${config.workspace ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Personalized Search */}
                        <div className="bg-[#2a2a2a] rounded-2xl p-5 border border-white/5 relative overflow-hidden">
                             <div className="flex items-start justify-between">
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center shadow-lg">
                                        <Search size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-white">Personalized Google Search</h4>
                                        <p className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                                            Use your own account to perform searches via the Custom Search API. Returns personalized results logged to your history.
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => onToggle('personalizedSearch')}
                                    className={`w-12 h-6 rounded-full transition-colors duration-300 relative ${config.personalizedSearch ? 'bg-blue-500' : 'bg-gray-600'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${config.personalizedSearch ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Media Section */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider ml-1">Media</h3>
                        
                        <div className="bg-[#2a2a2a] rounded-2xl p-5 border border-white/5 relative overflow-hidden">
                            <div className="flex items-start justify-between">
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
                                        <Youtube size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-white">YouTube</h4>
                                        <p className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                                            Play, search, and discover your favorite videos. Enables specialized video search tools.
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => onToggle('youtube')}
                                    className={`w-12 h-6 rounded-full transition-colors duration-300 relative ${config.youtube ? 'bg-blue-500' : 'bg-gray-600'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${config.youtube ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>

                         <div className="bg-[#2a2a2a] rounded-2xl p-5 border border-white/5 relative overflow-hidden">
                            <div className="flex items-start justify-between">
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
                                        <Music size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-white">YouTube Music</h4>
                                        <p className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                                            Access your playlists and music library. Enables specialized music search tools.
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => onToggle('media')}
                                    className={`w-12 h-6 rounded-full transition-colors duration-300 relative ${config.media ? 'bg-blue-500' : 'bg-gray-600'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${config.media ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* System Section */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider ml-1">System</h3>
                        
                        <div className="bg-[#2a2a2a] rounded-2xl p-5 border border-white/5 relative overflow-hidden">
                            <div className="flex items-start justify-between">
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center shadow-lg">
                                        <Bell size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-white">Browser Notifications</h4>
                                        <p className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                                            Allow Google-chan to send you reminders and updates even when the tab is in the background.
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => onToggle('notifications')}
                                    className={`w-12 h-6 rounded-full transition-colors duration-300 relative ${config.notifications ? 'bg-blue-500' : 'bg-gray-600'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${config.notifications ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>
                        
                        <div className="bg-[#2a2a2a] rounded-2xl p-5 border border-white/5 relative overflow-hidden">
                            <div className="flex items-start justify-between">
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg">
                                        <Monitor size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-white">Open Tabs & Windows</h4>
                                        <p className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                                            Allow Google-chan to automatically open new browser tabs (e.g. for search results, videos, music).
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => onToggle('openTabs')}
                                    className={`w-12 h-6 rounded-full transition-colors duration-300 relative ${config.openTabs ? 'bg-blue-500' : 'bg-gray-600'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${config.openTabs ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
                
                <div className="p-6 border-t border-white/5 bg-[#1e1e1e] flex justify-end">
                    <button onClick={onClose} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors">
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
