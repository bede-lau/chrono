"use client";
/**
 * The Evolution view of the right panel: everything about ONE engine (stage).
 * OWNER: ui-evolution agent (the ui-shell agent only renders <EvolutionView stage=... /> inside RightPanel).
 * Contract: props { stage: StageId; compact?: boolean } — compact = mobile bottom sheet.
 */
import { STAGE_COPY } from "@/lib/chain/stageCopy";
import type { StageId } from "@/lib/chain/types";

export function EvolutionView({ stage }: { stage: StageId; compact?: boolean }) {
  return <p className="text-[13px] text-fg-2">{STAGE_COPY[stage].what}</p>;
}
