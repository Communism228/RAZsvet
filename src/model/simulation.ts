import { endpointKey, isPlant, isConsumer, type Building, type Endpoint } from "./types.js";
import { World, type Cable } from "./world.js";
import { solveLP } from "./simplex.js";

export interface CableFlow {
  from: Endpoint; to: Endpoint; sentKW: number; receivedKW: number;
  lossKW: number; currentA: number;
}
export interface CableState {
  cable: Cable; flows: CableFlow[]; lossKW: number; active: boolean;
  approximationBoundKW: number;
}
export interface TransformerState { inputKW: number; outputKW: number; lossKW: number }
export interface Simulation {
  consumerKW: Map<number, number>;
  generationKW: Map<number, number>;
  transformer: Map<number, TransformerState>;
  cables: Map<string, CableState>;
  groupOfConsumer: Map<number, number>;
  groupRatio: number[];
  capacityKW: number;
  generatedKW: number;
  deliveredKW: number;
  cableLossKW: number;
  transformerLossKW: number;
  balanceErrorKW: number;
  approximationBoundKW: number;
  connectedConsumers: number;
  fullConsumers: number;
  pivots: number;
  durationMs: number;
}
interface Arc {
  cable: Cable; from: Endpoint; to: Endpoint;
  send: number; receive: number;
  coefficient: number; bound: number; approximationBound: number;
}
function canSend(b: Building, e: Endpoint): boolean {
  return isPlant(b) || b.kind === "pole" ||
    (b.kind === "transformer" && e.port === "out");
}
function canReceive(b: Building, e: Endpoint): boolean {
  return isConsumer(b) || b.kind === "pole" ||
    (b.kind === "transformer" && e.port === "in");
}
function blank(world: World): Simulation {
  return {
    consumerKW: new Map(world.buildings.filter(b => isConsumer(b)).map(b => [b.id, 0])),
    generationKW: new Map(world.buildings.filter(b => isPlant(b)).map(b => [b.id, 0])),
    transformer: new Map(world.buildings.filter(b => b.kind === "transformer")
      .map(b => [b.id, { inputKW: 0, outputKW: 0, lossKW: 0 }])),
    cables: new Map(world.cables().map(cable => [cable.key,
      { cable, flows: [], lossKW: 0, active: false, approximationBoundKW: 0 }])),
    groupOfConsumer: new Map(), groupRatio: [], capacityKW: 0,
    generatedKW: 0, deliveredKW: 0, cableLossKW: 0,
    transformerLossKW: 0, balanceErrorKW: 0,
    approximationBoundKW: 0, connectedConsumers: 0, fullConsumers: 0,
    pivots: 0, durationMs: 0
  };
}

/**
 * Steady-state power dispatch, NOT an AC circuit simulator.
 *
 * Each cable has two possible directed flows, permitted by endpoint roles.
 * For sent power S (kW), fixed reference voltage U and R=r*L:
 *   receive <= S - (1000*R/U^2)*S^2.
 * Concave delivery is conservatively approximated by chords (piecewise linear).
 * The optimizer first maximizes equal demand satisfaction (received power / demand) per reachable supply group,
 * then minimizes generation, then adds a tiny tie-breaking flow penalty.
 * Only poles transit. A transformer is an explicit directed two-port converter.
 * A house or a generator is never a transit node.
 */
