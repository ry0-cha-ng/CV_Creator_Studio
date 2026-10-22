const SOURCE_PREVIEW_STOP = 'cv-stop-source-preview';

export const stopSourcePreview = (): void => {
  window.dispatchEvent(new Event(SOURCE_PREVIEW_STOP));
};

export const subscribeSourcePreviewStop = (onStop: () => void): (() => void) => {
  window.addEventListener(SOURCE_PREVIEW_STOP, onStop);
  return () => window.removeEventListener(SOURCE_PREVIEW_STOP, onStop);
};
