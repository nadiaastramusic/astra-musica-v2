# Astra Musica Competition Platform v2

Complete music competition platform with 5 divisions, image uploads, Excel export, and weekly reset.

## What's New in v2

- **5 Divisions**: English, Afrikaans, Gospel, Praise & Worship, Live Artists
- **Beautiful backgrounds**: Sparkly navy kings blue main page + smoky division colors
- **Any link support**: Suno, YouTube, Facebook, or any URL
- **Image uploads**: Cover images for submissions + challenge banners
- **Admin-managed judges**: You assign judges by email; they set their own passwords
- **Division tabs**: Public can browse each division separately
- **Excel export**: Download weekly data as .xlsx
- **Weekly reset**: One-click clean slate for new week
- **Logo customization**: Paste your logo URL in admin settings

## File Structure

```
astra-musica-platform-v2/
├── server.js          # Express backend + API
├── package.json       # Dependencies (express, axios, xlsx)
└── public/            # Frontend
    ├── index.html     # Main app
    ├── app.js         # Frontend logic
    └── style.css      # Brand styling with effects
```

## Deploy to Render

### 1. Upload to GitHub
- Create repo `astra-musica-submissions-app` (or new name)
- Upload all 5 files at root level

### 2. Create Web Service
- Language: **Node**
- Build: `npm install`
- Start: `npm start`
- Root Directory: blank

### 3. Done
Your app goes live in 2–3 minutes.

## Demo Judge Login

| Email | Password | Division |
|-------|----------|----------|
| sarah@example.com | judge1 | English |
| pieter@example.com | judge2 | Afrikaans |
| rebecca@example.com | judge3 | Gospel |
| david@example.com | judge4 | Praise & Worship |

## How to Use

### Admin
1. Click **Admin** on homepage
2. **Submissions tab**: Add entries manually, upload challenge banners
3. **Judges tab**: Assign new judges by name/email/division
4. **Results tab**: Reveal/hide results, export Excel
5. **Settings tab**: Reset week, update logo

### Judge
1. Click **Judge** on homepage
2. Enter your assigned email and password
3. You only see submissions for YOUR division
4. Score 4 criteria (0-10 each) → auto-calculates to %
5. Other judges' scores stay hidden

### Public
1. Click **Public** on homepage
2. Browse Top 20s by division tabs
3. View Challenges with uploaded banners
4. See Final Results after admin reveals them

## Adding Your Logo

In Admin → Settings, paste your logo URL. Or edit `public/index.html` and replace:
```html
<div class="logo-box" id="logoBox">AM</div>
```
With:
```html
<div class="logo-box"><img src="YOUR_LOGO_URL" style="width:44px;height:44px;object-fit:contain;"></div>
```

## Adding Division Logos

You can add division-specific logos by editing the `div-header` sections in `app.js` and inserting `<img>` tags.

## Facebook Auto-Polling (Optional)

Add to Render Environment:
- `FB_PAGE_ID` = your Facebook Page ID
- `FB_ACCESS_TOKEN` = your Page Access Token

If left blank, app runs in manual mode perfectly.

## Weekly Workflow

1. **Monday**: Admin clicks "Reset for New Week" in Settings
2. **Throughout week**: Add submissions manually from your Facebook Group
3. **Judging**: Judges log in and score
4. **Sunday**: Admin clicks "Reveal Results Now"
5. **Export**: Download Excel for records
6. Repeat

## Troubleshooting

**Images not persisting?** Render's filesystem is temporary. For production, integrate Firebase Storage and replace base64 storage with Firebase URLs.

**Build fails?** Make sure `server.js` and `package.json` are at repo root, not in a subfolder.
