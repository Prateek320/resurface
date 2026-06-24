require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// Required behind Railway/Render so rate limiting uses real client IPs
app.set("trust proxy", 1);

const FREE_EXTRACTIONS = 10;
const FREE_DRAFTS = 3;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests. Please try again later." },
});

app.use("/api/", apiLimiter);

const SYSTEM_PROMPT = `You are an expert opportunity analyst. When given raw text (WhatsApp messages, LinkedIn posts, job postings, founder profiles, scholarship announcements, etc.), you extract structured opportunity data.

Always return valid JSON matching this exact schema:
{
  "type": "Job" | "Internship" | "Scholarship" | "Founder/Startup" | "Client/Sales" | "Networking" | "Grant" | "Conference" | "Other",
  "title": "string (max 70 chars, descriptive and specific)",
  "organization": "string or null",
  "location": "string or null (city/remote/hybrid)",
  "description": "string (2-3 sentence summary)",
  "deadline": "ISO 8601 date string or null",
  "followUpAction": "string (specific, actionable next step — e.g. 'Send a cold DM on LinkedIn mentioning your ML project', not just 'Apply')",
  "priorityScore": number (1-10, where 10 = urgent/high-impact, be discriminating),
  "priorityReason": "string (one sentence explaining the score)",
  "keyDetails": ["string", ...] (3-5 bullet points of important facts),
  "contactInfo": "string or null",
  "compensation": "string or null (salary, stipend, or grant amount if mentioned)",
  "tags": ["string", ...] (2-4 short tags like 'remote', 'equity', 'fast-apply', 'referral-needed')
}

Priority scoring guide:
- 9-10: Hard deadline within 2 weeks OR rare, high-impact opportunity
- 7-8: Deadline within a month OR strong fit with clear path to apply
- 5-6: Good opportunity, no urgent deadline
- 3-4: Worth tracking but low urgency or poor fit signals
- 1-2: Informational or very long-shot

Be specific and actionable. Never return vague follow-up actions like "look into it" or "apply online".`;

function buildProfileContext(profile) {
  if (!profile || !profile.onboarding_complete) return "";
  const parts = [];
  if (profile.role) parts.push(`Role/goal: ${profile.role}`);
  if (profile.location) parts.push(`Location: ${profile.location}`);
  if (profile.skills) parts.push(`Skills: ${profile.skills}`);
  if (profile.interests?.length) parts.push(`Interests: ${profile.interests.join(", ")}`);
  if (!parts.length) return "";
  return `\n\nUser profile (use to personalize priorityScore and followUpAction):\n${parts.join("\n")}`;
}

const DRAFT_PROMPT = `You are an expert at writing concise, authentic follow-up messages for career and business opportunities.

Given an opportunity and optional user context, write a ready-to-send follow-up message.

Return valid JSON:
{
  "channel": "email" | "linkedin_dm" | "whatsapp" | "other",
  "subject": "string or null (email subject line only)",
  "body": "string (the full message to send, 80-200 words, warm and specific)",
  "tips": "string (one sentence tip for sending this)"
}

Rules:
- Reference specific details from the opportunity (org name, role, deadline)
- Sound human, not templated
- Match channel tone (LinkedIn DM = shorter, email = slightly more formal)
- Do not invent credentials the user didn't provide — use placeholders like [your relevant project] if needed`;

