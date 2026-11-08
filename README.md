# IPEKA Student Well-Being Hub

A Google Apps Script (GAS) web application and Google Workspace integration designed to support student mental health, mood check-ins, journaling, incident reporting, counseling appointments, real-time messaging, psychoeducational articles, and well-being surveys.

---

## Project Architecture & File Structure

Google Apps Script shares a flat global namespace across all `.gs` files at runtime and uses `HtmlService` partials via `<?!= include('Filename'); ?>`.

| File | Type | Purpose |
| :--- | :--- | :--- |
| `appscript.json` | Manifest (`appsscript.json` in GAS) | Timezone (`Asia/Jakarta`), V8 runtime, Web App permissions, and Advanced Services (`Calendar v3`, `Sheets v4`). |
| `Config.gs` | Server (`.gs`) | Global configuration (`SPREADSHEET_ID`, `ALLOWED_DOMAIN`, `CANONICAL_URL`), role constants, crisis keywords, and standard counseling time slots. |
| `Database.gs` | Server (`.gs`) | Singleton `DatabaseConnection`, `LockService` concurrency locking, and automated 13-sheet schema creation (`setupDatabase`). |
| `Model.gs` | Server (`.gs`) | Domain data models (`User`, `MoodEntry`, `JournalEntry`, `ReportIncident`, `Appointment`, `ChatMessage`, `DailyQuote`, `EducationalResource`, `Survey`, etc.). |
| `Repositories.gs` | Server (`.gs`) | CRUD repositories with dynamic header-to-model mapping for Google Sheets. |
| `Services.gs` | Server (`.gs`) | Domain business logic, Role-Based Access Control (RBAC), crisis keyword detection, and Google Calendar sync. |
| `Controller.gs` | Server (`.gs`) | Public RPC endpoints (`google.script.run` handlers), `doGet(e)` entrypoint, `include()` helper, and Google Chat bot handlers. |
| `Code.gs` | Server (`.gs`) | Entrypoint bridge for backward compatibility and local Node/CommonJS test environments. |
| `Index.html` | Client (`.html`) | Main HTML layout shell, Tailwind CSS CDN, Lucide icons, and bottom navigation bar. |
| `Styles.html` | Client (`.html`) | Custom CSS styles and animations injected into `Index.html`. |
| `Navbar.html` | Client (`.html`) | Top navigation bar component. |
| `PageStudent.html` | Client (`.html`) | Student portal views (Mood Check-in, Journal, Incident Report, Education, Counseling Chat/Booking, Surveys). |
| `PageCounselor.html` | Client (`.html`) | Counselor & Admin dashboard views (Triage, Reports, Appointments, Student Directory, Articles, Surveys). |
| `Modals.html` | Client (`.html`) | Shared modal dialogs across Student and Counselor views. |
| `ClientState.html` | Client (`.html`) | Client-side state management, RPC wrapper, i18n, and initialization logic. |
| `ClientStudent.html` | Client (`.html`) | Student-specific frontend interactivity and event handlers. |
| `ClientCounselor.html` | Client (`.html`) | Counselor/Admin-specific frontend interactivity and dashboard handlers. |

---

## Step-by-Step Deployment Guide for Developers

You can deploy this project either via the **Google Apps Script Web Editor (GUI)** or using **Google `clasp` CLI** (recommended for team collaboration and Git workflows).

---

### Step 1: Prepare the Google Spreadsheet (Database)

