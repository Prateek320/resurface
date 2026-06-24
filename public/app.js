// ============================================================
// RESURFACE — Opportunity-to-Action Platform
// ============================================================

const OPP_TYPES = ["Job","Internship","Scholarship","Founder/Startup","Client/Sales","Networking","Grant","Conference","Other"];

// --- State ---
let opportunities = [];
let pendingDeleteId = null;
let activeFilter = "all";
let searchQuery = "";
let pendingExtract = null;
let pendingRawText = "";
let supabaseClient = null;
let currentUser = null;
let userProfile = null;
let appConfig = { limits: { freeExtractions: 10, freeDrafts: 3 } };
let cloudSyncEnabled = false;
let detailOppId = null;
const latestDrafts = {};

// ============================================================
// SEED DATA
// ============================================================
const SEED_DATA = [
  {
    id: "seed-lumber-1", type: "Job", title: "Senior Product Manager — Platform & Growth",
    organization: "Lumber", location: "Remote (US)",
    description: "Lumber is hiring a Senior PM to own their core platform and growth surface.",
    deadline: (() => { const d = new Date(); d.setDate(d.getDate() + 9); return d.toISOString().split("T")[0]; })(),
    followUpAction: "Email the hiring manager at Lumber with your portfolio and a 3-bullet pitch on their growth bottleneck",
    priorityScore: 9, priorityReason: "High-growth startup, deadline in 9 days",
    keyDetails: ["Series B construction-tech", "Remote-first", "$160–190K + equity"],
    contactInfo: "careers@lumber.com", compensation: "$160K–$190K + equity",
    tags: ["remote", "series-b", "b2b"], status: "in-progress",
    rawText: "Lumber PM opportunity", createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    notes: "", activity: [], drafts: [], snoozedUntil: null, reminderAt: null, outcome: null
  },
  {
    id: "seed-2", type: "Founder/Startup", title: "PM Hire #1 — PulseAI (YC W24)",
    organization: "PulseAI", location: "San Francisco / Remote",
    description: "YC-backed startup building AI for clinical documentation. First PM hire.",
    deadline: (() => { const d = new Date(); d.setDate(d.getDate() + 6); return d.toISOString().split("T")[0]; })(),
    followUpAction: "DM Arjun Mehta on LinkedIn — lead with healthcare or AI PM experience",
    priorityScore: 9, priorityReason: "First PM at YC company, deadline in 6 days",
    keyDetails: ["YC W24", "$8M Series A", "First PM hire"],
    contactInfo: "linkedin.com/in/arjunmehta", compensation: "Negotiable + equity",
    tags: ["yc", "early-stage", "ai"], status: "new",
    rawText: "WhatsApp from AWS Summit", createdAt: new Date(Date.now() - 86400000).toISOString(),
    notes: "", activity: [], drafts: [], snoozedUntil: null, reminderAt: null, outcome: null
  },
  {
    id: "seed-3", type: "Scholarship", title: "Fulbright-Nehru Master's Fellowship 2024",
    organization: "USIEF", location: "United States",
    description: "Prestigious fellowship for Indian citizens to pursue Master's in the US.",
    deadline: (() => { const d = new Date(); d.setDate(d.getDate() + 21); return d.toISOString().split("T")[0]; })(),
    followUpAction: "Start application at usief.org.in — request 2 recommenders this week",
    priorityScore: 8, priorityReason: "Full funding, 21-day deadline",
    keyDetails: ["Full tuition + stipend", "~50 spots annually"],
    contactInfo: "usief.org.in/fellowships", compensation: "Full funding",
    tags: ["fully-funded", "competitive"], status: "new",
    rawText: "Scholarship announcement", createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    notes: "", activity: [], drafts: [], snoozedUntil: null, reminderAt: null, outcome: null
  },
  {
    id: "seed-4", type: "Networking", title: "Sequoia Surge — SEA Founders Program 2024",
    organization: "Sequoia Surge", location: "Southeast Asia",
    description: "15 founders selected for $200K investment and 12-week program.",
    deadline: (() => { const d = new Date(); d.setDate(d.getDate() + 32); return d.toISOString().split("T")[0]; })(),
    followUpAction: "Apply at surge.sequoiacap.com/apply",
    priorityScore: 7, priorityReason: "Exceptional program, 32-day deadline",
    keyDetails: ["$200K investment", "12-week program"],
    contactInfo: "surge.sequoiacap.com/apply", compensation: "$200K investment",
    tags: ["vc", "founders", "accelerator"], status: "new",
    rawText: "LinkedIn post", createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    notes: "", activity: [], drafts: [], snoozedUntil: null, reminderAt: null, outcome: null
  },
  {
    id: "seed-5", type: "Job", title: "Product Manager — Consumer Growth",
    organization: "Swiggy", location: "Bangalore (Hybrid)",
    description: "PM role for customer acquisition funnel at Swiggy.",
    deadline: null, followUpAction: "Apply at careers.swiggy.com and email Priya Sharma",
    priorityScore: 6, priorityReason: "Solid role, no hard deadline",
    keyDetails: ["₹30–45 LPA + ESOP", "Reports to VP Growth"],
    contactInfo: "priya.sharma@swiggy.com", compensation: "₹30–45 LPA + ESOP",
    tags: ["hybrid", "consumer", "growth"], status: "done",
    rawText: "Swiggy job posting", createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    notes: "", activity: [], drafts: [], snoozedUntil: null, reminderAt: null, outcome: null
  }
];

const examples = {
  "WhatsApp message": `Hey! Ran into Arjun Mehta at AWS Summit — co-founder of PulseAI (YC W24). They're hiring their first PM. DM him on LinkedIn: linkedin.com/in/arjunmehta. Closing hire by end of June. Series A, $8M raised.`,
  "LinkedIn post": `Sequoia Surge is accepting applications for SEA Founders Program 2024. 15 founders, $200K investment, 12-week program. Applications close July 15. Apply at surge.sequoiacap.com/apply.`,
  "Job posting": `Product Manager — Consumer Growth\nSwiggy | Bangalore (Hybrid)\n\n₹30-45 LPA + ESOP\nDeadline: June 28\nContact: priya.sharma@swiggy.com`,
  "Scholarship": `Fulbright-Nehru Master's Fellowships for Indian citizens. Full tuition, living expenses, airfare. Deadline: July 15. usief.org.in/fellowships. ~50 spots annually.`
};