async function getUserFromToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !supabaseAdmin) return null;
  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function getProfile(userId) {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

async function ensureMonthReset(profile) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  if (!profile.month_reset || profile.month_reset < monthStart) {
    await supabaseAdmin
      .from("profiles")
      .update({
        extractions_this_month: 0,
        drafts_this_month: 0,
        month_reset: monthStart,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);
    profile.extractions_this_month = 0;
    profile.drafts_this_month = 0;
    profile.month_reset = monthStart;
  }
  return profile;
}

async function checkUsage(profile, type) {
  profile = await ensureMonthReset(profile);
  const isPro = profile.tier === "pro";
  if (isPro) return { allowed: true, profile };

  if (type === "extract" && profile.extractions_this_month >= FREE_EXTRACTIONS) {
    return {
      allowed: false,
      profile,
      error: `Free plan limit: ${FREE_EXTRACTIONS} extractions/month. Upgrade to Pro for unlimited.`,
    };
  }
  if (type === "draft" && profile.drafts_this_month >= FREE_DRAFTS) {
    return {
      allowed: false,
      profile,
      error: `Free plan limit: ${FREE_DRAFTS} AI drafts/month. Upgrade to Pro for unlimited.`,
    };
  }
  return { allowed: true, profile };
}

async function incrementUsage(userId, type) {
  if (!supabaseAdmin) return;
  const profile = await getProfile(userId);
  if (!profile || profile.tier === "pro") return;
  const field =
    type === "extract" ? "extractions_this_month" : "drafts_this_month";
  await supabaseAdmin
    .from("profiles")
    .update({
      [field]: (profile[field] || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
}

// --- Config endpoint for client ---
app.get("/api/config", (_, res) => {
  res.json({
    supabaseUrl: supabaseUrl || null,
    supabaseAnonKey: supabaseAnonKey || null,
    limits: { freeExtractions: FREE_EXTRACTIONS, freeDrafts: FREE_DRAFTS },
  });
});

// --- Auth middleware (optional) ---
async function optionalAuth(req, res, next) {
  req.user = await getUserFromToken(req);
  req.profile = req.user ? await getProfile(req.user.id) : null;
  next();
}

// --- Extract ---
app.post("/api/extract", optionalAuth, async (req, res) => {
  const { text, profile: clientProfile } = req.body;

  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "Please provide more text to analyze." });
  }
  if (text.trim().length > 8000) {
    return res.status(400).json({ error: "Text too long. Please paste up to 8000 characters." });
  }

  const profile = req.profile || clientProfile;
  if (req.user && req.profile) {
    const usage = await checkUsage(req.profile, "extract");
    if (!usage.allowed) {
      return res.status(402).json({ error: usage.error, limitReached: true });
    }
  }

  if (!openai) {
    return res.status(503).json({ error: "OpenAI API key not configured." });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + buildProfileContext(profile) },
        {
          role: "user",
          content: `Extract the opportunity from this text:\n\n${text.trim()}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1000,
    });

    const data = JSON.parse(completion.choices[0].message.content);
    if (req.user) await incrementUsage(req.user.id, "extract");

    res.json({ success: true, opportunity: data });
  } catch (err) {
    console.error("OpenAI error:", err.message);
    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid OpenAI API key." });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: "Rate limit hit. Please wait a moment and try again." });
    }
    res.status(500).json({ error: "AI extraction failed. Please try again." });
  }
});

// --- Draft follow-up ---
app.post("/api/draft-followup", optionalAuth, async (req, res) => {
  const { opportunity, profile: clientProfile } = req.body;
  if (!opportunity?.title) {
    return res.status(400).json({ error: "Opportunity data required." });
  }

  const profile = req.profile || clientProfile;
  if (req.user && req.profile) {
    const usage = await checkUsage(req.profile, "draft");
    if (!usage.allowed) {
      return res.status(402).json({ error: usage.error, limitReached: true });
    }
  }

  if (!openai) {
    return res.status(503).json({ error: "OpenAI API key not configured." });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: DRAFT_PROMPT },
        {
          role: "user",
          content: `Opportunity:\n${JSON.stringify(opportunity, null, 2)}${buildProfileContext(profile)}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 800,
    });

    const draft = JSON.parse(completion.choices[0].message.content);
    if (req.user) await incrementUsage(req.user.id, "draft");

    res.json({ success: true, draft });
  } catch (err) {
    console.error("Draft error:", err.message);
    res.status(500).json({ error: "Failed to generate draft. Please try again." });
  }
});

// --- Profile ---
app.get("/api/profile", optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ authenticated: false });
  const profile = await getProfile(req.user.id);
  res.json({ authenticated: true, profile, email: req.user.email });
});

app.put("/api/profile", optionalAuth, async (req, res) => {
  if (!req.user || !supabaseAdmin) {
    return res.status(401).json({ error: "Sign in required." });
  }
  const { role, interests, location, skills, onboarding_complete, tier } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (role !== undefined) updates.role = role;
  if (interests !== undefined) updates.interests = interests;
  if (location !== undefined) updates.location = location;
  if (skills !== undefined) updates.skills = skills;
  if (onboarding_complete !== undefined) updates.onboarding_complete = onboarding_complete;
  if (tier !== undefined && ["free", "pro"].includes(tier)) updates.tier = tier;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(updates)
    .eq("id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ profile: data });
});

// --- Opportunities CRUD (cloud sync) ---
app.get("/api/opportunities", optionalAuth, async (req, res) => {
  if (!req.user || !supabaseAdmin) {
    return res.json({ opportunities: null, cloud: false });
  }
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .select("data")
    .eq("user_id", req.user.id)
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({
    cloud: true,
    opportunities: (data || []).map((r) => r.data),
  });
});

app.put("/api/opportunities/sync", optionalAuth, async (req, res) => {
  if (!req.user || !supabaseAdmin) {
    return res.status(401).json({ error: "Sign in required for cloud sync." });
  }
  const { opportunities } = req.body;
  if (!Array.isArray(opportunities)) {
    return res.status(400).json({ error: "Invalid opportunities array." });
  }

  const rows = opportunities.map((opp) => ({
    id: opp.id,
    user_id: req.user.id,
    data: opp,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("opportunities")
    .upsert(rows, { onConflict: "id" });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, count: rows.length });
});

app.delete("/api/opportunities/:id", optionalAuth, async (req, res) => {
  if (!req.user || !supabaseAdmin) {
    return res.status(401).json({ error: "Sign in required." });
  }
  await supabaseAdmin
    .from("opportunities")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);
  res.json({ success: true });
});

// --- Usage ---
app.get("/api/usage", optionalAuth, async (req, res) => {
  if (!req.user || !req.profile) {
    return res.json({
      tier: "free",
      extractionsUsed: 0,
      extractionsLimit: FREE_EXTRACTIONS,
      draftsUsed: 0,
      draftsLimit: FREE_DRAFTS,
    });
  }
  const profile = await ensureMonthReset(req.profile);
  res.json({
    tier: profile.tier || "free",
    extractionsUsed: profile.extractions_this_month || 0,
    extractionsLimit: profile.tier === "pro" ? null : FREE_EXTRACTIONS,
    draftsUsed: profile.drafts_this_month || 0,
    draftsLimit: profile.tier === "pro" ? null : FREE_DRAFTS,
  });
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Resurface running at http://localhost:${PORT}\n`);
  if (!supabaseAdmin) {
    console.log("ℹ️  Supabase not configured — running in local-only mode.\n");
  }
});
