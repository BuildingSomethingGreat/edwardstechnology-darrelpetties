# Darrel Petties — Landing

Single-page landing site for Bishop Darrel Petties (Darrel Petties Ministries, The High Place · Olive Branch, MS).
Managed by Edwards Technology.

## Structure

| Path | Purpose |
| --- | --- |
| `index.html` | The entire site — a self-unpacking bundle. Images, fonts, the logo, and the component runtime ship inline as base64 in a `__bundler/manifest` script tag; a loader script decodes them to blob URLs and renders the page. |
| `netlify.toml` | Publishes the repo root as-is. No build step. |
| `robots.txt` | Allow-all, points at the sitemap. |
| `sitemap.xml` | The single URL, with its image. |
| `site.webmanifest` | PWA manifest — name, theme `#100E0B`, background `#050403`, icon set. |
| `favicon.svg` / `favicon.ico` / `apple-touch-icon.png` | DP monogram, cream-to-gold gradient on the site's near-black. |
| `assets/icon-*.png` | 192/512 plus a maskable 512 (full-bleed, mark inside the safe zone) for the manifest. |
| `assets/og-image.jpg` | 1200x630 social card, cropped from the hero screenshot. |

## Ministry intake form

The footer asks for an email and nothing else. On submit it posts
`{step:"email"}` to `/.netlify/functions/intake`, which writes the row to Airtable
immediately with Stage "Email only" — so someone who abandons the second step is
still a lead the office can chase. Then a sheet opens (bottom sheet under 861px,
right-hand drawer above it) prefilled with that email for name, booking type,
date, organization, phone and message; submitting posts `{step:"details"}` with
the record id returned by step 1.

The id alone cannot overwrite a row: the function re-reads the record and patches
only if its Email matches the submitted address. A missing or mismatched id falls
back to creating a fresh row, so details are never dropped.

- Data: Airtable base `appnwq20GTzMqYBN4` (Client-DarrelPetties), table `Bookings`
- Secret: `AIRTABLE_TOKEN` in Netlify env — a PAT with `data.records:read` +
  `data.records:write` on that base. **Without it the form returns a friendly
  error and points at the ministry email.**
- The sheet is built imperatively in `_buildSheet()` rather than in the template,
  because the DC renderer drops boolean attributes (see the loader-video note in
  the git history) and mangles controlled inputs.
- A hidden `company` field is a honeypot: if it arrives filled, the function
  returns 200 and writes nothing.

## SEO

Metadata lives in **two** places and both must be kept in sync:

1. The outer `<head>` of `index.html` — this is the raw HTML, and it is all that social
   scrapers (Facebook, iMessage, Slack, LinkedIn) ever read, since they do not run JS.
2. The `<helmet>` block inside the `__bundler/template` JSON string — the bundler replaces
   `document.documentElement` wholesale on swap, so this copy is what a JS-rendering crawler
   (Googlebot) sees. Editing only the outer head silently loses the tags after ~140ms.

Covered: title, description, canonical, robots (`max-image-preview:large`), theme-color,
Open Graph with explicit image dimensions, Twitter `summary_large_image`, and a JSON-LD
`@graph` of Person (awards, sameAs socials) + Church (The High Place) + WebSite.

Sections: loader → hero (`video-reveal`) → achievements → horizontal photo gallery → footer/contact.
Music button plays the "Word" single through a hidden YouTube IFrame player.

## Video assets (external)

The two videos are **not** bundled — they stream from Bunny CDN, which keeps `index.html` at ~5MB
instead of ~20MB:

- Loader: `https://ourcommunitynews.b-cdn.net/hf_20260812_030734_90558608-3a66-4308-8c8d-4815bec0b958.mp4`
- Hero opener: `https://ourcommunitynews.b-cdn.net/hf_20260812_031408_6eda8546-2847-4f82-b445-88927340e5cd.mp4`

The hero video is sampled into a WebGL reveal shader, so the CDN must keep sending
`Access-Control-Allow-Origin: *` — the `<video-reveal>` element requests it with
`crossOrigin="anonymous"` and the canvas would taint without it. If either video 404s the page
still loads: the loader has a 5.2s safety timeout and `video-reveal` falls back to a plain `<video>`.

To change a video, edit its URL inside the JSON string in the `__bundler/template` script tag at the
bottom of `index.html` (search for `b-cdn.net`).

## Local preview

```bash
npx serve .     # or: python3 -m http.server
```

Open over http://, not file:// — the bundler mints blob URLs and behaves closest to production there.

## Deploy

Pushes to `main` deploy automatically once the repo is linked in Netlify.
Manual deploy from this folder:

```bash
netlify deploy --prod --dir .
```
