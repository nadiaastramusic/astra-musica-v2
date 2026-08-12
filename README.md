# Astra Musica Competition Platform v2 — With MongoDB Persistence

Complete music competition platform that now **saves everything permanently** using MongoDB Atlas (free tier).

## The Problem (Fixed)

Render's free tier puts apps to sleep after inactivity. When they wake up, all in-memory data is lost:
- ❌ Admin password changes gone
- ❌ New judges deleted
- ❌ Submissions vanished
- ❌ Scores reset

**Solution:** MongoDB Atlas free tier (512MB) — data survives forever, even when Render sleeps.

---

## Setup MongoDB Atlas (10 minutes, free forever)

### Step 1: Create Account
1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Click **"Try Free"** and sign up with Google
3. You don't need a credit card

### Step 2: Create Cluster
1. Choose **"Shared"** (free tier)
2. Select **AWS** as cloud provider
3. Pick a region close to you (e.g. `af-south-1` for South Africa, or `eu-west-1` for Europe)
4. Click **"Create Deployment"**
5. Wait 1-3 minutes for the cluster to build

### Step 3: Create Database User
1. In the left sidebar, click **"Database Access"**
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Username: `astra_admin`
5. Password: Create a strong password (write it down!)
6. Under **"Database User Privileges"** select **"Read and write to any database"**
7. Click **"Add User"**

### Step 4: Allow Render to Connect
1. In the left sidebar, click **"Network Access"**
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (this adds `0.0.0.0/0`)
4. Click **"Confirm"**

### Step 5: Get Your Connection String
1. Go back to **"Database"** in the left sidebar
2. Click **"Connect"** on your cluster
3. Click **"Drivers"**
4. Select **"Node.js"**
5. Copy the connection string. It looks like:
   ```
   mongodb+srv://astra_admin:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
6. Replace `YOUR_PASSWORD` with the password you created in Step 3

### Step 6: Add to Render
1. Go to [render.com](https://render.com) → your web service
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Key: `MONGODB_URI`
5. Value: Paste your full connection string from Step 5
6. Click **"Save Changes"**
7. Render will auto-redeploy

### Step 7: Verify
1. Wait for deploy to finish
2. Open your app URL
3. Click **Admin** → enter password `astra2026`
4. Add a judge or submission
5. Wait 5 minutes for Render to sleep
6. Refresh the page — your data is still there!

---

## What Gets Saved in MongoDB

| Data | Collection | Survives Sleep? |
|------|-----------|----------------|
| Admin password | `settings` | ✅ Yes |
| Judges | `judges` | ✅ Yes |
| Submissions | `submissions` | ✅ Yes |
| Scores | `scores` | ✅ Yes |
| Challenge images | `challengeImages` | ✅ Yes |
| Week ID / reveal status | `settings` | ✅ Yes |

---

## Without MongoDB (Fallback)

If you don't set up MongoDB, the app still works perfectly. It just stores data in memory. When Render sleeps, data resets to the hardcoded defaults.

**For testing:** You can use the app without MongoDB. For production competitions, MongoDB is strongly recommended.

---

## Deploy to Render

### 1. Upload to GitHub
- Create repo `astra-musica-v2`
- Upload all files at root level (server.js, package.json, public/)

### 2. Create Web Service
- Language: **Node**
- Build: `npm install`
- Start: `npm start`
- Root Directory: blank

### 3. Add Environment Variables
| Variable | Value |
|----------|-------|
| `MONGODB_URI` | Your MongoDB connection string |
| `FB_PAGE_ID` | (Optional) Your Facebook Page ID |
| `FB_ACCESS_TOKEN` | (Optional) Your Facebook token |

---

## Demo Logins

| Role | Email | Password |
|------|-------|----------|
| Judge (English) | sarah@example.com | judge1 |
| Judge (Afrikaans) | pieter@example.com | judge2 |
| Judge (Gospel) | rebecca@example.com | judge3 |
| Judge (P&W) | david@example.com | judge4 |

Admin password: `astra2026` (change immediately in Settings)

---

## Integrated Management App

The file `Music_Management_Studio_Integrated.html` connects to your competition platform:

1. Open it in your browser
2. Click **🎵 Astra Musica** tab
3. Click **🔄 Sync Now** — fetches live data
4. Click **📊 Push Rankings to Charts** — sends competition results to your Charts tab
5. **💾 Save to File** — exports everything (contacts, artists, charts, competition data)

---

## Troubleshooting

**"MongoDB connection failed" in logs**
→ Check your `MONGODB_URI` is correct. Make sure you replaced `YOUR_PASSWORD` with the actual password.

**"Allow Access from Anywhere" not working**
→ In MongoDB Network Access, make sure `0.0.0.0/0` is listed and says "Active".

**Data still resetting**
→ Check Render logs. If it says "Memory-only mode", your `MONGODB_URI` is missing or wrong.

**Build fails with "Cannot find module 'mongodb'"**
→ Make sure `package.json` includes `"mongodb": "^6.0.0"` and you committed it before deploying.
