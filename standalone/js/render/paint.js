import { Assets } from "../assets.js";
import { Campaign } from "../model/campaign.js";
import { BUILD_KINDS, NAMES, isConsumer, isPlant, clamp } from "../model/types.js";
const C = { gold: "#e0bc67", paper: "#fff2d2", red: "#dc3b35", dark: "#3b3024", blue: "#fff2d2" };
export function countryRect(width, height) {
    const s = Math.min((width - 80) / 1280, (height - 150) / 800);
    const w = 1280 * s, h = 800 * s;
    return { x: (width - w) / 2, y: 105 + (height - 150 - h) / 2, w, h, scale: s };
}
export function worldView(width, height, b, c) {
    const scale = Math.min(width / b.world.widthM, height / b.world.heightM) * c.zoom;
    return { x: width / 2 - c.x * scale, y: height / 2 - c.y * scale, w: b.world.widthM * scale, h: b.world.heightM * scale, scale };
}
export function screenToWorld(p, s) {
    const v = worldView(s.width, s.height, s.campaign.balance, s.camera);
    return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}
export function worldToScreen(p, s) {
    const v = worldView(s.width, s.height, s.campaign.balance, s.camera);
    return { x: v.x + p.x * v.scale, y: v.y + p.y * v.scale };
}
/** Hit visible icons instead of only the smaller ground clearance rectangle. */
export function iconAt(p, s) {
    const w = s.campaign.world;
    if (!w)
        return;
    const k = s.campaign.balance.world.widthM / 1280;
    return [...w.buildings].sort((a, b) => b.y - a.y).find(b => {
        const art = s.data.manifest.sprites[b.kind];
        return p.x >= b.x - art.width * k * art.anchorX && p.x <= b.x + art.width * k * (1 - art.anchorX) &&
            p.y >= b.y - art.height * k * art.anchorY && p.y <= b.y + art.height * k * (1 - art.anchorY);
    }) ?? w.hit(p);
}
function text(ctx, t, x, y, size = 12, color = C.paper, align = "left") {
    ctx.font = `600 ${size}px "RazSvetUser","RazSvetInstalled","DejaVu Sans Condensed",Arial,sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(t, x, y);
}
function wrap(ctx, t, width) {
    const words = t.split(" "), lines = [];
    let line = "";
    for (const word of words) {
        const next = line ? line + " " + word : word;
        if (line && ctx.measureText(next).width > width) {
            lines.push(line);
            line = word;
        }
        else
            line = next;
    }
    if (line)
        lines.push(line);
    return lines;
}
function sprite(ctx, s, kind, x, y, active, scale) {
    const spec = s.data.manifest.sprites[kind], image = s.assets.image(active && spec.powered ? spec.powered : spec.idle);
    if (!image)
        return;
    const w = spec.width * scale, h = spec.height * scale, dx = x - w * spec.anchorX, dy = y - h * spec.anchorY;
    const f = spec.frames;
    if (f) {
        const n = Math.floor(image.naturalWidth / f.width);
        const frame = active ? Math.floor(s.time / 1000 * f.fps) % f.count : 0;
        ctx.drawImage(image, (frame % n) * f.width, Math.floor(frame / n) * f.height, f.width, f.height, dx, dy, w, h);
    }
    else
        ctx.drawImage(image, dx, dy, w, h);
}
function country(ctx, s) {
    const r = countryRect(s.width, s.height), dark = s.assets.image(s.data.manifest.country.dark);
    ctx.save();
    if (s.phase === "transition" && s.transition) {
        const p = clamp((s.time - s.transition.start) / 1050, 0, 1), e = p * p * (3 - 2 * p), z = 1 + 3.5 * e;
        const reg = s.data.regions.find(r => r.id === s.transition.regionId);
        const x = r.x + reg.city.u * r.w, y = r.y + reg.city.v * r.h;
        ctx.translate(s.width / 2, s.height / 2);
        ctx.scale(z, z);
        ctx.translate(-((s.width / 2) * (1 - e) + x * e), -((s.height / 2) * (1 - e) + y * e));
    }
    ctx.drawImage(dark, r.x, r.y, r.w, r.h);
    for (const id of s.campaign.completed) {
        const img = s.assets.litRegions.get(id);
        if (img)
            ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }
    if (s.hoverRegion && !s.campaign.completed.includes(s.hoverRegion)) {
        const image = s.assets.litRegions.get(s.hoverRegion);
        if (image) {
            ctx.globalAlpha = .14 + .035 * Math.sin(s.time / 300);
            ctx.drawImage(image, r.x, r.y, r.w, r.h);
            ctx.globalAlpha = 1;
        }
    }
    if (s.phase === "transition")
        for (const reg of s.data.regions) {
            text(ctx, reg.name.toUpperCase(), r.x + reg.city.u * r.w, r.y + reg.city.v * r.h, 15, C.paper, "center");
        }
    ctx.restore();
    if (s.phase === "transition" && s.transition) {
        ctx.fillStyle = `rgba(18,24,27,${clamp((s.time - s.transition.start - 700) / 350, 0, 1)})`;
        ctx.fillRect(0, 0, s.width, s.height);
    }
}
function menu(ctx, s) {
    const m = s.data.manifest.menu;
    const image = s.assets.image(m?.background ?? s.data.manifest.country.dark);
    const scale = Math.max(s.width / image.naturalWidth, s.height / image.naturalHeight) * (1.015 + .007 * Math.sin(s.time / 5000));
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, (s.width - w) / 2, (s.height - h) / 2, w, h);
}
function intro(ctx, s) {
    ctx.fillStyle = "#121e27";
    ctx.fillRect(0, 0, s.width, s.height);
    const c = s.data.intro, scale = Math.min(s.width / c.width, s.height / c.height);
    const ox = (s.width - c.width * scale) / 2, oy = (s.height - c.height * scale) / 2;
    c.panels.forEach((p, i) => {
        const x = ox + p.x * scale, y = oy + p.y * scale, w = p.width * scale, h = p.height * scale;
        if (!c.fullPageLayers) {
            ctx.fillStyle = "#b49c77";
            ctx.fillRect(x, y, w, h);
        }
        if (i > s.introIndex)
            return;
        const alpha = i < s.introIndex ? 1 : clamp((s.time - s.introStart) / c.fadeMs, 0, 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        const image = s.assets.image(p.image);
        const z = c.fullPageLayers ? 1 : 1 + (1 - alpha) * .035;
        ctx.drawImage(image, x - w * (z - 1) / 2, y - h * (z - 1) / 2, w * z, h * z);
        if (p.caption) {
            ctx.fillStyle = "#161e23ed";
            ctx.fillRect(x, y + h - 65 * scale, w, 65 * scale);
            ctx.font = `600 ${Math.max(11, 16 * scale)}px "RazSvetUser","RazSvetInstalled","DejaVu Sans Condensed",Arial`;
            const lines = wrap(ctx, p.caption, w - 28 * scale);
            lines.forEach((line, j) => text(ctx, line, x + 14 * scale, y + h - (lines.length - j) * 20 * scale - 6 * scale, Math.max(11, 16 * scale)));
        }
        ctx.restore();
        if (!c.fullPageLayers) {
            ctx.strokeStyle = "#171e23";
            ctx.lineWidth = 3 * scale;
            ctx.strokeRect(x, y, w, h);
        }
    });
}
function region(ctx, s) {
    const c = s.campaign, w = c.world, r = c.region;
    if (!w || !r)
        return;
    const v = worldView(s.width, s.height, c.balance, s.camera), u = v.scale;
    const pos = (p) => ({ x: v.x + p.x * u, y: v.y + p.y * u });
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.x, v.y, v.w, v.h);
    ctx.clip();
    const bg = s.assets.image(r.map);
    if (bg)
        ctx.drawImage(bg, v.x, v.y, v.w, v.h);
    if (s.tool === "hydro") {
        const mask = s.assets.hydroOverlays.get(r.id);
        if (mask) {
            ctx.globalAlpha = .48 + .14 * Math.sin(s.time / 380);
            ctx.drawImage(mask, v.x, v.y, v.w, v.h);
            ctx.globalAlpha = 1;
        }
    }
    if (BUILD_KINDS.includes(s.tool)) {
        ctx.strokeStyle = "#dfc28c0d";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 1000; x < c.balance.world.widthM; x += 1000) {
            ctx.moveTo(v.x + x * u, v.y);
            ctx.lineTo(v.x + x * u, v.y + v.h);
        }
        for (let y = 1000; y < c.balance.world.heightM; y += 1000) {
            ctx.moveTo(v.x, v.y + y * u);
            ctx.lineTo(v.x + v.w, v.y + y * u);
        }
        ctx.stroke();
    }
    for (const d of r.deposits) {
        const p = pos({ x: d.u * c.balance.world.widthM, y: d.v * c.balance.world.heightM }), radius = d.radiusM * u;
        const selected = s.tool === d.kind;
        ctx.strokeStyle = selected ? C.gold : "#b49b674d";
        ctx.lineWidth = selected ? 2 : 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (selected) {
            ctx.fillStyle = "#edbd6910";
            ctx.fill();
        }
        text(ctx, d.kind === "coal" ? "УГОЛЬ" : "ТОРФ", p.x, p.y - radius - 10, 10, selected ? C.gold : "#b6a183", "center");
    }
    for (const cable of w.cables()) {
        const a = pos(w.endpointPosition(cable.a)), b = pos(w.endpointPosition(cable.b));
        const state = c.sim?.cables.get(cable.key), active = state?.active, selected = s.selected === cable.key;
        ctx.strokeStyle = selected ? "#fff0c5" : active ? (cable.voltage === "hv" ? C.gold : C.blue) : "#847359";
        ctx.globalAlpha = active || selected ? 1 : .65;
        ctx.lineWidth = selected ? 5 : cable.voltage === "hv" ? 3 : 2.2;
        if (!active)
            ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (active && state.flows.length) {
            const from = state.flows[0].from.id === cable.a.id ? a : b, to = from === a ? b : a, t = (s.time / 2300) % 1;
            ctx.fillStyle = "#fff2d6";
            ctx.beginPath();
            ctx.arc(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    for (const b of [...w.buildings].sort((a, b) => a.y - b.y)) {
        const p = pos(b), cfg = c.balance.buildings[b.kind], scale = u * c.balance.world.widthM / 1280;
        const power = c.sim?.consumerKW.get(b.id) ?? 0, ratio = b.demandKW > 0 ? clamp(power / b.demandKW, 0, 1) : 0;
        const full = ratio >= c.balance.simulation.fullPowerThreshold;
        const active = isConsumer(b) ? full : isPlant(b) ? (c.sim?.generationKW.get(b.id) ?? 0) > 1e-6 :
            b.kind === "transformer" ? (c.sim?.transformer.get(b.id)?.outputKW ?? 0) > 1e-6 : true;
        if (s.selected === b.id || s.pending?.id === b.id) {
            ctx.strokeStyle = C.gold;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(p.x - (cfg.clearanceWidthM ?? cfg.widthM) * u / 2 - 5, p.y - (cfg.clearanceHeightM ?? cfg.heightM) * u / 2 - 5, (cfg.clearanceWidthM ?? cfg.widthM) * u + 10, (cfg.clearanceHeightM ?? cfg.heightM) * u + 10);
        }
        const objective = isConsumer(b) && c.isObjective(b.id);
        if (objective) {
            const planGlow = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 58 * scale);
            planGlow.addColorStop(0, full ? "#ff9b8f55" : "#ff544855");
            planGlow.addColorStop(1, "#ff544800");
            ctx.fillStyle = planGlow;
            ctx.fillRect(p.x - 58 * scale, p.y - 58 * scale, 116 * scale, 116 * scale);
            ctx.strokeStyle = "#ee6457";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + 15 * scale, 27 * scale, 10 * scale, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (full) {
            const glow = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 50 * scale);
            glow.addColorStop(0, "#edbd6935");
            glow.addColorStop(1, "#edbd6900");
            ctx.fillStyle = glow;
            ctx.fillRect(p.x - 50 * scale, p.y - 50 * scale, 100 * scale, 100 * scale);
        }
        sprite(ctx, s, b.kind, p.x, p.y, active, scale);
        if (b.kind === "transformer") {
            for (const port of ["in", "out"]) {
                const ep = pos(w.endpointPosition({ id: b.id, port }));
                ctx.fillStyle = port === "in" ? C.gold : C.blue;
                ctx.beginPath();
                ctx.arc(ep.x, ep.y, 4, 0, Math.PI * 2);
                ctx.fill();
                text(ctx, port === "in" ? "ВН" : "НН", ep.x, ep.y - 13, 8, port === "in" ? C.gold : C.blue, "center");
            }
        }
        const art = s.data.manifest.sprites[b.kind];
        const y = p.y + art.height * scale * (1 - art.anchorY) + 11, short = b.kind === "factory" ? `ЗАВОД ${w.buildings.filter(x => x.kind === "factory").indexOf(b) + 1}` :
            b.name || (b.kind === "pole" ? (b.voltage === "hv" ? "ВН" : "НН") : b.kind === "transformer" ? "10 кВ → 400 В" : NAMES[b.kind]);
        if (b.kind !== "pole" || s.selected === b.id) {
            ctx.font = '600 15px "RazSvetUser","RazSvetInstalled","DejaVu Sans Condensed",Arial';
            const tw = ctx.measureText(short).width;
            ctx.fillStyle = "#3c3029da";
            ctx.fillRect(p.x - tw / 2 - 5, y - 7, tw + 10, 15);
            text(ctx, short, p.x, y, 15, isConsumer(b) ? full ? C.gold : C.paper : "#c9b797", "center");
        }
        else {
            text(ctx, b.voltage === "hv" ? "ВН" : "НН", p.x + 10, p.y + 11, 8, b.voltage === "hv" ? C.gold : C.blue);
        }
        if (isConsumer(b)) {
            const bw = Math.max(34, cfg.widthM * u * .8);
            ctx.fillStyle = "#10171b";
            ctx.fillRect(p.x - bw / 2, y + 11, bw, 4);
            ctx.fillStyle = full ? C.gold : ratio > 0 ? "#c78047" : C.red;
            ctx.fillRect(p.x - bw / 2, y + 11, bw * ratio, 4);
            text(ctx, `${full ? 100 : Math.floor(ratio * 100 + .001)}%`, p.x, y + 26, 10, full ? C.gold : "#b6b3a7", "center");
        }
    }
    if (s.mouse && !c.paused) {
        const mouse = screenToWorld(s.mouse, s);
        if (BUILD_KINDS.includes(s.tool)) {
            const kind = s.tool, cfg = c.balance.buildings[kind];
            const error = w.placementError(kind, mouse.x, mouse.y);
            ctx.strokeStyle = error ? C.red : C.gold;
            ctx.fillStyle = error ? "#dc3b351a" : "#edbd691a";
            ctx.fillRect(s.mouse.x - cfg.widthM * u / 2, s.mouse.y - cfg.heightM * u / 2, cfg.widthM * u, cfg.heightM * u);
            ctx.strokeRect(s.mouse.x - cfg.widthM * u / 2, s.mouse.y - cfg.heightM * u / 2, cfg.widthM * u, cfg.heightM * u);
            ctx.globalAlpha = .6;
            sprite(ctx, s, kind, s.mouse.x, s.mouse.y, false, u * c.balance.world.widthM / 1280);
            ctx.globalAlpha = 1;
        }
        if (s.tool === "cable" && s.pending) {
            const a = pos(w.endpointPosition(s.pending)), target = iconAt(mouse, s);
            const end = target ? w.endpointAt(target, mouse) : null;
            const error = end ? w.connectionError(s.pending, end) : undefined;
            const b = end ? pos(w.endpointPosition(end)) : s.mouse;
            ctx.strokeStyle = error ? C.red : C.gold;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
            const source = w.byId(s.pending.id), dist = Math.hypot(mouse.x - source.x, mouse.y - source.y) / 1000;
            text(ctx, end && !error ? `${c.cablePrice(s.pending, end)} ₽` : `${dist.toFixed(2)} км`, b.x + 14, b.y - 12, 12, error ? C.red : C.gold);
        }
    }
    ctx.restore();
    const sx = 158, sy = s.height - 142, len = 2000 * u;
    ctx.strokeStyle = "#dfc18d";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 4);
    ctx.lineTo(sx, sy);
    ctx.lineTo(sx + len, sy);
    ctx.lineTo(sx + len, sy - 4);
    ctx.stroke();
    text(ctx, "2 км", sx + len / 2, sy - 13, 10, "#dfc18d", "center");
}
export function paint(ctx, s) {
    ctx.save();
    ctx.fillStyle = "#171f23";
    ctx.fillRect(0, 0, s.width, s.height);
    if (s.phase === "menu")
        menu(ctx, s);
    else if (s.phase === "intro")
        intro(ctx, s);
    else if (s.phase === "region")
        region(ctx, s);
    else if (s.phase === "result" && s.campaign.status === "failed") {
        const path = s.data.manifest.ui?.siberia, im = path ? s.assets.image(path) : undefined;
        if (im) {
            const scale = Math.max(s.width / im.naturalWidth, s.height / im.naturalHeight);
            const w = im.naturalWidth * scale, h = im.naturalHeight * scale;
            ctx.drawImage(im, (s.width - w) / 2, (s.height - h) / 2, w, h);
        }
    }
    else if (s.phase === "result" && s.campaign.status === "reprimand")
        region(ctx, s);
    else
        country(ctx, s);
    if (s.phase === "result") {
        ctx.fillStyle = s.campaign.status === "failed" ? "#51443218" : "#2a241b60";
        ctx.fillRect(0, 0, s.width, s.height);
    }
    ctx.restore();
}
