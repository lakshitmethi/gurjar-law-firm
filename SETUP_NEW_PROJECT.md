# Gurjar Law Firm & Associates — separate setup

This ZIP is a separate copy of the interface and application code. It contains no exported Firebase Auth users, Firestore documents, cases, clients, or gallery uploads. The previous firm's Firebase identifiers and default deployment project were removed. Do not use its Firebase project or existing hosting site.

## 1. Create a new Firebase project

1. The new Firebase Web app configuration for project `gurjar-law-firm` is already set in `js/firebase-config.js`. Never replace it with the previous firm's project ID.
2. Enable Authentication > Sign-in method > Email/Password. Create a Cloud Firestore database in the new project.
3. Publish this ZIP's `firestore.rules` and `firestore.indexes.json` to the **new** project. From this extracted folder, an authenticated Firebase CLI can run `firebase deploy --only firestore:rules,firestore:indexes --project gurjar-law-firm`. Check the project ID before confirming. For gallery photos stored as Firestore data URLs, apply the `imageUrl` single-field index exemption described in `GALLERY_SETUP.md` if the provided indexes configuration does not already cover it.
4. In Authentication > Users, add **anjugurjar06@gmail.com** with the passcode supplied by the owner. Copy the new account's UID. Do not store a password in JS, Firestore, a repo, or this document.
5. In the *new* Firestore database, create `users/{AUTH_UID}` where `{AUTH_UID}` is exactly the UID copied above, not a random document ID. Fields: `uid` (string, same UID), `name` (string, `Anju Gurjar`), `email` (string, `anjugurjar06@gmail.com`), `loginId` (string, `anjugurjar@admin`), `role` (string, `superadmin`), `active` (boolean, `true`), `locked` (boolean, `false`). Create this initial profile using the Firebase Console or trusted Admin SDK; browser clients are deliberately not allowed to grant themselves superadmin access.
6. The login form accepts `anjugurjar@admin` and maps it to the real Firebase Auth email. No public `loginIds` document is needed for this superadmin alias. For other users, use User Management after signing in.
7. In Authentication > Settings > Authorized domains, add only the domain of the new deployment as needed. Publish the site to a **new** hosting site; do not reuse any old deployment, domain, repository, or project.

## Test locally and deploy separately

Serve the extracted directory over HTTP, for example `python3 -m http.server 8000`, then open `http://localhost:8000`. Check the public landing page, Login to Portal button, logo, phone/WhatsApp links, and login after the new Firebase setup. Add one new test user/case/gallery photo, verify role access and persistence in the **new** project, then remove the test records if desired. A `file://` URL cannot reliably run the ES modules.

To create a new GitHub repository, create an empty repository under a new name, upload only this extracted folder, and verify `js/firebase-config.js` contains only the **new** project's public web configuration. Connect the **new** repository to a new Netlify/Vercel site (publish directory: project root), or deploy to a new Firebase Hosting site with an explicit `--project YOUR_NEW_FIREBASE_PROJECT_ID`. The old live site and its repository remain separate.

## Details to confirm

The supplied contact phone is 9636170062 and the supplied public email is anjugurjar06@gmail.com. The former firm's related companies were removed from default About Us content; add new related firms through the new portal if applicable. The submitted logo is a JPEG with a white background, so it is displayed as provided. Confirm the legal text in `terms.html` and `privacy.html` with the new firm's owner before going live.
