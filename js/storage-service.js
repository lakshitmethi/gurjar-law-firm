// Gallery images are persisted in Firestore; Firebase Storage is not used.
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { addGalleryItem, deleteGalleryDoc, updateGalleryItem } from "./firestore-service.js";

export const MAX_GALLERY_IMAGE_BYTES = 200 * 1024;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

function withDeadline(promise, message, milliseconds = 30000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

async function requireSuperAdmin() {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("You are offline. Connect to the internet before saving photos.");
  const snapshot = await withDeadline(
    getDocFromServer(doc(db, "users", auth.currentUser.uid)),
    "Could not verify your account. Check your connection and try again."
  );
  const profile = snapshot.exists() ? snapshot.data() : null;
  if (!profile || profile.role !== "superadmin" || profile.active !== true) {
    throw new Error("Only the active Super Admin can manage gallery photos.");
  }
  return auth.currentUser.uid;
}

function photoTitle(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 120) throw new Error("Enter a photo title between 1 and 120 characters.");
  return name;
}

// Keep JPEG bytes below 200 KiB; base64 is then below 280,000 characters.
export async function optimizeImageBeforeUpload(file, maxDimension = 1200) {
  if (!file || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, WebP or GIF image.");
  }
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error("Choose an image smaller than 15 MB.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await withDeadline(new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("This image cannot be opened. Try a JPG or PNG."));
      image.src = url;
    }), "Image processing timed out. Try a smaller image.");
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Image dimensions are invalid.");
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (let sizeAttempt = 0; sizeAttempt < 6; sizeAttempt++) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser cannot process photos.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.82, 0.65, 0.48]) {
        const blob = await withDeadline(new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality)), "Photo compression timed out.");
        if (!blob) throw new Error("Photo compression failed.");
        if (blob.size <= MAX_GALLERY_IMAGE_BYTES) return blob;
      }
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }
    throw new Error("This photo is too large after compression. Please choose a smaller image.");
  } finally {
    image.onload = image.onerror = null;
    URL.revokeObjectURL(url);
  }
}

async function toImageDataUrl(file) {
  const blob = await optimizeImageBeforeUpload(file);
  const result = await withDeadline(new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the compressed photo."));
    reader.readAsDataURL(blob);
  }), "Could not finish reading the photo.");
  if (typeof result !== "string" || !result.startsWith("data:image/jpeg;base64,") || result.length > 280000) {
    throw new Error("The compressed image is too large to save.");
  }
  return result;
}

const SAVE_TIMEOUT = "Save confirmation timed out. The write may still complete when the connection returns. Refresh the gallery before retrying.";

export async function uploadGalleryPhoto(file, photoName, order = 0) {
  const uid = await requireSuperAdmin();
  const name = photoTitle(photoName);
  const imageUrl = await toImageDataUrl(file);
  const record = {
    name, imageUrl, storageType: "firestore", storagePath: "",
    order: Number.isFinite(order) ? order : 0
  };
  const id = await withDeadline(addGalleryItem(record, uid), SAVE_TIMEOUT);
  return { id, ...record };
}

export async function editGalleryPhoto(photoId, newName, newFile = null) {
  await requireSuperAdmin();
  const update = { name: photoTitle(newName) };
  if (newFile) {
    update.imageUrl = await toImageDataUrl(newFile);
    update.storageType = "firestore";
    update.storagePath = "";
  }
  await withDeadline(updateGalleryItem(photoId, update), SAVE_TIMEOUT);
}

export async function deleteGalleryPhoto(photoId) {
  await requireSuperAdmin();
  await withDeadline(deleteGalleryDoc(photoId), SAVE_TIMEOUT);
}
// Old Storage-backed photos still render through their saved URL. Re-upload
// them to migrate. Legacy Storage objects are not deleted by this service.