1. Go to [Google Sheets](https://sheets.google.com) and create a **Blank Spreadsheet**.
2. Name the spreadsheet (e.g., `Student Well-Being Hub DB`).
3. Copy the **Spreadsheet ID** from the browser URL:
   ```text
   https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID_HERE/edit
   ```
   *(Save this ID for Step 3).*

---

### Step 2: Upload the Codebase to Google Apps Script

Choose **Option A (Using `clasp` CLI)** or **Option B (Manual Web Editor)**.

#### Option A: Using Google `clasp` CLI (Recommended for Developers)

1. **Install Node.js** (if not installed) and install `@google/clasp` globally:
   ```bash
   npm install -g @google/clasp
   ```
2. **Enable the Google Apps Script API**:
   - Visit [script.google.com/home/usersettings](https://script.google.com/home/usersettings) and toggle **Google Apps Script API** to **ON**.
3. **Clone this Git repository**:
   ```bash
   git clone https://github.com/DarthSaber23/TestingAppScript.git
   cd TestingAppScript
   ```
4. **Log in to `clasp`**:
   ```bash
   clasp login
   ```
5. **Rename or copy `appscript.json` to `appsscript.json`** (Google's `clasp` CLI expects two `s` characters in `appsscript.json`):
   ```bash
   cp appscript.json appsscript.json
   ```
6. **Create a new Apps Script project (or link to an existing Script ID)**:
   - To create a new standalone script:
     ```bash
     clasp create --type webapp --title "IPEKA Student Well-Being Hub"
     ```
   - Or, to connect to an existing Apps Script project created by a teammate:
     ```bash
     clasp clone <YOUR_SCRIPT_ID>
     ```
7. **Push the code to Google Apps Script**:
   ```bash
   clasp push
   ```
   *(When prompted to overwrite the manifest file `appsscript.json`, type `y`).*

#### Option B: Manual Setup via Google Apps Script Web Editor

1. Open [script.google.com](https://script.google.com) (or open your Google Sheet from Step 1 and click **Extensions > Apps Script**).
2. Click **Project Settings** (gear icon on the left sidebar) and check **Show "appsscript.json" manifest file in editor**.
3. Return to the **Editor** (`< >` icon):
   - Replace the contents of `appsscript.json` with the contents of [`appscript.json`](appscript.json).
   - For each `.gs` file in this repository (`Config.gs`, `Database.gs`, `Model.gs`, `Repositories.gs`, `Services.gs`, `Controller.gs`, `Code.gs`), click **+ > Script** in the Apps Script editor, name the file without the `.gs` extension, and paste its contents.
   - For each `.html` file (`Index.html`, `Styles.html`, `Navbar.html`, `PageStudent.html`, `PageCounselor.html`, `Modals.html`, `ClientState.html`, `ClientStudent.html`, `ClientCounselor.html`), click **+ > HTML**, name the file without the `.html` extension, and paste its contents.

> **Important Note**: Check that none of the required files (`Model.gs`, `Navbar.html`, `ClientCounselor.html`) are empty before deploying. If any file was committed as a 0-byte placeholder, populate its implementation before pushing.

---

### Step 3: Configure `Config.gs`

Open [`Config.gs`](Config.gs) and update `APP_CONFIG`:

```javascript
const APP_CONFIG = {
  SPREADSHEET_ID: 'PASTE_YOUR_SPREADSHEET_ID_HERE', // From Step 1
  ALLOWED_DOMAIN: '', // Optional: e.g. 'ipeka.sch.id' to restrict login domain, or leave '' for any Google account
  CANONICAL_URL: ''   // Optional: Paste the Web App /exec URL after first deployment
};
```

If using `clasp`, push your updated configuration:
```bash
clasp push
```

---

### Step 4: Enable Advanced Services (Calendar & Sheets API)

Because `appsscript.json` declares `Calendar v3` and `Sheets v4` under `enabledAdvancedServices`, verify they are enabled:
1. Open the project in the [Apps Script Editor](https://script.google.com).
2. In the left sidebar next to **Services**, verify that **Google Calendar API** (`Calendar`) and **Google Sheets API** (`Sheets`) appear.
3. If they do not appear automatically, click **+ Add a service**, select **Google Calendar API** (Identifier: `Calendar`) and **Google Sheets API** (Identifier: `Sheets`), and click **Add**.

---

### Step 5: Initialize the Database Schema (`setupDatabase`)

The project includes an automated schema generator in [`Database.gs`](Database.gs) that creates all 13 required sheets with bold headers:
- `Users`, `Moods`, `Journals`, `Reports`, `Counselors`, `Messages`, `Appointments`, `Resources`, `MotivationalQuotes`, `EducationalArticles`, `Surveys`, `SurveyQuestions`, `SurveyResponses`

To initialize the database:
1. In the **Apps Script Editor** toolbar, open the function dropdown at the top.
2. Select **`setupDatabase`** (defined in [`Controller.gs`](Controller.gs)).
3. Click **Run**.
4. **Grant Permissions**:
   - A Google OAuth prompt will appear (`Authorization required`).
   - Click **Review permissions**, choose your Google account, click **Advanced > Go to ... (unsafe)** (if using an unverified internal/dev project), and click **Allow**.
5. Open your Google Spreadsheet from Step 1 — you will see all 13 tabs automatically created with their column headers.

#### Seed Your First Admin / Counselor Account
To access the Counselor or Admin dashboard right away, add a row to the **`Users`** sheet in your Google Spreadsheet:

| email | name | role | class | status |
| :--- | :--- | :--- | :--- | :--- |
| `your.email@gmail.com` | `Developer Admin` | `ADMIN` | `-` | `ACTIVE` |
| `counselor@gmail.com` | `Guru BK` | `COUNSELOR` | `-` | `ACTIVE` |

*(For counselors to appear in appointment booking, also add a corresponding entry in the **`Counselors`** sheet with columns: `id`, `name`, `title`, `email`, `status`, `avatar_initials`).*

---

### Step 6: Deploy as a Web App

1. In the top-right corner of the Apps Script Editor, click **Deploy > New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Fill in the deployment settings:
   - **Description**: `Initial Release v1.0`
   - **Execute as**:
     - Choose **User accessing the web app** (`USER_ACCESSING`) if deploying within a Google Workspace domain where `Session.getActiveUser().getEmail()` automatically resolves the logged-in user's email.
     - Or choose **Me** (`USER_DEPLOYING`) if external users without direct Spreadsheet edit permissions will access the app (so database reads/writes execute using the script owner's Spreadsheet permissions).
   - **Who has access**:
     - **Anyone with Google account** (or **Anyone within [Your Organization]** for school-only Workspace deployments).
4. Click **Deploy**.
5. Copy the generated **Web app URL** (`https://script.google.com/macros/s/.../exec`).
6. *(Optional)* Paste this URL into `APP_CONFIG.CANONICAL_URL` in [`Config.gs`](Config.gs).

---

### Step 7: Collaborating & Updating the Deployment with Other Developers

When multiple developers work on this project:

1. **Share Access**:
   - Share the **Google Apps Script project** and the **Google Spreadsheet** (Editor access) with your fellow developers, OR let each developer create their own isolated test Spreadsheet and set their own `SPREADSHEET_ID` in `Config.gs` for development.
2. **Pull & Push Workflow with Git + `clasp`**:
   ```bash
   # 1. Pull latest changes from GitHub
   git pull origin main

   # 2. Push changes to your Google Apps Script environment
   clasp push

   # 3. Test immediately using the Test Deployment URL (/dev)
   # In Apps Script Editor: Deploy -> Test deployments -> Web app URL (.../dev)
   ```
3. **Publishing a New Production Version**:
   - Note that `clasp push` updates the **HEAD (`/dev`)** code, not the live `/exec` Web App URL.
   - To update the live `/exec` link without changing its URL:
     1. Go to **Deploy > Manage deployments** in the Apps Script Editor.
     2. Click the **Edit** (pencil) icon on your active deployment.
     3. Under **Version**, select **New version**.
     4. Click **Deploy**.
