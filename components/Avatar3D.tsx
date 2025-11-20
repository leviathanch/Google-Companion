
import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useFBX } from '@react-three/drei';
import * as THREE from 'three';

interface Avatar3DProps {
  isSpeaking: boolean;
  audioAnalyser: AnalyserNode | null;
  gesture: string | null;
}

// Inline WiggleBone Class (mimicking the library logic)
class WiggleBone {
  bone: THREE.Bone;
  velocity: THREE.Vector3;
  position: THREE.Vector3;
  initialRotation: THREE.Euler;
  stiffness: number;
  damping: number;

  constructor(bone: THREE.Bone, options: { stiffness: number; damping: number }) {
    this.bone = bone;
    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.initialRotation = bone.rotation.clone();
    this.stiffness = options.stiffness;
    this.damping = options.damping;
    
    // Initialize position
    this.bone.getWorldPosition(this.position);
  }

  update() {
    // 1. Get current world position (where the bone is dragged to by the body)
    const currentWorldPos = new THREE.Vector3();
    this.bone.getWorldPosition(currentWorldPos);

    // 2. Calculate the "movement" (inertia) relative to previous frame
    // If the body moves UP, the bone wants to stay DOWN (relative velocity)
    const movement = currentWorldPos.clone().sub(this.position);
    
    // 3. Add movement to velocity (Inertia)
    // We invert it because if body moves UP, force is DOWN
    this.velocity.add(movement.multiplyScalar(-1));

    // 4. Spring Force (Hooke's Law): Pull velocity back to 0 (Rest)
    // F = -k * x (Here x is essentially our velocity deviation from rest)
    // Ideally we'd track a separate "displacement" vector, but simplified wiggle 
    // often just damps the velocity to simulate the spring return.
    // For rotation-based wiggle:
    
    // Let's calculate target rotation offsets based on this velocity
    // Local conversion: We need the force in the bone's local space to know which way to rotate
    const inverseRotation = this.bone.parent ? this.bone.parent.quaternion.clone().invert() : new THREE.Quaternion();
    const localForce = this.velocity.clone().applyQuaternion(inverseRotation);

    // 5. Apply Rotation
    // Y-axis force -> X-axis Rotation (Bounce)
    // X-axis force -> Z-axis Rotation (Sway)
    const rotationForceX = localForce.y * 0.004; // Sensitivity
    const rotationForceZ = localForce.x * 0.004;

    // Add to existing rotation, but strictly damping it back to initial
    // We use a "temporary" offset approach to prevent accumulation/deformation
    // Reset to initial first
    this.bone.rotation.copy(this.initialRotation);
    
    // Apply the physics offset
    this.bone.rotation.x += rotationForceX * 10; // Scaler for visibility
    this.bone.rotation.z -= rotationForceZ * 10;

    // 6. Damping & Stiffness Step (Verlet-ish integration)
    // Pull velocity back to zero
    this.velocity.add(this.velocity.clone().multiplyScalar(-this.stiffness * 0.001));
    this.velocity.multiplyScalar(1 - (this.damping * 0.001));

    // Update history
    this.bone.getWorldPosition(this.position);
  }
}

export const Avatar3D: React.FC<Avatar3DProps> = ({ isSpeaking, audioAnalyser, gesture }) => {
  
  // Direct Google Cloud Storage URLs
  // Using codetabs proxy to bypass Sandbox CORS if needed, or direct if user has extension
  const MODEL_URL = "https://storage.googleapis.com/3d_model/GoogleChan.fbx";
  const IDLE_URL = "https://storage.googleapis.com/3d_model/animations/Idle.fbx";
  const TALK_URL = "https://storage.googleapis.com/3d_model/animations/Talking1.fbx";
  const NOD_URL = "https://storage.googleapis.com/3d_model/animations/HeadNod.fbx";
  const SHAKE_URL = "https://storage.googleapis.com/3d_model/animations/HeadShake.fbx";

  const model = useFBX(MODEL_URL);
  const idleFbx = useFBX(IDLE_URL);
  const talkFbx = useFBX(TALK_URL);
  const nodFbx = useFBX(NOD_URL);
  const shakeFbx = useFBX(SHAKE_URL);

  if (idleFbx.animations[0]) idleFbx.animations[0].name = 'Idle';
  if (talkFbx.animations[0]) talkFbx.animations[0].name = 'Talking';
  if (nodFbx.animations[0]) nodFbx.animations[0].name = 'HeadNod';
  if (shakeFbx.animations[0]) shakeFbx.animations[0].name = 'HeadShake';

  const animations = useMemo(() => [
      ...(idleFbx.animations[0] ? [idleFbx.animations[0]] : []),
      ...(talkFbx.animations[0] ? [talkFbx.animations[0]] : []),
      ...(nodFbx.animations[0] ? [nodFbx.animations[0]] : []),
      ...(shakeFbx.animations[0] ? [shakeFbx.animations[0]] : [])
  ], [idleFbx, talkFbx, nodFbx, shakeFbx]);

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

  useEffect(() => {
    if (!model) return;
    
    // 1. Setup Morph Targets
    const lipSyncCandidates = [
      'Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O',
      'A', 'aa', 'a', 'I', 'i', 'U', 'u',
      'MouthOpen', 'mouth_a', 'v_aa', 'Mouth_Open'
    ];
    const blinkCandidates = ['Fcl_EYE_Close', 'Fcl_EYE_Close_R', 'Blink', 'blink', 'EYE_Close', 'Fcl_EYE_Joy'];

    model.traverse((child) => {
      // Find Meshes for Morphs
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
      
      // Find Bones for Physics
      if ((child as THREE.Bone).isBone) {
          const bone = child as THREE.Bone;
          // Target Bust1 and Bust2 for both sides
          if (
              bone.name.includes('J_Sec_L_Bust1') || 
              bone.name.includes('J_Sec_R_Bust1') ||
              bone.name.includes('J_Sec_L_Bust2') || 
              bone.name.includes('J_Sec_R_Bust2')
          ) {
               // Prevent duplicates if strict mode runs twice
               if (!wiggleBones.current.find(wb => wb.bone === bone)) {
                   console.log("Adding WiggleBone:", bone.name);
                   // Use user provided values: Stiffness 700, Damping 28
                   wiggleBones.current.push(new WiggleBone(bone, { stiffness: 700, damping: 28 }));
               }
          }
      }
    });

  }, [model]);

  useFrame((state, delta) => {
    const now = state.clock.elapsedTime;

    // 1. Update Physics
    wiggleBones.current.forEach(wb => wb.update());

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

  useEffect(() => {
      if (!actions || !gesture) return;
      const action = actions[gesture];
      if (action) {
          action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play();
          action.clampWhenFinished = true;
          const timeout = setTimeout(() => action.fadeOut(0.5), 2000);
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

  useEffect(() => {
     if(model) {
        model.traverse((child) => {
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
