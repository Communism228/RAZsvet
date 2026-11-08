import { ALL_KINDS } from "./types.js";
export function validateBalance(data) {
    if (!data || typeof data !== "object")
        throw new Error("Настройки должны быть объектом JSON.");
    const b = data;
    if (b.schemaVersion !== 3 || !b.world || !b.economy || !b.campaign || !b.buildings || !b.lines || !b.simulation)
        throw new Error("Неподдерживаемый формат balance.json (нужна schemaVersion: 3).");
    function number(x, name, min, max) {
        if (!Number.isFinite(x) || x < min || x > max)
            throw new Error(`${name}: нужно число от ${min} до ${max}.`);
    }
    number(b.economy.startingMoney, "Начальный капитал", 0, 1e7);
    number(b.economy.refundFraction, "Возврат", 0, 1);
    number(b.economy.completionBonus, "Премия", 0, 1e7);
    number(b.campaign.baseSeconds, "Время этапа", 5, 3600);
    number(b.campaign.minSeconds, "Минимум времени", 5, b.campaign.baseSeconds);
    number(b.campaign.decreaseSeconds, "Уменьшение времени", 0, 600);
    number(b.campaign.priceGrowth, "Рост цен", 0, 1);
    number(b.campaign.firstYear, "Первый год", 1900, 2100);
    number(b.world.widthM, "Ширина мира", 1000, 100000);
    number(b.world.heightM, "Высота мира", 1000, 100000);
    number(b.world.clearanceM, "Зазор", 0, 1000);
    number(b.world.maxBuildings, "Лимит зданий", 8, 100);
    number(b.world.maxCables, "Лимит кабелей", 8, 160);
    number(b.world.minZoom, "Минимальный масштаб", 1, 1);
    number(b.world.maxZoom, "Максимальный масштаб", 1, 6);
    number(b.world.maxPanFraction, "Смещение камеры", 0, 0.5);
    if (b.world.initialZoom !== undefined)
        number(b.world.initialZoom, "world.initialZoom", b.world.minZoom, b.world.maxZoom);
    if (b.resources) {
        const r = b.resources;
        if (!["none", "random", "fixed"].includes(r.mode))
            throw new Error("resources.mode must be random, none or fixed");
        number(r.emptyRegionChance, "resources.emptyRegionChance", 0, 1);
        for (const kind of ["coal", "peat"]) {
            const c = r[kind];
            if (!c)
                throw new Error(`Missing resources.${kind}`);
            number(c.minCount, `${kind}.minCount`, 0, 12);
            number(c.maxCount, `${kind}.maxCount`, c.minCount, 12);
            if (!Number.isInteger(c.minCount) || !Number.isInteger(c.maxCount))
                throw new Error("Resource counts must be integers");
            number(c.noneChance, `${kind}.noneChance`, 0, 1);
            number(c.radiusM, `${kind}.radiusM`, 200, 2500);
        }
    }
    if (b.penalties) {
        const p = b.penalties;
        number(p.fine, "penalties.fine", 0, 1e7);
        number(p.fineGrowth, "penalties.fineGrowth", 0, 1e7);
        number(p.maxStrikes, "penalties.maxStrikes", 1, 10);
        number(p.retrySeconds, "penalties.retrySeconds", 5, 3600);
        if (!Number.isInteger(p.maxStrikes))
            throw new Error("penalties.maxStrikes must be an integer");
    }
    number(b.simulation.fullPowerThreshold, "Порог освещения", 0.95, 1);
    number(b.simulation.lossSegments, "Сегменты потерь", 4, 32);
    for (const n of [b.world.maxBuildings, b.world.maxCables, b.simulation.lossSegments])
        if (!Number.isInteger(n))
            throw new Error("Лимиты и число сегментов должны быть целыми.");
    for (const kind of ALL_KINDS) {
        const k = b.buildings[kind];
        if (!k)
            throw new Error(`Нет настройки здания ${kind}.`);
        number(k.price, `${kind}.price`, 0, 1e6);
        number(k.widthM, `${kind}.widthM`, 50, 3000);
        number(k.heightM, `${kind}.heightM`, 50, 3000);
        if (k.clearanceWidthM !== undefined)
            number(k.clearanceWidthM, `${kind}.clearanceWidthM`, k.widthM, 5000);
        if (k.clearanceHeightM !== undefined)
            number(k.clearanceHeightM, `${kind}.clearanceHeightM`, k.heightM, 5000);
        if (["coal", "peat", "hydro"].includes(kind))
            number(k.generationKW, `${kind}.generationKW`, 1, 10000);
        if (["city", "village", "factory"].includes(kind)) {
            number(k.demandKW, `${kind}.demandKW`, 1, 10000);
            number(k.incomePerSec, `${kind}.incomePerSec`, 0, 10000);
        }
        if (kind === "transformer") {
            number(k.outputLimitKW, `${kind}.outputLimitKW`, 1, 10000);
            number(k.efficiency, `${kind}.efficiency`, 0.5, 1);
        }
    }
    for (const v of ["hv", "lv"]) {
        const l = b.lines[v];
        if (!l)
            throw new Error(`Нет линии ${v}.`);
        number(l.voltageV, `${v}.voltageV`, 1, 100000);
        number(l.maxLengthM, `${v}.maxLengthM`, 100, 20000);
        number(l.resistanceOhmPerM, `${v}.resistanceOhmPerM`, 0, 0.01);
        number(l.maxCurrentA, `${v}.maxCurrentA`, 1, 10000);
        number(l.pricePerKm, `${v}.pricePerKm`, 0, 1e5);
    }
    if (b.lines.hv.voltageV <= b.lines.lv.voltageV)
        throw new Error("Высокое напряжение должно быть больше низкого.");
    return structuredClone(b);
}
