import React, { useEffect, useRef, useMemo } from 'react';
import { useLoader, useFrame } from '@react-three/fiber';
import { useAnimations, useFBX } from '@react-three/drei';
import * as THREE from 'three';

interface Avatar3DProps {
  isSpeaking: boolean;
}

// Utility to bypass CORS for Google Drive direct links
const getCorsUrl = (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`;

export const Avatar3D: React.FC<Avatar3DProps> = ({ isSpeaking }) => {
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
  // UPDATED: Darkened to [5, 5, 5] as per user preference
  const gradientTexture = useMemo(() => {
    const format = THREE.RedFormat;
    const colors = new Uint8Array([5, 5, 5]); 
    const texture = new THREE.DataTexture(colors, 3, 1, format);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);

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
                
                // We replace the standard material with MeshToonMaterial
                // preserving the original map (texture) and color
                const oldMat = mesh.material as THREE.MeshStandardMaterial;
                
                // Handle cases where material might be an array (though rare for this type of model)
                if (!Array.isArray(oldMat)) {
                    const toonMat = new THREE.MeshToonMaterial({
                        color: oldMat.color,
                        map: oldMat.map,
                        gradientMap: gradientTexture,
                        transparent: false,
                        side: THREE.FrontSide,
                        // Important: Enable skinning for animated meshes
                        // @ts-ignore - THREE types sometimes miss this for ToonMaterial but it exists
                        skinning: true 
                    });
                    
                    // Ensure the texture encoding is correct if needed
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