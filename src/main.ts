
import { bootstrap } from "./bootstrap.js";
import { nativeSurface } from "./render/native.js";
// The default development entry is the same tested Canvas path as the shipped build.
// Add ?renderer=phaser to use the optional Phaser host without changing game rules.
if (new URLSearchParams(location.search).get("renderer")==="phaser") {
  void import("./render/phaser.js").then(m=>bootstrap(m.phaserSurface));
} else {
  void bootstrap(nativeSurface);
}