const TIP_DELAY = 3000;
let tipTimer = null;

function icon(name, size = 16) {
  const s = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    play: `<svg ${s}><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    check: `<svg ${s}><polyline points="20 6 9 17 4 12"/></svg>`,
    reset: `<svg ${s}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
    archive: `<svg ${s}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
    trash: `<svg ${s}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
    eye: `<svg ${s}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    copy: `<svg ${s}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    mail: `<svg ${s}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    linkedin: `<svg ${s}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-12h4v2"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`,
    calendar: `<svg ${s}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    sparkles: `<svg ${s}><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/><path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z"/></svg>`,
    close: `<svg ${s}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    alert: `<svg ${s}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    dot: `<svg ${s}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`,
    restore: `<svg ${s}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  };
  return icons[name] || "";
}

function initTooltips() {
  const tipEl = document.getElementById("delayed-tip");
  if (!tipEl) return;

  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipEl.textContent = el.getAttribute("data-tip");
      const r = el.getBoundingClientRect();
      tipEl.style.left = Math.min(r.left, window.innerWidth - 260) + "px";
      tipEl.style.top = (r.bottom + 8) + "px";
      tipEl.classList.add("visible");
      tipEl.setAttribute("aria-hidden", "false");
    }, TIP_DELAY);
  });

  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    clearTimeout(tipTimer);
    tipEl.classList.remove("visible");
    tipEl.setAttribute("aria-hidden", "true");
  });
}

// ============================================================
// HELPERS
// ============================================================
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function escHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getDaysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

function deadlineLabel(dateStr) {
  const days = getDaysUntil(dateStr);
  if (days === null) return null;
  if (days < 0) return { text: "Overdue", cls: "deadline-urgent" };
  if (days === 0) return { text: "Due today!", cls: "deadline-urgent" };
  if (days === 1) return { text: "Tomorrow", cls: "deadline-urgent" };
  if (days <= 7) return { text: `${days}d left`, cls: "deadline-urgent" };
  if (days <= 14) return { text: `${days}d left`, cls: "deadline-soon" };
  return { text: new Date(dateStr).toLocaleDateString("en-US", { month:"short", day:"numeric" }), cls: "deadline-ok" };
}

function typeClass(t) {
  return ({ Job:"type-job", Internship:"type-internship", Scholarship:"type-scholarship", "Founder/Startup":"type-founder", "Client/Sales":"type-client", Networking:"type-networking", Grant:"type-grant", Conference:"type-conference" })[t] || "type-other";
}

function statusClass(s) {
  return ({ new:"status-new", "in-progress":"status-progress", done:"status-done", archived:"status-archived" })[s] || "status-new";
}

function statusLabel(s) {
  return ({ new:"New", "in-progress":"In Progress", done:"Followed Up", archived:"Archived" })[s] || s;
}

function priorityColor(score) {
  if (score >= 8) return "#C84B4B";
  if (score >= 6) return "#1877F2";
  if (score >= 4) return "#5B9BD5";
  return "#8A9BB0";
}

function normalizeOpp(opp) {
  return {
    notes: "", activity: [], drafts: [], snoozedUntil: null, reminderAt: null, reminderType: null, outcome: null,
    ...opp,
    activity: opp.activity || [],
    drafts: opp.drafts || [],
    notes: opp.notes || ""
  };
}

function addActivity(opp, type, meta = {}) {
  if (!opp.activity) opp.activity = [];
  opp.activity.unshift({ type, at: new Date().toISOString(), meta });
}

function getProfileForAI() {
  const local = JSON.parse(localStorage.getItem("resurface_profile") || "null");
  if (userProfile?.onboarding_complete) return userProfile;
  if (local?.onboarding_complete) return local;
  return null;
}

async function authHeaders() {
  if (!supabaseClient) return {};
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) return {};
  return { Authorization: `Bearer ${data.session.access_token}` };
}

// ============================================================
// PERSISTENCE
// ============================================================
function loadLocal() {
  try {
    const stored = localStorage.getItem("resurface_opps");
    if (stored) return JSON.parse(stored).map(normalizeOpp);
  } catch (e) {
    console.warn("Corrupt localStorage, resetting:", e);
    localStorage.removeItem("resurface_opps");
  }
  localStorage.setItem("resurface_opps", JSON.stringify(SEED_DATA));
  return SEED_DATA.map(normalizeOpp);
}

function save() {
  localStorage.setItem("resurface_opps", JSON.stringify(opportunities));
  if (cloudSyncEnabled && currentUser) syncToCloud();
}

async function syncToCloud() {
  try {
    const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
    await fetch("/api/opportunities/sync", { method: "PUT", headers, body: JSON.stringify({ opportunities }) });
  } catch (e) { console.warn("Cloud sync failed:", e); }
}

async function loadFromCloud() {
  const headers = await authHeaders();
  const res = await fetch("/api/opportunities", { headers });
  const data = await res.json();
  if (data.cloud && data.opportunities?.length) {
    opportunities = data.opportunities.map(normalizeOpp);
    localStorage.setItem("resurface_opps", JSON.stringify(opportunities));
  }
}

// ============================================================
// MOBILE NAV
// ============================================================
function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("open");
  document.getElementById("sidebar-backdrop")?.classList.toggle("open");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("open");
}

// ============================================================
// VIEWS
// ============================================================
function showView(name) {
  closeSidebar();
  ["dashboard","add","archived","preview"].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = v === name ? "block" : "none";
    const nav = document.getElementById(`nav-${v === "preview" ? "add" : v}`);
    if (nav) nav.classList.toggle("active", (v === name) || (name === "preview" && v === "add"));
  });
  if (name === "dashboard") renderCards();
  if (name === "archived") renderArchive();
}

// ============================================================
// AUTH
// ============================================================
async function initAuth() {
  try {
    const res = await fetch("/api/config");
    appConfig = await res.json();
    if (!appConfig.supabaseConfigured) {
      updateAuthUI(null, false);
      return;
    }
    supabaseClient = window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey);
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await onAuthChange(session);
    supabaseClient.auth.onAuthStateChange((_, session) => onAuthChange(session));
  } catch (e) { console.warn("Auth init failed:", e); }
}

async function onAuthChange(session) {
  currentUser = session?.user || null;
  if (currentUser) {
    cloudSyncEnabled = true;
    const headers = await authHeaders();
    const res = await fetch("/api/profile", { headers });
    const data = await res.json();
    userProfile = data.profile;
    await loadFromCloud();
    updateAuthUI(currentUser);
    updateUsageUI();
    if (userProfile && !userProfile.onboarding_complete) showOnboarding();
    else renderCards();
  } else {
    cloudSyncEnabled = false;
    userProfile = null;
    updateAuthUI(null);
  }
}

function updateAuthUI(user, supabaseReady = true) {
  const signedIn = document.getElementById("auth-signed-in");
  const signedOut = document.getElementById("auth-signed-out");
  const emailEl = document.getElementById("auth-email");
  const signInBtn = document.getElementById("auth-sign-in-btn");

  if (!supabaseReady) {
    signedIn.style.display = "none";
    signedOut.style.display = "block";
    if (signInBtn) {
      signInBtn.disabled = true;
      signInBtn.textContent = "Cloud sync — add Supabase keys";
      signInBtn.title = "Set SUPABASE_URL and SUPABASE_ANON_KEY on the server";
    }
    return;
  }

  if (signInBtn) {
    signInBtn.disabled = false;
    signInBtn.textContent = "Sign in for cloud sync";
    signInBtn.removeAttribute("title");
  }

  if (user) {
    signedIn.style.display = "block";
    signedOut.style.display = "none";
    emailEl.textContent = user.email;
  } else {
    signedIn.style.display = "none";
    signedOut.style.display = "block";
  }
}

function openAuthModal() { document.getElementById("auth-modal").style.display = "flex"; }
function closeAuthModal() { document.getElementById("auth-modal").style.display = "none"; }

async function signInWithEmail() {
  const email = document.getElementById("auth-email-input").value.trim();
  if (!email || !supabaseClient) return showToast("Enter a valid email", "error");
  const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) return showToast(error.message, "error");
  showToast("Check your email for the magic link!", "success");
}

async function signInWithGoogle() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  showToast("Signed out", "info");
}

async function migrateLocalToCloud() {
  if (!currentUser) return;
  await syncToCloud();
  showToast("Local data synced to cloud!", "success");
}

// ============================================================
// ONBOARDING / PROFILE
// ============================================================
function showOnboarding() {
  document.getElementById("onboarding-modal").style.display = "flex";
  if (userProfile) {
    document.getElementById("onboard-role").value = userProfile.role || "";
    document.getElementById("onboard-location").value = userProfile.location || "";
    document.getElementById("onboard-skills").value = userProfile.skills || "";
    document.getElementById("onboard-interests").value = (userProfile.interests || []).join(", ");
  }
}

function closeOnboarding() { document.getElementById("onboarding-modal").style.display = "none"; }

async function saveOnboarding() {
  const profile = {
    role: document.getElementById("onboard-role").value.trim(),
    location: document.getElementById("onboard-location").value.trim(),
    skills: document.getElementById("onboard-skills").value.trim(),
    interests: document.getElementById("onboard-interests").value.split(",").map(s => s.trim()).filter(Boolean),
    onboarding_complete: true
  };
  localStorage.setItem("resurface_profile", JSON.stringify(profile));
  if (currentUser) {
    const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
    await fetch("/api/profile", { method: "PUT", headers, body: JSON.stringify(profile) });
    userProfile = { ...userProfile, ...profile };
  }
  closeOnboarding();
  showToast("Profile saved — AI will personalize your opportunities", "success");
}

function openProfileSettings() {
  showOnboarding();
  document.getElementById("onboarding-title").textContent = "Your Profile";
}

// ============================================================
// USAGE / TIERS
// ============================================================
async function updateUsageUI() {
  const el = document.getElementById("usage-badge");
  if (!el) return;
  if (!currentUser) {
    el.textContent = "Local";
    el.className = "usage-badge free";
    return;
  }
  const headers = await authHeaders();
  const res = await fetch("/api/usage", { headers });
  const usage = await res.json();
  if (usage.tier === "pro") {
    el.textContent = "Pro";
    el.className = "usage-badge pro";
  } else {
    el.textContent = `${usage.extractionsUsed || 0}/${usage.extractionsLimit} extractions`;
    el.className = "usage-badge free";
  }
}

async function upgradeToPro() {
  if (!currentUser) return openAuthModal();
  const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
  await fetch("/api/profile", { method: "PUT", headers, body: JSON.stringify({ tier: "pro" }) });
  userProfile = { ...userProfile, tier: "pro" };
  updateUsageUI();
  showToast("Upgraded to Pro! (demo — no payment required)", "success");
}

// ============================================================
// AI EXTRACTION + PREVIEW
// ============================================================
async function extractOpportunity() {
  const text = document.getElementById("paste-input").value.trim();
  if (!text || text.length < 10) { showError("Please paste some text first."); return; }

  const btn = document.getElementById("extract-btn");
  const loading = document.getElementById("loading-state");
  const errorEl = document.getElementById("error-state");
  btn.style.display = "none";
  loading.style.display = "block";
  errorEl.style.display = "none";

  try {
    const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
    const res = await fetch("/api/extract", {
      method: "POST", headers,
      body: JSON.stringify({ text, profile: getProfileForAI() })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.limitReached) showUpgradePrompt(data.error);
      throw new Error(data.error || "Extraction failed");
    }
    pendingRawText = text;
    pendingExtract = data.opportunity;
    showPreview(data.opportunity);
    updateUsageUI();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.style.display = "flex";
    loading.style.display = "none";
  }
}

function showPreview(opp) {
  document.getElementById("preview-type").value = opp.type || "Other";
  document.getElementById("preview-title").value = opp.title || "";
  document.getElementById("preview-org").value = opp.organization || "";
  document.getElementById("preview-location").value = opp.location || "";
  document.getElementById("preview-deadline").value = opp.deadline ? opp.deadline.split("T")[0] : "";
  document.getElementById("preview-priority").value = opp.priorityScore || 5;
  document.getElementById("preview-action").value = opp.followUpAction || "";
  document.getElementById("preview-desc").value = opp.description || "";
  showView("preview");
}

function cancelPreview() {
  pendingExtract = null;
  pendingRawText = "";
  showView("add");
}

function saveFromPreview() {
  if (!pendingExtract) return;
  const opp = normalizeOpp({
    ...pendingExtract,
    id: genId(),
    type: document.getElementById("preview-type").value,
    title: document.getElementById("preview-title").value.trim(),
    organization: document.getElementById("preview-org").value.trim() || null,
    location: document.getElementById("preview-location").value.trim() || null,
    deadline: document.getElementById("preview-deadline").value || null,
    priorityScore: parseInt(document.getElementById("preview-priority").value, 10) || 5,
    followUpAction: document.getElementById("preview-action").value.trim(),
    description: document.getElementById("preview-desc").value.trim(),
    status: "new",
    rawText: pendingRawText,
    createdAt: new Date().toISOString()
  });
  addActivity(opp, "created");
  const dup = findDuplicate(opp);
  if (dup) {
    if (!confirm(`This looks similar to "${dup.title}" (${dup.organization || "no org"}). Save anyway?`)) return;
  }
  opportunities.unshift(opp);
  save();
  pendingExtract = null;
  pendingRawText = "";
  document.getElementById("paste-input").value = "";
  showView("dashboard");
  showToast("Opportunity saved!", "success");
}

function findDuplicate(opp) {
  const title = (opp.title || "").toLowerCase();
  const org = (opp.organization || "").toLowerCase();
  return opportunities.find(o => {
    if (o.status === "archived") return false;
    const t = (o.title || "").toLowerCase();
    const g = (o.organization || "").toLowerCase();
    if (org && g && org === g) return true;
    if (title && t && (t.includes(title.slice(0, 20)) || title.includes(t.slice(0, 20)))) return true;
    return false;
  });
}

function showError(msg) {
  document.getElementById("error-msg").textContent = msg;
  document.getElementById("error-state").style.display = "block";
}

function showUpgradePrompt(msg) {
  showToast(msg, "error");
  setTimeout(() => {
    if (confirm("Upgrade to Pro for unlimited extractions and AI drafts?")) upgradeToPro();
  }, 500);
}

// ============================================================
// AI DRAFTS
// ============================================================
async function generateDraft(oppId) {
  const opp = opportunities.find(o => o.id === oppId);
  if (!opp) return;
  const btn = document.getElementById("draft-generate-btn");
  if (btn) { btn.disabled = true; btn.innerHTML = "Generating..."; }
  try {
    const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
    const res = await fetch("/api/draft-followup", {
      method: "POST", headers,
      body: JSON.stringify({ opportunity: opp, profile: getProfileForAI() })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.limitReached) showUpgradePrompt(data.error);
      throw new Error(data.error || "Draft failed");
    }
    if (!opp.drafts) opp.drafts = [];
    opp.drafts.unshift({ ...data.draft, createdAt: new Date().toISOString() });
    addActivity(opp, "draft_generated", { channel: data.draft.channel });
    save();
    openDetail(oppId);
    updateUsageUI();
    showToast("Draft generated!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `${icon("sparkles",16)} Generate Follow-Up Draft`; }
  }
}

function copyDraft(text) {
  navigator.clipboard.writeText(text);
  showToast("Copied to clipboard!", "success");
}

function openGmailDraft(subject, body) {
  const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank");
}

function openLinkedInSearch(query) {
  window.open(`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(query)}`, "_blank");
}

function addToGoogleCalendar(opp) {
  const title = encodeURIComponent(`Deadline: ${opp.title}`);
  const details = encodeURIComponent(opp.followUpAction || "");
  const date = opp.deadline ? opp.deadline.replace(/-/g, "") : "";
  const url = date
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${date}/${date}&details=${details}`
    : `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}`;
  window.open(url, "_blank");
}

