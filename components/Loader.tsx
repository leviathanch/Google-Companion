import React from 'react';
import { Html, useProgress } from '@react-three/drei';

export const Loader = () => {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="flex flex-col items-center justify-center bg-white/80 p-4 rounded-lg backdrop-blur-md shadow-xl">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
        <span className="font-mono text-sm font-bold text-gray-700">{progress.toFixed(0)}% loaded</span>
      </div>
    </Html>
  );
};