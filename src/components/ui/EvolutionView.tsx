"use client";
/**
 * The Evolution view of the right panel: everything about ONE engine (stage).
 * OWNER: ui-evolution agent (the ui-shell agent only renders <EvolutionView ... /> inside RightPanel).
 *
 * Contract (props are fixed — add optional ones only):
 *   stage      the engine to show
 *   compact    mobile bottom sheet (tighter spacing)
 *   following  true while the panel is auto-following the RUNNING stage during Create/Evolve.
 *              In that mode the view must NOT set the Chrono Lens (leave it off so the growth reveal plays);
 *              show a small "Live" pill and a "Pin" button that calls onPin.
 *   onPin      the shell stops following and keeps this stage; the view then owns the lens for `stage`.
 */
import { STAGE_COPY } from "@/lib/chain/stageCopy";
import type { StageId } from "@/lib/chain/types";

export interface EvolutionViewProps {
  stage: StageId;
  compact?: boolean;
  following?: boolean;
  onPin?: () => void;
}

export function EvolutionView({ stage }: EvolutionViewProps) {
  return <p className="text-[13px] text-fg-2">{STAGE_COPY[stage].what}</p>;
}
