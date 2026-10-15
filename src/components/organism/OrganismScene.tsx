"use client";
/**
 * The R3F scene: stage, organism (+ Chrono Lens overlay objects), controls, post. Loaded client-only by Organism.tsx.
 * OWNER: viewport agent.
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SphereGeometry, Vector3, type Group, type LineSegments, type Mesh, type PerspectiveCamera, type Points } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useChrono } from "@/lib/store";
import type { Probe, SpecimenInteractionMode, Wound } from "@/lib/chain/types";
import { registerOrganismCanvas, unregisterOrganismCanvas } from "./capture";
import { OrganismRig } from "./rig";
import { Backdrop, Dust } from "./Stage";
import { ExperimentLink } from "./ExperimentLink";
import { FrameBudget } from "./FrameBudget";

export interface CursorApi {
  hover(active: boolean, clientX?: number, clientY?: number): void;
  pulse(): void;
  dragging(active: boolean): void;
}

export interface OrganismSceneProps {
  onWoundRef: RefObject<((w: Wound) => void) | undefined>;
  cursor: CursorApi;
  interactive: boolean;
  interactionMode: SpecimenInteractionMode;
  autoRotate: boolean;
}

const CAMERA_DISTANCE = 5.2;
/** Bounding radius of the mature organism (with bulges) and how much of the view it should fill. */
const SPECIMEN_RADIUS = 1.18;
const FILL = 0.62;
const IDLE_RESUME_MS = 4000;
/** Linked probe update rate (blob -> panel). */
const PROBE_MS = 50;

export default function OrganismScene({ onWoundRef, cursor, interactive, interactionMode, autoRotate }: OrganismSceneProps) {
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
      frameloop="never"
      dpr={[1, 1.5]}
      flat
      gl={{ antialias: false, preserveDrawingBuffer: true, powerPreference: "default", alpha: false, stencil: false }}
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
      <SceneContent onWoundRef={onWoundRef} cursor={cursor} interactive={interactive} interactionMode={interactionMode} autoRotate={autoRotate} onReady={() => setReady(true)} />
    </Canvas>
  );
}

