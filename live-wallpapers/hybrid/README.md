# Hybrid Interactive Wallpaper (Canvas + three.js)

How to run locally:
1. Put these files (index.html, style.css, main.js) together in one folder.
2. Place your wallpaper image in the same folder and name it `wallpaper.jpg`.
3. Run a simple HTTP server (recommended):
   - Python 3: `python -m http.server 8000`
   - Then open http://localhost:8000

Behavior:
- The page auto-detects whether to use Canvas (light) or three.js (advanced) by checking WebGL support, `navigator.deviceMemory`, and CPU cores.
- Long-press anywhere on the wallpaper to open settings (left side). Settings are saved to `localStorage`.
- Settings include performance toggle, star cycle, leaf density, wind speed, etc.

Deploy to GitHub Pages:
1. Create or use an existing repo.
2. Copy folder `live-wallpapers/hybrid` into repo.
3. Enable GitHub Pages (Settings → Pages) to serve from main branch (or /docs).
4. Use the Pages URL as wallpaper source in Lively Wallpaper.

Notes:
- Replace `wallpaper.jpg` with your image (optimize size for faster load).
- If you prefer I push these files into your repo, tell me owner/repo and I'll create a branch — but you must Allow the GitHub confirmation when prompted.
