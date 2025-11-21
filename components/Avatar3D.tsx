import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useAnimations, useFBX } from '@react-three/drei';
import * as THREE from 'three';
import { WiggleBone } from "../utils/wiggle/WiggleSpring";

interface Avatar3DProps {
  isSpeaking: boolean;
  audioAnalyser: AnalyserNode | null;
  gesture: string | null;
  onTouch?: (bodyPart: string) => void;
}

export const Avatar3D: React.FC<Avatar3DProps> = ({ isSpeaking, audioAnalyser, gesture, onTouch }) => {
  
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
  const morphTargetIndexRef = useRef<number | null>(null);
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
    const lipSyncCandidates = [
      'Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O',
      'A', 'aa', 'a', 'I', 'i', 'U', 'u',
      'MouthOpen', 'mouth_a', 'v_aa', 'Mouth_Open'
    ];
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
        if (!mouthMeshRef.current) {
            for (const name of lipSyncCandidates) {
                if (mesh.morphTargetDictionary?.hasOwnProperty(name)) {
                    mouthMeshRef.current = mesh;
                    morphTargetIndexRef.current = mesh.morphTargetDictionary[name];
                    break; 
                }
            }
        }
        if (!blinkMeshRef.current || (blinkMeshRef.current === mouthMeshRef.current)) {
             for (const name of blinkCandidates) {
                if (mesh.morphTargetDictionary?.hasOwnProperty(name)) {
                    blinkMeshRef.current = mesh;
                    blinkMorphIndexRef.current = mesh.morphTargetDictionary[name];
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
         // Making sure that we create the WiggleBone only once for
         // a bone rquires checking whether a target for the bone already
         // exists
         if (newWiggleBones.some(wbone => wbone.target.name === bone.name)) {
           // We found at least one object that we're looking for!
         } else {
           const wb = new WiggleBone(bone, {
             velocity: 0.5,
             stiffness: 50,
             damping: 18 
           });
           //console.log(wb);
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

    // 2. Lip Sync
    if (mouthMeshRef.current && morphTargetIndexRef.current !== null && audioAnalyser) {
      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
      audioAnalyser.getByteFrequencyData(dataArray);
      const speechBins = dataArray.slice(0, dataArray.length / 2); 
      let sum = 0;
      for (let i = 0; i < speechBins.length; i++) sum += speechBins[i];
      const targetOpenness = Math.min(1, (sum / speechBins.length / 100) * 1.5);
      const currentOpenness = mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current];
      mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current] = THREE.MathUtils.lerp(currentOpenness, targetOpenness, 0.3);
    } else if (mouthMeshRef.current && morphTargetIndexRef.current !== null && !isSpeaking) {
       const currentOpenness = mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current];
       mouthMeshRef.current.morphTargetInfluences![morphTargetIndexRef.current] = THREE.MathUtils.lerp(currentOpenness, 0, 0.2);
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
          // Note: WiggleBone wrapper stores the bone in .target
          wb.target.getWorldPosition(bonePos);
          // 15cm tolerance
          if (point.distanceTo(bonePos) < 0.15) {
             hitChest = true;
             // Add impulse logic here if library supports it later
          }
      });

      if (hitChest && onTouch) {
          onTouch('chest');
      }
  };

  useEffect(() => {
      if (!actions || !gesture) return;
      const action = actions[gesture];
      if (action) {
          action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play();
          action.clampWhenFinished = true;
          
          // Dynamic duration handling so Rumba plays fully
          const clipDuration = action.getClip().duration;
          const durationMs = clipDuration * 1000;
          const fadeOutTime = Math.max(1000, durationMs - 500); // Fade out 0.5s before end
          
          const timeout = setTimeout(() => action.fadeOut(0.5), fadeOutTime);
          return () => clearTimeout(timeout);
      }
  }, [gesture, actions]);

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
