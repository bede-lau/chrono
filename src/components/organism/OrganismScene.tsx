"use client";
/**
 * The R3F scene: stage, organism, controls, post. Loaded client-only by Organism.tsx.
 * OWNER: viewport agent.
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SphereGeometry, type Group, type Mesh, type PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useChrono } from "@/lib/store";
import type { Wound } from "@/lib/chain/types";
import { dirToUv } from "./artifacts";
import { registerOrganismCanvas, unregisterOrganismCanvas } from "./capture";
import { OrganismRig } from "./rig";
import { Backdrop, Dust } from "./Stage";

export interface CursorApi {
  hover(active: boolean, clientX?: number, clientY?: number): void;
  pulse(): void;
  dragging(active: boolean): void;
}

export interface OrganismSceneProps {
  onWoundRef: RefObject<((w: Wound) => void) | undefined>;
  cursor: CursorApi;
  interactive: boolean;
  autoRotate: boolean;
}

const CAMERA_DISTANCE = 5.2;
/** Bounding radius of the mature organism (with bulges) and how much of the view it should fill. */
const SPECIMEN_RADIUS = 1.18;
const FILL = 0.62;
const IDLE_RESUME_MS = 4000;

export default function OrganismScene({ onWoundRef, cursor, interactive, autoRotate }: OrganismSceneProps) {
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(
    () => () => {
      if (canvasRef.current) unregisterOrganismCanvas(canvasRef.current);
    },
    [],
  );

  return (
    <Canvas
      dpr={[1, 2]}
      flat
      gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ position: [0, 0.4, CAMERA_DISTANCE], fov: 30, near: 0.1, far: 80 }}
      onCreated={({ gl }) => {
        gl.setClearColor("#050506", 1);
        canvasRef.current = gl.domElement;
        registerOrganismCanvas(gl.domElement);
      }}
      style={{
        position: "absolute",
        inset: 0,
        opacity: ready ? 1 : 0,
        transition: "opacity 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      fallback={<div style={{ position: "absolute", inset: 0 }} />}
    >
      <SceneContent onWoundRef={onWoundRef} cursor={cursor} interactive={interactive} autoRotate={autoRotate} onReady={() => setReady(true)} />
    </Canvas>
  );
}

function SceneContent({ onWoundRef, cursor, interactive, autoRotate, onReady }: OrganismSceneProps & { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const [rig] = useState(() => new OrganismRig(gl));
  useEffect(() => () => rig.dispose(), [rig]);

  const pxPerUnit = useMemo(() => (size.height * dpr) / (2 * Math.tan(((camera.fov ?? 30) * Math.PI) / 360)), [size.height, dpr, camera.fov]);
  useEffect(() => rig.setPixelScale(pxPerUnit), [rig, pxPerUnit]);

  // frame the specimen for any aspect: its radius fills FILL of the smaller half-extent
  const fit = useMemo(() => {
    const vf = ((camera.fov ?? 30) * Math.PI) / 180;
    const aspect = size.width / Math.max(1, size.height);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    return SPECIMEN_RADIUS / (FILL * Math.tan(Math.min(vf, hf) / 2));
  }, [camera.fov, size.width, size.height]);
  useEffect(() => {
    const p = camera.position;
    if (p.lengthSq() < 1e-6) p.set(0, 0.4, 5);
    p.setLength(fit);
    camera.updateMatrixWorld();
  }, [camera, fit]);

  // first frames rendered -> fade the canvas in (no flash of an empty GL buffer)
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current < 3 && ++frames.current === 3) onReady();
  });

  return (
    <>
      <Backdrop hue={rig.hueColor} />
      <Dust pxPerUnit={pxPerUnit} />
      <OrganismBody rig={rig} onWoundRef={onWoundRef} cursor={cursor} interactive={interactive} />
      <Controls interactive={interactive} autoRotate={autoRotate} cursor={cursor} fit={fit} />
      <FpsReporter />
      <EffectComposer multisampling={4} enableNormalPass={false}>
        <Bloom mipmapBlur intensity={0.8} luminanceThreshold={0.72} luminanceSmoothing={0.28} radius={0.72} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.32} darkness={0.5} />
      </EffectComposer>
    </>
  );
}

