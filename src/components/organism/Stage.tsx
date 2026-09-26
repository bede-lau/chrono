"use client";
/**
 * The dark laboratory: radial-vignette backdrop + suspended spores. OWNER: viewport agent.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector2, Vector3 } from "three";
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

export function Dust({ count = 340, focus = 5.2, pxPerUnit }: { count?: number; focus?: number; pxPerUnit: number }) {
  const geometry = useMemo(() => {
    const rnd = mulberry32(0xc4a0);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // spherical shell around the specimen, denser near it
      const r = 1.7 + Math.pow(rnd(), 1.6) * 6.5;
      const ct = rnd() * 2 - 1;
      const st = Math.sqrt(1 - ct * ct);
      const ph = rnd() * Math.PI * 2;
      pos[i * 3] = r * st * Math.cos(ph);
      pos[i * 3 + 1] = r * ct * 0.75;
      pos[i * 3 + 2] = r * st * Math.sin(ph);
      seed[i * 4] = rnd();
      seed[i * 4 + 1] = rnd();
      seed[i * 4 + 2] = rnd();
      seed[i * 4 + 3] = rnd();
      size[i] = 0.006 + Math.pow(rnd(), 3) * 0.018;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new BufferAttribute(seed, 4));
    g.setAttribute("aSize", new BufferAttribute(size, 1));
    return g;
  }, [count]);
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
          uTint: { value: new Color(0.62, 0.64, 0.7) },
        },
      }),
    [focus],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uPxPerUnit.value = pxPerUnit;
    material.uniforms.uFocus.value = state.camera.position.length();
  });
  return <points geometry={geometry} material={material} renderOrder={3} frustumCulled={false} />;
}
