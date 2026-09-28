// Main Application Logic for Gurjar Law Firm & Associates
// Modular Firebase Integration - 4-Role System with Unified Auth
import { 
  loginUser, 
  logoutUser, 
  subscribeAuthState, 
  createAccountByAdmin,
  formatAuthErrorMessage,
  deleteLoginIdEntry,
  sendAccountPasswordReset,
  saveUserDetailsWithLoginId
} from "./auth.js";
import { 
  BASE_CASE_FIELDS,
  DEFAULT_ABOUT,
  DEFAULT_FIRMS,
  DEFAULT_TILE_SETTINGS,
  defaultTableSettings,
  subscribeCases,
  addCase,
  updateCase,
  deleteCase,
  resequenceCasesInFirestore,
  subscribeUsers,
  repairLegacyUserProfiles,
  updateUserProfile,
  toggleUserActive,
  toggleUserLock,
  deleteUserProfile,
  subscribeSettingsDoc,
  saveSettingsDoc,
  subscribeGallery,
  reorderGalleryItems,
  seedInitialFirestoreData,
  getLoginIdEntry
} from "./firestore-service.js";
import { 
  uploadGalleryPhoto, 
  editGalleryPhoto, 
  deleteGalleryPhoto 
} from "./storage-service.js";

// ==========================================
// APPLICATION STATE
// ==========================================
export let currentUser = { id: "guest", name: "Visitor", role: "guest", active: true };

let stateCases = [];
let stateUsers = [];
let stateGallery = [];
let stateAbout = DEFAULT_ABOUT;
let stateFirms = DEFAULT_FIRMS;
let stateTileSettings = DEFAULT_TILE_SETTINGS;
let stateTableSettings = defaultTableSettings();

let unsubCases = null;
let unsubUsers = null;
let unsubGallery = null;
let unsubAbout = null;
let unsubFirms = null;
let unsubTiles = null;
let unsubTable = null;

// DOM Helper
const $ = (id) => document.getElementById(id);

// ==========================================
// ROLE & PERMISSION HELPERS
// ==========================================
export function isSuperAdmin() {
  return currentUser && currentUser.role === "superadmin";
}

export function isPrivileged() {
  return currentUser && (currentUser.role === "superadmin" || currentUser.role === "admin");
}

export function hasPermission(permissionKey) {
  if (!currentUser || currentUser.active !== true) return false;
  if (currentUser.role === "superadmin") return true;
  if (currentUser.role === "admin") {
    if (!permissionKey) return true;
    if (currentUser.permissions && typeof currentUser.permissions[permissionKey] === "boolean") {
      return currentUser.permissions[permissionKey];
    }
    return true; // default admin access
  }
  return false;
}

// ==========================================
// STRING & DATE UTILITIES
// ==========================================
export function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

export function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizedResult(c) {
  return String(c?.result || "").trim().toLowerCase();
}

export function isDisposedCase(c) {
  const r = normalizedResult(c);
  return ["grant", "granted", "dismiss", "dismissed", "withdraw", "withdrawn", "dispose", "disposed", "return", "returned"].some(x => r === x || r.includes(x));
}

export function isActiveCase(c) {
  const r = normalizedResult(c);
  if (!r) return true; // Blank Case Result is considered Pending
  if (isDisposedCase(c)) return false;
  return ["pending", "ongoing", "running"].some(x => r === x || r.includes(x));
}

// Case status badge helper
function getStatusBadge(result) {
  if (isDisposedCase({ result })) {
    return `<span class="badge" style="background:#fef3f2;color:#b42318;border:1px solid #fecdca">${escapeHtml(result || "Disposed")}</span>`;
  }
  return `<span class="badge" style="background:#ecfdf3;color:#027a48;border:1px solid #a6f4c5">${escapeHtml(result || "Pending")}</span>`;
}

// Button loading state manager
function setButtonLoading(btn, isLoading, loadingText = "Please wait...") {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid #ffffff66;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite;margin-right:6px;vertical-align:middle"></span>${loadingText}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.origText) {
      btn.innerHTML = btn.dataset.origText;
    }
  }
}

// Non-blocking in-app notifications. Keeping this function named `alert`
// upgrades the existing call sites without browser modal popups freezing the UI.
function alert(message) {
  const oldToast = document.getElementById("appToast");
  if (oldToast) oldToast.remove();
  const toast = document.createElement("div");
  toast.id = "appToast";
  toast.className = "app-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = String(message || "Done");
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 250);
  }, 4500);
}

// ==========================================
// NAVIGATION & PAGE ROUTING
// ==========================================
export function showPublicHome() {
  currentUser = { id: "guest", name: "Visitor", role: "guest", active: true };
  cleanupListeners();
  
  $("loginPage")?.classList.add("hidden");
  $("appPage")?.classList.add("hidden");
  $("publicHome")?.classList.remove("hidden");
  closeModal();
}

export function displayAuthError(error) {
  const msg = typeof error === "string" ? error : formatAuthErrorMessage(error);
  console.error("Auth Notice:", msg, error);

  const alertEl = $("authAlert");
  if (alertEl) {
    alertEl.innerHTML = `<strong>Notice:</strong> ${escapeHtml(msg)}`;
    alertEl.classList.remove("hidden");
  }
}

export function clearAuthError() {
  const alertEl = $("authAlert");
  if (alertEl) {
    alertEl.textContent = "";
    alertEl.classList.add("hidden");
  }
}

export function openLogin() {
  $("publicHome")?.classList.add("hidden");
  $("appPage")?.classList.add("hidden");
  $("loginPage")?.classList.remove("hidden");
  
  clearAuthError();
  const idInp = $("loginId");
  const pwInp = $("password");
  if (idInp) idInp.value = "";
  if (pwInp) pwInp.value = "";
  if (idInp) idInp.focus();
}

export function showApp() {
  const validRoles = ["superadmin", "admin", "associate", "client"];
  if (!currentUser || !validRoles.includes(currentUser.role) || currentUser.active !== true) {
    showPublicHome();
    return;
  }
  if ((currentUser.role === "client" || currentUser.role === "associate") && currentUser.locked === true) {
    showPublicHome();
    return;
  }

  $("publicHome")?.classList.add("hidden");
  $("loginPage")?.classList.add("hidden");
  $("appPage")?.classList.remove("hidden");
  
  const roleDisplay = currentUser.role === "superadmin" ? "SUPER ADMIN" : currentUser.role.toUpperCase();
  $("roleLabel").textContent = (currentUser.role === "superadmin" ? "Super Admin" : currentUser.role) + " portal";
  $("userPill").textContent = `${currentUser.name || "User"} • ${roleDisplay}`;
  
  // Clear data from the previous signed-in account before starting
  // role-scoped Firestore listeners. This prevents a client from briefly
  // inheriting the Super Admin's in-memory case list after account switching.
  cleanupListeners();
  stateCases = [];
  stateUsers = [];
  stateGallery = [];

  buildNav();
  initRealtimeSubscriptions();
  render("dashboard");
}

export function buildNav() {
  let items = [];
  if (currentUser.role === "guest") {
    items = [["dashboard", "▦ Dashboard"]];
  } else {
    items = [
      ["dashboard", "▦ Dashboard"],
      ["about", "◉ About Us"],
      ["cases", "▤ Cases"]
    ];
    if (isPrivileged()) {
      if (hasPermission("canManageTiles")) {
        items.push(["tileSettings", "▦ Tile Settings"]);
      }
      if (hasPermission("canEditUsers") || hasPermission("canAddAssociate") || hasPermission("canAddClient") || isSuperAdmin()) {
        items.push(["users", "♙ User Management"]);
      }
    }
  }

  const nav = $("nav");
  nav.innerHTML = "";
  items.forEach(([id, title]) => {
    const btn = document.createElement("button");
    btn.dataset.page = id;
    btn.innerHTML = `<span>${title}</span>`;
    btn.type = "button";
    btn.title = title.replace(/^[^A-Za-z]+/, "");
    btn.setAttribute("aria-label", btn.title);
    btn.onclick = () => render(id);
    nav.appendChild(btn);
  });
}

export function render(page) {
  document.querySelectorAll("#nav button").forEach(b => {
    b.classList.toggle("active", b.dataset.page === page);
  });

  const titles = {
    dashboard: "Dashboard",
    about: "About Us",
    cases: "Case Records",
    tileSettings: "Tile Settings",
    users: "User Management"
  };
  $("pageTitle").textContent = titles[page] || page[0].toUpperCase() + page.slice(1);

  if (page === "dashboard") dashboard();
  else if (page === "about") aboutPage();
  else if (page === "cases") casePage();
  else if (page === "tileSettings") tileSettingsPage();
  else if (page === "users") userPage();
}

function getCurrentPage() {
  const activeBtn = document.querySelector("#nav button.active");
  return activeBtn ? activeBtn.dataset.page : "dashboard";
}

