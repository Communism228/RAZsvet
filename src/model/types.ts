
export type Kind = "coal" | "peat" | "hydro" | "pole" | "transformer" | "village" | "city" | "factory";
export type BuildKind = "coal" | "peat" | "hydro" | "pole" | "transformer";
export type Tool = BuildKind | "cable" | "delete" | "inspect";
export type Voltage = "hv" | "lv";
export type Port = "terminal" | "in" | "out";
export interface Point { x: number; y: number }
export interface Endpoint { id: number; port: Port }
export interface Building extends Point {
  id: number; kind: Kind; name: string; voltage: Voltage;
  generationKW: number; demandKW: number; incomePerSec: number;
  outputLimitKW: number; efficiency: number; paid: number; fixed: boolean;
}
export interface BuildingBalance {
  price: number; generationKW?: number; demandKW?: number; incomePerSec?: number;
  outputLimitKW?: number; efficiency?: number;
  widthM: number; heightM: number;
}
export interface LineBalance {
  voltageV: number; maxLengthM: number; resistanceOhmPerM: number;
  maxCurrentA: number; pricePerKm: number;
}
export interface Balance {
  schemaVersion: 3;
  economy: { startingMoney: number; refundFraction: number; completionBonus: number };
  campaign: { baseSeconds: number; decreaseSeconds: number; minSeconds: number;
    priceGrowth: number; firstYear: number };
  world: { widthM: number; heightM: number; clearanceM: number;
    maxBuildings: number; maxCables: number; minZoom: number; maxZoom: number;
    maxPanFraction: number };
  simulation: { lossSegments: number; fullPowerThreshold: number };
  buildings: Record<Kind, BuildingBalance>;
  lines: Record<Voltage, LineBalance>;
}
export interface Deposit { id: string; kind: "coal" | "peat"; u: number; v: number; radiusM: number }
export interface RegionConfig {
  id: string; name: string; city: { u: number; v: number };
  seed: number; map: string; countryMask: string;
  masks: { water?: string; hydro?: string; blocked?: string; spawn?: string };
  deposits: Deposit[];
  river: { points: [number, number][]; widthM: number } | null;
  spawn: { settlements: { kind: "city" | "village"; u: number; v: number; name: string }[];
    factories: {u: number; v: number; name: string}[]; jitterM: number };
}
export interface CampaignIndex { regions: string[] }
export interface SpriteSpec {
  idle: string; powered?: string; icon?: string; width: number; height: number;
  anchorX: number; anchorY: number;
  frames?: { width: number; height: number; count: number; fps: number };
}
export interface AssetsManifest {
  menu?: { background: string; showNetworkOverlay?: boolean;
    layers?: {image: string; amplitudeX?: number; amplitudeY?: number; periodMs?: number; opacity?: number}[] };
  country: { dark: string; light: string };
  sprites: Record<Kind, SpriteSpec>;
  overseer: string; intro: string;
}
export interface IntroConfig {
  width: number; height: number; fadeMs: number; fullPageLayers?: boolean;
  panels: { image: string; caption: string; x: number; y: number; width: number; height: number }[];
}
export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };
export const BUILD_KINDS: BuildKind[] = ["coal","peat","hydro","pole","transformer"];
export const ALL_KINDS: Kind[] = [...BUILD_KINDS,"village","city","factory"];
export const NAMES: Record<Kind,string> = {
  coal:"Угольная ТЭС", peat:"Торфяная ТЭС", hydro:"ГЭС", pole:"Опора ЛЭП",
  transformer:"Трансформатор", village:"Деревня", city:"Город", factory:"Завод"
};
export const SHORT: Record<Kind,string> = {
  coal:"У", peat:"Т", hydro:"Г", pole:"Л", transformer:"ПС", village:"Д", city:"ГР", factory:"З"
};
export const isPlant = (b: {kind: Kind}): boolean => ["coal","peat","hydro"].includes(b.kind);
export const isConsumer = (b: {kind: Kind}): boolean => ["village","city","factory"].includes(b.kind);
export const label = (b: Building): string => `${SHORT[b.kind]}${b.id}`;
export const edgeKey = (a: number,b: number): string => a < b ? `${a}-${b}` : `${b}-${a}`;
export const endpointKey = (e: Endpoint): string => `${e.id}:${e.port}`;
export const clamp = (x: number,a: number,b: number): number => Math.max(a,Math.min(b,x));
export const voltageOf = (b: Building,p: Port): Voltage =>
  b.kind === "transformer" ? p === "in" ? "hv" : "lv" : b.voltage;
export const voltageName = (v: Voltage): string => v === "hv" ? "10 кВ" : "400 В";

export interface MessagesConfig {
  everySeconds: number; displaySeconds: number; urgentBelowSeconds: number;
  regular: string[]; urgent: string; complete: string;
}
