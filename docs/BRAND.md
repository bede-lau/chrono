# Chrono identity

The **phase mark** is an open C formed from two organic crescent membranes. Its asymmetric opening suggests an organism unfolding through time; the opposing curves suggest linked quantum states. Monochrome white keeps the specimen as the interface's only saturated colour. The icon has a near-black plate so it stays legible on light and dark browser chrome.

## Assets

- Editable transparent master: `public/brand/chrono-mark.svg`; dark variant: `chrono-mark-dark.svg`.
- Transparent 1024px mark: `chrono-mark.png`.
- Horizontal lockups: `chrono-logo.svg`, `chrono-logo-dark.svg` and corresponding transparent PNGs.
- Browser icon: `icon.svg`, 16/32/48px PNGs and `src/app/favicon.ico` with all three sizes.
- Apple home-screen icon: `icon-180.png`.
- App icons: `icon-192.png`, `icon-512.png`; a separate `icon-maskable-512.png` keeps the entire mark inside the central safe zone.
- Social preview: `social-card.png`, 1200×630, featuring a real rendered Chrono specimen from `deck/assets/organism.png`.

Run `node scripts/generate-brand.mjs` to reproduce all exports from the vector master. Existing Sharp provides format conversion; no packages were added. The lockup uses Arial/sans-serif, while the live header keeps the site's Geist font.

Metadata in `src/app/layout.tsx` includes the canonical public URL, description, Open Graph and Twitter large-image cards with image alt text, favicon variants, Apple home-screen settings and manifest. `public/site.webmanifest` defines standalone display and app icons. `robots.txt` excludes API and development labs; `sitemap.xml` lists the public home page. Lab metadata is explicitly noindex. The manifest adds home-screen branding; it does not add offline support.

## Design provenance

A transparent bitmap concept was generated with the **built-in image generation tool** (not the CLI), then redrawn as two clean editable Bézier shapes for production scalability and tiny-icon clarity. The production logo and social layout are repository-native SVG; exported PNGs and ICO are deterministic.

Concept prompt:

> Create a singular original logo symbol for CHRONO, an experimental living quantum organism that evolves through eight chained quantum engines. Usage: production brand mark and favicon. One centered isolated symbol, no text whatsoever. Design a bold open C silhouette made from two interlocking organic crescent membranes, like a living cell seen through a phase interference lens. Thick sculptural white flat shapes, a distinctive tapered notch opening toward upper right, elegant asymmetric inner negative-space channel suggesting forward time. The mark must be genuinely custom and memorable, understated scientific editorial identity, precise vector-like edges and minimal silhouette, readable at 16px. Avoid atom icons, orbit ellipses, clock hands, stopwatch, arrows, generic infinity symbols. Solid pure white only, no colors, no gradients, no shading, no 3D, no thin hairlines, no mockup. Actual fully transparent background. Mark fills about 75 percent of square canvas, generous consistent margins. High quality clean flat brand design.