// ============================================================
// REMINDERS
// ============================================================
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function setReminder(oppId, type) {
  const opp = opportunities.find(o => o.id === oppId);
  if (!opp) return;
  requestNotificationPermission();
  let reminderAt = null;
  const now = new Date();
  if (type === "1day" && opp.deadline) {
    const d = new Date(opp.deadline);
    d.setDate(d.getDate() - 1);
    d.setHours(9, 0, 0, 0);
    reminderAt = d.toISOString();
  } else if (type === "dayof" && opp.deadline) {
    const d = new Date(opp.deadline);
    d.setHours(9, 0, 0, 0);
    reminderAt = d.toISOString();
  } else if (type === "stalled") {
    const d = new Date(now.getTime() + 3 * 86400000);
    d.setHours(9, 0, 0, 0);
    reminderAt = d.toISOString();
  } else if (type === "clear") {
    opp.reminderAt = null;
    opp.reminderType = null;
    save();
    openDetail(oppId);
    showToast("Reminder cleared", "info");
    return;
  }
  if (reminderAt && new Date(reminderAt) <= now) {
    showToast("That reminder time has already passed", "error");
    return;
  }
  opp.reminderAt = reminderAt;
  opp.reminderType = type;
  addActivity(opp, "reminder_set", { type });
  save();
  openDetail(oppId);
  showToast("Reminder set!", "success");
}

