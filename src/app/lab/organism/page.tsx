"use client";
/**
 * /lab/organism — viewport test harness. OWNER: viewport agent.
 * Simulates chain states (null → partial → complete), fake soma/audio, entanglement/decay, wounds, capture.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Organism from "@/components/organism/Organism";
import { captureOrganismPng } from "@/components/organism/capture";
import { useChrono } from "@/lib/store";
import type { ArchiveIndex, Specimen, Wound } from "@/lib/chain/types";
import { LAB_STAGES, proceduralSpecimen, randomSoma, specimenAtStage, spikeSpecimen } from "./fixtures";

type Source = "procedural" | "spike" | "archive";

export default function OrganismLab() {
  const [source, setSource] = useState<Source>("procedural");
  const [seed, setSeed] = useState(7);
  const [stage, setStage] = useState(7);
  const [autoGrow, setAutoGrow] = useState(false);
  const [audioOsc, setAudioOsc] = useState(false);
  const [archive, setArchive] = useState<ArchiveIndex["specimens"]>([]);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [archived, setArchived] = useState<Specimen | null>(null);
  const [somaOverride, setSomaOverride] = useState<number | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [lastWound, setLastWound] = useState<Wound | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const fps = useChrono((s) => s.fps);
  const controls = useChrono((s) => s.controls);
  const pending = useChrono((s) => s.pendingWounds.length);
  const audioLevel = useChrono((s) => s.audioLevel);

  // archive (real specimens produced by the pipeline agent)
  useEffect(() => {
    let alive = true;
    fetch("/specimens/index.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((idx: ArchiveIndex | null) => {
        if (!alive || !idx?.specimens?.length) return;
        const list = [...idx.specimens].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setArchive(list);
        setArchiveId((cur) => cur ?? list[0].id);
        setSource("archive");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (source !== "archive" || !archiveId) return;
    let alive = true;
    fetch(`/specimens/${encodeURIComponent(archiveId)}/manifest.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Specimen | null) => alive && s && setArchived(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source, archiveId]);

  const full = useMemo<Specimen | null>(() => {
    let s: Specimen | null = null;
    if (source === "procedural") s = typeof document === "undefined" ? null : proceduralSpecimen(seed);
    else if (source === "spike") s = spikeSpecimen();
    else s = archived;
    if (s && somaOverride !== null) s = { ...s, soma: randomSoma(somaOverride) };
    return s;
  }, [source, seed, archived, somaOverride]);

  // push the simulated state into the store
  useEffect(() => {
    useChrono.getState().setSpecimen(full ? specimenAtStage(full, stage) : null);
  }, [full, stage]);

  // auto-grow: step through the lifecycle
  useEffect(() => {
    if (!autoGrow) return;
    setStage(0);
    let s = 0;
    const id = window.setInterval(() => {
      s += 1;
      setStage(s);
      if (s >= 7) {
        window.clearInterval(id);
        setAutoGrow(false);
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [autoGrow]);

  // fake audio level oscillation
  useEffect(() => {
    if (!audioOsc) {
      useChrono.getState().setAudioLevel(0);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      const env = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.25);
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.1)), 6);
      useChrono.getState().setAudioLevel(Math.min(1, 0.15 + 0.55 * env * (0.6 + 0.4 * beat)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audioOsc]);

  const randomWound = useCallback(() => {
    const w: Wound = { u: Math.random(), v: 0.2 + Math.random() * 0.6, strength: 1, t: Date.now() };
    useChrono.getState().addWound(w);
    setLastWound(w);
  }, []);

  // keys: 0-7 stage, w wound, c capture, h hide panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (/^[0-7]$/.test(e.key)) setStage(Number(e.key));
      else if (e.key === "w") randomWound();
      else if (e.key === "c") setShot(captureOrganismPng());
      else if (e.key === "h") setPanelOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [randomWound]);

  return (
    <main style={{ position: "fixed", inset: 0, background: "#050506", color: "rgba(255,255,255,0.9)" }}>
      <Organism onWound={setLastWound} />

      <div style={{ position: "absolute", left: 84, bottom: 26, font: "11px/1.5 var(--font-geist-mono), ui-monospace, monospace", color: "rgba(255,255,255,0.4)", pointerEvents: "none" }}>
        {fps} fps · stage {stage} {LAB_STAGES[stage]} · wounds {pending} · audio {audioLevel.toFixed(2)}
        {lastWound && ` · last wound u ${lastWound.u.toFixed(3)} v ${lastWound.v.toFixed(3)}`}
      </div>

      <button onClick={() => setPanelOpen((o) => !o)} style={{ ...btn(false), position: "absolute", top: 16, right: 16, zIndex: 2 }}>
        {panelOpen ? "Hide" : "Lab"}
      </button>

      {panelOpen && (
        <div style={panel}>
          <Label>Source</Label>
          <Row>
            {(["procedural", "spike", "archive"] as Source[]).map((s) => (
              <button key={s} onClick={() => setSource(s)} style={btn(source === s)} disabled={s === "archive" && !archive.length}>
                {s}
              </button>
            ))}
          </Row>
          {source === "archive" && archive.length > 0 && (
            <select value={archiveId ?? ""} onChange={(e) => setArchiveId(e.target.value)} style={{ ...btn(false), width: "100%", marginTop: 6 }}>
              {archive.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · gen {a.generation}
                </option>
              ))}
            </select>
          )}

          <Label>Stage</Label>
          <Row>
            {LAB_STAGES.map((l, i) => (
              <button key={l} title={l} onClick={() => setStage(i)} style={{ ...btn(stage === i), minWidth: 26 }}>
                {i === 0 ? "∅" : i}
              </button>
            ))}
          </Row>
          <Row>
            <button onClick={() => setAutoGrow(true)} style={btn(autoGrow)}>
              Auto-grow
            </button>
            <button onClick={() => setSeed((s) => s + 1)} style={btn(false)} disabled={source !== "procedural"}>
              Reroll
            </button>
            <button onClick={() => setSomaOverride(Math.floor(Math.random() * 1e6))} style={btn(somaOverride !== null)}>
              Fake soma
            </button>
            {somaOverride !== null && (
              <button onClick={() => setSomaOverride(null)} style={btn(false)}>
                Real soma
              </button>
            )}
          </Row>

          <Label>Entanglement {controls.entanglement.toFixed(2)}</Label>
          <input type="range" min={0} max={1} step={0.01} value={controls.entanglement} onChange={(e) => useChrono.getState().setControls({ entanglement: Number(e.target.value) })} style={range} />
          <Label>Decoherence {controls.decay.toFixed(2)}</Label>
          <input type="range" min={0} max={1} step={0.01} value={controls.decay} onChange={(e) => useChrono.getState().setControls({ decay: Number(e.target.value) })} style={range} />

          <Label>Signals</Label>
          <Row>
            <button onClick={() => setAudioOsc((a) => !a)} style={btn(audioOsc)}>
              Audio osc
            </button>
            <button onClick={randomWound} style={btn(false)}>
              Wound
            </button>
            <button onClick={() => useChrono.getState().clearWounds()} style={btn(false)}>
              Clear
            </button>
            <button onClick={() => setShot(captureOrganismPng())} style={btn(false)}>
              Capture
            </button>
          </Row>
          {shot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="capture" onClick={() => setShot(null)} style={{ width: "100%", marginTop: 8, borderRadius: 4, border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }} />
          )}
        </div>
      )}
    </main>
  );
}

const panel: CSSProperties = {
  position: "absolute",
  top: 52,
  right: 16,
  width: 272,
  padding: "10px 12px 12px",
  background: "rgba(10,10,12,0.72)",
  backdropFilter: "blur(12px)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  font: "11px/1.4 var(--font-geist-sans), ui-sans-serif, system-ui",
  zIndex: 2,
};

const range: CSSProperties = { width: "100%", accentColor: "rgba(255,255,255,0.8)" };

function btn(active: boolean): CSSProperties {
  return {
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid rgba(255,255,255,${active ? 0.4 : 0.1})`,
    background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.03)",
    color: `rgba(255,255,255,${active ? 0.95 : 0.65})`,
    font: "11px/1.2 var(--font-geist-mono), ui-monospace, monospace",
    cursor: "pointer",
  };
}

function Label({ children }: { children: ReactNode }) {
  return <div style={{ margin: "10px 0 5px", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>{children}</div>;
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{children}</div>;
}
