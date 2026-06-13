# FormVault 🔑

FormVault is a secure, cross-platform form-filling ecosystem designed to manage your credentials, contact templates, and college details in one place, sync them across devices, and share them securely with friends.

The system consists of three modules:
1. **FormVault Server** (`server/`): An Express API server supporting custom JWT auth and MongoDB/Firebase integration (with a zero-configuration local SQLite database fallback).
2. **FormVault Web Dashboard** (`web-app/`): A modern React.js single-page application built with Vite, allowing users to register accounts, edit dynamic profiles (Name, Email, College details), and share profiles by email.
3. **FormVault Extension** (`extension/`): A Manifest V3 browser extension that caches profile data, enforces a 24-hour offline security invalidation rule, and overlays autofill trigger buttons onto inputs (specifically optimized for Google Forms' ARIA structure).

---

## Getting Started

### 1. Run the Backend API Server (`server/`)
The backend is configured to use **Firebase Firestore** if environment variables are provided, otherwise it automatically falls back to a local **SQLite** database (`server/formvault.db`).

1. Open your terminal and navigate to the server folder:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
   *The server will run on `http://localhost:5000`.*

#### Production Database Setup (Optional - Firebase Firestore)
To connect to Firebase Firestore when hosting on Render:
1. Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
2. Create a Firestore Database in production mode.
3. Go to **Project Settings** > **Service Accounts** > Generate new private key (downloads a JSON file).
4. Define these environment variables on your Render dashboard:
   - `FIREBASE_PROJECT_ID`: The `project_id` value from the JSON.
   - `FIREBASE_CLIENT_EMAIL`: The `client_email` value from the JSON.
   - `FIREBASE_PRIVATE_KEY`: The entire `private_key` string (including headers and `\n` characters).
   - `JWT_SECRET`: A secure custom secret key.

---

### 2. Run the Web Dashboard Client (`web-app/`)
The frontend is a React application styled with glassmorphism dark-mode theme.

1. Open a new terminal window and navigate to the web-app folder:
   ```bash
   cd web-app
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   *The dashboard will be accessible at `http://localhost:5173`.*

---

### 3. Load the Web Extension (`extension/`)
The extension is fully compatible with standard Manifest V3 specifications and can be loaded on both laptop browsers (Chrome, Edge, Brave, Opera) and mobile browsers (Kiwi Browser for Android, Orion Browser for iOS/macOS).

#### On Laptop (Chrome / Edge / Brave / Opera)
1. Open your browser and navigate to the extensions page:
   - Chrome/Brave: `chrome://extensions`
   - Edge: `edge://extensions`
2. Turn on **Developer Mode** (usually a toggle in the top-right corner).
3. Click the **Load unpacked** button (top-left corner).
4. Select the `extension/` directory from this project folder.
5. Pin the **FormVault Ext** icon to your toolbar.

#### On Phone (Android - Kiwi Browser)
1. Download **Kiwi Browser** from the Google Play Store.
2. Open Kiwi and navigate to `chrome://extensions`.
3. Enable **Developer Mode**.
4. Click **+ (from .zip/.crx/user.js)** or navigate to the directory and load the unpacked extension.

---

## Features & Verification Flows

### 1. Basic Account & Profile Flow
1. Open the Web App Dashboard (`http://localhost:5173`).
2. Create an account under **Register**. Log in.
3. Click **+ New** on the sidebar to create a profile (e.g. "Personal Details").
4. Fill out the default fields (Name, Email, College details) and click **Save Changes**.

### 2. Sharing Profiles with Friends
1. Register a second account (User B, e.g. `friend@domain.com`) in the Web App.
2. Log back into User A's account. Select your profile.
3. Under **Share Profile** (right sidebar panel), enter `friend@domain.com` and click the add button. Click **Save Changes**.
4. Log into the extension as User B (`friend@domain.com`).
5. You will see User A's profile list synced, labeled with a green `Shared` tag. Clicking it allows User B to autofill forms using User A's credentials, but editing is disabled.

### 3. Form Autofill (Google Forms Optimization)
1. Navigate to any Google Form (or standard input fields).
2. Click inside any text or paragraph input.
3. A small glowing key icon (`🔑`) will appear on the right side of the field.
4. Click the key icon to open the FormVault selector dropdown.
5. Select a profile. FormVault will use `aria-label` and container header mappings to match questions (e.g. "Full name", "College Roll Number", "Email Address") and populate the inputs instantly.

### 4. 24-Hour Expiry Verification
1. To safeguard local storage when offline, the extension tracks session age.
2. When the user opens the popup or attempts to autofill, the extension computes the delta since the last successful login/sync.
3. If this delta exceeds 24 hours, the local cache is cleared and the extension switches to the **Session Expired** security screen, prompting the user to connect to the internet and authenticate.