function snoozeOpp(oppId, days) {
  const opp = opportunities.find(o => o.id === oppId);
  if (!opp) return;
  const d = new Date();
  d.setDate(d.getDate() + days);
  opp.snoozedUntil = d.toISOString();
  addActivity(opp, "snoozed", { days });
  save();
  closeDetail();
  renderCards();
  showToast(`Snoozed for ${days} days`, "info");
}

function checkReminders() {
  const now = new Date();
  opportunities.forEach(opp => {
    if (!opp.reminderAt || opp.status === "archived" || opp.status === "done") return;
    if (new Date(opp.reminderAt) <= now && !opp._reminderFired) {
      opp._reminderFired = true;
      addActivity(opp, "reminder_sent", { type: opp.reminderType });
      save();
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`Resurface: ${opp.title}`, {
          body: opp.followUpAction || "Time to follow up!",
          icon: "/icons/icon.svg"
        });
      }
      showToast(`Reminder: ${opp.title}`, "info");
    }
    if (opp.snoozedUntil && new Date(opp.snoozedUntil) <= now) {
      opp.snoozedUntil = null;
      save();
    }
  });
}

// ============================================================
// FILTER / SEARCH / SORT
// ============================================================
function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  renderCards();
}

function onSearchInput(val) {
  searchQuery = val.trim().toLowerCase();
  renderCards();
}

