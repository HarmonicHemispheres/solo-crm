/**
 * The operator's brand images (T-260829-05) — one entry point for the IPC
 * layer, so `registry.ts` imports a behaviour and not a file layout, exactly
 * as `electron/main/favicons/index.ts` does for the favicon cache.
 *
 * Read `picker.ts`'s header before changing anything here: it carries the one
 * property this directory exists to hold (no filesystem path ever crosses back
 * to the renderer), the bounded-read discipline, and why the image transport
 * is a `data:` URL rather than anything that would mean editing the CSP.
 */
export {
  brandingSlotState,
  chooseBrandingImage,
  getBrandingSlotState,
  getBrandingSnapshot,
  IMAGE_FILTER_EXTENSIONS
} from './picker'
export type { BrandingDialog, BrandingPickerDeps, BrandingPickerWindow, BrandingWindowSource } from './picker'
