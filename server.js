require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
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

function env(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

const openaiKey = env("OPENAI_API_KEY");
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

const geminiKey = env("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY");
const GEMINI_MODEL = env("GEMINI_MODEL") || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = env("GEMINI_MODEL")
  ? [GEMINI_MODEL]
  : ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const gemini = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;

function getAIProvider() {
  if (gemini) return "gemini";
  if (openai) return "openai";
  return null;
}

function hasAI() {
  return !!(gemini || openai);
}

function parseJsonText(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

function safeParseJSON(text) {
  try {
    return JSON.parse(parseJsonText(text));
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Model returned invalid JSON");
  }
}

function getGeminiText(response) {
  try {
    return response.text();
  } catch {
    const reason = response.candidates?.[0]?.finishReason || "blocked";
    throw new Error(`Gemini response blocked or empty (${reason})`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthError(err) {
  const msg = (err.message || "").toLowerCase();
  return err.status === 401 || err.status === 403 || msg.includes("api key") || msg.includes("permission");
}

async function callGeminiModel(modelName, system, user, temperature, maxTokens, useSystemInstruction) {
  const model = gemini.getGenerativeModel({
    model: modelName,
    ...(useSystemInstruction ? { systemInstruction: system } : {}),
    generationConfig: {
      responseMimeType: "application/json",
      temperature,
      maxOutputTokens: maxTokens,
    },
  });
  const prompt = useSystemInstruction ? user : `${system}\n\n---\n\n${user}`;
  const result = await model.generateContent(prompt);
  return safeParseJSON(getGeminiText(result.response));
}

async function geminiCompleteJSON({ system, user, temperature, maxTokens }) {
  let lastError;
  for (const modelName of GEMINI_FALLBACK_MODELS) {
    for (const useSystemInstruction of [true, false]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await callGeminiModel(
            modelName,
            system,
            user,
            temperature,
            maxTokens,
            useSystemInstruction
          );
        } catch (err) {
          lastError = err;
          console.error(`Gemini error [${modelName}]:`, err.message);
          if (isAuthError(err)) throw err;
          if (isRateLimitError(err) && attempt < 2) {
            await sleep(2000 * (attempt + 1));
            continue;
          }
          break;
        }
      }
      if (lastError && isModelError(lastError)) break;
    }
  }
  throw lastError || new Error("Gemini request failed");
}

function isRateLimitError(err) {
  const msg = err.message || "";
  return (
    err.status === 429 ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("rate limit")
  );
}

function isModelError(err) {
  const msg = (err.message || "").toLowerCase();
  return err.status === 404 || msg.includes("not found") || msg.includes("deprecated");
}

async function completeJSON({ system, user, temperature = 0.2, maxTokens = 1000 }) {
  if (gemini) {
    return geminiCompleteJSON({ system, user, temperature, maxTokens });
  }

  if (openai) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature,
      max_tokens: maxTokens,
    });
    return JSON.parse(completion.choices[0].message.content);
  }

  throw new Error("No AI provider configured");
}

function mapAIError(err, res) {
  console.error("AI error:", err.message);
  const status = err.status || err.response?.status;
  if (status === 401 || err.message?.includes("API key")) {
    return res.status(401).json({ error: "Invalid AI API key." });
  }
  if (isModelError(err)) {
    return res.status(503).json({
      error: "AI model unavailable. Set GEMINI_MODEL to gemini-2.5-flash-lite on Render and redeploy.",
    });
  }
  if (isRateLimitError(err)) {
    return res.status(429).json({
      error:
        "Gemini free tier limit reached. Wait 1–2 minutes between tries. Free accounts allow ~15 requests/minute.",
    });
  }
  if (err.message?.includes("invalid JSON") || err.message?.includes("blocked")) {
    return res.status(500).json({ error: "AI returned an unusable response. Please try again." });
  }
  const hint = (err.message || "").slice(0, 160);
  return res.status(500).json({
    error: "AI request failed. Please try again.",
    hint: hint || undefined,
  });
}

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
    supabaseConfigured: !!(supabaseUrl && supabaseAnonKey),
    limits: { freeExtractions: FREE_EXTRACTIONS, freeDrafts: FREE_DRAFTS },
    aiConfigured: hasAI(),
    aiProvider: getAIProvider(),
    aiModel: gemini ? GEMINI_MODEL : openai ? "gpt-4o" : null,
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

  if (!hasAI()) {
    return res.status(503).json({ error: "AI API key not configured. Set GEMINI_API_KEY or OPENAI_API_KEY." });
  }

  try {
    const data = await completeJSON({
      system: SYSTEM_PROMPT + buildProfileContext(profile),
      user: `Extract the opportunity from this text:\n\n${text.trim()}`,
      temperature: 0.2,
      maxTokens: 1000,
    });
    if (req.user) await incrementUsage(req.user.id, "extract");

    res.json({ success: true, opportunity: data });
  } catch (err) {
    return mapAIError(err, res);
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

  if (!hasAI()) {
    return res.status(503).json({ error: "AI API key not configured. Set GEMINI_API_KEY or OPENAI_API_KEY." });
  }

  try {
    const draft = await completeJSON({
      system: DRAFT_PROMPT,
      user: `Opportunity:\n${JSON.stringify(opportunity, null, 2)}${buildProfileContext(profile)}`,
      temperature: 0.4,
      maxTokens: 800,
    });
    if (req.user) await incrementUsage(req.user.id, "draft");

    res.json({ success: true, draft });
  } catch (err) {
    return mapAIError(err, res);
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

app.get("/api/ai-ping", async (_, res) => {
  if (!gemini) {
    return res.json({ ok: false, reason: "no_ai_key" });
  }
  for (const modelName of GEMINI_FALLBACK_MODELS) {
    try {
      const model = gemini.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Reply with exactly the word "ok"');
      return res.json({
        ok: true,
        model: modelName,
        reply: getGeminiText(result.response).slice(0, 20),
      });
    } catch (err) {
      if (isAuthError(err)) {
        return res.json({ ok: false, model: modelName, error: err.message?.slice(0, 200) });
      }
    }
  }
  res.json({ ok: false, error: "All Gemini models failed. Check API key and model access." });
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Resurface running at http://localhost:${PORT}\n`);
  if (gemini) console.log(`✨ AI: Gemini (${GEMINI_MODEL})\n`);
  else if (openai) console.log("✨ AI: OpenAI (gpt-4o)\n");
  else console.log("⚠️  No AI key — set GEMINI_API_KEY or OPENAI_API_KEY\n");
  if (!supabaseAdmin) {
    console.log("ℹ️  Supabase not configured — running in local-only mode.\n");
  }
});
