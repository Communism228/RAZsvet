import { generateResources } from "./resources.js";
import { BUILD_KINDS, isConsumer } from "./types.js";
import { Terrain, random } from "./terrain.js";
import { World } from "./world.js";
import { simulate } from "./simulation.js";
export function balanceHash(balance) {
    let h = 2166136261;
    for (const c of JSON.stringify(balance)) {
        h ^= c.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}
export function populate(world, seed) {
    const cfg = world.terrain.region, b = world.balance, rand = random(seed ^ cfg.seed);
    const specs = [...cfg.spawn.settlements, ...cfg.spawn.factories.map(f => ({ ...f, kind: "factory" }))];
    for (const spec of specs) {
        let placed = false;
        for (let attempt = 0; attempt < 220; attempt++) {
            const jitter = cfg.spawn.jitterM;
            const x = attempt < 120 ? spec.u * b.world.widthM + (rand() - .5) * 2 * jitter :
                b.world.widthM * (0.08 + rand() * 0.84);
            const y = attempt < 120 ? spec.v * b.world.heightM + (rand() - .5) * 2 * jitter :
                b.world.heightM * (0.1 + rand() * 0.8);
            if (cfg.deposits.some(d => Math.hypot(x - d.u * b.world.widthM, y - d.v * b.world.heightM) < Math.max(550, d.radiusM * .5)))
                continue;
            if (world.add(spec.kind, x, y, { name: spec.name }).ok) {
                placed = true;
                break;
            }
        }
        if (!placed)
            throw new Error(`Нет допустимой площадки для ${spec.name}. Проверьте маски и spawn в region.json.`);
    }
}
function pickObjectives(world, seed) {
    const rand = random(seed);
    const shuffle = (items) => {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };
    const factories = shuffle(world.buildings.filter(b => b.kind === "factory"));
    const cities = shuffle(world.buildings.filter(b => b.kind === "city"));
    const villages = shuffle(world.buildings.filter(b => b.kind === "village"));
    const chosen = [...factories.slice(0, Math.min(2, factories.length))];
    if (cities.length)
        chosen.push(cities[0]);
    if (villages.length)
        chosen.push(villages[0]);
    if (chosen.length < 3) {
        for (const extra of shuffle(world.buildings.filter(b => isConsumer(b) && !chosen.some(x => x.id === b.id)))) {
            chosen.push(extra);
            if (chosen.length >= 3)
                break;
        }
    }
    return chosen.map((b, i) => ({
        id: b.id,
        name: b.name || (b.kind === "factory" ? `Завод ${i + 1}` : b.kind === "city" ? `Город ${i + 1}` : `Деревня ${i + 1}`),
        months: 3 + Math.floor(rand() * 10),
        kind: b.kind
    }));
}
export class Campaign {
    balance;
    regions;
    seed;
    money;
    completed = [];
    status = "map";
    strikes = 0;
    attempt = 0;
    world = null;
    sim = null;
    region = null;
    objectives = [];
    elapsed = 0;
    incomeEarned = 0;
    paused = false;
    lastOutcome = null;
    constructor(balance, regions, seed) {
        this.balance = balance;
        this.regions = regions;
        this.seed = seed;
        this.money = balance.economy.startingMoney;
    }
    get stage() { return this.completed.length; }
    get priceFactor() { return (1 + this.balance.campaign.priceGrowth) ** this.stage; }
    get penaltyRules() { return this.balance.penalties ?? { fine: 120, fineGrowth: 60, maxStrikes: 3, retrySeconds: 120 }; }
    get duration() {
        if (this.attempt > 0 && ["playing", "reprimand", "failed"].includes(this.status))
            return this.penaltyRules.retrySeconds;
        const c = this.balance.campaign;
        return Math.max(c.minSeconds, c.baseSeconds - this.stage * c.decreaseSeconds);
    }
    get remaining() { return Math.max(0, this.duration - this.elapsed); }
    price(kind) { return Math.ceil(this.balance.buildings[kind].price * this.priceFactor); }
    isObjective(id) { return this.objectives.some(o => o.id === id); }
    get poweredObjectives() {
        return this.objectives.filter(o => {
            const b = this.world?.byId(o.id);
            if (!b)
                return false;
            return (this.sim?.consumerKW.get(o.id) ?? 0) >= b.demandKW * this.balance.simulation.fullPowerThreshold;
        }).length;
    }
    get objectiveCount() { return this.objectives.length; }
    get poweredFactories() {
        return this.world?.buildings.filter(b => b.kind === "factory" &&
            (this.sim?.consumerKW.get(b.id) ?? 0) >= b.demandKW * this.balance.simulation.fullPowerThreshold).length ?? 0;
    }
    get factories() { return this.world?.buildings.filter(b => b.kind === "factory").length ?? 0; }
    get incomeRate() {
        if (!this.world || !this.sim)
            return 0;
        return this.world.buildings.filter(b => isConsumer(b) && b.kind !== "factory" &&
            (this.sim.consumerKW.get(b.id) ?? 0) >= b.demandKW * this.balance.simulation.fullPowerThreshold)
            .reduce((s, b) => s + b.incomePerSec, 0);
    }
    begin(region, terrain) {
        if (this.status !== "map" || this.completed.includes(region.id))
            throw new Error("Регион недоступен.");
        const stageSeed = this.seed + this.stage * 7919;
        terrain = generateResources(terrain, stageSeed);
        const world = new World(this.balance, terrain);
        populate(world, stageSeed);
        this.world = world;
        this.region = terrain.region;
        this.elapsed = 0;
        this.incomeEarned = 0;
        this.attempt = 0;
        this.objectives = pickObjectives(world, stageSeed ^ 0x9e3779b9);
        this.status = "playing";
        this.paused = false;
        this.refresh();
    }
    refresh() {
        if (this.world)
            this.sim = simulate(this.world);
    }
    guard() {
        if (this.status !== "playing" || !this.world)
            return "Регион уже закрыт.";
        if (this.paused)
            return "Сначала снимите паузу.";
    }
    place(kind, x, y, voltage) {
        const locked = this.guard();
        if (locked)
            return { ok: false, error: locked };
        if (!BUILD_KINDS.includes(kind))
            return { ok: false, error: "Нельзя купить этот объект." };
        const price = this.price(kind);
        const error = this.world.placementError(kind, x, y);
        if (error)
            return { ok: false, error };
        if (this.money + 1e-8 < price)
            return { ok: false, error: `Недостаточно денег: нужно ${price} ₽.` };
        const r = this.world.add(kind, x, y, { paid: price, voltage });
        if (!r.ok)
            return r;
        this.money -= price;
        this.refresh();
        return { ok: true, value: undefined };
    }
    cablePrice(a, b) {
        const w = this.world, aa = w.byId(a.id), bb = w.byId(b.id);
        const v = aa.kind === "transformer" ? a.port === "in" ? "hv" : "lv" : aa.voltage;
        return Math.ceil(Math.hypot(aa.x - bb.x, aa.y - bb.y) / 1000 * this.balance.lines[v].pricePerKm * this.priceFactor);
    }
    connect(a, b) {
        const locked = this.guard();
        if (locked)
            return { ok: false, error: locked };
        const error = this.world.connectionError(a, b);
        if (error)
            return { ok: false, error };
        const price = this.cablePrice(a, b);
        if (this.money + 1e-8 < price)
            return { ok: false, error: `Для кабеля нужно ${price} ₽.` };
        const r = this.world.connect(a, b, price);
        if (!r.ok)
            return r;
        this.money -= price;
        this.refresh();
        return { ok: true, value: undefined };
    }
    removeBuilding(id) {
        const locked = this.guard();
        if (locked)
            return { ok: false, error: locked };
        const r = this.world.remove(id);
        if (!r.ok)
            return r;
        const refund = r.value * this.balance.economy.refundFraction;
        this.money += refund;
        this.refresh();
        return { ok: true, value: refund };
    }
    removeCable(key) {
        const locked = this.guard();
        if (locked)
            return { ok: false, error: locked };
        const c = this.world.cables().find(c => c.key === key);
        if (!c)
            return { ok: false, error: "Кабель не найден." };
        const refund = this.world.disconnect(c.a.id, c.b.id) * this.balance.economy.refundFraction;
        this.money += refund;
        this.refresh();
        return { ok: true, value: refund };
    }
    advance(dt) {
        if (this.status !== "playing" || this.paused || !this.world)
            return null;
        if (!Number.isFinite(dt) || dt < 0)
            throw new Error("Некорректный шаг времени.");
        const step = Math.min(dt, this.remaining), earned = step * this.incomeRate;
        this.money += earned;
        this.incomeEarned += earned;
        this.elapsed += step;
        if (this.remaining > 1e-7)
            return null;
        this.refresh();
        const success = this.objectiveCount > 0 && this.poweredObjectives === this.objectiveCount;
        let fine = 0;
        if (success) {
            this.completed.push(this.region.id);
            this.money += this.balance.economy.completionBonus;
            this.status = this.completed.length === this.regions.length ? "won" : "map";
        }
        else {
            this.strikes++;
            if (this.strikes >= this.penaltyRules.maxStrikes) {
                this.status = "failed";
            }
            else {
                fine = this.penaltyRules.fine + (this.strikes - 1) * this.penaltyRules.fineGrowth;
                this.money -= fine; // Fines may create debt; purchases still require available money.
                this.status = "reprimand";
                this.paused = true;
            }
        }
        const outcome = { success, regionId: this.region.id, regionName: this.region.name,
            objectives: this.objectiveCount, poweredObjectives: this.poweredObjectives, incomeEarned: this.incomeEarned,
            money: this.money, lossesKW: (this.sim?.cableLossKW ?? 0) + (this.sim?.transformerLossKW ?? 0),
            fine, strikes: this.strikes, terminal: this.status === "failed" };
        this.lastOutcome = outcome;
        return outcome;
    }
    retry() {
        if (this.status !== "reprimand" || !this.world || !this.region)
            throw new Error("No reprimand to continue");
        // Keep the network, consumers, deposits, debt and objective IDs. Only the deadline restarts.
        this.attempt++;
        this.elapsed = 0;
        this.status = "playing";
        this.paused = false;
        this.refresh();
    }
    snapshot() {
        return { version: 6, strikes: this.strikes, balanceHash: balanceHash(this.balance), seed: this.seed, money: this.money,
            completed: [...this.completed], status: this.status, lastOutcome: this.lastOutcome,
            active: ["playing", "reprimand"].includes(this.status) && this.world && this.region ?
                { regionId: this.region.id, attempt: this.attempt, elapsed: this.elapsed, incomeEarned: this.incomeEarned, objectives: structuredClone(this.objectives), deposits: structuredClone(this.region.deposits), world: this.world.snapshot() } : null };
    }
    static restore(data, balance, regions, terrain) {
        if (!data || typeof data !== "object")
            throw new Error("Нет сохранения.");
        const s = data;
        if (s.version !== 6 || s.balanceHash !== balanceHash(balance))
            throw new Error("Баланс изменился. Начните новую кампанию.");
        if (!Number.isSafeInteger(s.seed) || !Number.isFinite(s.money) ||
            !Number.isInteger(s.strikes) || s.strikes < 0 || s.strikes > (balance.penalties?.maxStrikes ?? 3) ||
            !["map", "playing", "reprimand", "failed", "won"].includes(s.status) || !Array.isArray(s.completed) ||
            new Set(s.completed).size !== s.completed.length || s.completed.some(id => !regions.some(r => r.id === id)))
            throw new Error("Некорректное сохранение кампании.");
        const c = new Campaign(balance, regions, s.seed);
        c.money = s.money;
        c.strikes = s.strikes;
        c.completed = [...s.completed];
        c.status = s.status;
        c.lastOutcome = s.lastOutcome;
        if (s.status === "won" && s.completed.length !== regions.length)
            throw new Error("Неверный итог кампании.");
        if (s.status === "failed" && c.strikes !== c.penaltyRules.maxStrikes)
            throw new Error("Invalid final strike count");
        if (s.status !== "failed" && c.strikes >= c.penaltyRules.maxStrikes)
            throw new Error("Strike limit exceeded");
        if (s.status === "reprimand" && (c.strikes < 1 || !c.lastOutcome || c.lastOutcome.success))
            throw new Error("Invalid reprimand");
        if (s.status === "playing" || s.status === "reprimand") {
            if (!s.active || !Number.isInteger(s.active.attempt) || s.active.attempt < 0 || s.active.attempt > c.strikes)
                throw new Error("Invalid retry counter");
            c.attempt = s.active.attempt;
            if (!s.active || !terrain || s.active.regionId !== terrain.region.id ||
                c.completed.includes(s.active.regionId) || !Number.isFinite(s.active.elapsed) ||
                s.active.elapsed < 0 || s.active.elapsed > c.duration ||
                (s.status === "playing" && s.active.elapsed >= c.duration) ||
                (s.status === "reprimand" && Math.abs(s.active.elapsed - c.duration) > 1e-6) || !Number.isFinite(s.active.incomeEarned) || s.active.incomeEarned < 0 ||
                !Array.isArray(s.active.objectives))
                throw new Error("Некорректный активный регион.");
            if (!Array.isArray(s.active.deposits))
                throw new Error("Missing saved resources");
            const ids = new Set();
            const deposits = s.active.deposits.map(d => {
                if (!d || typeof d.id !== "string" || ids.has(d.id) || !["coal", "peat"].includes(d.kind) ||
                    !Number.isFinite(d.u) || !Number.isFinite(d.v) || d.u < 0 || d.u > 1 || d.v < 0 || d.v > 1 ||
                    !Number.isFinite(d.radiusM) || d.radiusM < 100 || d.radiusM > Math.hypot(balance.world.widthM, balance.world.heightM) * 2)
                    throw new Error("Invalid resource save");
                ids.add(d.id);
                return { ...d };
            });
            terrain = new Terrain({ ...terrain.region, deposits }, balance, terrain.masks);
            c.region = terrain.region;
            c.world = World.restore(s.active.world, balance, terrain);
            c.objectives = s.active.objectives.map(o => {
                if (!o || !Number.isSafeInteger(o.id) || typeof o.name !== "string" || !Number.isFinite(o.months) ||
                    !["city", "village", "factory"].includes(o.kind))
                    throw new Error("Некорректные данные госплана.");
                return { id: o.id, name: o.name, months: Math.max(1, Math.floor(o.months)), kind: o.kind };
            });
            if (c.objectives.length === 0 || new Set(c.objectives.map(o => o.id)).size !== c.objectives.length ||
                c.objectives.some(o => c.world.byId(o.id)?.kind !== o.kind))
                throw new Error("Invalid objective targets");
            c.elapsed = s.active.elapsed;
            c.incomeEarned = s.active.incomeEarned;
            c.paused = true;
            c.refresh();
        }
        return c;
    }
}