function OrganismBody({
  rig,
  onWoundRef,
  cursor,
  interactive,
}: {
  rig: OrganismRig;
  onWoundRef: OrganismSceneProps["onWoundRef"];
  cursor: CursorApi;
  interactive: boolean;
}) {
  const group = useRef<Group>(null);
  const proxy = useRef<Mesh>(null);
  const geometry = useMemo(() => new SphereGeometry(1, 256, 160), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const specimen = useChrono((s) => s.specimen);
  useEffect(() => {
    rig.setSpecimen(specimen);
  }, [rig, specimen]);

  useFrame((state, delta) => {
    const st = useChrono.getState();
    const t = state.clock.elapsedTime;
    rig.update(Math.min(delta, 0.1), t, Date.now(), st);
    const g = group.current;
    if (g) {
      g.scale.setScalar(rig.scale);
      g.position.y = Math.sin(t * 0.42) * 0.028;
      g.rotation.x = Math.sin(t * 0.21) * 0.035;
      g.rotation.z = Math.sin(t * 0.17 + 1.3) * 0.03;
    }
    if (proxy.current) proxy.current.scale.copy(rig.stretch).multiplyScalar(1.06);
  });

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const g = group.current;
    if (!g) return null;
    const local = g.worldToLocal(e.point.clone()).divide(rig.stretch).normalize();
    return dirToUv([local.x, local.y, local.z]);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive || e.delta > 6) return;
    e.stopPropagation();
    const uv = pick(e);
    if (!uv) return;
    const w: Wound = { u: uv.u, v: uv.v, strength: 1, t: Date.now() };
    rig.addLocalWound(w);
    try {
      useChrono.getState().addWound(w);
    } catch {
      /* store is optional for the ripple */
    }
    onWoundRef.current?.(w);
    cursor.pulse();
  };

  return (
    <group ref={group}>
      <points geometry={rig.nucleiGeometry} material={rig.nucleiMaterial} renderOrder={1} frustumCulled={false} />
      <mesh geometry={geometry} material={rig.material} renderOrder={2} frustumCulled={false} />
      {interactive && (
        <mesh
          ref={proxy}
          onClick={onClick}
          onPointerMove={(e) => cursor.hover(true, e.nativeEvent.clientX, e.nativeEvent.clientY)}
          onPointerOver={(e) => cursor.hover(true, e.nativeEvent.clientX, e.nativeEvent.clientY)}
          onPointerOut={() => cursor.hover(false)}
        >
          <sphereGeometry args={[1, 48, 32]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
}

function Controls({ interactive, autoRotate, cursor, fit }: { interactive: boolean; autoRotate: boolean; cursor: CursorApi; fit: number }) {
  const ref = useRef<OrbitControlsImpl>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (ref.current) ref.current.autoRotate = autoRotate;
    return () => window.clearTimeout(timer.current);
  }, [autoRotate]);

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enabled={interactive}
      enableDamping
      dampingFactor={0.06}
      enablePan={false}
      rotateSpeed={0.55}
      zoomSpeed={0.6}
      autoRotateSpeed={0.42}
      minDistance={fit * 0.5}
      maxDistance={fit * 1.6}
      minPolarAngle={0.25}
      maxPolarAngle={Math.PI - 0.25}
      onStart={() => {
        window.clearTimeout(timer.current);
        if (ref.current) ref.current.autoRotate = false;
        cursor.dragging(true);
      }}
      onEnd={() => {
        cursor.dragging(false);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          if (ref.current) ref.current.autoRotate = autoRotate;
        }, IDLE_RESUME_MS);
      }}
    />
  );
}

/** Reports fps to the store at 2 Hz. */
function FpsReporter() {
  const acc = useRef({ frames: 0, t0: 0 });
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (a.t0 === 0) a.t0 = now;
    a.frames++;
    const el = now - a.t0;
    if (el >= 500) {
      const fps = Math.round((a.frames * 1000) / el);
      a.frames = 0;
      a.t0 = now;
      const st = useChrono.getState();
      if (st.fps !== fps) st.setFps(fps);
    }
  });
  return null;
}
