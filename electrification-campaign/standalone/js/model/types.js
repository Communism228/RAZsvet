export const BUILD_KINDS = ["coal", "peat", "hydro", "pole", "transformer"];
export const ALL_KINDS = [...BUILD_KINDS, "village", "city", "factory"];
export const NAMES = {
    coal: "Угольная ТЭС", peat: "Торфяная ТЭС", hydro: "ГЭС", pole: "Опора ЛЭП",
    transformer: "Трансформатор", village: "Деревня", city: "Город", factory: "Завод"
};
export const SHORT = {
    coal: "У", peat: "Т", hydro: "Г", pole: "Л", transformer: "ПС", village: "Д", city: "ГР", factory: "З"
};
export const isPlant = (b) => ["coal", "peat", "hydro"].includes(b.kind);
export const isConsumer = (b) => ["village", "city", "factory"].includes(b.kind);
export const label = (b) => `${SHORT[b.kind]}${b.id}`;
export const edgeKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
export const endpointKey = (e) => `${e.id}:${e.port}`;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const voltageOf = (b, p) => b.kind === "transformer" ? p === "in" ? "hv" : "lv" : b.voltage;
export const voltageName = (v) => v === "hv" ? "10 кВ" : "400 В";
