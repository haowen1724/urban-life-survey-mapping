# Urban Life Survey Mapping 城市生活調查測繪

**Beta 測試版.** A bilingual (繁體中文 / English) phone-friendly field tool for public life surveys. Surveyors record three surveys at fixed points on a site plan:

- **人流計數 People moving.** A timed gate count by age band, gender and travel mode.
- **停留活動 People staying.** Every stationary person plotted on the plan and coded by posture, activity, group and what they have with them.
- **空間品質 Quality criteria.** A twelve-item walkthrough score.

Developed by Arup in collaboration with the Department of Architecture, National Taipei University of Technology, as part of the Responsible AI in Architectural Design programme.

The survey instruments and field directions are adapted from Gehl's **Urban95** toolkit and the underlying Public Life Data Protocol, adjusted for Taiwanese streets. The adjustments are motor-scooter counts, local weather options, bilingual coding, a five-minute count period and general age bands. This is not an official Urban95 study.

- [Urban95 Field Guide (Gehl / Bernard van Leer Foundation)](https://vanleerfoundation.org/wp-content/uploads/2018/10/Urban95-Field-Guide.pdf)
- [Urban95 Public Life Data Framework](https://issuu.com/gehlarchitects/docs/urban95_public_life_data_framework_guide)

---

## How it works

```
 phone (GitHub Pages)  ──►  Google Apps Script web app  ──►  Google Sheet in your account
   index.html                 apps-script/Code.gs              points · surveyors · records
   saves to the phone first                                    moving · staying · quality
```

- The **page** is hosted free on GitHub Pages. It holds no survey data.
- **Records** go to a Google Sheet that you own. Each record is first saved on the phone. If there is no signal it waits there, shows as *待上傳 Waiting to upload*, and uploads when the connection returns.
- **No photos are collected.** People in the street have not agreed to be recorded.

## Setting it up (about 15 minutes, once)

### 1. Make the Google Sheet
Create a new, empty Google Sheet and name it something like *Urban Life Survey – NTUT 2026*.

Use a personal Google account for testing. A university Google Workspace account also works, but some institutions block the *Anyone* access that step 4 needs.

### 2. Add the script
In the Sheet, open **Extensions → Apps Script**. Delete the sample code, paste in the whole of [`apps-script/Code.gs`](apps-script/Code.gs), and press **Save**.

### 3. Run `setup` once
Choose **setup** in the function menu at the top and press **Run**.
- Google asks you to authorise the script. Choose your account, then **Advanced → Go to … (unsafe)**. This warning appears for any script you write yourself.
- The script creates the six tabs and two access codes. Open **Execution log** to see them:
  - `ADMIN_CODE` is for you, the organiser. It can change the setup and delete any record.
  - `STUDY_CODE` is for surveyors. They add their own name, place their own survey points, add records, and can change or delete only what they made on their own phone.

### 4. Deploy the web app
Go to **Deploy → New deployment**, choose the type **Web app**, and set:
- *Execute as*: **Me**
- *Who has access*: **Anyone**

Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" means anyone who has the URL *and* a valid code. Without a code, the script returns nothing.

### 5. Connect the page
Paste the Web app URL into [`config.js`](config.js):

```js
window.ULS_API = "https://script.google.com/macros/s/……/exec";
```

### 6. Turn on GitHub Pages
In this repository, open **Settings → Pages**. Under *Source*, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`. The page appears at
`https://haowen1724.github.io/urban-life-survey-mapping/` within a minute or two.

### 7. Share two links

| Who | Link |
|---|---|
| You (organiser) | `https://haowen1724.github.io/urban-life-survey-mapping/?k=ADMIN_CODE` |
| Surveyors | `https://haowen1724.github.io/urban-life-survey-mapping/?k=STUDY_CODE` |

The page remembers the code on that phone and removes it from the address bar. Surveyors can also type the code in by hand.

## Before a field day

1. **Organiser:** open your organiser link and, on **設定 Setup**, upload the site plan.
2. **Each surveyor:** open the surveyor link **while on Wi-Fi**, so the site plan is stored on the phone and loads even with weak signal. Under **調查員 Surveyors**, add your name, or tap **這是我 This is me** if it's already listed. Then tap **新增調查點 Add survey point** and tap the plan where you'll stand. The point is yours: only you and the organiser can rename or remove it.
3. **On site:** the **調查 Survey** tab shows a coverage table of what's done and what's still missing. Each record is saved under the name of the person who made it.

A surveyor can remove a name they added by mistake, or any name nobody is using yet. A name that already has points or records can only be removed by the organiser, who can also add, rename, reassign or remove any point.

## The data

Everything lands in your Sheet, ready for analysis:

| Tab | One row per |
|---|---|
| `moving` | count period, with a column for each age × gender cell and each travel mode |
| `staying` | **plotted person**, with plan position (x, y from 0 to 1), age, gender, posture, activities, group size |
| `quality` | walkthrough, scored 2 = yes, 1 = partly, 0 = no |
| `records` | saved survey, with the full detail as JSON (the app reads this tab) |
| `points`, `surveyors` | setup |

The **紀錄 Records → 匯出 CSV Export CSV** button downloads the same data with a bilingual code book.

## Security and privacy notes (beta)

- **The codes are a shared secret, not real logins.** Anyone holding a link can act with that link's role. If a link leaks, run **`rotateCodes`** in Apps Script; old links stop working immediately.
- **Survey data lives in your Google account.** Nothing is stored in this repository or on GitHub.
- **This repository is public, but holds no data.** Anyone can see the page code. The site plan is stored in your Google Drive and is only sent to someone holding a valid code; it is never in this repository. If the plan comes from an open-data base map, keep its source credit.
- **No photos and no names of the public** are collected. Surveyors enter their own names; ask them to use the name the class uses, not a full legal name, if that matters for your consent terms.
- **Before wider use**, review this setup against Arup and university data policies. When moving to Arup systems, only the storage layer (`apps-script/` and `config.js`) needs to change.

## Updating the script later

After editing `Code.gs` in Apps Script, go to **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. The URL stays the same.
