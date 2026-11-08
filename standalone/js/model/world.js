import { ALL_KINDS, edgeKey, isConsumer, isPlant, voltageOf } from "./types.js";
import { Terrain, distanceToSegment } from "./terrain.js";
export class World {
    balance;
    terrain;
    buildings = [];
    /** The sole topology store; weight = distance in METRES, 0 = no cable. */
    adjacency = [];
    metadata = new Map();
    nextId = 1;
    constructor(balance, terrain) {
        this.balance = balance;
        this.terrain = terrain;
    }
    byId(id) { return this.buildings.find(b => b.id === id); }
    index(id) { return this.buildings.findIndex(b => b.id === id); }
    placementError(kind, x, y) {
        if (!ALL_KINDS.includes(kind) || !Number.isFinite(x) || !Number.isFinite(y))
            return "Некорректные координаты или тип.";
        const error = this.terrain.placementError(kind, x, y);
        if (error)
            return error;
        if (this.buildings.length >= this.balance.world.maxBuildings)
            return "Достигнут лимит зданий на участке.";
        const s = this.balance.buildings[kind], gap = this.balance.world.clearanceM;
        for (const b of this.buildings) {
            const t = this.balance.buildings[b.kind];
            if (Math.abs(x - b.x) < ((s.clearanceWidthM ?? s.widthM) + (t.clearanceWidthM ?? t.widthM)) / 2 + gap &&
                Math.abs(y - b.y) < ((s.clearanceHeightM ?? s.heightM) + (t.clearanceHeightM ?? t.heightM)) / 2 + gap)
                return "Здания не могут перекрываться. Оставьте зазор.";
        }
    }
    add(kind, x, y, options = {}) {
        const error = this.placementError(kind, x, y);
        if (error)
            return { ok: false, error };
        const s = this.balance.buildings[kind];
        const b = { id: this.nextId++, kind, x, y, name: options.name ?? "", paid: options.paid ?? 0,
            voltage: kind === "pole" ? options.voltage ?? "hv" : isConsumer({ kind }) ? "lv" : "hv",
            generationKW: s.generationKW ?? 0, demandKW: s.demandKW ?? 0, incomePerSec: s.incomePerSec ?? 0,
            outputLimitKW: s.outputLimitKW ?? 0, efficiency: s.efficiency ?? 1, fixed: isConsumer({ kind }) };
        for (const row of this.adjacency)
            row.push(0);
        this.adjacency.push(Array(this.buildings.length + 1).fill(0));
        this.buildings.push(b);
        return { ok: true, value: b };
    }
    validPort(b, p) {
        return b.kind === "transformer" ? p === "in" || p === "out" : p === "terminal";
    }
    connectionError(a, b) {
        const ba = this.byId(a.id), bb = this.byId(b.id);
        if (!ba || !bb)
            return "Не найдено здание.";
        if (a.id === b.id)
            return "Нельзя соединить здание с собой.";
        if (!this.validPort(ba, a.port) || !this.validPort(bb, b.port))
            return "Некорректный порт.";
        if (this.adjacency[this.index(a.id)][this.index(b.id)] > 0)
            return "Этот кабель уже существует.";
        const voltage = voltageOf(ba, a.port);
        if (voltage !== voltageOf(bb, b.port))
            return "Разное напряжение. Нужен трансформатор 10 кВ → 400 В.";
        const length = Math.hypot(ba.x - bb.x, ba.y - bb.y);
        if (length <= 0)
            return "Кабель должен иметь положительную длину.";
        if (length > this.balance.lines[voltage].maxLengthM)
            return `Линия длиннее ${(this.balance.lines[voltage].maxLengthM / 1000).toFixed(1)} км. Добавьте опору нужного напряжения.`;
        if (this.cables().length >= this.balance.world.maxCables)
            return "Достигнут лимит кабелей.";
    }
    connect(a, b, paid = 0) {
        const error = this.connectionError(a, b);
        if (error)
            return { ok: false, error };
        const ba = this.byId(a.id), bb = this.byId(b.id), i = this.index(a.id), j = this.index(b.id);
        this.adjacency[i][j] = this.adjacency[j][i] = Math.hypot(ba.x - bb.x, ba.y - bb.y);
        this.metadata.set(edgeKey(a.id, b.id), { ports: a.id < b.id ? [a.port, b.port] : [b.port, a.port], paid });
        return { ok: true, value: undefined };
    }
    disconnect(a, b) {
        const i = this.index(a), j = this.index(b);
        if (i < 0 || j < 0)
            return 0;
        const paid = this.metadata.get(edgeKey(a, b))?.paid ?? 0;
        this.adjacency[i][j] = this.adjacency[j][i] = 0;
        this.metadata.delete(edgeKey(a, b));
        return paid;
    }
    remove(id) {
        const i = this.index(id), b = this.byId(id);
        if (i < 0 || !b)
            return { ok: false, error: "Здание не найдено." };
        if (b.fixed)
            return { ok: false, error: "Населённые пункты и заводы удалять нельзя." };
        let paid = b.paid;
        for (const c of this.cables())
            if (c.a.id === id || c.b.id === id)
                paid += this.disconnect(c.a.id, c.b.id);
        this.buildings.splice(i, 1);
        this.adjacency.splice(i, 1);
        for (const row of this.adjacency)
            row.splice(i, 1);
        return { ok: true, value: paid };
    }
    cables() {
        const out = [];
        for (let i = 0; i < this.buildings.length; i++)
            for (let j = i + 1; j < this.buildings.length; j++) {
                const length = this.adjacency[i][j];
                if (length <= 0)
                    continue;
                const a = this.buildings[i], b = this.buildings[j], key = edgeKey(a.id, b.id);
                const meta = this.metadata.get(key);
                if (!meta)
                    throw new Error("Матрица и метаданные портов рассогласованы.");
                const ports = a.id < b.id ? meta.ports : [meta.ports[1], meta.ports[0]];
                out.push({ key, a: { id: a.id, port: ports[0] }, b: { id: b.id, port: ports[1] }, length,
                    voltage: voltageOf(a, ports[0]), paid: meta.paid });
            }
        return out;
    }
    hit(p) {
        return [...this.buildings].reverse().find(b => {
            const s = this.balance.buildings[b.kind];
            return Math.abs(p.x - b.x) <= s.widthM / 2 + 80 && Math.abs(p.y - b.y) <= s.heightM / 2 + 80;
        });
    }
    endpointAt(b, p) {
        return { id: b.id, port: b.kind === "transformer" ? p.x < b.x ? "in" : "out" : "terminal" };
    }
    endpointPosition(e) {
        const b = this.byId(e.id);
        return { x: b.x + (e.port === "in" ? -1 : e.port === "out" ? 1 : 0) * this.balance.buildings[b.kind].widthM * 0.43, y: b.y };
    }
    cableAt(p, tolerance = 150) {
        return this.cables().map(c => ({ c, d: distanceToSegment(p, this.endpointPosition(c.a), this.endpointPosition(c.b)) }))
            .filter(x => x.d <= tolerance).sort((a, b) => a.d - b.d)[0]?.c;
    }
    snapshot() {
        return { version: 3, nextId: this.nextId, buildings: structuredClone(this.buildings),
            adjacency: this.adjacency.map(r => [...r]), metadata: Object.fromEntries(structuredClone([...this.metadata])) };
    }
    static restore(data, balance, terrain) {
        if (!data || typeof data !== "object")
            throw new Error("Нет сохранения сети.");
        const s = data;
        if (s.version !== 3 || !Array.isArray(s.buildings) || !Array.isArray(s.adjacency) || !s.metadata ||
            s.buildings.length > balance.world.maxBuildings || s.adjacency.length !== s.buildings.length)
            throw new Error("Некорректный формат сети.");
        const w = new World(balance, terrain), ids = new Set();
        for (const b of s.buildings) {
            if (!b || !ALL_KINDS.includes(b.kind) || !Number.isSafeInteger(b.id) || b.id <= 0 || ids.has(b.id) ||
                !Number.isFinite(b.paid) || b.paid < 0 || !["hv", "lv"].includes(b.voltage) || typeof b.name !== "string")
                throw new Error("Некорректное здание в сохранении.");
            const a = w.add(b.kind, b.x, b.y, { voltage: b.voltage, paid: b.paid, name: b.name });
            if (!a.ok)
                throw new Error(a.error);
            a.value.id = b.id;
            ids.add(b.id);
            // Runtime parameters come from validated balance, not untrusted save JSON.
        }
        if (!Number.isSafeInteger(s.nextId) || s.nextId <= Math.max(0, ...ids))
            throw new Error("Неверный счётчик ID.");
        w.nextId = s.nextId;
        const n = w.buildings.length;
        for (const row of s.adjacency)
            if (!Array.isArray(row) || row.length !== n)
                throw new Error("Матрица не квадратная.");
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) {
                const d = s.adjacency[i][j];
                if (!Number.isFinite(d) || d < 0 || d !== s.adjacency[j][i] || (i === j && d !== 0))
                    throw new Error("Неверная матрица.");
                if (i >= j || d === 0)
                    continue;
                const a = w.buildings[i], b = w.buildings[j], m = s.metadata[edgeKey(a.id, b.id)];
                if (!m || !Array.isArray(m.ports) || m.ports.length !== 2 || !Number.isFinite(m.paid) || m.paid < 0)
                    throw new Error("Неверные метаданные кабеля.");
                if (Math.abs(d - Math.hypot(a.x - b.x, a.y - b.y)) > 1e-5)
                    throw new Error("Вес матрицы не совпадает с расстоянием.");
                const ps = a.id < b.id ? m.ports : [m.ports[1], m.ports[0]];
                const r = w.connect({ id: a.id, port: ps[0] }, { id: b.id, port: ps[1] }, m.paid);
                if (!r.ok)
                    throw new Error(r.error);
            }
        return w;
    }
}