function SceneContent({ onWoundRef, cursor, interactive, interactionMode, autoRotate, onReady }: OrganismSceneProps & { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const [rig] = useState(() => new OrganismRig(gl));
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { rig.setReducedMotion(query.matches); };
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [rig]);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __organismRig?: OrganismRig };
    w.__organismRig = rig;
    return () => {
      if (w.__organismRig === rig) delete w.__organismRig;
    };
  }, [rig]);

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

  const clock = () => rig.time;
  return (
    <>
      <FrameBudget />
      <Backdrop hue={rig.hueColor} />
      <Dust pxPerUnit={pxPerUnit} time={clock} />
      {/* the embryo's own spores: a few soft motes drifting close to the seed, gone once it matures */}
      <Dust
        count={14}
        pxPerUnit={pxPerUnit}
        radius={[1.05, 2.3]}
        size={[0.018, 0.042]}
        seed={0x51ee}
        tint={[0.66, 0.78, 1.0]}
        drift={0.6}
        alpha={() => rig.embryo * 0.85}
        time={clock}
      />
      <OrganismBody rig={rig} onWoundRef={onWoundRef} cursor={cursor} interactive={interactive} interactionMode={interactionMode} />
      <Controls rig={rig} interactive={interactive} autoRotate={autoRotate} interactionMode={interactionMode} cursor={cursor} fit={fit} />
      <FpsReporter />
      <EffectComposer multisampling={2} enableNormalPass={false}>
        <Bloom mipmapBlur resolutionScale={0.5} intensity={0.8} luminanceThreshold={0.72} luminanceSmoothing={0.28} radius={0.72} />
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
  interactionMode,
}: {
  rig: OrganismRig;
  onWoundRef: OrganismSceneProps["onWoundRef"];
  cursor: CursorApi;
  interactive: boolean;
  interactionMode: SpecimenInteractionMode;
}) {
  const group = useRef<Group>(null);
  const proxy = useRef<Mesh>(null);
  const sparks = useRef<Points>(null);
  const links = useRef<LineSegments>(null);
  const nodes = useRef<Points>(null);
  const shells = useRef<Mesh>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const specimenKey = useChrono((s) => s.specimen ? `${s.specimen.id}:${s.specimen.generation}` : null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const release = () => {
    const current = drag.current;
    drag.current = null;
    if (current && gl.domElement.hasPointerCapture(current.id)) gl.domElement.releasePointerCapture(current.id);
    const st = useChrono.getState();
    if (st.gesture?.active) st.setGesture({ ...st.gesture, active: false });
    cursor.dragging(false);
  };
  useEffect(() => {
    const cancel = () => {
      const current = drag.current;
      drag.current = null;
      if (current && gl.domElement.hasPointerCapture(current.id)) gl.domElement.releasePointerCapture(current.id);
      useChrono.getState().setGesture(null);
      cursor.dragging(false);
    };
    const visibility = () => { if (document.hidden) cancel(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [cursor, gl, interactionMode, specimenKey]);
  const geometry = useMemo(() => new SphereGeometry(1, 160, 100), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const specimen = useChrono((s) => s.specimen);
  useEffect(() => {
    rig.setSpecimen(specimen);
  }, [rig, specimen]);

  const tmp = useMemo(() => ({ c: new Vector3(), r: new Vector3() }), []);
  // linked probe (blob -> panel): latest hover, flushed at most every PROBE_MS
  const probe = useRef<{ next: Probe | null; last: number; mine: boolean }>({ next: null, last: 0, mine: false });

  useFrame((_, delta) => {
    let st = useChrono.getState();
    if (st.gesture?.fromControl && group.current) {
      tmp.c.setFromMatrixPosition(group.current.matrixWorld);
      tmp.r.copy(tmp.c).sub(camera.position).normalize();
      const hit = rig.pick(camera.position, tmp.r, group.current.matrixWorld, camera);
      st.setGesture(hit ? { ...st.gesture, fromControl: false, u: hit.u, v: hit.v } : null);
      st = useChrono.getState();
    }
    rig.update(Math.min(delta, 0.1), Date.now(), st);
    const t = rig.time;
    const g = group.current;
    if (g) {
      g.scale.setScalar(rig.scale);
      g.position.y = Math.sin(t * 0.42) * 0.028;
      g.rotation.x = Math.sin(t * 0.21) * 0.035;
      g.rotation.z = Math.sin(t * 0.17 + 1.3) * 0.03;
      // the blob's centre and radius on screen, for the compare wipe's sweep
      g.updateWorldMatrix(true, false);
      tmp.c.setFromMatrixPosition(g.matrixWorld);
      tmp.r.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(rig.scale).add(tmp.c);
      tmp.c.project(camera);
      tmp.r.project(camera);
      rig.setView(tmp.c.x, Math.abs(tmp.r.x - tmp.c.x));
    }
    if (proxy.current) proxy.current.scale.copy(rig.stretch).multiplyScalar(1.75);
    if (sparks.current) sparks.current.visible = rig.sparksVisible;
    if (links.current) links.current.visible = rig.linksVisible;
    if (nodes.current) nodes.current.visible = rig.linksVisible;
    if (shells.current) shells.current.visible = rig.shellsVisible;

    const pr = probe.current;
    const now = performance.now();
    if (pr.next && now - pr.last >= PROBE_MS) {
      pr.last = now;
      st.setProbe(pr.next);
      pr.next = null;
      pr.mine = true;
    }
  });

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const g = group.current;
    return g ? rig.pick(e.ray.origin, e.ray.direction, g.matrixWorld, e.camera) : null;
  };

  const leave = () => {
    cursor.hover(false);
    rig.setPointer(null);
    const pr = probe.current;
    pr.next = null;
    if (pr.mine) {
      pr.mine = false;
      const st = useChrono.getState();
      if (st.probe?.source === "blob") st.setProbe(null);
    }
  };

  const moveExperiment = (e: ThreeEvent<PointerEvent>) => {
    const st = useChrono.getState();
    if (!drag.current || drag.current.id !== e.pointerId || st.mode !== "idle") return false;
    e.stopPropagation();
    cursor.hover(true, e.nativeEvent.clientX, e.nativeEvent.clientY);
    if (interactionMode === "light") {
      st.setLightProbe({ x: e.pointer.x * 2.8, y: e.pointer.y * 2.8 });
    } else if (st.gesture?.active) {
      const span = Math.min(gl.domElement.clientWidth, gl.domElement.clientHeight) * 0.28;
      st.setGesture({ ...st.gesture, dx: (e.nativeEvent.clientX - drag.current.x) / span, dy: (drag.current.y - e.nativeEvent.clientY) / span });
    }
    return true;
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const st = useChrono.getState();
    if (!interactive || e.button !== 0 || e.nativeEvent.isPrimary === false || drag.current || !st.specimen || st.mode !== "idle") return;
    if (!["pressure", "tug", "light", "rhythm"].includes(interactionMode)) return;
    const hit = pick(e);
    if (!hit) return;
    e.stopPropagation();
    if (interactionMode === "rhythm") { st.tapRhythm(); cursor.pulse(); return; }
    drag.current = { id: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
    cursor.dragging(true);
    if (interactionMode === "light") st.setLightProbe({ x: e.pointer.x * 2.8, y: e.pointer.y * 2.8 });
    else if (interactionMode === "pressure" || interactionMode === "tug") st.setGesture({ kind: interactionMode, u: hit.u, v: hit.v, dx: 0, dy: 0, heldAt: Date.now(), active: true });
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (moveExperiment(e)) return;
    const hit = pick(e);
    if (!hit) return leave();
    cursor.hover(true, e.nativeEvent.clientX, e.nativeEvent.clientY);
    rig.setPointer(e.pointer.x);
    if (interactionMode === "inspect") {
      // Keep a clicked inspection point pinned while the pointer moves over the specimen.
      probe.current.next = null;
      probe.current.mine = false;
      return;
    }
    probe.current.next = { u: hit.u, v: hit.v, source: "blob", theta: hit.theta, phase: hit.phase };
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive || e.delta > 6 || (interactionMode !== "touch" && interactionMode !== "inspect")) return;
    const hit = pick(e);
    if (!hit) return;
    e.stopPropagation();
    if (interactionMode === "inspect") {
      const pr = probe.current;
      pr.next = null;
      pr.mine = false;
      useChrono.getState().setProbe({ u: hit.u, v: hit.v, source: "inspect", theta: hit.theta, phase: hit.phase });
      cursor.pulse();
      return;
    }
    const w: Wound = { u: hit.u, v: hit.v, strength: 1, t: Date.now() };
    rig.addLocalWound(w);
    const st = useChrono.getState();
    // before Create there is nothing to evolve: the embryo just ripples
    if (st.specimen) st.addWound(w);
    onWoundRef.current?.(w);
    cursor.pulse();
  };

  return (
    <group ref={group}>
      <points geometry={rig.nucleiGeometry} material={rig.nucleiMaterial} renderOrder={1} frustumCulled={false} />
      <mesh geometry={geometry} material={rig.material} renderOrder={2} frustumCulled={false} />
      <points ref={sparks} geometry={rig.sparksGeometry} material={rig.sparksMaterial} renderOrder={3} frustumCulled={false} visible={false} />
      <mesh ref={shells} geometry={rig.shellsGeometry} material={rig.shellsMaterial} renderOrder={4} frustumCulled={false} visible={false} />
      <lineSegments ref={links} geometry={rig.linksGeometry} material={rig.linksMaterial} renderOrder={5} frustumCulled={false} visible={false} />
      <points ref={nodes} geometry={rig.linkNodesGeometry} material={rig.linkNodesMaterial} renderOrder={6} frustumCulled={false} visible={false} />
      <ExperimentLink rig={rig} />
      {interactive && (
        <mesh ref={proxy} onPointerDown={onDown} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onClick={onClick} onPointerMove={onMove} onPointerOver={onMove} onPointerOut={leave}>
          <sphereGeometry args={[1, 48, 32]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
}

function Controls({
  rig,
  interactive,
  autoRotate,
  interactionMode,
  cursor,
  fit,
}: {
  rig: OrganismRig;
  interactive: boolean;
  autoRotate: boolean;
  interactionMode: SpecimenInteractionMode;
  cursor: CursorApi;
  fit: number;
}) {
  const ref = useRef<OrbitControlsImpl>(null);
  const timer = useRef<number | undefined>(undefined);
  const orbit = interactionMode === "touch" || interactionMode === "inspect";

  useEffect(() => {
    if (ref.current) ref.current.autoRotate = autoRotate && orbit;
    return () => window.clearTimeout(timer.current);
  }, [autoRotate, orbit]);

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enabled={interactive}
      enableRotate={orbit}
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
        rig.setDragging(true);
        cursor.dragging(true);
      }}
      onEnd={() => {
        rig.setDragging(false);
        cursor.dragging(false);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          if (ref.current) ref.current.autoRotate = autoRotate && orbit;
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
