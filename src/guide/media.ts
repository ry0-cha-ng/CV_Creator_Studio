export const mediaUrl = (filePath: string): string =>
  `studio-media://root/${filePath
    .split(/[\\/]/)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
