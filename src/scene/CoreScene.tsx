import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { demoConfig, runtime, type Quality } from "../config";
import { randomAt } from "../data/simulation";

declare global {
  interface Window {
    __db2Frames?: number[];
  }
}
function ContextLifecycle({ onFailure }: { onFailure: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", onFailure);
    return () => canvas.removeEventListener("webglcontextlost", onFailure);
  }, [gl, onFailure]);
  return null;
}

function Ring({
  radius,
  y,
  color,
  tube = 0.016,
  arc = Math.PI * 2,
}: {
  radius: number;
  y: number;
  color: string;
  tube?: number;
  arc?: number;
}) {
  return (
    <group position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <torusGeometry args={[radius, tube, 8, 64, arc]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.95}
          toneMapped={false}
        />
      </mesh>
      {tube >= 0.018 && (
        <mesh>
          <torusGeometry args={[radius, tube * 4, 8, 64, arc]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.085}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}
function Hologram({
  activity,
  quality,
  moving,
}: {
  activity: number;
  quality: Quality;
  moving: boolean;
}) {
  const top = useRef<THREE.Group>(null),
    bottom = useRef<THREE.Group>(null),
    points = useRef<THREE.Points>(null),
    waves = useRef<THREE.Group>(null);
  const shellMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const hologramMaterial = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uActivity: { value: activity } }), []);
  const level = useRef(activity);
  const elapsed = useRef(0);
  const positions = useMemo(() => {
    const count =
      quality === "high"
        ? demoConfig.graphics.internalParticles
        : demoConfig.graphics.economicalParticles;
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = randomAt(92, i) * Math.PI * 2;
      const r = Math.sqrt(randomAt(23, i)) * 1.22;
      data.set(
        [Math.cos(a) * r, randomAt(76, i) * 2.5 - 0.65, Math.sin(a) * r],
        i * 3,
      );
    }
    return data;
  }, [quality]);
  useFrame(({ gl }, delta) => {
    if (!gl.domElement.dataset.sceneReady)
      gl.domElement.dataset.sceneReady = "true";
    if (runtime.profile && moving) {
      const frames = (window.__db2Frames ??= []);
      frames.push(performance.now());
      if (frames.length > 5000) frames.shift();
    }
    level.current = THREE.MathUtils.damp(level.current, activity, 2, delta);
    if (shellMaterial.current)
      shellMaterial.current.opacity = 0.1 + level.current * 0.14;
    if (hologramMaterial.current) {
      hologramMaterial.current.uniforms.uTime.value = elapsed.current;
      hologramMaterial.current.uniforms.uActivity.value = level.current;
    }
    if (!moving || activity === 0) return;
    elapsed.current += Math.min(delta, 0.05);
    const t = elapsed.current;
    if (top.current) top.current.rotation.y = t * 0.18;
    if (bottom.current) bottom.current.rotation.y = -t * 0.12;
    if (points.current && activity > 0) points.current.rotation.y = t * 0.09;
    waves.current?.children.forEach((wave, i) => {
      const phase = (t * 0.25 + i / 3) % 1;
      wave.scale.setScalar(1 + phase * 0.48);
      ((wave as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
        (1 - phase) * level.current * 0.6;
    });
  });
  const blue = demoConfig.colors.blue,
    cyan = demoConfig.colors.cyan,
    violet = demoConfig.colors.violet;
  return (
    <group position={[0, -0.15, 0]}>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[1.31, 1.31, 2.5, 96, 1, true]} />
        <shaderMaterial
          ref={hologramMaterial}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={`
            varying vec3 vNormal;
            varying vec3 vView;
            varying vec2 vUv;
            void main() {
              vUv = uv;
              vec4 positionView = modelViewMatrix * vec4(position, 1.0);
              vNormal = normalize(normalMatrix * normal);
              vView = -positionView.xyz;
              gl_Position = projectionMatrix * positionView;
            }
          `}
          fragmentShader={`
            uniform float uTime;
            uniform float uActivity;
            varying vec3 vNormal;
            varying vec3 vView;
            varying vec2 vUv;
            void main() {
              float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.5);
              float rim = pow(abs(vUv.y - 0.5) * 2.0, 9.0);
              float scan = pow(max(0.0, 1.0 - abs(vUv.y - fract(uTime * 0.16)) * 22.0), 3.0) * uActivity;
              float lines = pow(max(0.0, sin(vUv.y * 360.0)), 12.0) * 0.055;
              vec3 color = mix(vec3(0.035, 0.16, 0.95), vec3(0.08, 0.86, 1.0), edge * 0.8 + rim * 0.2);
              gl_FragColor = vec4(color, 0.16 + edge * 0.65 + rim * 0.35 + scan * 0.32 + lines);
            }
          `}
        />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[1.3, 1.3, 2.5, 96, 1, true]} />
        <meshBasicMaterial
          ref={shellMaterial}
          color="#075bca"
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 2.4, 64, 1, true]} />
        <meshBasicMaterial
          color={blue}
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <Ring
          key={i}
          radius={1.3}
          y={-0.65 + (i * 2.5) / 8}
          color={i % 3 === 0 ? cyan : blue}
          tube={i === 0 || i === 8 ? 0.025 : 0.004}
        />
      ))}
      {[0, Math.PI].map((a) => (
        <mesh key={a} position={[Math.cos(a) * 1.3, 0.6, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 2.5, 8]} />
          <meshBasicMaterial color={cyan} />
        </mesh>
      ))}
      <group ref={top}>
        <Ring radius={1.34} y={1.86} color={cyan} tube={0.035} />
        <Ring radius={1.14} y={1.9} color={blue} tube={0.025} arc={4.6} />
        <Ring radius={0.93} y={1.89} color={cyan} tube={0.011} arc={5.6} />
        <Ring radius={0.65} y={1.91} color={blue} tube={0.018} arc={4.9} />
      </group>
      <group ref={bottom}>
        <Ring radius={1.36} y={-0.68} color={cyan} tube={0.026} />
        <Ring radius={1.17} y={-0.66} color={blue} tube={0.018} arc={4.8} />
        <Ring radius={2.58} y={-1.25} color={violet} tube={0.018} arc={4.2} />
        <Ring radius={2.75} y={-1.27} color={cyan} tube={0.012} arc={2.8} />
        {Array.from({ length: 24 }, (_, i) => {
          const angle = i * Math.PI / 12;
          return <mesh key={i} position={[Math.cos(angle) * 2.16, -0.97, Math.sin(angle) * 2.16]} rotation={[0, -angle, 0]}>
            <boxGeometry args={[0.12, 0.025, 0.035]} />
            <meshBasicMaterial color={i % 3 ? blue : cyan} />
          </mesh>;
        })}
      </group>
      <mesh position={[0, -1.15, 0]}>
        <cylinderGeometry args={[2.2, 2.35, 0.25, 96]} />
        <meshBasicMaterial color="#100b40" transparent opacity={0.92} />
      </mesh>
      {[2.35, 2.2, 2.02, 1.82, 1.6, 1.4, 1.05].map((r, i) => (
        <Ring
          key={r}
          radius={r}
          y={-1.13 + i * 0.025}
          color={i % 2 ? violet : blue}
          tube={i === 0 ? 0.028 : i === 3 ? 0.026 : 0.013}
        />
      ))}
      <Ring radius={2.3} y={-1.3} color={cyan} tube={0.022} arc={5.5} />
      <group ref={waves} visible={activity > 0}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, -1, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.4, 0.014, 6, 96]} />
            <meshBasicMaterial
              color={cyan}
              transparent
              opacity={activity * 0.2}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={cyan}
          size={0.032}
          transparent
          opacity={activity > 0 ? 0.8 : 0.12}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.007, 0.015, 4.1, 8]} />
        <meshBasicMaterial color={cyan} transparent opacity={activity * 0.35} />
      </mesh>
    </group>
  );
}

export default function CoreScene({
  activity,
  quality,
  moving,
  onFailure,
}: {
  activity: number;
  quality: Quality;
  moving: boolean;
  onFailure: () => void;
}) {
  return (
    <Canvas
      aria-hidden="true"
      dpr={[
        quality === "high" ? 1 : demoConfig.graphics.economicalDpr,
        quality === "high"
          ? demoConfig.graphics.maxDpr
          : demoConfig.graphics.economicalDpr,
      ]}
      frameloop={moving && activity > 0 ? "always" : "demand"}
      camera={{ position: [0, 3.8, 10.5], fov: 31 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: quality === "high" ? "high-performance" : "low-power",
      }}
      fallback={<span />}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <ContextLifecycle onFailure={onFailure} />
      <Hologram activity={activity} quality={quality} moving={moving} />
    </Canvas>
  );
}
