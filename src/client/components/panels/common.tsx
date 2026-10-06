import { useState, type ReactNode } from "react";
import { CHANNEL_META, type ChannelId } from "../../../shared/channels";
import { LIMITS } from "../../../shared/protocol";
import { useInterpolated } from "../../hooks/useInterpolated";
import { Sparkline } from "../graphics/Sparkline";
import { StatusLamp } from "../graphics/StatusLamp";
import { LensNote, useRoomCtx } from "../context";

export function Panel({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="panel grid-bg" aria-label={title}>
      <div className="panel-title"><span>{title}</span>{extra}</div>
      {children}
    </section>
  );
}

export function Readout({ channel, limit, label }: { channel: ChannelId; limit?: number; label?: string }) {
  const { state } = useRoomCtx();
  const v = useInterpolated(channel, 10);
  const meta = CHANNEL_META[channel];
  if (v === undefined) return <div className="readout-box"><div className="label">{label ?? meta?.label}</div><div className="value muted small">Outside your view</div></div>;
  return (
    <div className="readout-box">
      <div className="label">{label ?? meta?.label}</div>
      <div className="value">
        {v.toLocaleString(undefined, { maximumFractionDigits: meta?.digits ?? 1, minimumFractionDigits: meta?.digits ?? 0 })} <span className="small muted">{meta?.unit}</span>
      </div>
      <Sparkline values={state?.history[channel]} limit={limit} />
    </div>
  );
}

export function parseJson<T>(v: unknown): T | undefined {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

/** The viewer's own launch commit criteria, with waiver requests for waivable violated ones (spec 15). */
export function LccList() {
  const { state, send } = useRoomCtx();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (!state || !state.lccs.length) return null;
  const canRequest = state.you.seated && state.you.role !== "FD";
  const fdHuman = state.statuses.FD?.operator === "human";
  return (
    <Panel title="Launch commit criteria">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {state.lccs.map((l) => {
          const waiver = state.waivers.find((w) => w.lccId === l.id && (w.state === "requested" || w.state === "approved"));
          return (
            <div key={l.id} className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <StatusLamp status={l.violated ? (l.waived ? "WATCH" : "NO_GO") : "GO"} size={11} label={false} />
              <span className="num muted">{l.id}</span>
              <span style={{ flex: 1 }}>{l.label}{l.waivable && <span className="muted"> · waivable</span>}</span>
              {waiver && <span className="chip">waiver {waiver.state}</span>}
              {canRequest && l.waivable && l.violated && !waiver && (
                <button className="btn small" onClick={() => setOpen(open === l.id ? null : l.id)}>Request waiver</button>
              )}
              {open === l.id && (
                <form
                  style={{ flexBasis: "100%", display: "flex", gap: 6 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    send({ type: "waiver.request", lccId: l.id, reason });
                    setOpen(null);
                    setReason("");
                  }}
                >
                  <input className="input" placeholder="Reason for the waiver" maxLength={LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Waiver reason" />
                  <button className="btn primary small" disabled={!reason.trim()}>Send</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
      {canRequest && !fdHuman && state.lccs.some((l) => l.waivable) && (
        <p className="small muted" style={{ marginBottom: 0 }}>Waivers need a human Flight Director. The FD console is on autopilot, so requests will wait.</p>
      )}
      <LensNote topic="authority">Action authority: you may request a waiver for your own station, but only a human Flight Director can approve it.</LensNote>
    </Panel>
  );
}