export function simulate(world: World): Simulation {
  const started = performance.now();
  const result = blank(world);
  const plants = world.buildings.filter(b => isPlant(b));
  const houses = world.buildings.filter(b => isConsumer(b));
  const transformers = world.buildings.filter(b => b.kind === "transformer");
  result.capacityKW = plants.reduce((s, p) => s + p.generationKW, 0);
  if (!houses.length || result.capacityKW <= 0) {
    result.durationMs = performance.now() - started;
    return result;
  }

  let count = 0;
  const arcs: Arc[] = [];
  const vertexArcs = new Map<string, { incoming: Arc[]; outgoing: Arc[] }>();
  const at = (e: Endpoint) => {
    const key = endpointKey(e);
    if (!vertexArcs.has(key)) vertexArcs.set(key, { incoming: [], outgoing: [] });
    return vertexArcs.get(key)!;
  };
  for (const cable of world.cables()) {
    const line = world.balance.lines[cable.voltage];
    const R = cable.length * line.resistanceOhmPerM;
    const coefficient = 1000 * R / line.voltageV ** 2;
    // Do not use the descending, high-current branch of the delivery curve.
    const bound = Math.min(result.capacityKW, line.maxCurrentA * line.voltageV / 1000, coefficient > 0 ? 1 / (2 * coefficient) : Infinity);
    for (const [from, to] of [[cable.a, cable.b], [cable.b, cable.a]]) {
      if (!canSend(world.byId(from.id)!, from) || !canReceive(world.byId(to.id)!, to)) continue;
      const arc: Arc = { cable, from, to, send: count++, receive: count++,
        coefficient, bound, approximationBound: 0 };
      arcs.push(arc); at(from).outgoing.push(arc); at(to).incoming.push(arc);
    }
  }

  // Directed reachability. Houses cannot bridge supplies because they have no
  // outgoing arcs; stations likewise have no incoming arcs.
  const next = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!next.has(a)) next.set(a, []);
    next.get(a)!.push(b);
  };
  for (const a of arcs) link(endpointKey(a.from), endpointKey(a.to));
  for (const t of transformers) {
    if (t.outputLimitKW > 0)
      link(`${t.id}:in`, `${t.id}:out`);
  }
  const reachableByPlant: number[][] = [];
  for (const p of plants) {
    if (p.generationKW <= 0) { reachableByPlant.push([]); continue; }
    const seen = new Set<string>([`${p.id}:terminal`]);
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) {
      for (const v of next.get(queue[i]) ?? []) if (!seen.has(v)) {
        seen.add(v); queue.push(v);
      }
    }
    reachableByPlant.push(houses.filter(h => seen.has(`${h.id}:terminal`)).map(h => h.id));
  }
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let p = parent.get(id)!;
    while (parent.get(p)! !== p) p = parent.get(p)!;
    let k = id;
    while (parent.get(k)! !== p) {
      const old = parent.get(k)!; parent.set(k, p); k = old;
    }
    return p;
  };
  for (const ids of reachableByPlant) {
    for (const id of ids) if (!parent.has(id)) parent.set(id, id);
    for (let i = 1; i < ids.length; i++) parent.set(find(ids[i]), find(ids[0]));
  }
  const groupVariables = new Map<number, number>();
  const groupIds = new Map<number, number>();
  for (const house of houses) {
    if (!parent.has(house.id)) continue;
    const root = find(house.id);
    if (!groupVariables.has(root)) {
      groupVariables.set(root, count++); groupIds.set(root, groupIds.size);
    }
    result.groupOfConsumer.set(house.id, groupIds.get(root)!);
  }
  result.connectedConsumers = result.groupOfConsumer.size;
  if (!result.connectedConsumers) {
    result.durationMs = performance.now() - started;
    return result;
  }
  const transformerVariable = new Map<number, number>();
  for (const t of transformers) transformerVariable.set(t.id, count++);

  const A: number[][] = [], b: number[] = [];
  const row = () => Array(count).fill(0) as number[];
  const le = (r: number[], rhs: number) => { A.push(r); b.push(rhs); };
  const eqZero = (r: number[]) => { le(r, 0); le(r.map(x => -x), 0); };
  const balance = (e: Endpoint): number[] => {
    const r = row(), v = at(e);
    for (const a of v.incoming) r[a.receive] += 1;
    for (const a of v.outgoing) r[a.send] -= 1;
    return r;
  };
  for (const arc of arcs) {
    const limit = row(); limit[arc.send] = 1; le(limit, arc.bound);
    if (arc.coefficient === 0) {
      const r = row(); r[arc.receive] = 1; r[arc.send] = -1; le(r, 0);
    } else {
      for (let k = 0; k < world.balance.simulation.lossSegments; k++) {
        // Quadratic spacing refines the important low-load part of the curve.
        const x0 = arc.bound * (k / world.balance.simulation.lossSegments) ** 2;
        const x1 = arc.bound * ((k + 1) / world.balance.simulation.lossSegments) ** 2;
        const slope = 1 - arc.coefficient * (x0 + x1);
        const intercept = arc.coefficient * x0 * x1;
        const r = row(); r[arc.receive] = 1; r[arc.send] = -slope;
        le(r, intercept);
        arc.approximationBound = Math.max(arc.approximationBound,
          arc.coefficient * (x1 - x0) ** 2 / 4);
      }
    }
  }
  const primary = row(), secondary = row();
  for (const a of arcs) secondary[a.send] -= 1e-5; // Avoid idle circulations.
  for (const p of plants) {
    const r = row();
    for (const a of at({ id: p.id, port: "terminal" }).outgoing) {
      r[a.send] += 1; secondary[a.send] -= 1;
    }
    le(r, p.generationKW);
  }
  for (const pole of world.buildings.filter(b => b.kind === "pole"))
    eqZero(balance({ id: pole.id, port: "terminal" }));
  for (const house of houses) {
    const r = balance({ id: house.id, port: "terminal" });
    if (parent.has(house.id)) r[groupVariables.get(find(house.id))!] -= house.demandKW;
    eqZero(r);
  }
  for (const t of transformers) {
    const variable = transformerVariable.get(t.id)!;
    const input = balance({ id: t.id, port: "in" }); input[variable] -= 1; eqZero(input);
    const output = balance({ id: t.id, port: "out" }); output[variable] += t.efficiency;
    eqZero(output);
    const r = row(); r[variable] = t.efficiency; le(r, t.outputLimitKW);
  }
  for (const variable of groupVariables.values()) {
    primary[variable] = 1;
    const r = row(); r[variable] = 1; le(r, 1);
  }
  const solution = solveLP({ A, b, primary, secondary });
  const x = solution.x;
  result.pivots = solution.pivots;
  for (const [root, variable] of groupVariables)
    result.groupRatio[groupIds.get(root)!] = x[variable];
  for (const house of houses) {
    const value = parent.has(house.id) ? house.demandKW * x[groupVariables.get(find(house.id))!] : 0;
    result.consumerKW.set(house.id, value);
    result.deliveredKW += value;
    if (value >= house.demandKW * world.balance.simulation.fullPowerThreshold) result.fullConsumers++;
  }
  for (const p of plants) {
    const power = at({ id: p.id, port: "terminal" }).outgoing.reduce((s, a) => s + x[a.send], 0);
    result.generationKW.set(p.id, power);
    result.generatedKW += power;
  }
  for (const t of transformers) {
    const inputKW = x[transformerVariable.get(t.id)!];
    const outputKW = inputKW * t.efficiency;
    result.transformer.set(t.id, { inputKW, outputKW, lossKW: inputKW - outputKW });
    result.transformerLossKW += inputKW - outputKW;
  }
  for (const arc of arcs) {
    const sentKW = x[arc.send], receivedKW = x[arc.receive];
    const lossKW = Math.max(0, sentKW - receivedKW);
    const state = result.cables.get(arc.cable.key)!;
    if (sentKW > 1e-7) {
      state.flows.push({ from: arc.from, to: arc.to, sentKW, receivedKW,
        lossKW, currentA: sentKW * 1000 / world.balance.lines[arc.cable.voltage].voltageV });
      state.active = true;
      state.approximationBoundKW += arc.approximationBound;
      result.approximationBoundKW += arc.approximationBound;
    }
    state.lossKW += lossKW; result.cableLossKW += lossKW;
  }
  result.balanceErrorKW = result.generatedKW - result.deliveredKW -
    result.cableLossKW - result.transformerLossKW;
  result.durationMs = performance.now() - started;
  return result;
}