function filterOpps(list) {
  let active = list.filter(o => o.status !== "archived");
  active = active.filter(o => !o.snoozedUntil || new Date(o.snoozedUntil) <= new Date());
  if (searchQuery) {
    active = active.filter(o => {
      const hay = [o.title, o.organization, o.description, o.followUpAction, o.location, ...(o.tags||[]), o.rawText, o.notes].join(" ").toLowerCase();
      return hay.includes(searchQuery);
    });
  }
  switch (activeFilter) {
    case "high": return active.filter(o => o.priorityScore >= 8);
    case "soon": return active.filter(o => { const d = getDaysUntil(o.deadline); return d !== null && d <= 14; });
    case "new": return active.filter(o => o.status === "new");
    case "in-progress": return active.filter(o => o.status === "in-progress");
    default: return active;
  }
}

function sortOpps(list) {
  const s = document.getElementById("sort-select")?.value || "priority";
  if (s === "priority") return [...list].sort((a,b) => (b.priorityScore||0)-(a.priorityScore||0));
  if (s === "deadline") return [...list].sort((a,b) =>
    (a.deadline ? new Date(a.deadline) : new Date("9999")) - (b.deadline ? new Date(b.deadline) : new Date("9999"))
  );
  return [...list].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
}

// ============================================================
// RENDERING
// ============================================================
function renderExampleButtons() {
  const container = document.getElementById("example-btns");
  if (!container) return;
  container.innerHTML = "";
  Object.entries(examples).forEach(([label, text]) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "example-btn";
    btn.onclick = () => { document.getElementById("paste-input").value = text; document.getElementById("paste-input").focus(); };
    container.appendChild(btn);
  });
}

function renderCards() {
  const grid = document.getElementById("cards-grid");
  const emptyEl = document.getElementById("empty-state");
  const filtered = sortOpps(filterOpps(opportunities));
  Array.from(grid.children).forEach(c => { if (c.id !== "empty-state") c.remove(); });
  if (!filtered.length) {
    emptyEl.style.display = "block";
    emptyEl.querySelector("h3").textContent = searchQuery ? "No matches" : "No opportunities yet";
    updateStats();
    return;
  }
  emptyEl.style.display = "none";
  filtered.forEach((opp, i) => {
    const card = buildCard(opp, false);
    card.style.opacity = "0";
    grid.appendChild(card);
    requestAnimationFrame(() => { card.style.animation = `slideUp 0.4s cubic-bezier(0.16,1,0.3,1) ${i*40}ms forwards`; });
  });
  updateStats();
}

function renderArchive() {
  const grid = document.getElementById("archive-grid");
  const emptyEl = document.getElementById("archive-empty");
  const archived = opportunities.filter(o => o.status === "archived");
  Array.from(grid.children).forEach(c => { if (c.id !== "archive-empty") c.remove(); });
  if (!archived.length) { emptyEl.style.display = "block"; return; }
  emptyEl.style.display = "none";
  archived.forEach(opp => grid.appendChild(buildCard(opp, true)));
}

