/**
 * Pure helpers over the ProgramManifest contract type.
 *
 * A program is a multi-SynthDef composition whose exact OSC stream was
 * captured server-side into a manifest: an ordered `setup` (groups +
 * persistent stem/FX synths) and a beat-stamped `events` list with every
 * numeric argument already resolved. Playback is a faithful replay of
 * that stream, so everything here is deterministic data-shaping with no
 * engine or network dependencies.
 *
 * The manifest type itself comes from the generated API contract
 * (src/generated/api-types.ts); these helpers are hand-maintained ports
 * of the first-party player's manifest math and must stay semantically
 * identical to it -- the backend serves both consumers the same bytes.
 */
import type { ProgramManifest, ProgramEvent, ProgramSection } from "./types.js";
import type { OscPacket } from "./bundle-pump.js";

/** A set of events that share an exact beat, replayed in one OSC bundle. */
export interface BeatGroup {
  beat: number;
  packets: OscPacket[];
}

/**
 * Group events that share an identical beat into a single bundle, preserving
 * their capture order within the beat. Same-time packets execute atomically
 * before the target synth's first calc block, so an array control set via
 * /s_new + /n_setn lands before the synth reads its controls.
 *
 * The capture log records events in CALL order, not time order, and the
 * BundlePump requires ascending times: it stalls on the first group beyond
 * its lookahead window, so an earlier-beat group sitting after a later-beat
 * group in the array would be sent past its timestamp and scsynth executes
 * late bundles immediately -- audibly off-grid onsets. The stable sort fixes
 * that while keeping same-beat events in capture order.
 */
export function groupEventsByBeat(events: ProgramEvent[]): BeatGroup[] {
  const ordered = [...events].sort((a, b) => a.beat - b.beat);
  const groups: BeatGroup[] = [];
  let current: BeatGroup | null = null;
  for (const event of ordered) {
    const packet: OscPacket = [event.cmd, ...event.args];
    if (!current || current.beat !== event.beat) {
      current = { beat: event.beat, packets: [packet] };
      groups.push(current);
    } else {
      current.packets.push(packet);
    }
  }
  return groups;
}

/**
 * Index of the last section whose start beat is at or before `beat`, or -1
 * before the first section. Sections are assumed sorted by beat.
 */
export function sectionIndexAtBeat(sections: ProgramSection[], beat: number): number {
  let index = -1;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].beat <= beat) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

/**
 * Fold OSC control/value pairs from `args` (starting at `start`) into
 * `target`, last value winning. Both /s_new (args:
 * `[defName, nodeID, addAction, targetID, ...pairs]`, start = 4) and /n_set
 * (args: `[nodeID, ...pairs]`, start = 1) trail an even run of
 * `[controlName, value]` pairs. Non-conforming entries (an array control sent
 * via /n_setn, a stray non-numeric) are skipped so one malformed pair cannot
 * poison the rest of the run.
 */
export function foldControlPairs(
  target: Map<string, number>,
  args: ReadonlyArray<string | number>,
  start: number
): void {
  for (let i = start; i + 1 < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (typeof key === "string" && typeof value === "number") target.set(key, value);
  }
}

/**
 * The persistent-stem control state as it would stand at `beat`: every
 * setup-created node's controls, seeded from its /s_new setup values and
 * then advanced by every /n_set event strictly before `beat`, in beat order.
 * Returned as ready-to-send /n_set packets so a mid-piece (re)start can
 * restore the graph to exactly the values a from-zero playthrough would have
 * reached -- the "set all the params between 0 and this point" a seek relies
 * on. Transient /s_new voices are intentionally omitted: one-shot hits before
 * the target are not re-fired, only sustained stems are re-stated.
 */
export function stemControlStateAtBeat(manifest: ProgramManifest, beat: number): OscPacket[] {
  const state = new Map<number, Map<string, number>>();
  const order: number[] = [];
  for (const cmd of manifest.setup) {
    if (cmd.cmd !== "/s_new") continue;
    const node = cmd.args[1];
    if (typeof node !== "number") continue;
    const values = new Map<string, number>();
    foldControlPairs(values, cmd.args, 4);
    if (!state.has(node)) order.push(node);
    state.set(node, values);
  }

  const moves = manifest.events
    .filter((event) => event.cmd === "/n_set" && event.beat < beat)
    .sort((a, b) => a.beat - b.beat);
  for (const event of moves) {
    const node = event.args[0];
    if (typeof node !== "number") continue;
    const values = state.get(node);
    if (!values) continue; // only restore setup-created stems
    foldControlPairs(values, event.args, 1);
  }

  const packets: OscPacket[] = [];
  for (const node of order) {
    const values = state.get(node)!;
    if (values.size === 0) continue;
    const args: Array<string | number> = [node];
    for (const [key, value] of values) args.push(key, value);
    packets.push(["/n_set", ...args]);
  }
  return packets;
}
