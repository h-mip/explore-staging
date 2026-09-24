# H-MIP Explore / Explora

An Astro site for exploring H-MIP research in Catalonia. Catalan is the default language; Spanish and English are under `/es/` and `/en/`.

## Run locally

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev
npm run build
```

`npm run build` validates and generates map data before building the site. Generated files belong in `public/generated/`; do not edit them.

## Editing

- Research CSVs and the survey publication switch are in `data/`. Follow [the data guide](data/README.md).
- Approved map explanations are in `src/content/map-method/{ca,es,en}.md`.
- Legal, privacy and accessibility notices are in `src/content/policies/{ca,es,en}/`.
- Page wording is in `src/content/site-copy/{ca,es,en}.json`. Follow [the short copy guide](src/content/site-copy/README.md).
- Stories are Markdown files in `src/content/stories/`. Draft stories do not appear on the site. `stagingOnly: true` keeps an example story off production.
- Short interface labels in components remain developer-maintained.

The map data is a provisional model run. The time, activity and headline CSVs contain synthetic test figures. Production hides those results while `publishSurveyResults` is false; do not switch it on until all three files have been replaced with verified research data.

## Hosting

The public staging site is [h-mip.com/explore-staging](https://h-mip.com/explore-staging/), deployed from [h-mip/explore-staging](https://github.com/h-mip/explore-staging). Staging is marked `noindex` but remains publicly accessible. It previews the survey sections and chart embeds with prominent synthetic-data labels, per-section show/hide controls, and staging-only example stories. This does not change the production publication switch. The staging workflow validates and builds before publishing.

The production site is live at [h-mip.com/explore](https://h-mip.com/explore/) from [h-mip/explore](https://github.com/h-mip/explore). Its workflow deploys only from that repository's `main`, after validation and a successful build. Preview changes on staging and review them before merging to production. The root-domain `robots.txt` belongs to the separate repository that serves `h-mip.com/`; the copy under `/explore/` does not control crawlers for the domain.

## Embeds

The full map's “Share map” control copies either a link to the current view or ready-to-paste iframe code. Map embeds are available at `/embed/ca/map/`, `/embed/es/map/` and `/embed/en/map/` under either site's base path. Staging also previews the hour, month, activity and place embeds with synthetic-data labels; production generates them only when verified survey results are enabled. Embeds are marked `noindex`.

Site code is GPL-3.0-only. Model estimates are CC0 1.0; site texts and figures are CC BY 4.0. ICGC boundaries require CC BY 4.0 attribution, and the basemap requires OpenStreetMap attribution.