// ==========================================
// REAL-TIME FIRESTORE SUBSCRIPTIONS
// ==========================================
function cleanupListeners() {
  if (unsubCases) { unsubCases(); unsubCases = null; }
  if (unsubUsers) { unsubUsers(); unsubUsers = null; }
  if (unsubGallery) { unsubGallery(); unsubGallery = null; }
  if (unsubAbout) { unsubAbout(); unsubAbout = null; }
  if (unsubFirms) { unsubFirms(); unsubFirms = null; }
  if (unsubTiles) { unsubTiles(); unsubTiles = null; }
  if (unsubTable) { unsubTable(); unsubTable = null; }
}

function initRealtimeSubscriptions() {
  cleanupListeners();

  // 1. Cases Subscription
  const subscriptionUser = {
    ...currentUser,
    uid: String(currentUser?.uid || "").trim(),
    role: String(currentUser?.role || "").trim().toLowerCase()
  };

  // Never let a client render data from a stale/broad subscription.
  // A valid Firebase Auth UID is mandatory for client case access.
  if (subscriptionUser.role === "client" && !subscriptionUser.uid) {
    stateCases = [];
    console.error("Client case subscription blocked: missing authenticated UID.");
    return;
  }

  unsubCases = subscribeCases(subscriptionUser, (cases) => {
    // subscribeCases already enforces the authenticated Firebase UID for clients.
    // Do not apply a second profile-derived UID filter here.
    stateCases = cases;
    const page = getCurrentPage();
    if (page === "dashboard") dashboard();
    else if (page === "cases") casePage();
  }, (err) => {
    console.error("Cases sync error:", err);
    if (subscriptionUser.role === "client") {
      const code = String(err?.code || "unknown");
      const message = String(err?.message || "Unable to load assigned cases.");
      showToast(`Case sync failed [${code}]: ${message}`);
      const content = $("content");
      if (content && getCurrentPage() === "cases") {
        content.innerHTML = `
          <div class="panel">
            <div class="panel-head"><h3>Case Records</h3></div>
            <div style="padding:24px">
              <strong>Assigned cases could not be loaded.</strong>
              <div style="margin-top:8px">Error: ${escapeHtml(code)}</div>
              <div style="margin-top:8px">Auth UID: ${escapeHtml(subscriptionUser.uid)}</div>
            </div>
          </div>`;
      }
    }
  });

  // 2. Settings: About Us
  unsubAbout = subscribeSettingsDoc("about", DEFAULT_ABOUT, (data) => {
    stateAbout = data;
    if (getCurrentPage() === "about") aboutPage();
  });

  // 3. Settings: Other Firms
  unsubFirms = subscribeSettingsDoc("firms", DEFAULT_FIRMS, (data) => {
    stateFirms = data;
    if (getCurrentPage() === "about") aboutPage();
  });

  // 4. Settings: Tile Settings
  unsubTiles = subscribeSettingsDoc("tileSettings", DEFAULT_TILE_SETTINGS, (data) => {
    stateTileSettings = Object.assign({}, DEFAULT_TILE_SETTINGS, data);
    if (getCurrentPage() === "dashboard") dashboard();
    else if (getCurrentPage() === "tileSettings") tileSettingsPage();
  });

  // 5. Settings: Table Settings
  unsubTable = subscribeSettingsDoc("tableSettings", { list: defaultTableSettings() }, (data) => {
    stateTableSettings = Array.isArray(data?.list) && data.list.length ? data.list : defaultTableSettings();
    if (getCurrentPage() === "cases") casePage();
  });

  // 6. Gallery Subscription
  unsubGallery = subscribeGallery((galleryItems) => {
    stateGallery = galleryItems;
    if (getCurrentPage() === "dashboard") dashboard();
  });

  // 7. Users Subscription (Super Admin and Admin)
  if (isPrivileged()) {
    let repairingLegacyUsers = false;
    unsubUsers = subscribeUsers(async (users) => {
      stateUsers = users;

      // Old accounts created before UID-keyed profiles are migrated once by
      // the Super Admin. Firestore client rules require users/{auth.uid}.
      if (isSuperAdmin() && !repairingLegacyUsers &&
          users.some(u => u.firestoreDocId && u.uid && u.firestoreDocId !== u.uid)) {
        repairingLegacyUsers = true;
        try {
          await repairLegacyUserProfiles(users);
        } catch (err) {
          console.error("Legacy user UID migration failed:", err);
        } finally {
          repairingLegacyUsers = false;
        }
      }

      if (getCurrentPage() === "users") userPage();
    });
  }
}

// ==========================================
// TILE & TABLE SETTINGS HELPERS
// ==========================================
function getTileSettings() {
  return stateTileSettings || DEFAULT_TILE_SETTINGS;
}

function tileVisible(key) {
  const t = getTileSettings()[key];
  if (!t || t.enabled === false || !Array.isArray(t.roles)) return false;
  if (currentUser.role === "superadmin") return true;
  return t.roles.includes(currentUser.role);
}

function getTableSettings() {
  return stateTableSettings || defaultTableSettings();
}

function fieldsForRole() {
  return getTableSettings()
    .filter(x => Array.isArray(x.roles) && (x.roles.includes(currentUser.role) || (isSuperAdmin() && x.roles.includes("admin"))))
    .map(x => [x.key, x.label, x.custom]);
}

function allCaseFields() {
  return getTableSettings().map(x => [x.key, x.label, x.custom]);
}

