// Connection to the LaunchRoom agent (implementation guide 8.1). Two stores:
// publicState (Agent state sync, identical for everyone) and console state (role-filtered messages).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAgent } from "agents/react";
import {
  ClientMsg,
  ServerMsgZ,
  type CalloutView,
  type ClientMsg as ClientMsgT,
  type ConflictView,
  type FactProjection,
  type FilteredRoomState,
  type LccView,
  type PollView,
  type PromptView,
  type PublicRoomState,
  type ServerMsg,
  type StatusView,
  type WaiverView,
  type WhyNode,
} from "../../shared/protocol";
import { HISTORY_CHANNELS, type ChannelId, type Telemetry } from "../../shared/channels";
import type { Station } from "../../shared/roles";
import { createTelemetryStore, type TelemetryStore } from "./telemetryStore";

export interface Answer {
  id: string;
  question: string;
  text: string | null;
  source?: "llm" | "template";
  factIds: string[];
}
export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

export type TimedPrompt = PromptView & { at: number };

export interface ConsoleState extends Omit<FilteredRoomState, "history" | "prompts"> {
  history: Partial<Record<string, number[]>>;
  prompts: TimedPrompt[];
  receivedAt: number;
  answers: Answer[];
  why: { factId: string; chain: WhyNode[] } | null;
  aar: { narrative: string; factIds: string[]; source: "llm" | "template" } | null;
}

type Action = { msg: ServerMsg; at: number } | { local: "ask"; id: string; question: string } | { local: "closeWhy" };

const MAX_FACTS = 500;

function reducer(state: ConsoleState | null, a: Action): ConsoleState | null {
  if ("local" in a) {
    if (!state) return state;
    if (a.local === "ask") return { ...state, answers: [...state.answers, { id: a.id, question: a.question, text: null, factIds: [] }].slice(-12) };
    return { ...state, why: null };
  }
  const { msg, at } = a;
  if (msg.type === "snapshot") {
    return { ...msg.state, prompts: msg.state.prompts.map((p) => ({ ...p, at })), receivedAt: at, answers: state?.answers ?? [], why: null, aar: state?.aar ?? null };
  }
  if (!state) return state;
  switch (msg.type) {
    case "tick": {
      const history = { ...state.history };
      for (const c of HISTORY_CHANNELS) {
        const v = msg.telemetry[c];
        if (typeof v !== "number") continue;
        history[c] = [...(history[c] ?? []), v].slice(-60);
      }
      return {
        ...state,
        simTime: msg.simTime,
        phase: msg.phase,
        windowRemaining: msg.windowRemaining,
        windowOpen: msg.windowOpen,
        timescale: msg.timescale,
        telemetry: msg.telemetry,
        statuses: msg.statuses,
        hiddenCount: msg.hiddenCount,
        milestone: msg.milestone,
        tags: msg.tags,
        advice: msg.advice,
        lccs: msg.lccs,
        conflicts: msg.conflicts,
        history,
        receivedAt: at,
      };
    }
    case "fact":
      if (state.facts.some((f) => f.id === msg.fact.id)) return state;
      return { ...state, facts: [...state.facts, msg.fact].slice(-MAX_FACTS) };
    case "callout":
      return { ...state, callouts: [...state.callouts, msg.callout].slice(-120) };
    case "poll":
      return { ...state, poll: msg.poll };
    case "prompt":
      return { ...state, prompts: [...state.prompts.filter((p) => !samePrompt(p, msg.prompt)), { ...msg.prompt, at }] };
    case "prompt.clear":
      return { ...state, prompts: state.prompts.filter((p) => !(p.kind === msg.kind && promptId(p) === msg.id)) };
    case "waivers":
      return { ...state, waivers: msg.waivers };
    case "answer": {
      const exists = state.answers.some((x) => x.id === msg.questionId);
      const answers = exists
        ? state.answers.map((x) => (x.id === msg.questionId ? { ...x, text: msg.text, source: msg.source, factIds: msg.factIds } : x))
        : [...state.answers, { id: msg.questionId, question: "", text: msg.text, source: msg.source, factIds: msg.factIds }];
      return { ...state, answers };
    }
    case "why.result":
      return { ...state, why: { factId: msg.factId, chain: msg.chain } };
    case "aar":
      return { ...state, aar: { narrative: msg.narrative, factIds: msg.factIds, source: msg.source } };
    default:
      return state;
  }
}

export function promptId(p: PromptView): string {
  return p.kind === "poll_confirm" ? p.data.pollId : p.data.id;
}
function samePrompt(a: PromptView, b: PromptView) {
  return a.kind === b.kind && promptId(a) === promptId(b);
}

export interface RoomHandle {
  pub: PublicRoomState | null;
  state: ConsoleState | null;
  connected: boolean;
  closedReason: string | null;
  toasts: Toast[];
  dismissToast(id: number): void;
  send(msg: ClientMsgT): void;
  ask(text: string): void;
  closeWhy(): void;
  telemetry: TelemetryStore;
}

const HEARTBEAT_MS = 20_000;

export function useRoom(code: string, token: string): RoomHandle {
  const [pub, setPub] = useState<PublicRoomState | null>(null);
  const [state, dispatch] = useReducer(reducer, null);
  const [connected, setConnected] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const telemetry = useMemo(() => createTelemetryStore(), []);
  const askSeq = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"]) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 5000);
  }, []);

  const onMessage = useCallback(
    (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(e.data);
      } catch {
        return;
      }
      // The Agents SDK also sends its own protocol frames (identity, state); ignore anything that is not ours.
      if (!ServerMsgZ.safeParse(raw).success) return;
      const msg = raw as ServerMsg;
      const at = performance.now();
      if (msg.type === "tick") telemetry.push(msg.telemetry, at, msg.timescale);
      if (msg.type === "snapshot") telemetry.reset(msg.state.telemetry, at);
      if (msg.type === "error") {
        toast(msg.message, msg.code === "waiver_needs_human_fd" ? "info" : "error");
        if (msg.code === "room_full") setClosedReason("This control room is full.");
        return;
      }
      if (msg.type === "welcome") {
        setPub(msg.room);
        return;
      }
      dispatch({ msg, at });
    },
    [telemetry, toast],
  );

  const agent = useAgent<PublicRoomState>({
    agent: "launch-room",
    name: code,
    query: { token },
    onStateUpdate: (s) => setPub(s),
    onMessage,
    onOpen: () => setConnected(true),
    onClose: (e: CloseEvent) => {
      setConnected(false);
      if (e.code === 4001) setClosedReason("Your session for this room has expired. Join again.");
      if (e.code === 4004) setClosedReason("This room has expired.");
    },
  });

  const send = useCallback(
    (msg: ClientMsgT) => {
      const parsed = ClientMsg.safeParse(msg);
      if (!parsed.success) return;
      agent.send(JSON.stringify(parsed.data));
    },
    [agent],
  );

  const ask = useCallback(
    (text: string) => {
      const id = `c${Date.now().toString(36)}${++askSeq.current}`;
      dispatch({ local: "ask", id, question: text });
      send({ type: "ask", text, clientId: id });
    },
    [send],
  );

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") send({ type: "heartbeat" });
    };
    const t = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [send]);

  return {
    pub,
    state,
    connected,
    closedReason,
    toasts,
    dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    send,
    ask,
    closeWhy: () => dispatch({ local: "closeWhy" }),
    telemetry,
  };
}

export type { CalloutView, ConflictView, FactProjection, LccView, PollView, PromptView, StatusView, WaiverView, Station, Telemetry, ChannelId };