function buildCard(opp, isArchive) {
  const card = document.createElement("div");
  card.className = "glass card-hover";
  card.style.cssText = "border-radius:12px;padding:18px;cursor:pointer;position:relative;";
  const dl = opp.deadline ? deadlineLabel(opp.deadline) : null;
  const pColor = priorityColor(opp.priorityScore || 5);
  const barWidth = ((opp.priorityScore || 5) / 10 * 100).toFixed(0);
  const tags = (opp.tags || []).slice(0, 3);
  const id = opp.id;
  const snoozed = opp.snoozedUntil && new Date(opp.snoozedUntil) > new Date();
  const statusTip = opp.status === "new" ? "Mark as in progress" : opp.status === "in-progress" ? "Mark as followed up" : "Reset to new";
  const statusIcon = opp.status === "new" ? "play" : opp.status === "in-progress" ? "check" : "reset";
  const statusBtnLabel = opp.status === "new" ? "Start" : opp.status === "in-progress" ? "Done" : "Reset";

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <span class="tag ${typeClass(opp.type)}">${opp.type||"Other"}</span>
        <span class="tag ${statusClass(opp.status)}">${statusLabel(opp.status)}</span>
        ${snoozed ? '<span class="tag status-archived">Snoozed</span>' : ""}
      </div>
      ${dl ? `<span class="${dl.cls}" style="font-size:12px;font-weight:500;">${dl.text}</span>` : ""}
    </div>
    <h3 class="card-title" style="font-size:15px;font-weight:500;color:var(--text);margin:0 0 4px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(opp.title||"Untitled")}</h3>
    ${opp.organization ? `<p class="card-org" style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">${escHtml(opp.organization)}${opp.location?` · ${escHtml(opp.location)}`:""}</p>` : ""}
    <p class="card-desc" style="font-size:13px;color:var(--text-secondary);margin:0 0 14px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(opp.description||"")}</p>
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
        <span class="section-label" style="margin:0;">Priority</span>
        <span style="font-size:13px;font-weight:600;color:${pColor};">${opp.priorityScore||"?"}/10</span>
      </div>
      <div class="priority-bar"><div class="priority-fill" style="width:${barWidth}%;background:${pColor};"></div></div>
    </div>
    <div class="card-action-box" style="margin-bottom:14px;">
      <p class="card-action-label">Next Action</p>
      <p class="card-action-text" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(opp.followUpAction||"No action extracted")}</p>
    </div>
    ${tags.length ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px;">${tags.map(t=>`<span style="padding:2px 8px;border-radius:4px;font-size:11px;background:var(--tag-bg);color:var(--tag-text);">${escHtml(t)}</span>`).join("")}</div>` : ""}
    <div style="display:flex;gap:8px;padding-top:12px;border-top:1px solid var(--border);">
      ${!isArchive ? `
        <button onclick="event.stopPropagation();cycleStatus('${id}')" class="icon-btn" style="flex:1;gap:6px;font-size:12px;" data-tip="${statusTip}">${icon(statusIcon,14)} ${statusBtnLabel}</button>
        <button onclick="event.stopPropagation();archiveOpp('${id}')" class="icon-btn" data-tip="Move to archive">${icon("archive",14)}</button>
      ` : `
        <button onclick="event.stopPropagation();unarchiveOpp('${id}')" class="icon-btn" style="flex:1;gap:6px;font-size:12px;" data-tip="Restore to dashboard">${icon("restore",14)} Restore</button>
      `}
      <button onclick="event.stopPropagation();confirmDelete('${id}')" class="icon-btn danger" data-tip="Permanently delete">${icon("trash",14)}</button>
      <button onclick="event.stopPropagation();openDetail('${id}')" class="icon-btn" data-tip="View full details">${icon("eye",14)}</button>
    </div>`;
  card.addEventListener("click", () => openDetail(opp.id));
  return card;
}

function updateStats() {
  const active = opportunities.filter(o => o.status !== "archived" && (!o.snoozedUntil || new Date(o.snoozedUntil) <= new Date()));
  document.getElementById("s-total").textContent = active.length;
  document.getElementById("s-high").textContent = active.filter(o => (o.priorityScore||0) >= 8).length;
  document.getElementById("s-soon").textContent = active.filter(o => { const d=getDaysUntil(o.deadline); return d!==null&&d<=14; }).length;
  document.getElementById("s-done").textContent = opportunities.filter(o => o.status==="done").length;
  const urgent = active.filter(o => { const d=getDaysUntil(o.deadline); return d!==null&&d<=7; });
  document.getElementById("stat-total").textContent = active.length;
  const wrap = document.getElementById("stat-urgent-wrap");
  if (urgent.length > 0) { wrap.style.display = "block"; document.getElementById("stat-urgent").textContent = `${urgent.length} due within 7 days`; }
  else wrap.style.display = "none";
}

// ============================================================
// ACTIONS
// ============================================================
function cycleStatus(id) {
  const opp = opportunities.find(o => o.id === id);
  if (!opp) return;
  if (opp.status === "in-progress") {
    showOutcomePrompt(id);
    return;
  }
  const prev = opp.status;
  opp.status = ({ new:"in-progress", done:"new" })[opp.status] || "new";
  addActivity(opp, "status_change", { from: prev, to: opp.status });
  save(); renderCards();
  showToast(`Moved to "${statusLabel(opp.status)}"`, "info");
}

function showOutcomePrompt(id) {
  const opp = opportunities.find(o => o.id === id);
  if (!opp) return;
  detailOppId = id;
  document.getElementById("outcome-modal").style.display = "flex";
}

function setOutcome(outcome) {
  const opp = opportunities.find(o => o.id === detailOppId);
  if (!opp) return;
  opp.status = "done";
  opp.outcome = outcome;
  addActivity(opp, "status_change", { from: "in-progress", to: "done", outcome });
  save();
  document.getElementById("outcome-modal").style.display = "none";
  closeDetail();
  renderCards();
  showToast("Marked as followed up!", "success");
}

function archiveOpp(id) {
  const opp = opportunities.find(o => o.id === id);
  if (!opp) return;
  const prev = opp.status;
  opp.status = "archived";
  addActivity(opp, "status_change", { from: prev, to: "archived" });
  save(); renderCards();
  showToast("Archived", "info");
}

function unarchiveOpp(id) {
  const opp = opportunities.find(o => o.id === id);
  if (!opp) return;
  opp.status = "new";
  addActivity(opp, "status_change", { to: "new" });
  save(); renderArchive();
  showToast("Restored to dashboard", "success");
}

function confirmDelete(id) {
  pendingDeleteId = id;
  document.getElementById("delete-modal").style.display = "flex";
  document.getElementById("confirm-delete-btn").onclick = () => {
    opportunities = opportunities.filter(o => o.id !== pendingDeleteId);
    save(); closeDeleteModal(); closeDetail(); renderCards(); renderArchive();
    showToast("Deleted", "info");
  };
}

function closeDeleteModal() {
  document.getElementById("delete-modal").style.display = "none";
  pendingDeleteId = null;
}

// ============================================================
// DETAIL MODAL
// ============================================================
function openDetail(id) {
  detailOppId = id;
  const opp = opportunities.find(o => o.id === id);
  if (!opp) return;

  const dl = opp.deadline ? deadlineLabel(opp.deadline) : null;
  const pColor = priorityColor(opp.priorityScore || 5);
  const barWidth = ((opp.priorityScore||5)/10*100).toFixed(0);
  const details = opp.keyDetails || [];
  const latestDraft = opp.drafts?.[0];
  const activities = (opp.activity || []).slice(0, 10);
  if (latestDraft) {
    latestDrafts[id] = { subject: latestDraft.subject || "", search: opp.organization || opp.title || "" };
  }

  const detailStatusTip = opp.status === "new" ? "Mark as in progress" : opp.status === "in-progress" ? "Mark as followed up" : "Reset to new";
  const detailStatusBtn = opp.status === "new" ? `${icon("play",14)} Start Progress` : opp.status === "in-progress" ? `${icon("check",14)} Mark Done` : `${icon("reset",14)} Reset`;

  document.getElementById("detail-content").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <span class="tag ${typeClass(opp.type)}">${opp.type||"Other"}</span>
        <span class="tag ${statusClass(opp.status)}">${statusLabel(opp.status)}</span>
        ${opp.outcome ? `<span class="tag status-done">${escHtml(opp.outcome)}</span>` : ""}
      </div>
      <button onclick="closeDetail()" class="icon-btn" data-tip="Close details">${icon("close",14)}</button>
    </div>
    <div class="detail-section">
      <h2 style="font-size:20px;font-weight:500;color:var(--text);margin:0 0 6px;">${escHtml(opp.title||"Untitled")}</h2>
      ${opp.organization ? `<p style="font-size:14px;color:var(--accent);margin:0 0 4px;">${escHtml(opp.organization)}${opp.location?` · ${escHtml(opp.location)}`:""}</p>` : ""}
      ${opp.compensation ? `<p style="font-size:14px;color:var(--success);margin:0;">${escHtml(opp.compensation)}</p>` : ""}
    </div>
    <div class="detail-section">
      <p class="section-label">Description</p>
      <p style="font-size:14px;color:var(--text-secondary);margin:0;line-height:1.6;">${escHtml(opp.description||"No description")}</p>
    </div>
    <div class="detail-section" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <p class="section-label">Priority</p>
        <p style="font-size:28px;font-weight:600;color:${pColor};margin:0;">${opp.priorityScore||"?"}<span style="font-size:14px;color:var(--text-dim);">/10</span></p>
        <div class="priority-bar" style="margin:6px 0;"><div class="priority-fill" style="width:${barWidth}%;background:${pColor};"></div></div>
        <p style="font-size:12px;color:var(--text-muted);margin:0;">${escHtml(opp.priorityReason||"")}</p>
      </div>
      <div>
        <p class="section-label">Deadline</p>
        ${dl ? `<p class="${dl.cls}" style="font-size:18px;font-weight:500;margin:0;">${dl.text}</p>` : '<p style="font-size:14px;color:var(--text-dim);">No deadline</p>'}
        ${opp.deadline ? `<button onclick="addToGoogleCalendar(opportunities.find(o=>o.id==='${id}'))" class="link-btn icon-btn" style="margin-top:8px;display:inline-flex;gap:6px;align-items:center;padding:6px 10px;" data-tip="Add deadline to Google Calendar">${icon("calendar",14)} Calendar</button>` : ""}
      </div>
    </div>
    <div class="detail-section">
      <p class="section-label">Next Action</p>
      <div class="card-action-box">
        <p style="font-size:15px;color:var(--text-secondary);margin:0;line-height:1.5;">${escHtml(opp.followUpAction||"No action")}</p>
      </div>
    </div>
    <div class="detail-section">
      <p class="section-label">Follow-Up Draft</p>
      <button id="draft-generate-btn" onclick="generateDraft('${id}')" class="btn-primary" style="width:100%;padding:10px;cursor:pointer;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:8px;" data-tip="Generate a ready-to-send follow-up message">${icon("sparkles",16)} Generate Draft</button>
      ${latestDraft ? `
        <div style="padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--accent-softer);">
          <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px;">${escHtml(latestDraft.channel)} ${latestDraft.subject ? `· ${escHtml(latestDraft.subject)}` : ""}</p>
          <textarea id="draft-textarea" class="preview-field" style="min-height:120px;margin:0;">${escHtml(latestDraft.body)}</textarea>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
            <button onclick="copyDraft(document.getElementById('draft-textarea').value)" class="icon-btn" style="gap:6px;font-size:12px;" data-tip="Copy draft to clipboard">${icon("copy",14)} Copy</button>
            ${latestDraft.channel === "email" ? `<button onclick="openGmailDraft(latestDrafts['${id}'].subject, document.getElementById('draft-textarea').value)" class="icon-btn" style="gap:6px;font-size:12px;" data-tip="Open draft in Gmail">${icon("mail",14)} Gmail</button>` : ""}
            ${latestDraft.channel === "linkedin_dm" ? `<button onclick="openLinkedInSearch(latestDrafts['${id}'].search)" class="icon-btn" style="gap:6px;font-size:12px;" data-tip="Search contact on LinkedIn">${icon("linkedin",14)} LinkedIn</button>` : ""}
          </div>
          ${latestDraft.tips ? `<p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">${escHtml(latestDraft.tips)}</p>` : ""}
        </div>` : '<p style="font-size:13px;color:var(--text-dim);">No drafts yet</p>'}
    </div>
    ${details.length ? `<div class="detail-section"><p class="section-label">Key Details</p>${details.map(d=>`<div style="display:flex;gap:8px;margin-bottom:6px;align-items:flex-start;">${icon("dot",8)}<span style="font-size:14px;color:var(--text-secondary);">${escHtml(d)}</span></div>`).join("")}</div>` : ""}
    ${opp.contactInfo ? `<div class="detail-section"><p class="section-label">Contact</p><p style="font-size:14px;color:var(--accent);">${escHtml(opp.contactInfo)} <button onclick="copyDraft('${escHtml(opp.contactInfo)}')" class="link-btn" data-tip="Copy contact information">Copy</button></p></div>` : ""}
    <div class="detail-section">
      <p class="section-label">Notes</p>
      <textarea id="detail-notes" onchange="saveNotes('${id}')" placeholder="Add context for this opportunity..." class="preview-field" style="min-height:60px;margin:0;">${escHtml(opp.notes||"")}</textarea>
    </div>
    <div class="detail-section">
      <p class="section-label">Reminders</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="setReminder('${id}','1day')" class="btn-secondary" style="font-size:12px;padding:6px 12px;" data-tip="Notify one day before the deadline">1 day before</button>
        <button onclick="setReminder('${id}','dayof')" class="btn-secondary" style="font-size:12px;padding:6px 12px;" data-tip="Notify on the deadline date">Day of</button>
        <button onclick="setReminder('${id}','stalled')" class="btn-secondary" style="font-size:12px;padding:6px 12px;" data-tip="Remind if no action in 3 days">3d stalled</button>
        <button onclick="snoozeOpp('${id}',3)" class="btn-secondary" style="font-size:12px;padding:6px 12px;" data-tip="Hide from dashboard for 3 days">Snooze 3d</button>
        <button onclick="snoozeOpp('${id}',7)" class="btn-secondary" style="font-size:12px;padding:6px 12px;" data-tip="Hide from dashboard for 7 days">Snooze 7d</button>
        ${opp.reminderAt ? `<button onclick="setReminder('${id}','clear')" class="btn-secondary danger" style="font-size:12px;padding:6px 12px;color:var(--danger);" data-tip="Remove scheduled reminder">Clear</button>` : ""}
      </div>
      ${opp.reminderAt ? `<p style="font-size:12px;color:var(--text-muted);margin:8px 0 0;">Reminder: ${new Date(opp.reminderAt).toLocaleString()}</p>` : ""}
    </div>
    ${activities.length ? `<div class="detail-section"><p class="section-label">Activity</p>${activities.map(a=>`<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">${new Date(a.at).toLocaleString()} — ${escHtml(a.type)}${a.meta?.outcome ? ` (${escHtml(a.meta.outcome)})` : ""}</div>`).join("")}</div>` : ""}
    <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;">
      ${opp.status !== "archived" ? `
        <button onclick="cycleStatus('${id}')" class="btn-primary" style="padding:10px 20px;display:flex;align-items:center;gap:8px;cursor:pointer;" data-tip="${detailStatusTip}">${detailStatusBtn}</button>
        <button onclick="archiveOpp('${id}');closeDetail()" class="btn-secondary" style="padding:10px 16px;display:flex;align-items:center;gap:6px;" data-tip="Move to archive">${icon("archive",14)} Archive</button>
      ` : `<button onclick="unarchiveOpp('${id}');closeDetail()" class="btn-primary" style="padding:10px 20px;display:flex;align-items:center;gap:8px;" data-tip="Restore to dashboard">${icon("restore",14)} Restore</button>`}
      <button onclick="confirmDelete('${id}')" class="btn-secondary danger" style="padding:10px 16px;margin-left:auto;color:var(--danger);display:flex;align-items:center;gap:6px;" data-tip="Permanently delete this opportunity">${icon("trash",14)} Delete</button>
    </div>`;

  document.getElementById("detail-modal").style.display = "flex";
}

