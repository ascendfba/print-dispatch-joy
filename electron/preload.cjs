const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dispatchAPI", {
  isElectron: true,
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  printPdf: (args) => ipcRenderer.invoke("printers:printPdf", args),
  mintsoftFetch: (args) => ipcRenderer.invoke("mintsoft:fetch", args),
});