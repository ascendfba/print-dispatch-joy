const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dispatchAPI", {
  isElectron: true,
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  getPrintLogPath: () => ipcRenderer.invoke("printers:getPrintLogPath"),
  debugPrintLog: (args) => ipcRenderer.invoke("printers:debugLog", args),
  printPdf: (args) => ipcRenderer.invoke("printers:printPdf", args),
  printRasterPages: (args) => ipcRenderer.invoke("printers:printRasterPages", args),
  mintsoftFetch: (args) => ipcRenderer.invoke("mintsoft:fetch", args),
});