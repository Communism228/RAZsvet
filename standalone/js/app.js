import { Assets } from "./assets.js";
import { Campaign } from "./model/campaign.js";
import { validateBalance } from "./model/settings.js";
import { Terrain } from "./model/terrain.js";
import { BUILD_KINDS, NAMES, SHORT, clamp, isConsumer, isPlant, label, voltageOf } from "./model/types.js";
import { paint, countryRect, screenToWorld, worldView, iconAt } from "./render/paint.js";
import { Audio } from "./ui/audio.js";
import { Typography } from "./ui/typography.js";
const SAVE = "raz-svet-campaign-v6";
const months = ["ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН", "ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК"];
const e = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (value, digits = 1) => value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
const monthsWord = (m) => { const mod10 = m % 10, mod100 = m % 100; return mod10 === 1 && mod100 !== 11 ? "месяц" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "месяца" : "месяцев"; };
const order = ["coal", "peat", "hydro", "transformer", "pole", "cable", "delete"];
const titles = { coal: "УГОЛЬНАЯ ТЭС", peat: "ТОРФЯНАЯ ТЭС", hydro: "ГЭС", transformer: "ТРАНСФОРМАТОР", pole: "ОПОРА ЛЭП", cable: "КАБЕЛЬ", delete: "ДЕМОНТАЖ" };
export class App {
    root;
    surface;
    data;
    assets;
    phase = "menu";
    campaign;
    balance;
    camera;
    width = innerWidth;
    height = innerHeight;
    time = performance.now();
    tool = "inspect";
    poleVoltage = "hv";
    mouse = null;
    selected = null;
    pending = null;
    hoverRegion = null;
    introIndex = 0;
    introStart = 0;
    transition = null;
    preparedTerrain = null;
    modal = null;
    modalWasPaused = false;
    saved = null;
    savingFailed = false;
    ui;
    toastEl;
    toastUntil = 0;
    last = performance.now();
    lastHud = 0;
    lastSave = 0;
    shownMessage = -1;
    messageUntil = 0;
    space = false;
    cameraKeys = new Set();
    drag = null;
    audio = new Audio();
    typography = new Typography();
    dev = new URLSearchParams(location.search).get("dev") === "1";
    test = new URLSearchParams(location.search).get("test") === "1";
    constructor(root, surface, data, assets) {
        this.root = root;
        this.surface = surface;
        this.data = data;
        this.assets = assets;
        this.balance = data.balance;
        this.campaign = new Campaign(this.balance, data.regions, Date.now() >>> 0);
        this.camera = { x: this.balance.world.widthM / 2, y: this.balance.world.heightM / 2, zoom: 1 };
        this.ui = document.createElement("div");
        this.ui.id = "ui";
        root.append(this.ui);
        this.toastEl = document.createElement("div");
        this.toastEl.id = "toast";
        this.toastEl.setAttribute("role", "status");
        root.append(this.toastEl);
        try {
            const raw = localStorage.getItem(SAVE);
            if (raw)
                this.saved = JSON.parse(raw);
        }
        catch {
            this.saved = null;
        }
        for (const [name, path] of Object.entries(this.data.manifest.ui ?? {}))
            this.root.style.setProperty(`--art-${name}`, `url("${new URL(path, document.baseURI).href}")`);
        this.audio.configure(data.manifest.audio?.background ?? null, data.manifest.audio?.volume ?? .35);
        this.audio.onError = () => { this.notify("Не удалось воспроизвести трек. Выберите другой аудиофайл в настройках.", true); this.updateHUD(); };
        this.bind();
        this.resize();
        this.renderUI();
        void Promise.all([this.audio.restore(), this.typography.restore()]).then(() => { if (this.modal === "settings")
            this.renderUI(); });
        if (this.test)
            Object.defineProperty(window, "__game", { value: this, configurable: true });
        requestAnimationFrame(this.tick);
    }
    state() {
        return { width: this.width, height: this.height, time: this.time, phase: this.phase, campaign: this.campaign,
            assets: this.assets, data: this.data, camera: this.camera, mouse: this.mouse, tool: this.tool, poleVoltage: this.poleVoltage,
            selected: this.selected, pending: this.pending, hoverRegion: this.hoverRegion, introIndex: this.introIndex, introStart: this.introStart, transition: this.transition };
    }
    tick = (now) => {
        const dt = Math.max(0, (now - this.last) / 1000);
        this.last = now;
        this.time = now;
        try {
            if (this.phase === "transition" && this.preparedTerrain && this.transition && now - this.transition.start >= 1050) {
                const t = this.preparedTerrain;
                this.preparedTerrain = null;
                this.transition = null;
                this.campaign.begin(t.region, t);
                this.enterBoard();
                this.save();
            }
            if (this.phase === "region" && !this.modal && !this.campaign.paused) {
                const speed = 600 * Math.min(dt, .05) / worldView(this.width, this.height, this.balance, this.camera).scale;
                const held = (...keys) => keys.some(k => this.cameraKeys.has(k)) ? 1 : 0;
                this.camera.x += (held("KeyD", "ArrowRight") - held("KeyA", "ArrowLeft")) * speed;
                this.camera.y += (held("KeyS", "ArrowDown") - held("KeyW", "ArrowUp")) * speed;
                this.clampCamera();
            }
            if (this.phase === "region" && !document.hidden) {
                const outcome = this.campaign.advance(dt);
                if (outcome)
                    this.finish(outcome);
                if (now - this.lastSave > 5000) {
                    this.save();
                    this.lastSave = now;
                }
            }
            paint(this.surface.ctx, this.state());
            this.surface.present();
            if (now - this.lastHud > 100) {
                this.updateHUD();
                this.lastHud = now;
            }
            if (this.toastUntil > 0 && now > this.toastUntil) {
                this.toastEl.classList.remove("visible");
                this.toastUntil = 0;
            }
        }
        catch (error) {
            this.failSafely(error);
        }
        requestAnimationFrame(this.tick);
    };
    failSafely(error) {
        this.campaign.paused = true;
        this.notify(error instanceof Error ? error.message : String(error), true);
    }
    resize = () => {
        this.width = innerWidth;
        this.height = innerHeight;
        this.surface.resize(this.width, this.height);
        this.clampCamera();
        this.positionCities();
    };
    positionCities() {
        const layer = this.ui.querySelector("#cities");
        if (!layer)
            return;
        const r = countryRect(this.width, this.height);
        Object.assign(layer.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    }
    clampCamera() {
        const b = this.balance.world;
        this.camera.zoom = clamp(this.camera.zoom, b.minZoom, b.maxZoom);
        const base = Math.min(this.width / b.widthM, this.height / b.heightM) * this.camera.zoom;
        const maxX = Math.min(b.widthM * b.maxPanFraction, Math.max(0, (b.widthM - this.width / base) / 2));
        const maxY = Math.min(b.heightM * b.maxPanFraction, Math.max(0, (b.heightM - this.height / base) / 2));
        this.camera.x = clamp(this.camera.x, b.widthM / 2 - maxX, b.widthM / 2 + maxX);
        this.camera.y = clamp(this.camera.y, b.heightM / 2 - maxY, b.heightM / 2 + maxY);
    }
    bind() {
        window.addEventListener("resize", this.resize);
        this.ui.addEventListener("click", event => {
            const mini = event.target.closest(".mini-map");
            if (mini && this.phase === "region") {
                const r = mini.getBoundingClientRect();
                this.camera.x = (event.clientX - r.left) / r.width * this.balance.world.widthM;
                this.camera.y = (event.clientY - r.top) / r.height * this.balance.world.heightM;
                this.clampCamera();
                return;
            }
            const target = event.target.closest("[data-action]");
            if (target)
                void this.action(target.dataset.action, target).catch(error => this.failSafely(error));
        });
        this.ui.addEventListener("pointerover", event => {
            const city = event.target.closest("[data-region]");
            if (city)
                this.hoverRegion = city.dataset.region;
        });
        this.ui.addEventListener("pointerout", event => {
            if (event.target.closest("[data-region]"))
                this.hoverRegion = null;
        });
        this.ui.addEventListener("change", event => {
            const fileInput = event.target;
            if (["font-file", "music-file"].includes(fileInput.id)) {
                const file = fileInput.files?.[0];
                if (file)
                    void this.importMedia(fileInput.id, file);
                return;
            }
            const input = event.target;
            if (input.id !== "resource-mode")
                return;
            const area = this.ui.querySelector("#balance-json");
            if (!area)
                return;
            try {
                const b = JSON.parse(area.value);
                b.resources.mode = input.value;
                area.value = JSON.stringify(b, null, 2);
            }
            catch { }
        });
        this.ui.addEventListener("input", event => {
            const input = event.target, path = input.dataset.balancePath;
            if (input.id === "music-volume") {
                this.audio.setVolume(Number(input.value));
                return;
            }
            if (!path)
                return;
            const area = this.ui.querySelector("#balance-json");
            if (!area)
                return;
            try {
                const b = JSON.parse(area.value);
                let part = b;
                const keys = path.split(".");
                for (const key of keys.slice(0, -1))
                    part = part[key];
                part[keys.at(-1)] = Number(input.value);
                area.value = JSON.stringify(b, null, 2);
            }
            catch { /* An incomplete JSON edit is reported on Apply, not every keystroke. */ }
        });
        const canvas = this.surface.input;
        const point = (event) => {
            const r = canvas.getBoundingClientRect();
            return { x: (event.clientX - r.left) * this.width / r.width, y: (event.clientY - r.top) * this.height / r.height };
        };
        canvas.addEventListener("pointerdown", event => {
            if (event.button === 2) {
                this.pending = null;
                this.renderUI();
                return;
            }
            const p = point(event), pan = this.phase === "region" && (event.button === 1 || (event.button === 0 && (this.space || this.tool === "inspect")));
            this.drag = { x: p.x, y: p.y, cameraX: this.camera.x, cameraY: this.camera.y, pan, distance: 0 };
            if (event.button === 0 || pan) {
                canvas.setPointerCapture(event.pointerId);
                event.preventDefault();
            }
        });
        canvas.addEventListener("pointermove", event => {
            const p = point(event);
            this.mouse = p;
            if (this.drag) {
                this.drag.distance = Math.max(this.drag.distance, Math.hypot(p.x - this.drag.x, p.y - this.drag.y));
                if (this.drag.pan) {
                    const v = worldView(this.width, this.height, this.balance, this.camera);
                    this.camera.x = this.drag.cameraX - (p.x - this.drag.x) / v.scale;
                    this.camera.y = this.drag.cameraY - (p.y - this.drag.y) / v.scale;
                    this.clampCamera();
                }
            }
        });
        canvas.addEventListener("pointerup", event => {
            const d = this.drag;
            this.drag = null;
            if (canvas.hasPointerCapture(event.pointerId))
                canvas.releasePointerCapture(event.pointerId);
            if (event.button === 0 && d && (!d.pan || this.tool === "inspect" && !this.space) && d.distance < 6)
                this.boardClick(point(event), event.shiftKey);
        });
        canvas.addEventListener("pointercancel", () => { this.drag = null; });
        canvas.addEventListener("pointerleave", () => { if (!this.drag)
            this.mouse = null; });
        canvas.addEventListener("contextmenu", event => event.preventDefault());
        canvas.addEventListener("wheel", event => {
            if (this.phase !== "region" || this.modal)
                return;
            event.preventDefault();
            const p = point(event), before = screenToWorld(p, this.state());
            this.camera.zoom *= Math.exp(-event.deltaY * .0012);
            this.clampCamera();
            const after = screenToWorld(p, this.state());
            this.camera.x += before.x - after.x;
            this.camera.y += before.y - after.y;
            this.clampCamera();
        }, { passive: false });
        window.addEventListener("keydown", event => {
            if (event.target.matches("input,textarea,select"))
                return;
            if (this.phase === "intro" && ["Space", "Enter"].includes(event.code)) {
                event.preventDefault();
                this.nextPanel();
                return;
            }
            if (this.phase !== "region")
                return;
            if (event.code === "Space") {
                this.space = true;
                event.preventDefault();
            }
            if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) {
                if (!this.modal)
                    this.cameraKeys.add(event.code);
                event.preventDefault();
                return;
            }
            if (event.repeat)
                return;
            if (event.code === "Escape") {
                if (this.modal)
                    this.closeModal();
                else if (this.pending) {
                    this.pending = null;
                    this.renderUI();
                }
                else
                    this.togglePause();
                return;
            }
            if (event.code === "KeyM") {
                this.modal === "matrix" ? this.closeModal() : this.openModal("matrix");
                return;
            }
            if (event.code === "KeyV") {
                this.poleVoltage = this.poleVoltage === "hv" ? "lv" : "hv";
                this.renderUI();
                return;
            }
            if (this.modal || this.campaign.paused)
                return;
            const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
            if (digit === "0")
                this.selectTool("inspect");
            else if (digit && Number(digit) <= 7 && Number(digit) > 0)
                this.selectTool(order[Number(digit) - 1]);
            if (event.code === "Delete" && this.selected !== null) {
                const r = typeof this.selected === "number" ? this.campaign.removeBuilding(this.selected) : this.campaign.removeCable(this.selected);
                this.result(r, "Демонтировано.");
                if (r.ok)
                    this.selected = null;
            }
            if (["Equal", "NumpadAdd"].includes(event.code)) {
                this.camera.zoom *= 1.15;
                this.clampCamera();
            }
            if (["Minus", "NumpadSubtract"].includes(event.code)) {
                this.camera.zoom /= 1.15;
                this.clampCamera();
            }
            if (event.code === "Home") {
                this.camera = { x: this.balance.world.widthM / 2, y: this.balance.world.heightM / 2, zoom: 1 };
            }
        });
        window.addEventListener("keyup", event => { if (event.code === "Space")
            this.space = false; this.cameraKeys.delete(event.code); });
        const loseFocus = () => {
            this.space = false;
            this.drag = null;
            this.cameraKeys.clear();
            if (this.phase === "region" && !this.campaign.paused) {
                this.campaign.paused = true;
                this.save();
                this.renderUI();
            }
            this.last = performance.now();
        };
        document.addEventListener("visibilitychange", () => { if (document.hidden)
            loseFocus();
        else
            this.last = performance.now(); });
        window.addEventListener("blur", loseFocus);
        window.addEventListener("pagehide", () => this.save());
    }
    async action(action, target) {
        if (action === "play") {
            await this.play();
            return;
        }
        if (action === "new") {
            this.newGame();
            return;
        }
        if (action === "menu") {
            this.campaign.paused = true;
            this.save();
            this.phase = "menu";
            this.modal = null;
            this.renderUI();
            return;
        }
        if (action === "skip") {
            this.phase = "country";
            this.save();
            this.renderUI();
            return;
        }
        if (action === "next-panel") {
            this.nextPanel();
            return;
        }
        if (action === "region") {
            await this.startRegion(target.dataset.region);
            return;
        }
        if (action === "retry-plan") {
            this.campaign.retry();
            this.phase = "region";
            this.shownMessage = -1;
            this.messageUntil = 0;
            this.last = performance.now();
            this.save();
            this.renderUI();
            return;
        }
        if (action === "settings") {
            this.openModal("settings");
            return;
        }
        if (action === "reset-music") {
            await this.audio.reset();
            this.renderUI();
            return;
        }
        if (action === "reset-font") {
            await this.typography.reset();
            this.renderUI();
            return;
        }
        if (action === "next-region") {
            this.phase = "country";
            this.renderUI();
            return;
        }
        if (action === "tool") {
            this.selectTool(target.dataset.tool);
            return;
        }
        if (action === "voltage") {
            this.poleVoltage = this.poleVoltage === "hv" ? "lv" : "hv";
            this.renderUI();
            return;
        }
        if (action === "pause") {
            this.togglePause();
            return;
        }
        if (action === "matrix") {
            this.modal === "matrix" ? this.closeModal() : this.openModal("matrix");
            return;
        }
        if (action === "help") {
            this.openModal("help");
            return;
        }
        if (action === "dev") {
            this.openModal("dev");
            return;
        }
        if (action === "close") {
            this.closeModal();
            return;
        }
        if (action === "zoom-in") {
            this.camera.zoom *= 1.15;
            this.clampCamera();
            return;
        }
        if (action === "zoom-out") {
            this.camera.zoom /= 1.15;
            this.clampCamera();
            return;
        }
        if (action === "home") {
            this.camera = { x: this.balance.world.widthM / 2, y: this.balance.world.heightM / 2, zoom: 1 };
            return;
        }
        if (action === "sound") {
            if (!this.audio.hasTrack) {
                this.openModal("settings");
                this.notify("Выберите фоновую музыку: MP3, OGG, WAV или M4A.");
                return;
            }
            try {
                await this.audio.toggle();
            }
            catch {
                this.notify("Музыка не запустилась. Проверьте файл или нажмите радио ещё раз.", true);
            }
            if (this.modal === "settings")
                this.renderUI();
            else
                this.updateHUD();
            return;
        }
        if (action === "inspect") {
            this.selectTool("inspect");
            return;
        }
        if (action === "matrix-cable") {
            this.selected = target.dataset.key;
            this.closeModal();
            return;
        }
        if (action === "apply-balance" || action === "export-balance") {
            const text = this.ui.querySelector("#balance-json").value;
            const balance = validateBalance(JSON.parse(text));
            if (action === "export-balance") {
                this.download("balance.json", balance);
                return;
            }
            this.balance = balance;
            this.data.balance = balance;
            this.campaign = new Campaign(balance, this.data.regions, this.campaign.seed);
            this.camera = { x: balance.world.widthM / 2, y: balance.world.heightM / 2, zoom: 1 };
            this.phase = "country";
            this.modal = null;
            this.save();
            this.renderUI();
            this.notify("Новая кампания с тем же seed. Для постоянных изменений экспортируйте balance.json.");
            return;
        }
    }
    async play() {
        if (this.saved && ["map", "playing", "reprimand"].includes(this.saved.status)) {
            try {
                let terrain;
                if (this.saved.active) {
                    const region = this.data.regions.find(r => r.id === this.saved.active.regionId);
                    if (!region)
                        throw new Error("Регион сохранения не найден.");
                    this.notify("Загрузка сохранённого региона…");
                    terrain = await this.assets.terrain(region, this.balance);
                }
                this.campaign = Campaign.restore(this.saved, this.balance, this.data.regions, terrain);
                if (this.campaign.status === "reprimand") {
                    this.phase = "result";
                    this.renderUI();
                }
                else if (this.campaign.status === "playing")
                    this.enterBoard();
                else {
                    this.phase = "country";
                    this.renderUI();
                }
                return;
            }
            catch (error) {
                this.saved = null;
                this.notify(error instanceof Error ? error.message : String(error), true);
            }
        }
        this.newGame();
    }
    newGame() {
        this.campaign = new Campaign(this.balance, this.data.regions, Date.now() >>> 0);
        this.saved = null;
        this.modal = null;
        this.selected = null;
        this.pending = null;
        this.phase = "intro";
        this.introIndex = 0;
        this.introStart = this.time;
        this.save();
        this.renderUI();
    }
    nextPanel() {
        if (this.phase !== "intro")
            return;
        if (this.time - this.introStart < this.data.intro.fadeMs) {
            this.introStart = this.time - this.data.intro.fadeMs;
            return;
        }
        if (this.introIndex < this.data.intro.panels.length - 1) {
            this.introIndex++;
            this.introStart = this.time;
        }
        else {
            this.phase = "country";
            this.save();
        }
        this.renderUI();
    }
    async startRegion(id) {
        if (this.phase !== "country" || this.campaign.status !== "map" || this.campaign.completed.includes(id))
            return;
        const region = this.data.regions.find(r => r.id === id);
        if (!region)
            return;
        this.phase = "transition";
        this.transition = { regionId: id, start: this.time };
        this.preparedTerrain = null;
        this.renderUI();
        try {
            this.preparedTerrain = await this.assets.terrain(region, this.balance);
        }
        catch (error) {
            this.phase = "country";
            this.transition = null;
            this.renderUI();
            this.failSafely(error);
        }
    }
    enterBoard() {
        this.phase = "region";
        this.tool = "inspect";
        this.selected = null;
        this.pending = null;
        this.mouse = null;
        this.camera = { x: this.balance.world.widthM / 2, y: this.balance.world.heightM / 2, zoom: this.balance.world.initialZoom ?? 1.7 };
        this.modal = null;
        this.shownMessage = -1;
        this.messageUntil = 0;
        this.last = performance.now();
        this.renderUI();
    }
    finish(outcome) {
        this.pending = null;
        this.selected = null;
        this.modal = null;
        this.phase = "result";
        this.hoverRegion = null;
        this.save();
        this.audio.tone(outcome.success);
        this.renderUI();
    }
    selectTool(tool) {
        if (this.phase !== "region")
            return;
        this.tool = tool;
        this.pending = null;
        this.renderUI();
    }
    boardClick(p, chain) {
        try {
            if (this.phase === "intro") {
                this.nextPanel();
                return;
            }
            if (this.phase !== "region" || this.campaign.paused || this.modal || !this.campaign.world)
                return;
            const w = this.campaign.world, point = screenToWorld(p, this.state()), b = iconAt(point, this.state());
            if (this.tool === "inspect") {
                this.selected = b?.id ?? w.cableAt(point)?.key ?? null;
                this.renderUI();
                return;
            }
            if (this.tool === "delete") {
                const cable = w.cableAt(point);
                const r = b ? this.campaign.removeBuilding(b.id) : cable ? this.campaign.removeCable(cable.key) : null;
                if (r) {
                    this.result(r, r.ok ? `Возвращено ${n(r.value)} ₽.` : "");
                    if (r.ok)
                        this.selected = null;
                }
                else
                    this.notify("Нажмите на здание или кабель для демонтажа.");
                return;
            }
            if (this.tool === "cable") {
                if (!b) {
                    this.notify("Выберите здание. У трансформатора вход слева, выход справа.");
                    return;
                }
                const endpoint = w.endpointAt(b, point);
                if (!this.pending) {
                    this.pending = endpoint;
                    this.selected = b.id;
                    this.renderUI();
                    return;
                }
                if (this.pending.id === b.id) {
                    this.pending = null;
                    this.renderUI();
                    return;
                }
                const r = this.campaign.connect(this.pending, endpoint);
                if (r.ok) {
                    this.pending = chain && b.kind === "pole" ? endpoint : null;
                    this.selected = b.id;
                }
                this.result(r, "Кабель проложен.");
                return;
            }
            const r = this.campaign.place(this.tool, point.x, point.y, this.poleVoltage);
            if (r.ok)
                this.selected = w.buildings.at(-1).id;
            this.result(r, "Сооружение построено.");
        }
        catch (error) {
            this.failSafely(error);
            this.renderUI();
        }
    }
    result(r, success) {
        this.audio.tone(r.ok);
        this.notify(r.ok ? success : r.error ?? "Действие невозможно.", !r.ok);
        if (r.ok)
            this.save();
        this.renderUI();
    }
    togglePause() {
        if (this.phase !== "region")
            return;
        this.campaign.paused = !this.campaign.paused;
        this.last = performance.now();
        this.save();
        this.renderUI();
    }
    openModal(modal) {
        if (this.modal)
            this.closeModal();
        this.modalWasPaused = this.campaign.paused;
        if (modal === "dev" || modal === "help" || modal === "settings")
            this.campaign.paused = true;
        this.modal = modal;
        this.renderUI();
    }
    closeModal() {
        if (this.modal === "help" || this.modal === "dev" || this.modal === "settings")
            this.campaign.paused = this.modalWasPaused;
        this.modal = null;
        this.last = performance.now();
        this.renderUI();
    }
    save() {
        if (!this.campaign)
            return;
        try {
            this.saved = this.campaign.snapshot();
            localStorage.setItem(SAVE, JSON.stringify(this.saved));
        }
        catch {
            if (!this.savingFailed) {
                this.savingFailed = true;
                this.notify("Браузер запретил сохранение. Прогресс сохранится только до закрытия страницы.", true);
            }
        }
    }
    notify(message, error = false) {
        this.toastEl.textContent = message;
        this.toastEl.className = `visible${error ? " error" : ""}`;
        this.toastUntil = this.time + 4500;
    }
    download(name, data) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    inspector() {
        const w = this.campaign.world;
        if (!w || this.selected === null)
            return "";
        if (typeof this.selected === "string") {
            const c = w.cables().find(c => c.key === this.selected), f = this.campaign.sim?.cables.get(this.selected);
            if (!c)
                return "";
            const flow = f?.flows[0];
            return `<aside class="inspector"><div class="eyebrow">ЛИНИЯ / ${c.voltage === "hv" ? "ВЫСОКОЕ" : "НИЗКОЕ"} НАПРЯЖЕНИЕ</div>
      <h3>${n(c.length / 1000, 2)} км <span>${n(this.balance.lines[c.voltage].voltageV)} В</span></h3>
      <p>Передано ${n(flow?.sentKW ?? 0)} кВт → получено ${n(flow?.receivedKW ?? 0)} кВт</p>
      <p>Потери: <strong>${n(f?.lossKW ?? 0, 2)} кВт</strong> · Возврат: ${n(c.paid * this.balance.economy.refundFraction)} ₽</p></aside>`;
        }
        const b = w.byId(this.selected);
        if (!b)
            return "";
        let detail = "";
        if (isPlant(b))
            detail = `Выработка ${n(this.campaign.sim?.generationKW.get(b.id) ?? 0)} / ${n(b.generationKW)} кВт · выход 10 кВ`;
        else if (isConsumer(b)) {
            const power = this.campaign.sim?.consumerKW.get(b.id) ?? 0;
            const plan = this.campaign.objectives.find(o => o.id === b.id);
            detail = `Получено ${n(power)} / ${n(b.demandKW)} кВт · ${n(power / b.demandKW * 100)}%<br>` +
                (plan ? `<strong>Госплан:</strong> объект должен быть запитан к сроку.<br>` : "") +
                (b.kind !== "factory" ? `Доход при полном питании: ${n(b.incomePerSec)} ₽/с` : "Промышленный объект. Дохода не приносит.");
        }
        else if (b.kind === "transformer")
            detail = `10 000 В → 400 В · КПД ${n(b.efficiency * 100)}%<br>Выход ${n(this.campaign.sim?.transformer.get(b.id)?.outputKW ?? 0)} / ${n(b.outputLimitKW)} кВт`;
        else
            detail = `Опора ${b.voltage === "hv" ? "10 кВ" : "400 В"}. Только одно напряжение; преобразования нет.`;
        return `<aside class="inspector"><div class="eyebrow">${e(label(b))} / ${e(NAMES[b.kind])}</div>
      <h3>${e(b.name || NAMES[b.kind])}</h3><p>${detail}</p>
      ${b.fixed ? "" : `<p class="muted">Демонтаж: возврат ${n(b.paid * this.balance.economy.refundFraction)} ₽ + кабели.</p>`}</aside>`;
    }
    toolHint() {
        if (this.tool === "cable")
            return this.pending ? "Теперь выберите второй конец. Shift — продолжить цепочку через опору." : "Кликните по двум зданиям. ВН: жёлтый порт; НН: голубой. Напряжения должны совпадать.";
        if (this.tool === "delete")
            return `Удалите своё здание или кабель. Возврат ${n(this.balance.economy.refundFraction * 100)}% уплаченной цены. Поселения и заводы защищены.`;
        if (this.tool === "inspect")
            return "Подключите поселения для дохода, затем обеспечьте все отмеченные госпланы. Схема подключения — в настройках.";
        if (this.tool === "pole")
            return `Опора ${this.poleVoltage === "hv" ? "10 кВ" : "400 В"} · V меняет тип · кабель можно провести над водой.`;
        if (this.tool === "transformer")
            return "Трансформатор: вход 10 кВ слева, выход 400 В справа. Ставьте ближе к потребителю.";
        if (this.tool === "hydro")
            return "ГЭС: центр здания должен находиться на разрешённой реке.";
        if ((this.tool === "coal" || this.tool === "peat") && !this.campaign.region?.deposits.some(d => d.kind === this.tool))
            return "В этой области нет этого ресурса. Выберите другую станцию или ГЭС.";
        return this.tool === "coal" ? "Угольная ТЭС: внутри зоны угольного месторождения." : "Торфяная ТЭС: внутри зоны торфяного болота.";
    }
    matrix() {
        const w = this.campaign.world;
        if (!w)
            return "";
        return `<div class="sheet matrix-sheet"><header><div><div class="eyebrow">ДИАГНОСТИКА СЕТИ</div><h2>Матрица смежности</h2></div><button data-action="close" class="icon-button" aria-label="Закрыть">×</button></header>
      <p>Ячейки показаны в <b>км</b>; в модели хранятся метры. 0 — кабеля нет. Время продолжает идти.</p>
      <div class="matrix-scroll"><table><thead><tr><th></th>${w.buildings.map(b => `<th title="${e(b.name || NAMES[b.kind])}">${e(label(b))}</th>`).join("")}</tr></thead><tbody>
      ${w.buildings.map((a, i) => `<tr><th>${e(label(a))}</th>${w.buildings.map((b, j) => `<td>${w.adjacency[i][j] > 0 ? `<button data-action="matrix-cable" data-key="${a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`}">${n(w.adjacency[i][j] / 1000, 2)}</button>` : "<span>0</span>"}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div><p class="muted">Кабели и расчёт берут топологию именно из этой матрицы. Направление преобразования и тип напряжения задаются портами.</p></div>`;
    }
    help() {
        return `<div class="modal-backdrop"><section class="dialog help-dialog"><button class="close" data-action="close" aria-label="Закрыть">×</button>
      <div class="eyebrow">КАК ВЫПОЛНИТЬ ПЛАН</div><h2>Сначала доход.<br>Затем промышленность.</h2>
      <div class="connection-guide"><span>ТЭС / ГЭС<br><b>10 кВ</b></span><i>→</i><span>Опора ВН<br><b>10 кВ</b></span><i>→</i><span>Трансформатор<br><b>10 кВ → 400 В</b></span><i>→</i><span>Потребитель<br><b>400 В</b></span></div>
      <p>1. Постройте станцию в подходящей зоне: уголь, торф или река. 2. Подведите высоковольтную линию к трансформатору рядом с поселением. 3. Соедините низковольтный выход с потребителем.</p>
      <p>Длинная линия требует промежуточных опор. Тип опоры переключается <kbd>V</kbd>. Вход трансформатора слева, выход справа. Потребители и станции не передают чужую мощность.</p>
      <p>Поселения при 100% питания дают деньги каждую секунду. Отмеченные красным свечением госпланы должны иметь полное питание <strong>одновременно в момент окончания срока</strong>. Заводы не приносят доход, а города и деревни продолжают приносить его как обычно.</p>
      <p>Колесо — масштаб. Средняя кнопка или пробел + перетаскивание — камера. <kbd>0</kbd> — выбор, <kbd>1–7</kbd> — инструменты, <kbd>M</kbd> — матрица, <kbd>Esc</kbd> — отмена или пауза.</p>
      <p>За сорванный срок региона начисляется одно нарушение. Первые два — штраф и новый срок в том же регионе, без потери сети. Третье за всю кампанию — командировка в Сибирь.</p>
      <p class="muted">Пока эта справка открыта, время и доход остановлены.</p><button class="primary" data-action="close">К РАБОТЕ</button></section></div>`;
    }
    async importMedia(kind, file) {
        try {
            const persisted = kind === "font-file" ? await this.typography.import(file) : await this.audio.import(file);
            this.notify(kind === "font-file" ?
                "Шрифт применён ко всему интерфейсу." :
                "Трек выбран. Нажмите радио, чтобы включить музыку.");
            if (!persisted)
                this.notify("Файл загружен. Браузер не дал сохранить его: после перезапуска выберите файл повторно.");
        }
        catch (error) {
            this.notify("Не удалось загрузить файл: " + (error instanceof Error ? error.message : String(error)), true);
        }
        if (this.modal === "settings")
            this.renderUI();
    }
    settingsPanel() {
        return `<div class="modal-backdrop"><section class="dialog settings-dialog" role="dialog" aria-label="Настройки">
      <button class="close" data-action="close" aria-label="Закрыть">×</button>
      <div class="eyebrow">РАЗ, СВЕТ!</div><h2>Настройки</h2>
      <section class="setting-block"><h3>Радио и фоновая музыка</h3>
        <p>${e(this.audio.trackName || "Трек не выбран")}</p>
        <label class="file-choice">Выбрать аудиофайл<input id="music-file" type="file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.flac,.opus"></label>
        <label class="volume-label">Громкость<input id="music-volume" type="range" min="0" max="1" step=".01" value="${this.audio.volume}"></label>
        <div class="button-row"><button data-action="sound" ${this.audio.hasTrack ? "" : "disabled"}>${this.audio.enabled ? "Выключить радио" : "Включить радио"}</button><button data-action="reset-music" class="text-button">Убрать трек</button></div>
        <p class="setting-note">Музыка играет по кругу. Картинка радио показывает наличие объявления; значок ♫ — работу музыки.</p>
      </section>
      <section class="setting-block"><h3>Шрифт Rodchenko</h3>
        <p>${e(this.typography.active ? this.typography.name : "Выберите ваш ZIP со шрифтами или отдельный OTF/TTF.")}</p>
        <label class="file-choice">Загрузить шрифт<input id="font-file" type="file" accept=".zip,.otf,.ttf,.woff,.woff2"></label>
        <button data-action="reset-font" class="text-button">Сбросить шрифт</button>
        <p class="setting-note">Шрифт и трек хранятся в этом браузере. Файлы никуда не отправляются.</p>
      </section>
      <div class="button-row"><button class="primary" data-action="close">Готово</button><button data-action="help">Правила и управление</button></div>
      </section></div>`;
    }
    developerPanel() {
        const fields = [
            ["Стартовые деньги", "economy.startingMoney", this.balance.economy.startingMoney],
            ["Первый этап, с", "campaign.baseSeconds", this.balance.campaign.baseSeconds],
            ["Минимум, с", "campaign.minSeconds", this.balance.campaign.minSeconds],
            ["Уменьшение, с", "campaign.decreaseSeconds", this.balance.campaign.decreaseSeconds],
            ["Рост цен (0.08 = 8%)", "campaign.priceGrowth", this.balance.campaign.priceGrowth],
            ["Цена угольной ТЭС", "buildings.coal.price", this.balance.buildings.coal.price],
            ["Мощность угольной, кВт", "buildings.coal.generationKW", this.balance.buildings.coal.generationKW],
            ["Доход деревни, ₽/с", "buildings.village.incomePerSec", this.balance.buildings.village.incomePerSec],
            ["Первый штраф", "penalties.fine", this.campaign.penaltyRules.fine],
            ["Рост штрафа", "penalties.fineGrowth", this.campaign.penaltyRules.fineGrowth],
            ["Срок на исправление, с", "penalties.retrySeconds", this.campaign.penaltyRules.retrySeconds],
            ["Масштаб при входе", "world.initialZoom", this.balance.world.initialZoom ?? 1.7],
            ["Макс. масштаб", "world.maxZoom", this.balance.world.maxZoom],
            ["Шанс без месторождений (0–1)", "resources.emptyRegionChance", this.balance.resources?.emptyRegionChance ?? 0],
            ["Макс. угольных мест", "resources.coal.maxCount", this.balance.resources?.coal.maxCount ?? 4],
            ["Макс. торфяных мест", "resources.peat.maxCount", this.balance.resources?.peat.maxCount ?? 5]
        ];
        return `<div class="modal-backdrop"><section class="dialog dev-dialog"><button class="close" data-action="close" aria-label="Закрыть">×</button>
      <div class="eyebrow">РЕЖИМ РАЗРАБОТЧИКА / SEED ${this.campaign.seed}</div><h2>Баланс игры</h2>
      <p>Применение начнёт новую кампанию с тем же seed. Экспортируйте файл и замените <code>public/data/balance.json</code>, чтобы сохранить изменения в проекте.</p>
      <label class="resource-mode-label">Месторождения <select id="resource-mode">
        <option value="random" ${this.balance.resources?.mode === "random" ? "selected" : ""}>Случайные</option>
        <option value="none" ${this.balance.resources?.mode === "none" ? "selected" : ""}>Без угля и торфа (ГЭС)</option>
        <option value="fixed" ${this.balance.resources?.mode === "fixed" ? "selected" : ""}>Из файла региона</option>
      </select></label>
      <div class="balance-fields">${fields.map(([title, path, value]) => `<label>${e(title)}<input type="number" step="any" value="${value}" data-balance-path="${path}"></label>`).join("")}</div>
      <label class="json-label">Все настройки<textarea id="balance-json" spellcheck="false">${e(JSON.stringify(this.balance, null, 2))}</textarea></label>
      <div class="button-row"><button data-action="apply-balance" class="primary">ПРИМЕНИТЬ И ПЕРЕЗАПУСТИТЬ</button><button data-action="export-balance">ЭКСПОРТ BALANCE.JSON</button></div>
      </section></div>`;
    }
    art(name) {
        const path = this.data.manifest.ui?.[name];
        return path ? e(new URL(path, document.baseURI).href) : "";
    }
    renderUI() {
        let html = "";
        const c = this.campaign;
        if (this.phase === "menu") {
            const resume = this.saved && ["map", "playing", "reprimand"].includes(this.saved.status);
            html = `<div class="menu-content art-menu">
        <h1 class="sr-only">РАЗ, СВЕТ!</h1>
        <img class="game-logo" src="${this.art("logo")}" alt="РАЗ, СВЕТ!">
        <button class="play-button art-play" data-action="play" aria-label="Играть"><img src="${this.art("playLabel")}" alt="ИГРАТЬ"></button>
        ${resume ? `<div class="resume-note">Продолжить кампанию · ${e(this.saved.completed.length)}/6 областей</div><button class="new-campaign-button" data-action="new">Новая кампания</button>` : ""}
        </div><div class="menu-footer"><span>СТРАТЕГИЯ ЭЛЕКТРИФИКАЦИИ</span><span>БЕЛАРУСЬ / 1922—1927</span></div>
        ${this.dev ? '<button class="dev-corner" data-action="dev">БАЛАНС</button>' : ""}`;
        }
        else if (this.phase === "intro") {
            html = `<div class="intro-top"><span>ИСТОРИЯ СВЕТА</span><button data-action="skip" class="text-button">Пропустить →</button></div>
        <div class="intro-bottom"><span>${this.introIndex + 1} / ${this.data.intro.panels.length}</span><button data-action="next-panel">ДАЛЕЕ <span>→</span></button><small>Клик или пробел · панели остаются на странице</small></div>`;
        }
        else if (this.phase === "country") {
            html = `<header class="country-header"><div><div class="eyebrow">ГОСУДАРСТВЕННЫЙ ПЛАН / ${this.balance.campaign.firstYear + c.stage}</div><h2>ВЫБЕРИТЕ ОБЛАСТЬ</h2></div>
        <div class="country-budget"><small>ОБЩАЯ КАЗНА</small><strong>${n(c.money, 0)} <span>₽</span></strong></div></header>
        <div id="cities">${this.data.regions.map(r => `<button class="city-button ${c.completed.includes(r.id) ? "completed" : ""}" style="left:${r.city.u * 100}%;top:${r.city.v * 100}%" data-action="region" data-region="${r.id}" ${c.completed.includes(r.id) ? "disabled" : ""}>
          <i></i><span>${e(r.name.toUpperCase())}</span><small>${c.completed.includes(r.id) ? "ПЛАН ВЫПОЛНЕН" : "ВЫБРАТЬ РЕГИОН"}</small></button>`).join("")}</div>
        <footer class="country-footer"><span><b>${c.completed.length} / ${this.data.regions.length}</b> ОБЛАСТЕЙ ЭЛЕКТРИФИЦИРОВАНО</span><span>СЛЕДУЮЩИЙ СРОК: <b>${c.duration} с</b> · ЦЕНЫ: <b>×${n(c.priceFactor, 2)}</b></span></footer>
        <div class="map-note">Схематическая карта. Ресурсы и участки вымышлены.</div>
        ${this.dev ? '<button class="dev-corner" data-action="dev">БАЛАНС</button>' : ""}`;
        }
        else if (this.phase === "transition") {
            html = '<div class="transition-label">РАЗВОРАЧИВАНИЕ РЕГИОНАЛЬНОГО ПЛАНА…</div>';
        }
        else if (this.phase === "region") {
            html = `<header class="hud-top"><div class="top-left">
        <button class="art-icon" data-action="menu" title="В меню (пауза и сохранение)" aria-label="Меню"><img src="${this.art("home")}" alt=""></button>
        <button class="art-icon" data-action="settings" title="Настройки" aria-label="Настройки"><img src="${this.art("settings")}" alt=""></button>
        <button class="pause-mini" data-action="pause" title="Пауза (Esc)" aria-label="Пауза">Ⅱ</button>
        </div><div class="region-name"><b>${e(c.region.name.toUpperCase())}</b><small>${this.balance.campaign.firstYear + c.stage} ГОД</small></div>
        <div class="ledger"><div class="currency-row"><button class="art-icon radio-button" data-action="sound" title="Включить музыку" aria-label="Радио" aria-pressed="${this.audio.enabled}"><img id="radio-image" src="${this.art("radioOff")}" alt="Радио"><span class="music-mark" aria-hidden="true">♫</span></button><img class="coin" src="${this.art("coin")}" alt="Рубли"><strong id="money">0</strong></div>
        <div class="income" id="income">+0 ₽/с</div><div class="ledger-top"><span>ГОСПЛАН</span><b id="factories-hud">0 / 0</b></div><div id="strikes-hud" class="strikes-hud"></div></div></header>
        <div class="foreman" id="foreman"><img src="${e(new URL(this.data.manifest.overseer, document.baseURI).href)}" alt="Надсмотрщик"><div><small>УПОЛНОМОЧЕННЫЙ ПО ПЛАНУ</small><p id="foreman-text"></p></div></div>
        <aside class="time-panel"><div class="month-track" aria-label="Месяцы госплана"><img id="time-empty" src="${this.art("timeOff")}" alt="Январь — декабрь"><img id="time-fill" src="${this.art("timeOn")}" alt=""><div class="sr-only">${months.join(" ")}</div></div><strong id="countdown">3:00</strong></aside>
        <div class="mini-map" title="Нажмите, чтобы переместить камеру"><img src="${e(new URL(c.region.map, document.baseURI).href)}" alt="Обзор области"><i id="mini-viewport"></i></div>
        <div class="map-controls"><button data-action="matrix" title="Матрица (M)">СЕТЬ</button><button data-action="zoom-in" aria-label="Приблизить">+</button><button data-action="zoom-out" aria-label="Отдалить">−</button><button data-action="home" title="Сбросить камеру">⌂</button>${this.dev ? '<button data-action="dev">DEV</button>' : ""}</div>
        <div class="inspector-container">${this.inspector()}</div>
        <div class="build-area"><div class="build-top"><button class="voltage-toggle ${this.poleVoltage}" data-action="voltage"><span>ОПОРА</span> ${this.poleVoltage === "hv" ? "10 кВ / ВН" : "400 В / НН"} <kbd>V</kbd></button><div class="tool-hint">${e(this.toolHint())}</div><button data-action="inspect" class="inspect-button ${this.tool === "inspect" ? "selected" : ""}" title="Выбор (0)">ВЫБОР <kbd>0</kbd></button></div>
        <nav class="dock" aria-label="Строительство">${order.map((t, i) => {
                const build = BUILD_KINDS.includes(t), price = build ? `${c.price(t)} ₽` : t === "cable" ? `${n(this.balance.lines.hv.pricePerKm * c.priceFactor, 1)} ₽/км ВН` : `ВОЗВРАТ ${n(this.balance.economy.refundFraction * 100)}%`;
                return `<button data-action="tool" data-tool="${t}" class="build-card ${this.tool === t ? "selected" : ""}"><kbd>${i + 1}</kbd>
          ${build ? `<img src="${e(this.assets.thumb(t))}" alt="">` : `<img class="tool-art" src="${this.art(t === "cable" ? "wire" : "destroy")}" alt="">`}
          <b>${titles[t]}</b><small>${price}</small></button>`;
            }).join("")}</nav></div>
        <div class="network-foot" id="network-foot"></div>
        ${c.paused && !this.modal ? `<div class="modal-backdrop pause-backdrop"><section class="dialog pause-dialog"><div class="eyebrow">ВРЕМЯ И ДОХОД ОСТАНОВЛЕНЫ</div><h2>ПАУЗА</h2><button class="primary" data-action="pause">ПРОДОЛЖИТЬ</button><button class="text-button" data-action="menu">В главное меню</button></section></div>` : ""}`;
        }
        else if (this.phase === "result") {
            const o = c.lastOutcome, win = c.status === "won", penalty = c.status === "reprimand", final = c.status === "failed";
            const title = final ? "Ваша электрификация Беларуси завершена. Теперь, товарищ, вы электрифицируете Сибирь!" :
                penalty ? "План сорван. Назначен штраф." : win ? "Страна стала светлее!" : "План выполнен!";
            const description = penalty ? `Штраф ${n(o.fine, 0)} ₽. Нарушение ${c.strikes} из ${c.penaltyRules.maxStrikes}. Сеть сохранена. На исправление плана даётся ${c.penaltyRules.retrySeconds} секунд. Отрицательный баланс — долг, который погашается доходом.` :
                final ? `Третье нарушение за кампанию. Партия поручает вам новое направление работ.` :
                    win ? "Все шесть регионов электрифицированы." : "Регион освещён и закрыт. Деньги и счётчик нарушений переходят в следующий этап.";
            html = `<section class="result-card ${penalty ? "penalty" : final ? "siberia" : "success"}"><div class="eyebrow">${e(o.regionName.toUpperCase())} / ${c.strikes} НАРУШЕНИЙ</div>
        <h1>${title}</h1><p>${description}</p>
        <div class="result-stats"><div><small>ГОСПЛАНЫ</small><b>${o.poweredObjectives} / ${o.objectives}</b></div><div><small>${penalty ? "ШТРАФ" : "ДОХОД ЭТАПА"}</small><b>${n(penalty ? o.fine : o.incomeEarned, 0)} ₽</b></div><div><small>КАЗНА</small><b>${n(c.money, 0)} ₽</b></div></div>
        <button class="primary" data-action="${penalty ? "retry-plan" : o.success && !win ? "next-region" : "new"}">${penalty ? "ИСПРАВИТЬ ПЛАН" : o.success && !win ? "СЛЕДУЮЩАЯ ОБЛАСТЬ" : "НОВАЯ КАМПАНИЯ"} →</button>
        <button class="text-button" data-action="menu">В главное меню</button></section>`;
        }
        if (this.phase === "menu" || this.phase === "country")
            html += `<button class="art-icon settings-corner" data-action="settings" aria-label="Настройки"><img src="${this.art("settings")}" alt=""></button>`;
        if (this.modal === "settings")
            html += this.settingsPanel();
        if (this.modal === "matrix")
            html += this.matrix();
        if (this.modal === "help")
            html += this.help();
        if (this.modal === "dev")
            html += this.developerPanel();
        this.ui.className = `phase-${this.phase}`;
        this.ui.innerHTML = html;
        this.positionCities();
        this.updateHUD();
    }
    updateHUD() {
        if (this.phase !== "region")
            return;
        const c = this.campaign;
        const set = (id, value) => { const el = this.ui.querySelector("#" + id); if (el && el.textContent !== value)
            el.textContent = value; };
        set("money", n(Math.floor(c.money), 0));
        this.ui.querySelector("#money")?.classList.toggle("debt", c.money < 0);
        set("strikes-hud", `НАРУШЕНИЯ ${c.strikes} / ${c.penaltyRules.maxStrikes}`);
        set("income", `+${n(c.incomeRate)} ₽/с`);
        set("factories-hud", `${c.poweredObjectives} / ${c.objectiveCount}`);
        const left = Math.ceil(c.remaining);
        set("countdown", `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
        const fill = this.ui.querySelector("#time-fill");
        const unfilled = this.ui.querySelector("#time-empty");
        if (unfilled)
            unfilled.style.clipPath = `inset(${clamp(c.elapsed / c.duration * 100, 0, 100)}% 0 0 0)`;
        if (fill)
            fill.style.clipPath = `inset(0 0 ${100 - clamp(c.elapsed / c.duration * 100, 0, 100)}% 0)`;
        const mini = this.ui.querySelector("#mini-viewport");
        if (mini) {
            const view = worldView(this.width, this.height, this.balance, this.camera);
            Object.assign(mini.style, { left: `${-view.x / view.w * 100}%`, top: `${-view.y / view.h * 100}%`, width: `${this.width / view.w * 100}%`, height: `${this.height / view.h * 100}%` });
        }
        for (const m of this.ui.querySelectorAll("[data-month]"))
            m.classList.toggle("elapsed", (Number(m.dataset.month) + .5) / 12 < c.elapsed / c.duration);
        for (const button of this.ui.querySelectorAll("[data-tool]")) {
            const kind = button.dataset.tool;
            button.classList.toggle("unaffordable", BUILD_KINDS.includes(kind) && c.price(kind) > c.money);
        }
        const sim = c.sim;
        set("network-foot", `ВЫРАБОТКА ${n(sim?.generatedKW ?? 0)} кВт  /  ПОТРЕБЛЕНИЕ ${n(sim?.deliveredKW ?? 0)} кВт  /  ПОТЕРИ ${n((sim?.cableLossKW ?? 0) + (sim?.transformerLossKW ?? 0), 2)} кВт`);
        const messages = this.data.messages;
        const index = Math.floor(c.elapsed / messages.everySeconds), message = this.ui.querySelector("#foreman");
        if (message) {
            if (index !== this.shownMessage) {
                this.shownMessage = index;
                this.messageUntil = c.elapsed + messages.displaySeconds;
            }
            const plans = c.objectives;
            const plan = plans.length ? plans[index % plans.length] : null;
            const remark = c.poweredObjectives === c.objectiveCount && c.objectiveCount > 0 ? "Все объекты госплана получают питание. Удерживайте сеть до конца срока." :
                c.remaining < messages.urgentBelowSeconds && plan ? `Товарищ! Напоминаю: "${plan.name}" должен быть запитан без перебоев.` :
                    plan ? (index < plans.length ? `Товарищ! Партия постановила вам запитать "${plan.name}" в течение ${plan.months} ${monthsWord(plan.months)}.` : `Товарищ! Напоминаю о госплане: "${plan.name}" должен быть обеспечен электроэнергией.`) : messages.regular[index % messages.regular.length];
            set("foreman-text", remark);
            const visible = c.elapsed < this.messageUntil && !c.paused;
            message.classList.toggle("visible", visible);
            const radio = this.ui.querySelector(".radio-button");
            const image = this.ui.querySelector("#radio-image");
            const path = this.data.manifest.ui?.[visible ? "radioOn" : "radioOff"];
            if (image && path) {
                const url = new URL(path, document.baseURI).href;
                if (image.src !== url)
                    image.src = url;
            }
            if (radio) {
                radio.classList.toggle("music-enabled", this.audio.enabled);
                radio.dataset.message = visible ? "on" : "off";
                radio.setAttribute("aria-pressed", String(this.audio.enabled));
                radio.title = (this.audio.enabled ? "Выключить музыку" : "Включить музыку") + (visible ? " / Новое объявление" : "");
            }
        }
    }
}
