# BattleGrid AI — OpenLayers (Static Web MVP)

This is a pure **HTML/CSS/JS** prototype that uses **OpenLayers** for the map and **Canvas** for visualizations.
It’s 100% static and ready to host on **GitHub Pages**.

## Files
```
battlegrid-openlayers/
  index.html        # Command Center (OpenLayers map + live feed + alerts)
  threat.html       # Threat Engine (image upload + canvas detections + forecast)
  comms.html        # Comms (messaging, simulated encryption, mock transcription)
  missions.html     # Missions (briefing form, optimizer, timeline canvas)
  analytics.html    # Analytics (trend chart, KPIs, predictive logistics, export)
  assets/
    style.css
    app.js          # Shared JS logic + OpenLayers wiring
```

## Deploy to GitHub Pages (root)
1) Create a **public** GitHub repo (e.g. `battlegrid-openlayers`).
2) Upload the **contents** of this folder (all HTML files + `assets/`) to the repo **root** and commit.
3) Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** and **/(root)** → Save.
4) Wait ~1–2 minutes; then open the green published URL (e.g. `https://<your-user>.github.io/battlegrid-openlayers/`).

> If root gives you trouble, move everything into a `docs/` folder and set Pages to `main` → `/docs`.
