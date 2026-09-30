// The same geometric VS monogram is used in the interface and generated app assets.
export const brandPaths = {
  tile: "M16 1h32a15 15 0 0 1 15 15v25a22 22 0 0 1-22 22H16A15 15 0 0 1 1 48V16A15 15 0 0 1 16 1Z",
  v: "M8 18h8l7.3 22.2L31 18h8L27 49h-7.5Z",
  s: "M54 18H42c-6.3 0-10.3 3.4-10.3 9 0 4.4 2.8 6.8 8.1 8.3l4.8 1.3c2.1.6 3.1 1.5 3.1 2.9 0 1.8-1.4 2.8-4 2.8H34L31.4 49h12.4C50.8 49 55 45.2 55 39.3c0-4.8-2.8-7.3-8.3-8.8l-4.6-1.2c-2.3-.6-3.4-1.5-3.4-2.8 0-1.6 1.3-2.6 3.6-2.6H54Z",
};

export const brandColors = {
  dark: {
    start: "#35674f",
    end: "#123b2e",
    v: "#d5efab",
    s: "#f9fcf4",
    edge: "#c2dfac",
  },
  light: {
    start: "#e7f4ce",
    end: "#bfd994",
    v: "#153f30",
    s: "#2e5940",
    edge: "#ffffff",
  },
};

// Keep downloaded icons, installed app assets and the UI on the same artwork.
export function brandSvg() {
  const color = brandColors.dark;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="vs-tile" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color.start}"/><stop offset="1" stop-color="${color.end}"/></linearGradient></defs><path d="${brandPaths.tile}" fill="url(#vs-tile)" stroke="${color.edge}" stroke-opacity=".28"/><path d="M6 18A12 12 0 0 1 18 6h28" fill="none" stroke="${color.edge}" stroke-opacity=".22"/><path d="${brandPaths.s}" fill="${color.s}"/><path d="${brandPaths.v}" fill="${color.v}"/><path d="M42 56h5a9 9 0 0 0 9-9v-5" fill="none" stroke="${color.edge}" stroke-opacity=".32" stroke-linecap="round"/></svg>`;
}
