import { Assets, loadData } from "./assets.js";
import { App } from "./app.js";
export async function bootstrap(factory) {
    const root = document.getElementById("app");
    try {
        const data = await loadData(), assets = new Assets(data);
        await assets.preload();
        root.innerHTML = '<div id="display"></div>';
        const surface = await factory(root.querySelector("#display"));
        new App(root, surface, data, assets);
    }
    catch (error) {
        root.textContent = "";
        const box = document.createElement("div");
        box.className = "loading error-page";
        const h = document.createElement("h1");
        h.textContent = "Не удалось запустить игру";
        const p = document.createElement("p");
        p.textContent = error instanceof Error ? error.message : String(error);
        const q = document.createElement("p");
        q.textContent = "Откройте игру через локальный HTTP-сервер, не через file://. Проверьте Console и Network.";
        box.append(h, p, q);
        root.append(box);
        console.error(error);
    }
}
