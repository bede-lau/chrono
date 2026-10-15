"use client";
/** A temporary x-ray trace identifies the antipodal partner during an entangled tug. */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Vector3, type Vector4 } from "three";
import type { OrganismRig } from "./rig";

export function ExperimentLink({ rig }: { rig: OrganismRig }) {
  const resources = useMemo(() => {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(33 * 3), colors = new Float32Array(33 * 3);
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      colors.set([0.3 + t * 0.7, 0.85 - t * 0.3, 1 - t * 0.7], i * 3);
    }
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const line = new Line(geometry, material);
    line.frustumCulled = false; line.renderOrder = 8;
    return { line, geometry, material, positions, d: new Vector3(), tangent: new Vector3(), p: new Vector3() };
  }, []);
  useEffect(() => () => { resources.geometry.dispose(); resources.material.dispose(); }, [resources]);
  const animated = useRef(resources);
  useFrame(() => {
    const r = animated.current, u = rig.material.uniforms;
    const g = u.uGesture.value as Vector4;
    const opacity = Math.min(0.6, Math.abs(g.w) * 4) * Math.min(1, (u.uGesturePair.value as number) * 2);
    r.line.visible = opacity > 0.008;
    if (!r.line.visible) return;
    r.material.opacity = opacity;
    r.d.set(g.x, g.y, g.z);
    // Great-circle arch extends outside the silhouette; depth-free rendering makes the far endpoint legible.
    r.tangent.set(1, 0, 0);
    if (Math.abs(g.x) > 0.9) r.tangent.set(0, 1, 0);
    r.tangent.addScaledVector(r.d, -r.tangent.dot(r.d)).normalize();
    for (let i = 0; i <= 32; i++) {
      const angle = Math.PI * i / 32;
      r.p.copy(r.d).multiplyScalar(Math.cos(angle)).addScaledVector(r.tangent, Math.sin(angle));
      r.p.multiply(rig.stretch).multiplyScalar(1.03 + 0.3 * Math.sin(angle) + g.w * Math.cos(angle));
      r.p.toArray(r.positions, i * 3);
    }
    r.geometry.attributes.position.needsUpdate = true;
  });
  return <primitive object={resources.line} />;
}
