
import { ALL_KINDS, type Balance } from "./types.js";

export function validateBalance(data: unknown): Balance {
  if (!data || typeof data !== "object") throw new Error("Настройки должны быть объектом JSON.");
  const b = data as Balance;
  if (b.schemaVersion !== 3 || !b.world || !b.economy || !b.campaign || !b.buildings || !b.lines || !b.simulation)
    throw new Error("Неподдерживаемый формат balance.json (нужна schemaVersion: 3).");
  function number(x: number, name: string, min: number, max: number): void {
    if (!Number.isFinite(x) || x < min || x > max) throw new Error(`${name}: нужно число от ${min} до ${max}.`);
  }
  number(b.economy.startingMoney,"Начальный капитал",0,1e7);
  number(b.economy.refundFraction,"Возврат",0,1);
  number(b.economy.completionBonus,"Премия",0,1e7);
  number(b.campaign.baseSeconds,"Время этапа",5,3600);
  number(b.campaign.minSeconds,"Минимум времени",5,b.campaign.baseSeconds);
  number(b.campaign.decreaseSeconds,"Уменьшение времени",0,600);
  number(b.campaign.priceGrowth,"Рост цен",0,1);
  number(b.campaign.firstYear,"Первый год",1900,2100);
  number(b.world.widthM,"Ширина мира",1000,100000);
  number(b.world.heightM,"Высота мира",1000,100000);
  number(b.world.clearanceM,"Зазор",0,1000);
  number(b.world.maxBuildings,"Лимит зданий",8,100);
  number(b.world.maxCables,"Лимит кабелей",8,160);
  number(b.world.minZoom,"Минимальный масштаб",1,1);
  number(b.world.maxZoom,"Максимальный масштаб",1,3);
  number(b.world.maxPanFraction,"Смещение камеры",0,0.25);
  number(b.simulation.fullPowerThreshold,"Порог освещения",0.95,1);
  number(b.simulation.lossSegments,"Сегменты потерь",4,32);
  for (const n of [b.world.maxBuildings,b.world.maxCables,b.simulation.lossSegments])
    if (!Number.isInteger(n)) throw new Error("Лимиты и число сегментов должны быть целыми.");
  for (const kind of ALL_KINDS) {
    const k = b.buildings[kind];
    if (!k) throw new Error(`Нет настройки здания ${kind}.`);
    number(k.price,`${kind}.price`,0,1e6);
    number(k.widthM,`${kind}.widthM`,50,3000);
    number(k.heightM,`${kind}.heightM`,50,3000);
    if (["coal","peat","hydro"].includes(kind)) number(k.generationKW!,`${kind}.generationKW`,1,10000);
    if (["city","village","factory"].includes(kind)) {
      number(k.demandKW!,`${kind}.demandKW`,1,10000);
      number(k.incomePerSec!,`${kind}.incomePerSec`,0,10000);
    }
    if (kind === "transformer") {
      number(k.outputLimitKW!,`${kind}.outputLimitKW`,1,10000);
      number(k.efficiency!,`${kind}.efficiency`,0.5,1);
    }
  }
  for (const v of ["hv","lv"] as const) {
    const l = b.lines[v];
    if (!l) throw new Error(`Нет линии ${v}.`);
    number(l.voltageV,`${v}.voltageV`,1,100000);
    number(l.maxLengthM,`${v}.maxLengthM`,100,20000);
    number(l.resistanceOhmPerM,`${v}.resistanceOhmPerM`,0,0.01);
    number(l.maxCurrentA,`${v}.maxCurrentA`,1,10000);
    number(l.pricePerKm,`${v}.pricePerKm`,0,1e5);
  }
  if (b.lines.hv.voltageV <= b.lines.lv.voltageV) throw new Error("Высокое напряжение должно быть больше низкого.");
  return structuredClone(b);
}
