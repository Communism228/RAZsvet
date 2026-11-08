const DB = "raz-svet-local-media-v1";
function openStore() {
    return new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error("Local storage unavailable"));
            return;
        }
        const request = indexedDB.open(DB, 1);
        const timer = setTimeout(() => reject(new Error("Local storage timed out")), 2000);
        request.onupgradeneeded = () => request.result.createObjectStore("assets");
        request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(new Error("Local storage blocked")); };
    });
}
export async function readLocal(key) {
    let db;
    try {
        db = await openStore();
        return await new Promise((resolve, reject) => {
            const req = db.transaction("assets", "readonly").objectStore("assets").get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    }
    catch {
        return null;
    }
    finally {
        db?.close();
    }
}
export async function writeLocal(key, value) {
    let db;
    try {
        db = await openStore();
        await new Promise((resolve, reject) => {
            const tx = db.transaction("assets", "readwrite");
            if (value)
                tx.objectStore("assets").put(value, key);
            else
                tx.objectStore("assets").delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        db?.close();
    }
}