function saveNotes(id) {
  const opp = opportunities.find(o => o.id === id);
  if (!opp) return;
  const notes = document.getElementById("detail-notes")?.value || "";
  if (notes !== opp.notes) {
    opp.notes = notes;
    addActivity(opp, "note", {});
    save();
  }
}

function closeDetail() { document.getElementById("detail-modal").style.display = "none"; }

// ============================================================
// EXPORT
// ============================================================
function exportJSON() {
  const blob = new Blob([JSON.stringify(opportunities, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `resurface-export-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  showToast("Exported JSON", "success");
}

function exportCSV() {
  const headers = ["title","type","organization","location","deadline","priorityScore","status","followUpAction","compensation","contactInfo"];
  const rows = opportunities.map(o => headers.map(h => `"${String(o[h]||"").replace(/"/g,'""')}"`).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `resurface-export-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  showToast("Exported CSV", "success");
}

function importJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) return showToast("Invalid file", "error");
    opportunities = data.map(normalizeOpp);
    save();
    renderCards();
    showToast(`Imported ${data.length} opportunities`, "success");
  };
  input.click();
}

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function showToast(msg, type) {
  const inner = document.getElementById("toast-inner");
  const colors = {
    success: "background:#EDF7F2;border:1px solid #C8E6D8;color:var(--success);",
    info: "background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);",
    error: "background:var(--danger-soft);border:1px solid #E8C4C4;color:var(--danger);"
  };
  inner.style.cssText = colors[type] || colors.info;
  document.getElementById("toast-msg").textContent = msg;
  const toast = document.getElementById("toast");
  toast.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = "none"; }, 3000);
}

