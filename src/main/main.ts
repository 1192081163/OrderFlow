import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, Menu, Tray } from "electron";

import { registerIpcHandlers } from "./ipcHandlers.js";
import { createMainLocalMailServices } from "./localMailServices.js";
import { createTrayController } from "./trayController.js";
import { createWindowLifecycle } from "./windowLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createWindow(options: { show: boolean }): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    title: "订单提取助手",
    backgroundColor: "#f5f6f8",
    show: options.show,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  return window;
}

app.whenReady().then(async () => {
  const services = await createMainLocalMailServices();
  registerIpcHandlers({ localMail: services.localMail });
  const startHidden = process.argv.includes("--hidden");
  const window = await createWindow({ show: !startHidden });
  const lifecycle = createWindowLifecycle(window);
  window.on("close", (event) => lifecycle.handleClose(event));
  const tray = createTrayController({
    iconPath: trayIconPath(),
    bindings: {
      createTray: (icon) => new Tray(icon),
      buildMenu: (template) => Menu.buildFromTemplate(template),
    },
    showWindow: lifecycle.showWindow,
    reconnect: () => services.localMail.reconnect(),
    exit: async () => {
      lifecycle.allowQuit();
      tray.destroy();
      await services.close();
      app.quit();
    },
  });
  await services.localMail.start();

  app.on("activate", () => lifecycle.showWindow());
}).catch((error: unknown) => {
  console.error("Failed to start local mail workstation", error);
  app.quit();
});

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "app_icon.png")
    : path.resolve("assets", "app_icon.png");
}
