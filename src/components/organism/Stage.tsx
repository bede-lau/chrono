"use client";
/**
 * The dark laboratory: radial-vignette backdrop + suspended spores. OWNER: viewport agent.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector2, Vector3, type Points } from "three";
import { backdropFragment, backdropVertex, dustFragment, dustVertex } from "./shaders";

/** Linear values chosen so the stage reads as #050506 after ACES + sRGB (centre slightly lifted). */
const STAGE_BASE = new Vector3(0.0029, 0.0029, 0.0033);
const STAGE_CENTRE = new Vector3(0.0068, 0.0068, 0.0078);

export function Backdrop({ hue }: { hue: Color }) {
  const size = useThree((s) => s.size);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: backdropVertex,
        fragmentShader: backdropFragment,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uRes: { value: new Vector2(1, 1) },
          uHue: { value: new Color() },
          uGlow: { value: 0.0016 },
          uBase: { value: STAGE_BASE },
          uCentre: { value: STAGE_CENTRE },
        },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    (material.uniforms.uRes.value as Vector2).set(size.width, size.height);
  }, [material, size.width, size.height]);
  useFrame(() => {
    (material.uniforms.uHue.value as Color).copy(hue);
  });
  return (
    <mesh renderOrder={-1000} frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DustProps {
  count?: number;
  focus?: number;
  pxPerUnit: number;
  /** Shell the particles live in (world units around the specimen). */
  radius?: [number, number];
  /** Particle size range (world units). */
  size?: [number, number];
  seed?: number;
  tint?: [number, number, number];
  /** Drift amplitude multiplier. */
  drift?: number;
  /** Read every frame: overall opacity 0..1 (e.g. the embryo's spores fade as the organism matures). */
  alpha?: () => number;
  /** Read every frame: animation clock (s); defaults to the R3F clock. */
  time?: () => number;
}

export function Dust({
  count = 340,
  focus = 5.2,
  pxPerUnit,
  radius = [1.7, 8.2],
  size = [0.006, 0.024],
  seed = 0xc4a0,
  tint = [0.62, 0.64, 0.7],
  drift = 1,
  alpha,
  time,
}: DustProps) {
  const [r0, r1] = radius;
  const [s0, s1] = size;
  const geometry = useMemo(() => {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // spherical shell around the specimen, denser near it
      const r = r0 + Math.pow(rnd(), 1.6) * (r1 - r0);
      const ct = rnd() * 2 - 1;
      const st = Math.sqrt(1 - ct * ct);
      const ph = rnd() * Math.PI * 2;
      pos[i * 3] = r * st * Math.cos(ph);
      pos[i * 3 + 1] = r * ct * 0.75;
      pos[i * 3 + 2] = r * st * Math.sin(ph);
      seeds[i * 4] = rnd();
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd();
      seeds[i * 4 + 3] = rnd();
      sizes[i] = s0 + Math.pow(rnd(), 3) * (s1 - s0);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new BufferAttribute(seeds, 4));
    g.setAttribute("aSize", new BufferAttribute(sizes, 1));
    return g;
  }, [count, seed, r0, r1, s0, s1]);
  const [tr, tg, tb] = tint;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: dustVertex,
        fragmentShader: dustFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPxPerUnit: { value: 800 },
          uFocus: { value: focus },
          uTint: { value: new Color(tr, tg, tb) },
          uAlpha: { value: 1 },
          uDrift: { value: drift },
        },
      }),
    [focus, tr, tg, tb, drift],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const ref = useRef<Points>(null);
  useFrame((state) => {
    const points = ref.current;
    if (!points) return;
    const liveMaterial = points.material as ShaderMaterial;
    const a = alpha ? alpha() : 1;
    liveMaterial.uniforms.uTime.value = time ? time() : state.clock.elapsedTime;
    liveMaterial.uniforms.uPxPerUnit.value = pxPerUnit;
    liveMaterial.uniforms.uFocus.value = state.camera.position.length();
    liveMaterial.uniforms.uAlpha.value = a;
    points.visible = a > 0.004;
  });
  return <points ref={ref} geometry={geometry} material={material} renderOrder={7} frustumCulled={false} />;
}
