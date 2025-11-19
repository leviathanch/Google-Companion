import React, { useEffect, useRef, useMemo } from 'react';
import { useLoader, useFrame } from '@react-three/fiber';
import { useAnimations, useFBX } from '@react-three/drei';
import * as THREE from 'three';

interface Avatar3DProps {
  isSpeaking: boolean;
  audioAnalyser: AnalyserNode | null;
}

// Utility to bypass CORS for Google Drive direct links
const getCorsUrl = (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`;

export const Avatar3D: React.FC<Avatar3DProps> = ({ isSpeaking, audioAnalyser }) => {
  // Original Google Drive Links
  const MODEL_ORIGIN = "https://drive.google.com/uc?export=download&id=11bPt43uqy-SjzGEP75ml_4MLObhy26cT";
  const IDLE_ORIGIN = "https://drive.google.com/uc?export=download&id=1rMbZFQHtwQoG02ELbig1OJkeO5-MnEmU";
  const TALK_ORIGIN = "https://drive.google.com/uc?export=download&id=16vmtArbDFnFKOL2ex0RqP6tkhndBvllC";

  // Proxied URLs
  const MODEL_URL = useMemo(() => getCorsUrl(MODEL_ORIGIN), []);
  const IDLE_URL = useMemo(() => getCorsUrl(IDLE_ORIGIN), []);
  const TALK_URL = useMemo(() => getCorsUrl(TALK_ORIGIN), []);

  // Load Model
  const model = useFBX(MODEL_URL);
  
  // Load Animations
  const idleFbx = useFBX(IDLE_URL);
  const talkFbx = useFBX(TALK_URL);

  // Rename animations
  if (idleFbx.animations[0].name !== 'Idle') idleFbx.animations[0].name = 'Idle';
  if (talkFbx.animations[0].name !== 'Talking') talkFbx.animations[0].name = 'Talking';

  const animations = useMemo(() => {
    return [...idleFbx.animations, ...talkFbx.animations];
  }, [idleFbx, talkFbx]);

  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, group);

  // Create a flat gradient texture for the toon effect
  // [5, 5, 5] gives a dark flat look that is balanced by ambient light
  const gradientTexture = useMemo(() => {
    const format = THREE.RedFormat;
    const colors = new Uint8Array([5, 5, 5]); 
    const texture = new THREE.DataTexture(colors, 3, 1, format);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);

  // --- Lip Sync & Blink Logic ---
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);
  const morphTargetIndexRef = useRef<number | null>(null);

  const blinkMeshRef = useRef<THREE.Mesh | null>(null);
  const blinkMorphIndexRef = useRef<number | null>(null);
  
  // Blink State
  const nextBlinkTime = useRef<number>(0);
  const isBlinking = useRef<boolean>(false);
  const blinkStartTime = useRef<number>(0);
  const BLINK_DURATION = 0.15; // Seconds

  // Find the head mesh with blendshapes on load
  useEffect(() => {
    if (!model) return;
    
    // Candidates for Lip Sync
    const lipSyncCandidates = [
      'Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O', // Vroid standard
      'A', 'aa', 'a', 'I', 'i', 'U', 'u', // Simple vowels
      'MouthOpen', 'mouth_a', 'v_aa', 'Mouth_Open' // Generic
    ];

    // Candidates for Blinking
    const blinkCandidates = [
        'Fcl_EYE_Close', 'Fcl_EYE_Close_R', 'Blink', 'blink', 'EYE_Close', 'Fcl_EYE_Joy'
    ];

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).morphTargetDictionary) {
        const mesh = child as THREE.Mesh;
        
        // 1. Find Mouth
        if (!mouthMeshRef.current) {
            for (const name of lipSyncCandidates) {
                if (mesh.morphTargetDictionary?.hasOwnProperty(name)) {
                    mouthMeshRef.current = mesh;
                    morphTargetIndexRef.current = mesh.morphTargetDictionary[name];
                    console.log(`Lip Sync: Found target mesh "${mesh.name}" with morph "${name}"`);
                    break; 
                }
            }
        }

        // 2. Find Eyes (Blink) - Might be the same mesh as mouth
        // We check separately in case they are different meshes or we haven't found one yet
        if (!blinkMeshRef.current || (blinkMeshRef.current === mouthMeshRef.current)) {
             for (const name of blinkCandidates) {
                if (mesh.morphTargetDictionary?.hasOwnProperty(name)) {
                    blinkMeshRef.current = mesh;
                    blinkMorphIndexRef.current = mesh.morphTargetDictionary[name];
                    console.log(`Blink: Found target mesh "${mesh.name}" with morph "${name}"`);
                    break;
                }
            }
        }
      }
    });
  }, [model]);

  // Frame Loop for Animation (Lip Sync + Blink)
  useFrame((state) => {
    const now = state.clock.elapsedTime;

    // --- Lip Sync ---
    if (mouthMeshRef.current && morphTargetIndexRef.current !== null && audioAnalyser) {
      // Get audio data
      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
      audioAnalyser.getByteFrequencyData(dataArray);
      
      // Calculate energy (simple average of lower frequencies for speech)
      const speechBins = dataArray.slice(0, dataArray.length / 2); 
      let sum = 0;
      for (let i = 0; i < speechBins.length; i++) {
        sum += speechBins[i];
      }
      const average = sum / speechBins.length;
      
      // Boost signal slightly to make mouth open more easily
      const targetOpenness = Math.min(1, (average / 100) * 1.5);
      
      // Smooth interpolation (LERP)
      const currentOpenness = mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current];
      const smoothed = THREE.MathUtils.lerp(currentOpenness, targetOpenness, 0.3); 
      
      mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current] = smoothed;
    } else if (mouthMeshRef.current && morphTargetIndexRef.current !== null && !isSpeaking) {
       // Close mouth smoothly when not speaking
       const currentOpenness = mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current];
       mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current] = THREE.MathUtils.lerp(currentOpenness, 0, 0.2);
    }

    // --- Blinking ---
    if (blinkMeshRef.current && blinkMorphIndexRef.current !== null) {
        // Trigger Blink
        if (!isBlinking.current && now > nextBlinkTime.current) {
            isBlinking.current = true;
            blinkStartTime.current = now;
            // Schedule next blink (2 to 6 seconds later)
            nextBlinkTime.current = now + 2 + Math.random() * 4; 
        }

        // Animate Blink
        if (isBlinking.current) {
            const progress = (now - blinkStartTime.current) / BLINK_DURATION;
            
            if (progress >= 1) {
                // Blink finished
                isBlinking.current = false;
                blinkMeshRef.current.morphTargetInfluences![blinkMorphIndexRef.current] = 0;
            } else {
                // Bell curve 0 -> 1 -> 0
                const value = Math.sin(progress * Math.PI);
                blinkMeshRef.current.morphTargetInfluences![blinkMorphIndexRef.current] = value;
            }
        }
    }
  });

  // Handle Animation Switching
  useEffect(() => {
    if (!actions) return;

    const idleAction = actions['Idle'];
    const talkAction = actions['Talking'];

    if (isSpeaking) {
      idleAction?.fadeOut(0.2);
      talkAction?.reset().fadeIn(0.2).play();
    } else {
      talkAction?.fadeOut(0.2);
      idleAction?.reset().fadeIn(0.2).play();
    }
  }, [isSpeaking, actions]);

  // Apply Toon Material
  useEffect(() => {
     if(model) {
        model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                mesh.castShadow = false;
                mesh.receiveShadow = false;
                
                const oldMat = mesh.material as THREE.MeshStandardMaterial;
                
                if (!Array.isArray(oldMat)) {
                    const toonMat = new THREE.MeshToonMaterial({
                        color: oldMat.color,
                        map: oldMat.map,
                        gradientMap: gradientTexture,
                        transparent: false,
                        side: THREE.FrontSide,
                        // @ts-ignore
                        skinning: true 
                    });
                    
                    if (toonMat.map) {
                        toonMat.map.colorSpace = THREE.SRGBColorSpace;
                    }

                    mesh.material = toonMat;
                }
            }
        });
     }
  }, [model, gradientTexture]);

  return (
    // @ts-ignore
    <group ref={group} dispose={null} scale={0.02} position={[0, -1, 0]}>
      {/* @ts-ignore */}
      <primitive object={model} />
    {/* @ts-ignore */}
    </group>
  );
};