// ==========================================
// DASHBOARD
// ==========================================
export function dashboard() {
  const cs = stateCases;
  const ts = getTileSettings();
  const due = cs.reduce((total, c) => {
    const raw = String(c.due ?? "").trim();
    if (!raw) return total;
    // Accept currency symbols and Indian comma grouping in saved fee values.
    const amount = Number(raw.replace(/[₹,\s]/g, ""));
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  // Tomorrow calculation
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = localDateKey(tomorrow);
  const tomorrowCases = cs.filter(c => String(c.nextDate || "").slice(0, 10) === tomorrowKey);
  const tomorrowCount = tomorrowCases.length;

  // Upcoming dates calculation
  const todayKey = localDateKey(new Date());
  const upcomingCases = cs.filter(c => {
    const nd = String(c.nextDate || "").slice(0, 10);
    return nd && nd >= todayKey;
  });

  const activeCount = cs.filter(isActiveCase).length;
  const disposedCount = cs.filter(isDisposedCase).length;

  const stats = [];
  if (tileVisible("total")) {
    stats.push(`<div class="stat"><small>${escapeHtml(ts.total?.label || "Total Cases")}</small><strong>${cs.length}</strong></div>`);
  }
  if (tileVisible("active")) {
    stats.push(`<div class="stat"><small>${escapeHtml(ts.active?.label || "Active Cases")}</small><strong>${activeCount}</strong></div>`);
  }
  if (tileVisible("disposed")) {
    stats.push(`<div class="stat"><small>${escapeHtml(ts.disposed?.label || "Disposed Cases")}</small><strong>${disposedCount}</strong></div>`);
  }
  if (tileVisible("tomorrow")) {
    stats.push(`<div class="stat"><small>${escapeHtml(ts.tomorrow?.label || "Tomorrow's Cases")}</small><strong>${tomorrowCount ? `${tomorrowCount} Case${tomorrowCount === 1 ? "" : "s"}` : "No Case Scheduled"}</strong></div>`);
  }
  if (tileVisible("upcoming")) {
    stats.push(`<div class="stat"><small>${escapeHtml(ts.upcoming?.label || "Upcoming Dates")}</small><strong>${upcomingCases.length ? `${upcomingCases.length} Hearing${upcomingCases.length === 1 ? "" : "s"}` : "None"}</strong></div>`);
  }
  if (tileVisible("summary")) {
    const summaryVal = isPrivileged()
      ? `₹${due.toLocaleString("en-IN")}` 
      : `${cs.filter(c => c.result).length} Decided`;
    stats.push(`<div class="stat"><small>${escapeHtml(ts.summary?.label || "Fees Due / Case Results")}</small><strong>${summaryVal}</strong></div>`);
  }

  for (const tile of (Array.isArray(ts.customTiles) ? ts.customTiles : [])) {
    if (tile && tile.enabled !== false && Array.isArray(tile.roles) && (isSuperAdmin() || tile.roles.includes(currentUser.role))) {
      stats.push(`<div class="stat"><small>${escapeHtml(tile.label || "Custom Tile")}</small><strong>${escapeHtml(tile.value || "—")}</strong></div>`);
    }
  }

  const roleBadge = isSuperAdmin() 
    ? `<span class="badge" style="background:#5b0b16;color:#fff;letter-spacing:1px">SUPER ADMIN</span>`
    : `<span class="badge" style="background:#5b0b16;color:#fff">${currentUser.role.toUpperCase()}</span>`;

  $("content").innerHTML = `
    ${stats.length ? `<div class="stats">${stats.join("")}</div>` : ""}
    <div class="panel">
      <div class="panel-head">
        <h3>Welcome to Gurjar Law Firm &amp; Associates</h3>
        ${roleBadge}
      </div>
      <p class="muted">A secure and organized workspace for managing cases, scheduled hearing dates, client updates, and advocate workflow.</p>
    </div>
    ${renderGallery()}
  `;
}

// ==========================================
// PHOTO GALLERY
// ==========================================
export function renderGallery() {
  const g = stateGallery;
  const canManage = isSuperAdmin() && currentUser.active === true;

  return `
    <div class="panel gallery-panel">
      <div class="gallery-head">
        <div>
          <h3>Photo Gallery</h3>
          <div class="muted" style="margin-top:4px">Our people, moments &amp; legal journey</div>
        </div>
        ${canManage ? `<button class="btn primary" type="button" id="btnAddGalleryPhoto">+ Add Photo</button>` : ""}
      </div>
      ${g.length ? `
        <div class="gallery-grid">
          ${g.map((x, i) => `
            <div class="gallery-card">
              <img class="gallery-photo" src="${escapeHtml(x.imageUrl)}" alt="${escapeHtml(x.name || 'Gallery photo')}" loading="lazy">
              <div class="gallery-name">${escapeHtml(x.name || 'Untitled')}</div>
              ${canManage ? `
                <div class="gallery-admin">
                  <button class="btn" type="button" data-gallery-move="${i}" data-dir="-1">←</button>
                  <button class="btn" type="button" data-gallery-edit="${i}">Edit</button>
                  <button class="danger" type="button" data-gallery-delete="${i}">Delete</button>
                  <button class="btn" type="button" data-gallery-move="${i}" data-dir="1">→</button>
                </div>
              ` : ""}
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="gallery-empty">
          ${canManage ? 'No photos added yet. Click <b>+ Add Photo</b> to upload a photo to the gallery.' : 'No gallery photos added yet.'}
        </div>
      `}
    </div>
  `;
}

// Gallery button event delegation
document.addEventListener("click", async (e) => {
  if (e.target.id === "btnAddGalleryPhoto") {
    openGalleryEditor();
  }
  const editBtn = e.target.closest("[data-gallery-edit]");
  if (editBtn) {
    const idx = parseInt(editBtn.dataset.galleryEdit, 10);
    editGalleryItem(idx);
  }
  const delBtn = e.target.closest("[data-gallery-delete]");
  if (delBtn) {
    const idx = parseInt(delBtn.dataset.galleryDelete, 10);
    deleteGalleryItem(idx);
  }
  const moveBtn = e.target.closest("[data-gallery-move]");
  if (moveBtn) {
    const idx = parseInt(moveBtn.dataset.galleryMove, 10);
    const dir = parseInt(moveBtn.dataset.dir, 10);
    moveGalleryItem(idx, dir);
  }
});

export function openGalleryEditor() {
  if (!isSuperAdmin() || currentUser.active !== true) return;
  $("modalTitle").textContent = "Add Gallery Photo";
  $("caseForm").innerHTML = `
    <div class="form-grid">
      <label class="span2">Photo Name / Title
        <input id="galleryName" type="text" placeholder="e.g. Advocate Team / High Court Campus / Office Conference" maxlength="120" required>
      </label>
      <label class="span2">Select Photo
        <input id="galleryFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required>
      </label>
      <div class="span2">
        <img id="galleryPreview" class="gallery-file-preview hidden" alt="Preview">
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="secondary" id="btnCancelGallery">Cancel</button>
      <button class="primary" type="submit" id="btnSubmitGallery">Upload Photo</button>
    </div>
  `;
  $("modal").classList.remove("hidden");
  $("btnCancelGallery").onclick = closeModal;

  $("galleryFile").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const im = $("galleryPreview");
      im.src = ev.target.result;
      im.classList.remove("hidden");
    };
    reader.readAsDataURL(f);
  };

  $("caseForm").onsubmit = async (e) => {
    e.preventDefault();
    const file = $("galleryFile").files[0];
    const name = $("galleryName").value.trim();
    if (!file) return alert("Please select an image file to upload.");

    const submitBtn = $("btnSubmitGallery");
    setButtonLoading(submitBtn, true, "Compressing & saving photo...");

    try {
      await uploadGalleryPhoto(file, name, stateGallery.length, currentUser.uid);
      closeModal();
      dashboard();
    } catch (err) {
      alert("Failed to upload photo: " + (err.message || "Unknown error. Check internet connection."));
    } finally {
      setButtonLoading(submitBtn, false);
    }
  };
}

export function editGalleryItem(i) {
  if (!isSuperAdmin() || currentUser.active !== true) return;
  const x = stateGallery[i];
  if (!x) return;

  $("modalTitle").textContent = "Edit Gallery Photo";
  $("caseForm").innerHTML = `
    <div class="form-grid">
      <label class="span2">Photo Name / Title
        <input id="galleryName" type="text" value="${escapeHtml(x.name || '')}" maxlength="120" required>
      </label>
      <label class="span2">Replace Photo (Optional)
        <input id="galleryFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
      </label>
      <div class="span2">
        <img id="galleryPreview" class="gallery-file-preview" src="${escapeHtml(x.imageUrl)}" alt="Preview">
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="secondary" id="btnCancelGallery">Cancel</button>
      <button class="primary" type="submit" id="btnSubmitGallery">Save Changes</button>
    </div>
  `;
  $("modal").classList.remove("hidden");
  $("btnCancelGallery").onclick = closeModal;

  $("galleryFile").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      $("galleryPreview").src = ev.target.result;
    };
    reader.readAsDataURL(f);
  };

  $("caseForm").onsubmit = async (e) => {
    e.preventDefault();
    const newName = $("galleryName").value.trim();
    const replaceFile = $("galleryFile").files[0] || null;

    const submitBtn = $("btnSubmitGallery");
    setButtonLoading(submitBtn, true, "Saving...");

    try {
      await editGalleryPhoto(x.id, newName, replaceFile, x.storagePath, currentUser.uid);
      closeModal();
      dashboard();
    } catch (err) {
      alert("Failed to update photo: " + (err.message || "Unknown error."));
    } finally {
      setButtonLoading(submitBtn, false);
    }
  };
}

export async function deleteGalleryItem(i) {
  if (!isSuperAdmin() || currentUser.active !== true) return;
  const x = stateGallery[i];
  if (!x) return;
  if (!confirm(`Are you sure you want to delete '${x.name || "this photo"}' from the gallery?`)) return;

  try {
    await deleteGalleryPhoto(x.id, x.storagePath);
    dashboard();
  } catch (err) {
    alert("Failed to delete gallery item: " + err.message);
  }
}

export async function moveGalleryItem(i, d) {
  if (!isSuperAdmin() || currentUser.active !== true) return;
  const list = [...stateGallery];
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  
  [list[i], list[j]] = [list[j], list[i]];
  stateGallery = list;
  dashboard();
  
  try {
    await reorderGalleryItems(list);
  } catch (err) {
    console.error("Failed to reorder gallery:", err);
  }
}

// ==========================================
// CASE RECORDS & CRUD
// ==========================================
export function casePage() {
  const cs = stateCases;
  const canEdit = isPrivileged() && hasPermission("canEditCases");
  const canManageTbl = isPrivileged() && hasPermission("canManageTable");
  const fields = fieldsForRole();

  $("content").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Case Records</h3>
        <div class="actions">
          <input id="caseSearch" class="search" placeholder="Search case, court or title...">
          ${canManageTbl ? `<button class="btn" id="btnEditTable">⚙ Edit Table</button>` : ""}
          ${canEdit ? `<button class="btn primary" id="btnAddCase">+ Add Case</button>` : ""}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${fields.map(x => `<th>${escapeHtml(x[1])}</th>`).join("")}
              ${canEdit ? `<th>Actions</th>` : ""}
            </tr>
          </thead>
          <tbody id="tbody">
            ${rows(cs, canEdit)}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $("caseSearch").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = cs.filter(c => Object.values(c).join(" ").toLowerCase().includes(q));
    $("tbody").innerHTML = rows(filtered, canEdit);
  };

  if (canManageTbl) {
    $("btnEditTable").onclick = openTableEditor;
  }
  if (canEdit) {
    $("btnAddCase").onclick = () => openCase(null);
  }
}

function rows(cs, canEdit) {
  const fields = fieldsForRole();
  if (!cs.length) {
    const clientDiagnostic = currentUser?.role === "client"
      ? `<div style="margin-top:8px;font-size:11px;opacity:.75">Auth UID: ${escapeHtml(String(currentUser.uid || ""))}</div>`
      : "";
    return `<tr><td colspan="${fields.length + (canEdit ? 1 : 0)}" style="text-align:center;padding:35px;color:#96767a">No records found.${clientDiagnostic}</td></tr>`;
  }

  const canDelete = isPrivileged() && hasPermission("canDeleteCases");
  const canLock = isPrivileged() && hasPermission("canLockUsers");

  return cs.map((c, i) => `
    <tr>
      ${fields.map(([k]) => {
        if (k === "paymentStatus") {
          return `<td><span class="badge ${String(c[k] || "").toLowerCase()}">${escapeHtml(c[k] || "-")}</span></td>`;
        }
        if (k === "result") {
          return `<td>${getStatusBadge(c[k])}</td>`;
        }
        return `<td>${escapeHtml(c[k] || "-")}</td>`;
      }).join("")}
      ${canEdit ? `
        <td style="white-space:nowrap">
          <button class="btn" data-case-edit="${i}">Edit</button>
          ${canDelete ? `<button class="danger" data-case-delete="${i}">Delete</button>` : ""}
          ${canLock ? `<button class="btn" data-case-lock="${i}">🔒/🔓 Client</button>` : ""}
        </td>
      ` : ""}
    </tr>
  `).join("");
}

// Case action button delegation
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest("[data-case-edit]");
  if (editBtn) {
    const idx = parseInt(editBtn.dataset.caseEdit, 10);
    openCase(idx);
  }
  const delBtn = e.target.closest("[data-case-delete]");
  if (delBtn) {
    const idx = parseInt(delBtn.dataset.caseDelete, 10);
    deleteCaseAction(idx);
  }
  const lockBtn = e.target.closest("[data-case-lock]");
  if (lockBtn) {
    const idx = parseInt(lockBtn.dataset.caseLock, 10);
    lockClientForCase(idx);
  }
});

export async function openCase(i) {
  if (!isPrivileged() || !hasPermission("canEditCases")) return;
  const isNew = (i === null || i === undefined);
  const c = isNew ? {} : stateCases[i];
  const fields = allCaseFields().filter(([k]) => k !== "sno");
  const vis = Array.isArray(c.visibleTo) ? c.visibleTo : ["admin", "associate", "client"];
  const clientUsers = stateUsers.filter(u => u.role === "client");
  const assigned = Array.isArray(c.assignedClientUids) ? c.assignedClientUids : [];

  // stateUsers.uid is the canonical users/{Auth UID} document ID.
  const clientAuthUidByProfileUid = new Map(clientUsers.map(u => [u.uid, u.uid]));

  $("modalTitle").textContent = isNew ? "Add New Case" : "Edit Case";
  $("caseForm").innerHTML = `
    <div class="form-grid">
      ${fields.map(([k, l]) => `
        <label class="${["title", "particular", "clientAddress"].includes(k) ? "span2" : ""}">
          ${escapeHtml(l)}
          <input type="${["previousDate", "nextDate", "powerFileDate", "registrationDate"].includes(k) ? "date" : "text"}" 
                 name="${escapeHtml(k)}" 
                 value="${escapeHtml(c[k] || "")}">
        </label>
      `).join("")}
    </div>

    <div class="tile-setting-card" style="margin-top:16px">
      <h4 style="margin:0 0 10px">Case Visibility</h4>
      <div class="role-checks">
        <label><input type="checkbox" checked disabled> Admin &amp; Super Admin (always)</label>
        <label><input type="checkbox" id="caseVis_associate" ${vis.includes("associate") ? "checked" : ""}> Associate</label>
        <label><input type="checkbox" id="caseVis_client" ${assigned.length ? "checked" : ""} disabled> Client (automatic when assigned)</label>
      </div>
      <div class="hint" style="margin-top:8px">Associate visibility is optional. Client visibility is automatic and only applies to the specific client account(s) selected below.</div>
    </div>

    <div class="tile-setting-card" style="margin-top:12px">
      <h4 style="margin:0 0 10px">Assign Case to Client Account</h4>
      ${clientUsers.length ? `
        <div class="role-checks">
          ${clientUsers.map(u => `
            <label>
              <input type="checkbox" class="case-client-assign" value="${escapeHtml(u.uid)}" ${(assigned.includes(clientAuthUidByProfileUid.get(u.uid)) || (Array.isArray(u.caseNos) && u.caseNos.includes(c.caseNo))) ? "checked" : ""}>
              ${escapeHtml(u.name)} (${escapeHtml(u.email || u.loginId || u.uid.slice(0, 6))})
            </label>
          `).join("")}
        </div>
      ` : `
        <div class="hint">No client accounts registered yet. You can add client users from User Management.</div>
      `}
      <div class="hint" style="margin-top:8px">Only assigned client accounts can see this case in the Client Portal when Client visibility is enabled above.</div>
    </div>

    <div class="form-actions">
      <button type="button" class="secondary" id="btnCancelCase">Cancel</button>
      <button class="primary" type="submit" id="btnSaveCase">Save Case</button>
    </div>
  `;

  $("modal").classList.remove("hidden");
  $("btnCancelCase").onclick = closeModal;

  $("caseForm").onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const d = Object.fromEntries(formData.entries());

    const selectedProfileUids = [...document.querySelectorAll(".case-client-assign:checked")].map(x => x.value);

    // users/{documentId} is keyed by Firebase Auth UID. Never override it
    // with a possibly stale loginIds mapping.
    const selectedClientUids = [...new Set(selectedProfileUids.map(uid => String(uid || "").trim()).filter(Boolean))];
    d.assignedClientUids = selectedClientUids;

    // Client access is controlled by assignment, not by a second independent visibility switch.
    const associateVisible = $("caseVis_associate")?.checked;
    d.visibleTo = ["admin", ...(associateVisible ? ["associate"] : []), ...(d.assignedClientUids.length ? ["client"] : [])];

    if (!d.clientName && selectedClientUids.length === 1) {
      const selectedProfileUid = selectedProfileUids[0];
      const cu = clientUsers.find(u => u.uid === selectedProfileUid);
      if (cu) d.clientName = cu.name;
    }

    const saveBtn = $("btnSaveCase");
    setButtonLoading(saveBtn, true, "Saving Case to Firestore...");

    try {
      if (isNew) {
        d.sno = String(stateCases.length + 1);
        await addCase(d, currentUser.uid);
      } else {
        d.sno = c.sno || String(i + 1);
        await updateCase(c.id, d);
      }

      // Sync assigned caseNos to selected client user profiles
      if (d.caseNo) {
        for (const u of clientUsers) {
          let userCaseNos = Array.isArray(u.caseNos) ? [...u.caseNos] : [];
          const shouldHave = selectedProfileUids.includes(u.uid);
          const hadOld = c.caseNo && userCaseNos.includes(c.caseNo);
          
          if (c.caseNo && c.caseNo !== d.caseNo && hadOld) {
            userCaseNos = userCaseNos.filter(no => no !== c.caseNo);
          }
          
          if (shouldHave && !userCaseNos.includes(d.caseNo)) {
            userCaseNos.push(d.caseNo);
            await updateUserProfile(u.uid, { caseNos: userCaseNos });
          } else if (!shouldHave && userCaseNos.includes(d.caseNo)) {
            userCaseNos = userCaseNos.filter(no => no !== d.caseNo);
            await updateUserProfile(u.uid, { caseNos: userCaseNos });
          }
        }
      }

      closeModal();
      casePage();
    } catch (err) {
      alert("Error saving case: " + err.message);
    } finally {
      setButtonLoading(saveBtn, false);
    }
  };
}

export async function deleteCaseAction(i) {
  if (!isPrivileged() || !hasPermission("canDeleteCases")) return;
  const c = stateCases[i];
  if (!c || !c.id) return;

  if (!confirm(`Are you sure you want to permanently delete Case No. ${c.caseNo || `S.No ${c.sno}`}?`)) {
    return;
  }

  try {
    await deleteCase(c.id);
    const remaining = stateCases.filter(x => x.id !== c.id);
    await resequenceCasesInFirestore(remaining);
    casePage();
  } catch (err) {
    alert("Error deleting case: " + err.message);
  }
}

export async function lockClientForCase(i) {
  if (!isPrivileged() || !hasPermission("canLockUsers")) return;
  const c = stateCases[i];
  if (!c) return;

  const u = stateUsers.find(x => 
    x.role === "client" && 
    ((Array.isArray(c.assignedClientUids) && c.assignedClientUids.includes(x.uid)) ||
     (Array.isArray(x.caseNos) && x.caseNos.includes(c.caseNo)))
  );

  if (!u) {
    alert("No client account assigned to this Case No. Assign a client account first via Edit Case.");
    return;
  }

  const willLock = !u.locked;
  const reason = willLock 
    ? (prompt("Enter reason for client access restriction:", "Pending fees") || "Restricted by Admin") 
    : "";

  try {
    await toggleUserLock(u.uid, u.locked, reason);
    alert(willLock ? `Client '${u.name}' has been locked.` : `Client '${u.name}' has been unlocked.`);
  } catch (err) {
    alert("Error updating client lock state: " + err.message);
  }
}

// ==========================================
// CASE TABLE EDITOR
// ==========================================
export function openTableEditor() {
  if (!isPrivileged() || !hasPermission("canManageTable")) return;
  const st = getTableSettings();

  $("modalTitle").textContent = "Edit Case Table Columns";
  $("caseForm").innerHTML = `
    <div class="table-editor-help" style="background:#fffaf8;padding:12px;border:1px solid #ead8d8;border-radius:10px;margin-bottom:14px;font-size:13px;line-height:1.5">
      <b>Table Customization:</b> Change column titles, select role visibility, and reorder with ↑ ↓ buttons.
    </div>
    <div id="tableEditorList" class="table-editor-list">${st.map((x, i) => tableFieldEditorRow(x, i)).join("")}</div>
    <div class="add-column-box" style="margin-top:16px;background:#fff;border:1px solid #ead8d8;padding:14px;border-radius:12px">
      <h4 style="margin:0 0 10px;color:#5b0b16">+ Add New Custom Column</h4>
      <div class="add-column-grid" style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end">
        <label>Column Title<input id="newColLabel" placeholder="e.g. FIR No. / Police Station"></label>
        <div>
          <div style="font-size:12px;font-weight:700;margin-bottom:7px">Who can view this?</div>
          <div class="visibility-box" style="display:flex;gap:10px">
            <label><input type="checkbox" id="newRole_admin" checked> Admin</label>
            <label><input type="checkbox" id="newRole_associate"> Associate</label>
            <label><input type="checkbox" id="newRole_client"> Client</label>
          </div>
        </div>
        <button class="btn primary" type="button" id="btnAddColumn">Add Column</button>
      </div>
    </div>
    <div class="form-actions" style="margin-top:18px">
      <button type="button" class="secondary" id="btnResetTable">Reset Default</button>
      <button type="button" class="secondary" id="btnCancelTable">Cancel</button>
      <button type="button" class="primary" id="btnSaveTable">Save Table Layout</button>
    </div>
  `;

  $("modal").classList.remove("hidden");
  $("btnCancelTable").onclick = closeModal;
  $("btnAddColumn").onclick = addCustomColumn;
  $("btnResetTable").onclick = resetTableSettings;
  $("btnSaveTable").onclick = saveTableEditor;
}

function tableFieldEditorRow(x, i) {
  return `
    <div class="table-field-row" data-key="${escapeHtml(x.key)}">
      <div>
        <b>${escapeHtml(x.label)}</b>
        <div class="field-key">${escapeHtml(x.key)} ${x.custom ? '<span class="custom-badge" style="background:#5b0b16;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px">CUSTOM</span>' : ""}</div>
      </div>
      <input class="col-label" type="text" value="${escapeHtml(x.label)}">
      <div class="visibility-box">
        ${["admin", "associate", "client"].map(r => `
          <label><input class="role-${r}" type="checkbox" ${Array.isArray(x.roles) && x.roles.includes(r) ? "checked" : ""}> ${r[0].toUpperCase() + r.slice(1)}</label>
        `).join("")}
      </div>
      <div class="order-btns">
        <button type="button" class="btn" data-tbl-move="${i}" data-dir="-1">↑</button>
        <button type="button" class="btn" data-tbl-move="${i}" data-dir="1">↓</button>
        ${x.custom ? `<button type="button" class="danger" data-tbl-remove="${escapeHtml(x.key)}">×</button>` : ""}
      </div>
    </div>
  `;
}

// Table editor row buttons
document.addEventListener("click", (e) => {
  const moveBtn = e.target.closest("[data-tbl-move]");
  if (moveBtn) {
    const idx = parseInt(moveBtn.dataset.tblMove, 10);
    const dir = parseInt(moveBtn.dataset.dir, 10);
    moveTableField(idx, dir);
  }
  const removeBtn = e.target.closest("[data-tbl-remove]");
  if (removeBtn) {
    const key = removeBtn.dataset.tblRemove;
    removeTableField(key);
  }
});

function collectTableEditor() {
  return [...document.querySelectorAll("#tableEditorList .table-field-row")].map(row => ({
    key: row.dataset.key,
    label: row.querySelector(".col-label").value.trim() || row.dataset.key,
    custom: row.querySelector(".custom-badge") != null,
    roles: [
      "superadmin",
      ...(["admin", "associate", "client"].filter(r => row.querySelector(".role-" + r).checked))
    ]
  }));
}

function moveTableField(i, dir) {
  const a = collectTableEditor();
  const j = i + dir;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  stateTableSettings = a;
  openTableEditor();
}

function removeTableField(key) {
  if (!confirm("Remove this custom column from the table? Saved data will be preserved in cases but hidden from view.")) return;
  const a = collectTableEditor().filter(x => x.key !== key);
  stateTableSettings = a;
  openTableEditor();
}

function addCustomColumn() {
  const label = $("newColLabel").value.trim();
  if (!label) return alert("Please enter a column title.");
  const a = collectTableEditor();
  const base = "custom_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || ("custom_" + Date.now());
  let key = base;
  let n = 2;
  while (a.some(x => x.key === key)) {
    key = base + "_" + n++;
  }
  const roles = ["superadmin", ...(["admin", "associate", "client"].filter(r => $("newRole_" + r).checked))];
  a.push({ key, label, custom: true, roles });
  stateTableSettings = a;
  openTableEditor();
}

async function saveTableEditor() {
  const a = collectTableEditor();
  const saveBtn = $("btnSaveTable");
  setButtonLoading(saveBtn, true, "Saving Table...");

  try {
    await saveSettingsDoc("tableSettings", { list: a });
    stateTableSettings = a;
    closeModal();
    casePage();
    alert("Case table configuration saved successfully.");
  } catch (err) {
    alert("Failed to save table settings: " + err.message);
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

async function resetTableSettings() {
  if (!confirm("Reset table columns, names, and visibility to default?")) return;
  const def = defaultTableSettings();
  try {
    await saveSettingsDoc("tableSettings", { list: def });
    stateTableSettings = def;
    openTableEditor();
  } catch (err) {
    alert("Failed to reset table: " + err.message);
  }
}

// ==========================================
// TILE SETTINGS
// ==========================================
export 
const BUILTIN_TILES = [
  ["total", "Total Cases Tile"], ["active", "Active Cases Tile"],
  ["disposed", "Disposed Cases Tile"], ["tomorrow", "Tomorrow Cases Tile"],
  ["upcoming", "Upcoming Dates Tile"], ["summary", "Fees / Results Tile"]
];

function tileSettingsPage() {
  if (!isPrivileged() || !hasPermission("canManageTiles")) return render("dashboard");
  const ts = getTileSettings();
  const customTiles = Array.isArray(ts.customTiles) ? ts.customTiles : [];
  $("content").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Dashboard Tile Settings</h3></div>
      <p class="muted">Remove a built-in tile to hide it; Add it back restores its calculation. Custom tiles show a fixed value.</p>
      <div class="tile-settings-grid">
        ${BUILTIN_TILES.map(([k, n]) => `
          <div class="tile-setting-card" data-built-in="${k}">
            <h4>${n}</h4>
            <label>Title <input id="tileLabel_${k}" maxlength="80" value="${escapeHtml(ts[k]?.label || "")}"></label>
            <label><input type="checkbox" id="tileEnabled_${k}" ${ts[k]?.enabled !== false ? "checked" : ""}> Show tile</label>
            <div class="role-checks">${["admin", "associate", "client"].map(r => `
              <label><input type="checkbox" id="tileRole_${k}_${r}" ${ts[k]?.roles?.includes(r) ? "checked" : ""}> ${r}</label>
            `).join("")}</div>
            <button type="button" class="secondary" data-remove-tile="${k}">Remove Tile</button>
          </div>
        `).join("")}
      </div>
      <h4>Custom Tiles</h4>
      <div id="customTilesEditor"></div>
      <button type="button" class="secondary" id="btnAddTile">+ Add Tile</button>
      <div class="form-actions"><button type="button" class="primary" id="btnSaveTiles">Save Tile Settings</button></div>
    </div>`;
  function addCustomTile(tile = {}) {
    const row = document.createElement("div");
    row.className = "tile-setting-card";
    row.style.marginTop = "12px";
    row.innerHTML = `
      <label>Title <input class="custom-tile-label" maxlength="80" value="${escapeHtml(tile.label || "")}" required></label>
      <label>Value <input class="custom-tile-value" maxlength="100" value="${escapeHtml(tile.value || "")}" required></label>
      <div class="role-checks">${["admin", "associate", "client"].map(r => `
        <label><input type="checkbox" data-tile-role="${r}" ${tile.roles?.includes(r) ? "checked" : ""}> ${r}</label>
      `).join("")}</div>
      <button type="button" class="danger">Delete Tile</button>`;
    row.querySelector("button").onclick = () => row.remove();
    $("customTilesEditor").appendChild(row);
  }
  customTiles.forEach(addCustomTile);
  $("btnAddTile").onclick = () => addCustomTile({ roles: ["admin", "associate", "client"] });
  document.querySelectorAll("[data-remove-tile]").forEach(btn => {
    btn.onclick = () => { $("tileEnabled_" + btn.dataset.removeTile).checked = false; };
  });
  $("btnSaveTiles").onclick = saveTileSettings;
}

async function saveTileSettings() {
  if (!isPrivileged() || !hasPermission("canManageTiles")) return;
  const out = {};
  BUILTIN_TILES.forEach(([k]) => {
    out[k] = {
      label: $("tileLabel_" + k).value.trim() || DEFAULT_TILE_SETTINGS[k]?.label || k,
      enabled: $("tileEnabled_" + k).checked,
      roles: ["superadmin", ...["admin", "associate", "client"].filter(r => $("tileRole_" + k + "_" + r).checked)]
    };
  });
  const rows = [...document.querySelectorAll("#customTilesEditor .tile-setting-card")];
  if (rows.length > 20) return alert("Maximum 20 custom tiles allowed.");
  out.customTiles = rows.map(row => ({
    label: row.querySelector(".custom-tile-label").value.trim(),
    value: row.querySelector(".custom-tile-value").value.trim(),
    roles: ["superadmin", ...[...row.querySelectorAll("[data-tile-role]:checked")].map(cb => cb.dataset.tileRole)]
  }));
  if (out.customTiles.some(tile => !tile.label || !tile.value)) return alert("Add a title and value to each custom tile.");
  const btn = $("btnSaveTiles");
  setButtonLoading(btn, true, "Saving...");
  try {
    await saveSettingsDoc("tileSettings", out);
    stateTileSettings = { ...stateTileSettings, ...out };
    alert("Dashboard tile settings saved.");
  } catch (err) {
    alert("Failed to save tile settings: " + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ==========================================
// ABOUT US & OTHER FIRMS
// ==========================================
export function aboutPage() {
  const a = stateAbout || DEFAULT_ABOUT;
  const f = stateFirms || DEFAULT_FIRMS;
  const canEdit = isPrivileged() && (hasPermission("canEditAbout") || hasPermission("canEditSettings"));

  const firms = (f.items || []).map((x, i) => `
    <div class="firm-item">
      <span class="firm-no">${String(i + 1).padStart(2, "0")}</span>
      <div class="firm-name">${escapeHtml(x.name)}</div>
      <div class="firm-desc">${escapeHtml(x.desc)}</div>
    </div>
  `).join("");

  $("content").innerHTML = `
    <div class="about-card">
      <h2>About Us</h2>
      <p class="about-intro">${escapeHtml(a.intro)}</p>
      <ul class="about-list">
        ${(a.items || []).map(x => `<li>${escapeHtml(x)}</li>`).join("")}
      </ul>
      <div class="about-courts">${escapeHtml(a.courts)}</div>
      <div class="about-tagline">
        <div class="about-tagline-main">“Legal Clarity For A Better Tomorrow.”</div>
        <div class="about-tagline-mid">“Your Legal Journey In Safe Hands.”</div>
        <div class="about-tagline-small">“Justice Guided by Trust.”</div>
      </div>

      ${(firms || canEdit) ? `<section class="other-firms">
        <div class="other-firms-kicker">Our Other Firms</div>
        <h3 class="other-firms-title">${escapeHtml(f.group || "Add your group name")}</h3>
        <div class="firm-grid">${firms}</div>
      </section>` : ""}

      ${canEdit ? `
        <div class="about-edit" style="margin-top:28px">
          <h3>Edit About Us</h3>
          <label>Intro
            <textarea id="aboutIntro">${escapeHtml(a.intro)}</textarea>
          </label>
          <label>Matters Dealt With (one per line)
            <textarea id="aboutItems">${escapeHtml((a.items || []).join("\n"))}</textarea>
          </label>
          <label>Court Coverage
            <input id="aboutCourts" value="${escapeHtml(a.courts)}">
          </label>
          <label>Tagline
            <input id="aboutTagline" value="${escapeHtml(a.tagline)}">
          </label>
          <div class="form-actions">
            <button class="primary" type="button" id="btnSaveAbout">Save About Us</button>
          </div>
          <div class="hint">Changes update live across all devices.</div>
        </div>

        <div class="about-edit" style="margin-top:28px">
          <h3>Edit Our Other Firms</h3>
          <label>Group Heading
            <input id="firmGroup" value="${escapeHtml(f.group)}">
          </label>
          <div id="firmEditRows">
            ${(f.items || []).map((x, i) => `
              <div class="tile-setting-card" style="margin-top:10px">
                <b>Firm ${i + 1}</b>
                <label>Firm Name<input class="firm-edit-name" value="${escapeHtml(x.name)}"></label>
                <label>Description<input class="firm-edit-desc" value="${escapeHtml(x.desc)}"></label>
              </div>
            `).join("")}
          </div>
          <div class="form-actions">
            <button class="secondary" type="button" id="btnAddFirm">Add Firm</button>
            <button class="primary" type="button" id="btnSaveFirms">Save Other Firms</button>
          </div>
          <div class="hint">Edit firm names, descriptions, and group heading.</div>
        </div>
      ` : ""}
    </div>
  `;

  if (canEdit) {
    $("btnSaveAbout").onclick = saveAbout;
    $("btnSaveFirms").onclick = saveFirms;
    $("btnAddFirm").onclick = () => {
      const row = document.createElement("div");
      row.className = "tile-setting-card";
      row.style.marginTop = "10px";
      row.innerHTML = '<label>Firm Name<input class="firm-edit-name"></label><label>Description<input class="firm-edit-desc"></label><button class="secondary" type="button">Remove</button>';
      row.querySelector("button").onclick = () => row.remove();
      $("firmEditRows").append(row);
    };
  }
}

async function saveAbout() {
  if (!isPrivileged() || !(hasPermission("canEditAbout") || hasPermission("canEditSettings"))) return;
  const intro = $("aboutIntro").value.trim();
  const items = $("aboutItems").value.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const courts = $("aboutCourts").value.trim();
  const tagline = $("aboutTagline").value.trim();

  const btn = $("btnSaveAbout");
  setButtonLoading(btn, true, "Saving About Us...");

  try {
    await saveSettingsDoc("about", { intro, items, courts, tagline });
    stateAbout = { intro, items, courts, tagline };
    alert("About Us details saved successfully.");
  } catch (err) {
    alert("Failed to save About Us: " + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function saveFirms() {
  if (!isPrivileged() || !hasPermission("canEditSettings")) return;
  const group = $("firmGroup").value.trim() || DEFAULT_FIRMS.group;
  const names = [...document.querySelectorAll(".firm-edit-name")];
  const descs = [...document.querySelectorAll(".firm-edit-desc")];
  const items = names.map((n, i) => ({
    name: n.value.trim(),
    desc: (descs[i]?.value || "").trim()
  })).filter(x => x.name);

  const btn = $("btnSaveFirms");
  setButtonLoading(btn, true, "Saving Other Firms...");

  try {
    await saveSettingsDoc("firms", { group, items });
    stateFirms = { group, items };
    alert("Other Firms details saved successfully.");
  } catch (err) {
    alert("Failed to save other firms: " + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ==========================================
// USER MANAGEMENT & ACCESS CONTROL
// ==========================================
function userMatchesSearch(user, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return true;
  if ([user.loginId, user.name, user.mobile].some(value => String(value ?? "").toLowerCase().includes(term))) return true;
  // Match phone numbers despite spaces, country-code prefixes and separators.
  const digits = term.replace(/\D/g, "");
  return Boolean(digits && /^[+\d\s().-]+$/.test(term) &&
    String(user.mobile ?? "").replace(/\D/g, "").includes(digits));
}

export function userPage() {
  if (!isPrivileged()) return render("dashboard");
  const users = stateUsers;
  const previousSearch = $("userSearch");
  const searchValue = previousSearch?.value || "";
  const restoreSearchFocus = document.activeElement === previousSearch;
  const caret = previousSearch?.selectionStart;
  const canAdd = isSuperAdmin() || hasPermission("canAddAssociate") || hasPermission("canAddClient");

  $("content").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>User Management &amp; Access Control</h3>
          <p class="muted" style="margin:4px 0 0">Manage portal accounts, roles, access permissions, and account locks.</p>
        </div>
        ${canAdd ? `<button class="btn primary" id="btnAddUser">+ Add User</button>` : ""}
      </div>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-top:16px">
        <label for="userSearch" style="flex:1;min-width:180px">Search Users
          <input id="userSearch" type="search" placeholder="Login ID / number, mobile number or name" value="${escapeHtml(searchValue)}" autocomplete="off" style="width:100%;box-sizing:border-box">
        </label>
        <button type="button" class="secondary" id="clearUserSearch">Clear</button>
      </div>
      <p id="userSearchCount" class="muted" role="status" aria-live="polite"></p>
      <p id="userSearchEmpty" class="muted" style="display:none">No users found.</p>
      <div class="users-list" id="userSearchResults" style="margin-top:14px">
        ${users.map((u) => {
          const isTargetSuperAdmin = u.role === "superadmin";
          const isTargetAdmin = u.role === "admin";
          const canManageThisUser = isSuperAdmin() || (!isTargetSuperAdmin && hasPermission("canEditUsers"));
          const canDeleteThisUser = isSuperAdmin() ? !isTargetSuperAdmin : (!isTargetSuperAdmin && hasPermission("canDeleteUsers"));
          const canLockThisUser = !isTargetSuperAdmin && (isSuperAdmin() || hasPermission("canLockUsers"));

          return `
            <div class="user-row" style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid #f0dfe1">
              <div class="user-meta" style="flex:1">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <b style="font-size:15px">${escapeHtml(u.name || "User")}</b>
                  ${isTargetSuperAdmin ? `<span class="superadmin-badge">SUPER ADMIN – PRIMARY ACCOUNT</span>` : `
                    <span class="badge" style="background:#5b0b16;color:#fff">${(u.role || "").toUpperCase()}</span>
                  `}
                  ${u.locked ? `<span class="badge" style="background:#fef3f2;color:#b42318">LOCKED</span>` : ""}
                  ${u.active === false ? `<span class="badge" style="background:#f4f5f7;color:#667085">INACTIVE</span>` : `<span class="badge" style="background:#ecfdf3;color:#027a48">ACTIVE</span>`}
                </div>
                <small style="display:block;color:#718292;margin-top:5px;font-size:12px">
                  Login ID: <b>${escapeHtml(u.loginId || "-")}</b> &nbsp;•&nbsp;
                  Sign-in Email: ${escapeHtml(u.email || "-")}
                  ${u.contactEmail ? `&nbsp;•&nbsp; Contact Email: ${escapeHtml(u.contactEmail)}` : ""}
                  ${u.mobile ? `&nbsp;•&nbsp; Mobile: ${escapeHtml(u.mobile)}` : ""}
                </small>
                ${u.locked ? `<small style="color:#b42318;display:block;margin-top:3px">Lock Reason: ${escapeHtml(u.lockReason || "Not specified")}</small>` : ""}
                ${u.role === "client" && Array.isArray(u.caseNos) && u.caseNos.length ? `
                  <small style="color:#5b0b16;display:block;margin-top:3px">Assigned Cases: ${u.caseNos.join(", ")}</small>
                ` : ""}
              </div>
              <div class="actions" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                ${isSuperAdmin() && isTargetAdmin ? `
                  <button class="btn" data-usr-perms="${u.uid}">Manage Access</button>
                ` : ""}
                ${canLockThisUser && (u.role === "client" || u.role === "associate") ? `
                  <button class="btn" data-usr-lock="${u.uid}">${u.locked ? "Unlock" : "Lock"}</button>
                ` : ""}
                ${!isTargetSuperAdmin && canManageThisUser ? `
                  <button class="btn" data-usr-edit="${u.uid}">Edit Details</button>
                  <button class="btn" data-usr-active="${u.uid}">${u.active === false ? "Activate" : "Deactivate"}</button>
                ` : ""}
                ${canDeleteThisUser ? `
                  <button class="danger" data-usr-delete="${u.uid}">Delete</button>
                ` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  const rows = [...$("userSearchResults").children];
  const applySearch = () => {
    let count = 0;
    rows.forEach((row, index) => {
      const matches = userMatchesSearch(users[index], $("userSearch").value);
      row.style.display = matches ? "flex" : "none";
      if (matches) count++;
    });
    $("userSearchCount").textContent = count + " of " + users.length + " users";
    $("userSearchEmpty").style.display = count ? "none" : "block";
    $("clearUserSearch").disabled = !$("userSearch").value;
  };
  $("userSearch").oninput = applySearch;
  $("clearUserSearch").onclick = () => {
    $("userSearch").value = "";
    applySearch();
    $("userSearch").focus();
  };
  applySearch();
  if (restoreSearchFocus) {
    $("userSearch").focus();
    if (caret != null) $("userSearch").setSelectionRange(caret, caret);
  }

  if (canAdd) {
    $("btnAddUser").onclick = addUserModal;
  }
}

// User row action buttons
document.addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-usr-edit]");
  if (editBtn) {
    openEditUserModal(editBtn.dataset.usrEdit);
    return;
  }

  // Manage Permissions (Super Admin only for Admin accounts)
  const permsBtn = e.target.closest("[data-usr-perms]");
  if (permsBtn) {
    const uid = permsBtn.dataset.usrPerms;
    openPermissionsModal(uid);
    return;
  }

  // Lock / Unlock
  const lockBtn = e.target.closest("[data-usr-lock]");
  if (lockBtn) {
    const uid = lockBtn.dataset.usrLock;
    const u = stateUsers.find(x => x.uid === uid);
    if (!u || u.role === "superadmin") return;
    const willLock = !u.locked;
    const reason = willLock ? (prompt("Reason for locking account access:", "Pending fees") || "Restricted by Administrator") : "";
    try {
      await toggleUserLock(uid, u.locked, reason);
    } catch (err) {
      alert("Error: " + err.message);
    }
    return;
  }

  // Activate / Deactivate
  const actBtn = e.target.closest("[data-usr-active]");
  if (actBtn) {
    const uid = actBtn.dataset.usrActive;
    const u = stateUsers.find(x => x.uid === uid);
    if (!u || u.role === "superadmin") {
      alert("Primary Super Admin account cannot be deactivated.");
      return;
    }
    try {
      await toggleUserActive(uid, u.active !== false);
    } catch (err) {
      alert("Error: " + err.message);
    }
    return;
  }

  // Delete User
  const delBtn = e.target.closest("[data-usr-delete]");
  if (delBtn) {
    const uid = delBtn.dataset.usrDelete;
    const u = stateUsers.find(x => x.uid === uid);
    if (!u) return;
    if (u.role === "superadmin") {
      alert("Primary Super Admin account cannot be deleted.");
      return;
    }
    if (u.uid === currentUser.uid) {
      alert("You cannot delete your own logged-in account.");
      return;
    }
    if (!confirm(`Permanently delete account '${u.name}' (${u.loginId || u.email})? This action cannot be undone.`)) {
      return;
    }
    try {
      await deleteUserProfile(uid);
      if (u.loginId) {
        await deleteLoginIdEntry(u.loginId);
      }
    } catch (err) {
      alert("Error deleting user: " + err.message);
    }
    return;
  }
});

function openEditUserModal(uid) {
  const u = stateUsers.find(x => x.uid === uid);
  if (!u || u.role === "superadmin" || !(isSuperAdmin() || hasPermission("canEditUsers"))) return;

  $("modalTitle").textContent = `Edit User: ${u.name || "User"}`;
  $("caseForm").innerHTML = `
    <div class="form-grid">
      <label>Login ID / Number <input id="editUserLoginId" type="text" required value="${escapeHtml(u.loginId || "")}" autocomplete="off" spellcheck="false"></label>
      <p class="muted">A new Login ID can contain numbers, letters, dots, underscores or hyphens. Your password and sign-in email stay the same.</p>
      <label>Full Name <input id="editUserName" required maxlength="120" value="${escapeHtml(u.name || "")}"></label>
      <label>Mobile Number <input id="editUserMobile" type="tel" maxlength="20" value="${escapeHtml(u.mobile || "")}"></label>
      <label>Contact Email <input id="editUserContactEmail" type="email" maxlength="254" value="${escapeHtml(u.contactEmail || "")}"></label>
      ${u.role === "client" ? `<label class="span2">Assigned Case Numbers (comma separated)
        <input id="editUserCases" value="${escapeHtml((u.caseNos || []).join(", "))}">
      </label>` : ""}
    </div>
    <p class="muted">Sign-in email: ${escapeHtml(u.email || "—")}. Contact email does not change sign-in. A reset link can only be sent to a real sign-in email.</p>
    <button type="button" class="secondary" id="btnResetUserPassword">Send Password Reset Link</button>
    <div class="form-actions" style="margin-top:18px">
      <button type="button" class="secondary" id="btnCancelEditUser">Cancel</button>
      <button type="submit" class="primary" id="btnSaveEditUser">Save Changes</button>
    </div>`;
  $("modal").classList.remove("hidden");
  $("btnCancelEditUser").onclick = closeModal;
  $("btnResetUserPassword").onclick = async () => {
    if (!(isSuperAdmin() || hasPermission("canEditUsers"))) return;
    const btn = $("btnResetUserPassword");
    setButtonLoading(btn, true, "Sending...");
    try {
      await sendAccountPasswordReset(u.email);
      alert("Reset link sent to the sign-in email.");
    } catch (err) {
      alert("Could not send reset link: " + (err.message || "Unknown error."));
    } finally {
      setButtonLoading(btn, false);
    }
  };
  $("caseForm").onsubmit = async (event) => {
    event.preventDefault();
    if (!(isSuperAdmin() || hasPermission("canEditUsers"))) return;
    const name = $("editUserName").value.trim();
    const mobile = $("editUserMobile").value.trim();
    if (!name) return alert("Full name is required.");
    const changes = { name, mobile, contactEmail: $("editUserContactEmail").value.trim() };
    if (u.role === "client") {
      changes.caseNos = [...new Set($("editUserCases").value.split(",").map(v => v.trim()).filter(Boolean))];
    }
    const saveBtn = $("btnSaveEditUser");
    setButtonLoading(saveBtn, true, "Saving...");
    try {
      await saveUserDetailsWithLoginId(uid, $("editUserLoginId").value, changes);
      closeModal();
    } catch (err) {
      alert("Could not save user details: " + err.message);
    } finally {
      setButtonLoading(saveBtn, false);
    }
  };
}

// Permissions list definitions
const ADMIN_PERMISSIONS_CONFIG = [
  { group: "Case Management", items: [
    { key: "canEditCases", label: "Add and Edit Cases" },
    { key: "canDeleteCases", label: "Delete Cases" },
    { key: "canAssignCases", label: "Assign Cases to Clients" }
  ]},
  { group: "User Management", items: [
    { key: "canAddAssociate", label: "Add Associate Accounts" },
    { key: "canAddClient", label: "Add Client Accounts" },
    { key: "canEditUsers", label: "Edit & Deactivate Users" },
    { key: "canLockUsers", label: "Lock & Unlock Accounts" },
    { key: "canDeleteUsers", label: "Delete User Accounts" }
  ]},
  { group: "Website & Portal Management", items: [
    { key: "canEditAbout", label: "Edit About Us & Firm Info" },
    { key: "canEditSettings", label: "Edit Other Firms" },
    { key: "canManageTable", label: "Customize Case Table Layout" },
    { key: "canManageTiles", label: "Customize Dashboard Tiles" }
  ]}
];

function openPermissionsModal(uid) {
  if (!isSuperAdmin()) return;
  const u = stateUsers.find(x => x.uid === uid);
  if (!u) return;

  const currentPerms = u.permissions || {};

  $("modalTitle").textContent = `Manage Access: ${u.name}`;
  $("caseForm").innerHTML = `
    <div style="margin-bottom:14px;background:#fffaf8;padding:12px 14px;border:1px solid #ead8d8;border-radius:10px;font-size:13px;line-height:1.5">
      <b>Role:</b> ADMIN &nbsp;•&nbsp; <b>Login ID:</b> ${escapeHtml(u.loginId || u.email)}<br>
      Toggle granular privileges for this Administrator account below. Super Admin always maintains complete control.
    </div>

    ${ADMIN_PERMISSIONS_CONFIG.map(grp => `
      <div class="tile-setting-card" style="margin-top:12px">
        <h4 style="margin:0 0 10px;color:#5b0b16">${grp.group}</h4>
        <div class="role-checks" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
          ${grp.items.map(item => `
            <label style="display:flex;align-items:center;gap:8px">
              <input type="checkbox" class="perm-check" data-perm="${item.key}" ${currentPerms[item.key] !== false ? "checked" : ""}>
              ${item.label}
            </label>
          `).join("")}
        </div>
      </div>
    `).join("")}

    <div class="form-actions" style="margin-top:18px">
      <button type="button" class="secondary" id="btnCancelPerms">Cancel</button>
      <button class="primary" type="button" id="btnSavePerms">Save Permissions</button>
    </div>
  `;

  $("modal").classList.remove("hidden");
  $("btnCancelPerms").onclick = closeModal;

  $("btnSavePerms").onclick = async () => {
    const updatedPerms = {};
    document.querySelectorAll(".perm-check").forEach(cb => {
      updatedPerms[cb.dataset.perm] = cb.checked;
    });

    const saveBtn = $("btnSavePerms");
    setButtonLoading(saveBtn, true, "Saving...");

    try {
      await updateUserProfile(uid, { permissions: updatedPerms });
      closeModal();
      alert(`Permissions for '${u.name}' updated successfully.`);
    } catch (err) {
      alert("Failed to save permissions: " + err.message);
    } finally {
      setButtonLoading(saveBtn, false);
    }
  };
}

function addUserModal() {
  const allowAdminRole = isSuperAdmin();
  const allowAssociate = isSuperAdmin() || hasPermission("canAddAssociate");
  const allowClient = isSuperAdmin() || hasPermission("canAddClient");

  $("modalTitle").textContent = "Add New Portal Account";
  $("caseForm").innerHTML = `
    <div class="form-grid">
      <label>Full Name
        <input id="newUserName" placeholder="e.g. Adv. Rajesh Sharma / Client Name" required>
      </label>
      <label>Login ID
        <input id="newUserLoginId" placeholder="e.g. rajesh / rajesh123 (no spaces)" required>
      </label>
      <label>Mobile Number
        <input id="newUserMobile" placeholder="e.g. 9876543210">
      </label>
      <label>Email (Optional)
        <input id="newUserEmail" type="email" placeholder="e.g. user@gmail.com">
      </label>
      <label class="span2">Portal Role
        <select id="newUserRole">
          ${allowClient ? `<option value="client">Client</option>` : ""}
          ${allowAssociate ? `<option value="associate">Associate</option>` : ""}
          ${allowAdminRole ? `<option value="admin">Admin</option>` : ""}
        </select>
      </label>
      <label>Password
        <input id="newUserPassword" type="password" placeholder="At least 6 characters" required>
      </label>
      <label>Confirm Password
        <input id="newUserConfirmPassword" type="password" placeholder="Repeat password" required>
      </label>
    </div>
    <div class="form-actions" style="margin-top:18px">
      <button type="button" class="secondary" id="btnCancelAddUser">Cancel</button>
      <button class="primary" type="submit" id="btnSubmitAddUser">Create Account</button>
    </div>
  `;

  $("modal").classList.remove("hidden");
  $("btnCancelAddUser").onclick = closeModal;

  $("caseForm").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("newUserName").value.trim();
    const loginId = $("newUserLoginId").value.trim();
    const mobile = $("newUserMobile").value.trim();
    const email = $("newUserEmail").value.trim();
    const role = $("newUserRole").value;
    const password = $("newUserPassword").value;
    const confirmPassword = $("newUserConfirmPassword").value;

    if (!name || !loginId || !password) return alert("Please fill in Name, Login ID, and Password.");
    if (password.length < 6) return alert("Password must be at least 6 characters.");
    if (password !== confirmPassword) return alert("Passwords do not match.");

    // Prevent non-superadmin from attempting to create admin or superadmin
    if (!isSuperAdmin() && (role === "admin" || role === "superadmin")) {
      return alert("Only Super Admin can create Admin accounts.");
    }

    const submitBtn = $("btnSubmitAddUser");
    setButtonLoading(submitBtn, true, "Creating Account in Firebase...");

    try {
      await createAccountByAdmin({
        loginId,
        name,
        role,
        password,
        mobile,
        email,
        caseNos: [],
        permissions: role === "admin" ? {} : undefined
      });
      closeModal();
      alert(`Account '${name}' (Login ID: ${loginId}) created successfully.`);
    } catch (err) {
      alert("Error creating user: " + (err.message || "Failed to create account."));
    } finally {
      setButtonLoading(submitBtn, false);
    }
  };
}

// ==========================================
// MODAL HELPER
// ==========================================
export function closeModal() {
  const modal = $("modal");
  if (modal) modal.classList.add("hidden");
}

// ==========================================
// INITIALIZATION
// ==========================================
let appInitialized = false;

export async function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  // Modal handlers
  $("closeModal")?.addEventListener("click", closeModal);
  $("modal")?.addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });

  // Public navigation is bound directly in index.html so it survives SDK errors.

  // Password Show / Hide toggle
  $("pwToggle")?.addEventListener("click", () => {
    const pwField = $("password");
    if (!pwField) return;
    if (pwField.type === "password") {
      pwField.type = "text";
      $("pwToggle").textContent = "🙈";
    } else {
      pwField.type = "password";
      $("pwToggle").textContent = "👁";
    }
  });

  // Logout button
  $("logout")?.addEventListener("click", async () => {
    try {
      await logoutUser();
    } catch (e) {
      console.warn("Logout notice:", e);
    }
    showPublicHome();
  });

  // Unified Login Form Submit (Login ID / Email + Password)
  let isFormAuthInProgress = false;
  $("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isFormAuthInProgress) return;
    isFormAuthInProgress = true;
    clearAuthError();

    const loginId = $("loginId").value.trim();
    const password = $("password").value;

    const submitBtn = $("loginSubmitBtn") || e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, "Signing in...");

    try {
      const profile = await loginUser(loginId, password);
      currentUser = profile;
      showApp();
    } catch (err) {
      displayAuthError(err);
    } finally {
      setButtonLoading(submitBtn, false);
      isFormAuthInProgress = false;
    }
  });

  window.gurjarAppReady = true;

  // Auth State Observer (Automatic Session Restore & Active Guard)
  subscribeAuthState((profile) => {
    if (profile) {
      currentUser = profile;
      showApp();
    } else {
      const isLoginVisible = $("loginPage") && !$("loginPage").classList.contains("hidden");
      if (!isLoginVisible) {
        showPublicHome();
      }
    }
  });

  // First-run automatic seeding (seeds defaults if collections are empty)
  // Defaults are created only after an authorized superadmin signs in.
}

// Start application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
