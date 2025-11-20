
import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useFBX } from '@react-three/drei';
import * as THREE from 'three';

interface Avatar3DProps {
  isSpeaking: boolean;
  audioAnalyser: AnalyserNode | null;
  gesture: string | null;
}

// Euler-based Wiggle Bone Physics
// calculates inertia in world space, converts to local space, applies to rotation
class WiggleBone {
    bone: THREE.Bone;
    velocity: THREE.Vector2 = new THREE.Vector2(0, 0); // x = pitch (bounce), y = yaw (sway)
    prevWorldPos: THREE.Vector3 = new THREE.Vector3();
    
    // Config
    stiffness: number = 150.0;
    damping: number = 4.0;
    mass: number = 1.0;
    gravity: number = 0; // Optional, usually baked into pose
    
    constructor(bone: THREE.Bone) {
        this.bone = bone;
        this.bone.getWorldPosition(this.prevWorldPos);
    }
    
    update(dt: number) {
        if (!this.bone.parent) return;

        // 1. Calculate Bone's current World Position (if it were rigid)
        const currentWorldPos = new THREE.Vector3();
        this.bone.getWorldPosition(currentWorldPos);

        // 2. Calculate Inertia Force (Movement delta)
        const movement = currentWorldPos.clone().sub(this.prevWorldPos);
        this.prevWorldPos.copy(currentWorldPos);
        
        // 3. Convert Movement to Local Space of the bone's parent (to know direction relative to body)
        // We want the force relative to the bone's orientation? Or parent?
        // Usually relative to the bone's rest orientation.
        // Let's project movement vector onto the bone's Local X and Z axes equivalents.
        
        // Get rotation of parent to transform world vector to local
        const parentInverseQuat = this.bone.parent.quaternion.clone().invert();
        const parentWorldQuat = new THREE.Quaternion();
        this.bone.parent.getWorldQuaternion(parentWorldQuat);
        const invParentWorldQuat = parentWorldQuat.clone().invert();
        
        const localMovement = movement.clone().applyQuaternion(invParentWorldQuat);
        
        // Local Y is usually "Up" or "Along Bone". 
        // Local X is Left/Right. 
        // Local Z is Forward/Back.
        
        // Movement in Local Y (Up/Down) -> Rotates around X (Pitch) -> Bounce
        // Movement in Local X (Left/Right) -> Rotates around Z (Roll/Sway) -> Sway
        
        // Force = -Movement (Inertia lags behind)
        const forceX = -localMovement.y * 3000; // Vertical movement causes X-axis rotation
        const forceZ = localMovement.x * 3000;  // Horizontal movement causes Z-axis rotation (Side sway)
        
        // 4. Spring Physics (Hooke's Law) for Rotation
        // Target rotation is 0 (Rest pose)
        const accelX = (forceX - this.stiffness * this.bone.rotation.x - this.damping * this.velocity.x) / this.mass;
        const accelY = (forceZ - this.stiffness * this.bone.rotation.z - this.damping * this.velocity.y) / this.mass;
        
        this.velocity.x += accelX * dt;
        this.velocity.y += accelY * dt;
        
        // 5. Apply Rotation
        this.bone.rotation.x += this.velocity.x * dt;
        this.bone.rotation.z += this.velocity.y * dt;
        
        // Clamp to prevent breaking
        this.bone.rotation.x = THREE.MathUtils.clamp(this.bone.rotation.x, -0.3, 0.5); // Bounce limit
        this.bone.rotation.z = THREE.MathUtils.clamp(this.bone.rotation.z, -0.2, 0.2); // Sway limit
    }
}


export const Avatar3D: React.FC<Avatar3DProps> = ({ isSpeaking, audioAnalyser, gesture }) => {
  
  // Direct Google Cloud Storage URLs
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

  // Morph Targets
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);
  const morphTargetIndexRef = useRef<number | null>(null);
  const blinkMeshRef = useRef<THREE.Mesh | null>(null);
  const blinkMorphIndexRef = useRef<number | null>(null);

  // Physics
  const wiggleBones = useRef<WiggleBone[]>([]);

  // Blink State
  const nextBlinkTime = useRef<number>(0);
  const isBlinking = useRef<boolean>(false);
  const blinkStartTime = useRef<number>(0);
  const BLINK_DURATION = 0.15; 

  useEffect(() => {
    if (!model) return;
    
    wiggleBones.current = [];

    const lipSyncCandidates = [
      'Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O',
      'A', 'aa', 'a', 'I', 'i', 'U', 'u',
      'MouthOpen', 'mouth_a', 'v_aa', 'Mouth_Open'
    ];
    const blinkCandidates = ['Fcl_EYE_Close', 'Fcl_EYE_Close_R', 'Blink', 'blink', 'EYE_Close', 'Fcl_EYE_Joy'];

    model.traverse((child) => {
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

      if ((child as THREE.Bone).isBone) {
          const bone = child as THREE.Bone;
          // Target just the ROOT bust bones.
          // J_Sec_L_Bust1 / J_Sec_R_Bust1
          if (bone.name === 'J_Sec_L_Bust1' || bone.name === 'J_Sec_R_Bust1' || bone.name === 'Breast_L' || bone.name === 'Breast_R') {
              console.log(`Adding WiggleBone: ${bone.name}`);
              wiggleBones.current.push(new WiggleBone(bone));
          }
      }
    });

  }, [model]);

  useFrame((state, delta) => {
    const now = state.clock.elapsedTime;

    // Lip Sync
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

    // Blink
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

    // Physics Update
    // Use fixed time step approx for stability
    const dt = Math.min(delta, 0.03);
    wiggleBones.current.forEach(wb => wb.update(dt));
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
