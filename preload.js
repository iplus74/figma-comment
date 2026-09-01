// preload.js - contextBridge 를 통해 렌더러 프로세스에 안전한 API 를 노출한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('figmaAPI', {
  getMe: (token) => ipcRenderer.invoke('figma:getMe', { token }),
  getComments: (token, fileKey) => ipcRenderer.invoke('figma:getComments', { token, fileKey }),
  getImages: (token, fileKey, nodeIds, scale) =>
    ipcRenderer.invoke('figma:getImages', { token, fileKey, nodeIds, scale }),
  getNode: (token, fileKey, nodeId) =>
    ipcRenderer.invoke('figma:getNode', { token, fileKey, nodeId }),
  postComment: (token, fileKey, message, commentId) =>
    ipcRenderer.invoke('figma:postComment', { token, fileKey, message, commentId }),
  openImage: (url) => ipcRenderer.invoke('app:openImage', { url }),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),
});
