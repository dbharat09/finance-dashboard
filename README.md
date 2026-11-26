# Finance Dashboard (web app)

A shareable version of Bharat's Finance Dashboard: monthly budget tracking with
daily expense entry, per-category budgets with carry-over, a spending pie chart,
and a $1,500/month savings target on $6,000 income. Data lives in Firebase
(Firestore), sign-in uses Firebase Auth, and a household can be shared with a
partner through an invite code — both people see and edit the same live data.

## One-time Firebase setup (about 5 minutes)

1. Go to https://console.firebase.google.com and create a project
   (any name, e.g. `finance-dashboard`). Google Analytics is not needed.
2. In the project, open **Build → Firestore Database → Create database**
   (production mode, any region).
3. Open **Firestore Database → Rules**, paste the contents of
   `firestore.rules` from this repo, and click **Publish**.
4. Open **Build → Authentication → Get started**, and enable
   **Email/Password** sign-in.
5. Open **Project settings (gear) → General → Your apps → Web (`</>`)**,
   register the app (no hosting needed), and copy the `firebaseConfig` values.
6. Paste those values into `firebase-config.js` in this repo and commit/push
   (or send them to Muse and it will push the update).
7. Open the GitHub Pages link, create an account, then tap
   **Create my household**. The dashboard shows an **invite code** — give that
   code to your partner. They open the same link, create their own account,
   and choose **Join household** with the code. From then on you both see the
   same expenses, live.

## Notes

- The Firebase web config in `firebase-config.js` is not a secret; security
  comes from Firebase Auth plus the Firestore rules, which limit every
  household's data to its members.
- Anyone with the Pages link sees only a sign-in screen unless they have an
  account AND your invite code.
- The plan defaults: income $6,000, savings target $1,500, categories —
  Housing/Rent $2,426, Groceries $775, Utilities & Internet $225, Dining Out
  $200, Shopping $250, Health & Medical $100, Subscriptions $75, Personal
  Care $75, Entertainment $100, Travel $150, Buffer/Miscellaneous $124.
  Everything is editable in the app under "Monthly plan & budgets".
