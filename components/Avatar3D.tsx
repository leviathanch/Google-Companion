
import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useAnimations, useFBX } from '@react-three/drei';
import * as THREE from 'three';
import { WiggleBone } from "../utils/wiggle/WiggleSpring";

interface Avatar3DProps {
  isSpeaking: boolean;
  audioAnalyser: AnalyserNode | null;
  gesture: string | null;
  isDancing: boolean;
  onTouch?: (bodyPart: string) => void;
}

// Define Vowel Indices Structure
interface VowelIndices {
    a: number | null;
    i: number | null;
    u: number | null;
    e: number | null;
    o: number | null;
}

export const Avatar3D: React.FC<Avatar3DProps> = ({ isSpeaking, audioAnalyser, gesture, isDancing, onTouch }) => {
  
  // Direct Google Cloud Storage URLs
  const MODEL_URL = "https://storage.googleapis.com/3d_model/GoogleChan.fbx";
  const IDLE_URL = "https://storage.googleapis.com/3d_model/animations/Idle.fbx";
  const TALK_URL = "https://storage.googleapis.com/3d_model/animations/Talking1.fbx";
  const NOD_URL = "https://storage.googleapis.com/3d_model/animations/HeadNod.fbx";
  const SHAKE_URL = "https://storage.googleapis.com/3d_model/animations/HeadShake.fbx";
  const RUMBA_URL = "https://storage.googleapis.com/3d_model/animations/RumbaDancing.fbx";

  const model = useFBX(MODEL_URL);
  const idleFbx = useFBX(IDLE_URL);
  const talkFbx = useFBX(TALK_URL);
  const nodFbx = useFBX(NOD_URL);
  const shakeFbx = useFBX(SHAKE_URL);
  const rumbaFbx = useFBX(RUMBA_URL);

  if (idleFbx.animations[0]) idleFbx.animations[0].name = 'Idle';
  if (talkFbx.animations[0]) talkFbx.animations[0].name = 'Talking';
  if (nodFbx.animations[0]) nodFbx.animations[0].name = 'HeadNod';
  if (shakeFbx.animations[0]) shakeFbx.animations[0].name = 'HeadShake';
  if (rumbaFbx.animations[0]) rumbaFbx.animations[0].name = 'Rumba';

  const animations = useMemo(() => [
      ...(idleFbx.animations[0] ? [idleFbx.animations[0]] : []),
      ...(talkFbx.animations[0] ? [talkFbx.animations[0]] : []),
      ...(nodFbx.animations[0] ? [nodFbx.animations[0]] : []),
      ...(shakeFbx.animations[0] ? [shakeFbx.animations[0]] : []),
      ...(rumbaFbx.animations[0] ? [rumbaFbx.animations[0]] : [])
  ], [idleFbx, talkFbx, nodFbx, shakeFbx, rumbaFbx]);

  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, group);

  // Gradient for Toon
  const gradientTexture = useMemo(() => {
    const format = THREE.RedFormat;
    const colors = new Uint8Array([5, 5, 5]); 
    const texture = new THREE.DataTexture(colors, 3, 1, format);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);

  // Memoize Scene to prevent recreation on every render
  const scene = useMemo(() => new THREE.Scene(), []);

  // Morph Targets & Physics Refs
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);
  const vowelIndices = useRef<VowelIndices>({ a: null, i: null, u: null, e: null, o: null });
  
  const blinkMeshRef = useRef<THREE.Mesh | null>(null);
  const blinkMorphIndexRef = useRef<number | null>(null);
  
  // Physics Engine
  const wiggleBones = useRef<WiggleBone[]>([]);

  // Blink State
  const nextBlinkTime = useRef<number>(0);
  const isBlinking = useRef<boolean>(false);
  const blinkStartTime = useRef<number>(0);
  const BLINK_DURATION = 0.15; 

  // Initialize Model, Materials, and Physics
  useEffect(() => {
    if (!model) return;
    
    console.log("Initializing Avatar Model...");

    // 1. Setup Morph Targets & Materials
    const blinkCandidates = ['Fcl_EYE_Close', 'Fcl_EYE_Close_R', 'Blink', 'blink', 'EYE_Close', 'Fcl_EYE_Joy'];

    model.traverse((child) => {
      // Materials
      if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          const oldMat = mesh.material as THREE.MeshStandardMaterial;
          if (!Array.isArray(oldMat)) {
              // @ts-ignore 
              const { skinning, ...safeProps } = oldMat;
              const toonMat = new THREE.MeshToonMaterial({
                  color: oldMat.color,
                  map: oldMat.map,
                  gradientMap: gradientTexture,
                  transparent: false,
                  side: THREE.FrontSide
              });
              if (toonMat.map) toonMat.map.colorSpace = THREE.SRGBColorSpace;
              mesh.material = toonMat;
          }
      }

      // Morphs
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).morphTargetDictionary) {
        const mesh = child as THREE.Mesh;
        const dict = mesh.morphTargetDictionary;

        // Find Vowels (VRoid standard names)
        if (dict['Fcl_MTH_A'] !== undefined || dict['aa'] !== undefined) {
            mouthMeshRef.current = mesh;
            vowelIndices.current.a = dict['Fcl_MTH_A'] ?? dict['aa'] ?? dict['A'] ?? null;
            vowelIndices.current.i = dict['Fcl_MTH_I'] ?? dict['ih'] ?? dict['I'] ?? null;
            vowelIndices.current.u = dict['Fcl_MTH_U'] ?? dict['ou'] ?? dict['U'] ?? null;
            vowelIndices.current.e = dict['Fcl_MTH_E'] ?? dict['E'] ?? null;
            vowelIndices.current.o = dict['Fcl_MTH_O'] ?? dict['oh'] ?? dict['O'] ?? null;
        }

        // Find Blink
        if (!blinkMeshRef.current || (blinkMeshRef.current === mouthMeshRef.current)) {
             for (const name of blinkCandidates) {
                if (dict.hasOwnProperty(name)) {
                    blinkMeshRef.current = mesh;
                    blinkMorphIndexRef.current = dict[name];
                    break;
                }
            }
        }
      }
    });

    // 4. Add to Scene
    scene.add(model);

    // 2. Find Bones First (Do not modify scene graph during traversal to avoid infinite loops)
    const bonesToWiggle: THREE.Bone[] = [];
    model.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
          const bone = child as THREE.Bone;
          // Target Bust1 and Bust2 for both sides
          if (
              bone.name == 'J_Sec_L_Bust1' ||
              bone.name == 'J_Sec_R_Bust1' ||
              bone.name == 'J_Sec_L_Bust2' ||
              bone.name == 'J_Sec_R_Bust2'
          ) {
               bonesToWiggle.push(bone);
          }
      }
    });

    // 3. Initialize Wiggle Bones (Modifies Scene Graph)
    const newWiggleBones: WiggleBone[] = [];
    bonesToWiggle.forEach((bone) => {
         // WiggleBone constructor clones the bone and adds a wrapper, 
         // so we must do this AFTER the traverse loop.
         if (newWiggleBones.some(wbone => wbone.target.name === bone.name)) {
           // We found at least one object that we're looking for!
         } else {
           const wb = new WiggleBone(bone, {
             velocity: 0.5,
             stiffness: 300,
             damping: 2000
           });
           newWiggleBones.push(wb);
         }
    });
    wiggleBones.current = newWiggleBones;

    // Cleanup
    return () => {
        console.log("Cleaning up Avatar...");
        wiggleBones.current.forEach(wb => wb.dispose());
        wiggleBones.current = [];
        scene.remove(model);
    };
  }, [model, gradientTexture, scene]);

  useFrame((state, delta) => {
    const now = state.clock.elapsedTime;

    // 1. Update Physics
    wiggleBones.current.forEach(wb => wb.update(delta));

    // 2. Detailed Lip Sync (Formant Analysis)
    if (mouthMeshRef.current && audioAnalyser && isSpeaking) {
      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
      audioAnalyser.getByteFrequencyData(dataArray);
      
      // Calculate energy in different frequency bands
      const binCount = dataArray.length;
      const lowEnd = Math.floor(binCount * 0.1); // Bass/Vowels like U/O
      const midEnd = Math.floor(binCount * 0.4); // Mids/Vowels like A
      const highEnd = binCount; // Treble/Vowels like I/E

      let sumLow = 0, sumMid = 0, sumHigh = 0;
      for(let i=0; i<lowEnd; i++) sumLow += dataArray[i];
      for(let i=lowEnd; i<midEnd; i++) sumMid += dataArray[i];
      for(let i=midEnd; i<highEnd; i++) sumHigh += dataArray[i];

      const volLow = (sumLow / lowEnd) / 255;
      const volMid = (sumMid / (midEnd - lowEnd)) / 255;
      const volHigh = (sumHigh / (highEnd - midEnd)) / 255;
      const totalVol = Math.min(1, (volLow + volMid + volHigh) / 1.5);

      // Map to Vowels (Heuristic)
      // A: High Volume, Balanced
      // I: High Treble
      // U: High Bass, Low Treble
      // E: Mid Range
      // O: High Bass, Mid Range

      let targetA = totalVol * 1.2; 
      let targetI = volHigh * 1.5 - volLow * 0.5;
      let targetU = volLow * 1.5 - volHigh * 0.5;
      let targetE = volMid * 1.2;
      let targetO = (volLow + volMid) * 0.8;

      // Clamp
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      targetA = clamp(targetA);
      targetI = clamp(targetI);
      targetU = clamp(targetU);
      targetE = clamp(targetE);
      targetO = clamp(targetO);

      const indices = vowelIndices.current;
      const influences = mouthMeshRef.current.morphTargetInfluences!;
      const lerpFactor = 0.4;

      if (indices.a !== null) influences[indices.a] = THREE.MathUtils.lerp(influences[indices.a], targetA, lerpFactor);
      if (indices.i !== null) influences[indices.i] = THREE.MathUtils.lerp(influences[indices.i], targetI, lerpFactor);
      if (indices.u !== null) influences[indices.u] = THREE.MathUtils.lerp(influences[indices.u], targetU, lerpFactor);
      if (indices.e !== null) influences[indices.e] = THREE.MathUtils.lerp(influences[indices.e], targetE, lerpFactor);
      if (indices.o !== null) influences[indices.o] = THREE.MathUtils.lerp(influences[indices.o], targetO, lerpFactor);

    } else if (mouthMeshRef.current && !isSpeaking) {
       // Close mouth smoothly
       const indices = vowelIndices.current;
       const influences = mouthMeshRef.current.morphTargetInfluences!;
       const lerpFactor = 0.2;
       if (indices.a !== null) influences[indices.a] = THREE.MathUtils.lerp(influences[indices.a], 0, lerpFactor);
       if (indices.i !== null) influences[indices.i] = THREE.MathUtils.lerp(influences[indices.i], 0, lerpFactor);
       if (indices.u !== null) influences[indices.u] = THREE.MathUtils.lerp(influences[indices.u], 0, lerpFactor);
       if (indices.e !== null) influences[indices.e] = THREE.MathUtils.lerp(influences[indices.e], 0, lerpFactor);
       if (indices.o !== null) influences[indices.o] = THREE.MathUtils.lerp(influences[indices.o], 0, lerpFactor);
    }

    // 3. Blink
    if (blinkMeshRef.current && blinkMorphIndexRef.current !== null) {
        if (!isBlinking.current && now > nextBlinkTime.current) {
            isBlinking.current = true;
            blinkStartTime.current = now;
            nextBlinkTime.current = now + 2 + Math.random() * 4; 
        }
        if (isBlinking.current) {
            const progress = (now - blinkStartTime.current) / BLINK_DURATION;
            if (progress >= 1) {
                isBlinking.current = false;
                blinkMeshRef.current.morphTargetInfluences![blinkMorphIndexRef.current] = 0;
            } else {
                blinkMeshRef.current.morphTargetInfluences![blinkMorphIndexRef.current] = Math.sin(progress * Math.PI);
            }
        }
    }
  });

  // Handle Touches
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const point = e.point;
      
      // Check distance to bust bones
      let hitChest = false;

      wiggleBones.current.forEach(wb => {
          const bonePos = new THREE.Vector3();
          wb.target.getWorldPosition(bonePos);
          if (point.distanceTo(bonePos) < 0.15) {
             hitChest = true;
          }
      });

      if (hitChest && onTouch) {
          onTouch('chest');
      }
  };

  // One-shot Gestures
  useEffect(() => {
      if (!actions || !gesture || isDancing) return; // Ignore gestures if dancing
      const action = actions[gesture];
      if (action) {
          action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play();
          action.clampWhenFinished = true;
          
          const clipDuration = action.getClip().duration;
          const durationMs = clipDuration * 1000;
          const fadeOutTime = Math.max(1000, durationMs - 500);
          
          const timeout = setTimeout(() => action.fadeOut(0.5), fadeOutTime);
          return () => clearTimeout(timeout);
      }
  }, [gesture, actions, isDancing]);

  // Base State: Idle vs Talking vs Dancing
  useEffect(() => {
    if (!actions) return;
    
    const idleAction = actions['Idle'];
    const talkAction = actions['Talking'];
    const rumbaAction = actions['Rumba'];

    if (isDancing) {
        // DANCING STATE
        idleAction?.fadeOut(0.5);
        talkAction?.fadeOut(0.5);
        rumbaAction?.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.5).play();
    } else {
        // NORMAL STATE
        rumbaAction?.fadeOut(0.5);
        
        if (isSpeaking) {
            idleAction?.fadeOut(0.2);
            talkAction?.reset().fadeIn(0.2).play();
        } else {
            talkAction?.fadeOut(0.2);
            idleAction?.reset().fadeIn(0.2).play();
        }
    }
  }, [isSpeaking, isDancing, actions]);

  return (
    // @ts-ignore
    <group ref={group} dispose={null} scale={0.02} position={[0, -1, 0]}>
      {/* @ts-ignore */}
      <primitive
        object={scene} 
        onPointerDown={handlePointerDown}
      />
    {/* @ts-ignore */}
    </group>
  );
};