// ============================================================
// SHARE TARGET / URL PARAMS
// ============================================================
function handleShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const text = params.get("text") || params.get("title") || "";
  const url = params.get("url") || "";
  const combined = [text, url].filter(Boolean).join("\n\n");
  if (combined.length >= 10) {
    showView("add");
    document.getElementById("paste-input").value = combined;
    window.history.replaceState({}, "", "/");
  }
}

// ============================================================
// INIT
// ============================================================
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeDetail(); closeDeleteModal(); closeAuthModal(); closeOnboarding(); }
});

document.addEventListener("DOMContentLoaded", async () => {
  opportunities = loadLocal();
  renderExampleButtons();
  renderCards();
  handleShareTarget();
  initTooltips();

  const ta = document.getElementById("paste-input");
  if (ta) ta.addEventListener("keydown", e => { if ((e.metaKey||e.ctrlKey)&&e.key==="Enter") extractOpportunity(); });

  await initAuth();
  requestNotificationPermission();
  setInterval(checkReminders, 60000);
  checkReminders();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.update());
    });
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
});

// Expose globals for inline handlers
window.showView = showView;
window.toggleSidebar = toggleSidebar;
window.extractOpportunity = extractOpportunity;
window.cancelPreview = cancelPreview;
window.saveFromPreview = saveFromPreview;
window.setFilter = setFilter;
window.onSearchInput = onSearchInput;
window.cycleStatus = cycleStatus;
window.archiveOpp = archiveOpp;
window.unarchiveOpp = unarchiveOpp;
window.confirmDelete = confirmDelete;
window.closeDeleteModal = closeDeleteModal;
window.openDetail = openDetail;
window.closeDetail = closeDetail;
window.generateDraft = generateDraft;
window.copyDraft = copyDraft;
window.openGmailDraft = openGmailDraft;
window.openLinkedInSearch = openLinkedInSearch;
window.addToGoogleCalendar = addToGoogleCalendar;
window.setReminder = setReminder;
window.snoozeOpp = snoozeOpp;
window.saveNotes = saveNotes;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.signInWithEmail = signInWithEmail;
window.signInWithGoogle = signInWithGoogle;
window.signOut = signOut;
window.migrateLocalToCloud = migrateLocalToCloud;
window.saveOnboarding = saveOnboarding;
window.closeOnboarding = closeOnboarding;
window.openProfileSettings = openProfileSettings;
window.upgradeToPro = upgradeToPro;
window.exportJSON = exportJSON;
window.exportCSV = exportCSV;
window.importJSON = importJSON;
window.setOutcome = setOutcome;
