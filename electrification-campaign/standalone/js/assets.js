import { validateBalance } from "./model/settings.js";
import { Mask, Terrain } from "./model/terrain.js";
export async function json(path) {
    const r = await fetch(new URL(path, document.baseURI));
    if (!r.ok)
        throw new Error(`Не удалось загрузить ${path}: HTTP ${r.status}`);
    return r.json();
}
export async function loadData() {
    const [raw, manifest, index] = await Promise.all([
        json("data/balance.json"), json("data/assets.json"), json("data/campaign.json")
    ]);
    const balance = validateBalance(raw);
    const regions = await Promise.all(index.regions.map(p => json(p)));
    if (regions.length === 0 || new Set(regions.map(r => r.id)).size !== regions.length)
        throw new Error("Список регионов пуст или содержит дубликаты.");
    for (const r of regions) {
        if (!r.id || !r.name || !r.map || !r.city || !r.spawn || r.spawn.factories.length === 0)
            throw new Error("Неверные данные региона.");
        for (const p of [r.city, ...r.deposits, ...r.spawn.settlements, ...r.spawn.factories])
            if (!Number.isFinite(p.u) || !Number.isFinite(p.v) || p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1)
                throw new Error(`Координаты ${r.id} должны лежать от 0 до 1.`);
    }
    const intro = await json(manifest.intro);
    if (!Number.isFinite(intro.width) || intro.width <= 0 || !Number.isFinite(intro.height) || intro.height <= 0 ||
        !Number.isFinite(intro.fadeMs) || intro.fadeMs <= 0 || !Array.isArray(intro.panels) || !intro.panels.length)
        throw new Error("Неверные размеры или длительность комикса.");
    for (const panel of intro.panels) {
        if (typeof panel.image !== "string" || typeof panel.caption !== "string" ||
            ![panel.x, panel.y, panel.width, panel.height].every(Number.isFinite) ||
            panel.width <= 0 || panel.height <= 0 || panel.x < 0 || panel.y < 0 ||
            panel.x + panel.width > intro.width || panel.y + panel.height > intro.height)
            throw new Error("Панель комикса выходит за пределы общего холста.");
    }
    const messages = await json("data/messages.json");
    if (!Number.isFinite(messages.everySeconds) || messages.everySeconds <= 0 ||
        !Number.isFinite(messages.displaySeconds) || messages.displaySeconds <= 0 ||
        !Array.isArray(messages.regular) || messages.regular.length === 0)
        throw new Error("Неверные настройки сообщений надсмотрщика.");
    return { balance, manifest, regions, intro, messages };
}
export class Assets {
    data;
    images = new Map();
    litRegions = new Map();
    constructor(data) {
        this.data = data;
    }
    image(path) { return this.images.get(path); }
    async loadImage(path) {
        const cached = this.images.get(path);
        if (cached)
            return cached;
        const img = new Image();
        img.src = new URL(path, document.baseURI).href;
        try {
            await img.decode();
        }
        catch {
            throw new Error(`Не удалось прочитать изображение: ${path}`);
        }
        this.images.set(path, img);
        return img;
    }
    async preload() {
        const m = this.data.manifest;
        const paths = new Set([m.country.dark, m.country.light, m.overseer, ...this.data.intro.panels.map(p => p.image),
            ...this.data.regions.map(r => r.countryMask)]);
        if (m.menu) {
            paths.add(m.menu.background);
            for (const layer of m.menu.layers ?? [])
                paths.add(layer.image);
        }
        for (const s of Object.values(m.sprites)) {
            paths.add(s.idle);
            if (s.powered)
                paths.add(s.powered);
            if (s.icon)
                paths.add(s.icon);
        }
        await Promise.all([...paths].map(p => this.loadImage(p)));
        const dark = this.image(m.country.dark), light = this.image(m.country.light);
        if (dark.naturalWidth !== light.naturalWidth || dark.naturalHeight !== light.naturalHeight)
            throw new Error("Тёмная и светлая карты страны должны иметь одинаковые размеры.");
        for (const r of this.data.regions) {
            const mask = this.image(r.countryMask);
            if (mask.naturalWidth !== dark.naturalWidth || mask.naturalHeight !== dark.naturalHeight)
                throw new Error(`Маска области ${r.id}: ${mask.naturalWidth} x ${mask.naturalHeight}; карта: ${dark.naturalWidth} x ${dark.naturalHeight}. Проверьт ${r.countryMask} и явные width/height у SVG.`);
            const c = document.createElement("canvas");
            c.width = dark.naturalWidth;
            c.height = dark.naturalHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(light, 0, 0, c.width, c.height);
            ctx.globalCompositeOperation = "destination-in";
            ctx.drawImage(mask, 0, 0, c.width, c.height);
            this.litRegions.set(r.id, c);
        }
    }
    thumb(kind) {
        const s = this.data.manifest.sprites[kind], im = this.image(s.idle);
        if (s.icon)
            return new URL(s.icon, document.baseURI).href;
        if (!s.frames || !im)
            return new URL(s.idle, document.baseURI).href;
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 128;
        c.getContext("2d").drawImage(im, 0, 0, s.frames.width, s.frames.height, 0, 0, 128, 128);
        return c.toDataURL();
    }
    async terrain(region, balance) {
        const bg = await this.loadImage(region.map), masks = {};
        for (const name of ["water", "hydro", "blocked", "spawn"]) {
            const path = region.masks[name];
            if (!path)
                continue;
            const img = await this.loadImage(path);
            if (img.naturalWidth !== bg.naturalWidth || img.naturalHeight !== bg.naturalHeight)
                throw new Error(`Маска ${path} должна совпадать по размеру с ${region.map}.`);
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            const rgba = ctx.getImageData(0, 0, c.width, c.height).data, pixels = new Uint8Array(c.width * c.height);
            for (let i = 0; i < pixels.length; i++)
                pixels[i] = rgba[i * 4 + 3] >= 128 && rgba[i * 4] >= 128 ? 255 : 0;
            masks[name] = new Mask(c.width, c.height, pixels);
        }
        return new Terrain(region, balance, masks);
    }
}
