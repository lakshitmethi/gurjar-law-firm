# Firestore gallery setup

New gallery uploads are compressed to JPEG (at most 200 KiB) and saved as a data URL inside each Firestore gallery document. No Cloud Storage bucket or external image-host account is needed for new photos. Photos survive logout and refresh after the Firestore write is confirmed.

## Publish before testing

1. Publish the repository's firestore.rules in Firebase Console > Firestore Database > Rules.
2. In Firestore > Indexes > Single field, add an exemption for collection group gallery, field imageUrl, and disable its indexes. Do not exempt the order field.
3. Alternatively, from a checkout with Firebase CLI authentication, deploy the configuration:
   firebase deploy --only firestore:rules,firestore:indexes --project YOUR_NEW_FIREBASE_PROJECT_ID
4. Deploy the updated website through its existing hosting provider.

GitHub pushes do not publish Firebase rules or indexes automatically.

## Verify

Sign in as the active Super Admin. Upload a JPG/PNG/WebP/GIF under 15 MB with a title. A gallery document should contain storageType: firestore and an imageUrl beginning data:image/jpeg;base64,. Refresh and sign back in to confirm it persists. Test a normal admin account: photo management controls should be absent and gallery writes should be denied by the deployed rules.

Existing Storage-backed photos retain their old URLs; re-upload those photos to migrate them. Old Storage objects are not automatically removed. GIF uploads become static JPEGs, and transparent areas become white.

This is intended for a small gallery. Firestore free storage, reads and network quotas are shared with the rest of the portal. Compression reduces image detail; this is not an original-photo archive. Keep copies of important originals.

If save confirmation times out, the pending Firestore write may still complete after reconnection. Refresh the gallery before retrying. Access rules and live uploads must be verified in your Firebase project after deployment.

## Validation performed

JavaScript syntax checks and local tests using a native Canvas implementation and mocked Firestore adapters passed: compression of a roughly 10 MB noise image below 200 KiB; valid data URL size; save/edit/delete operations; preserving photo data during rename; rejecting non-superadmin mutations and invalid images; releasing temporary object URLs. These are not live Firebase or browser end-to-end tests.
