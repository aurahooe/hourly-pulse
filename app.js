import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
let session = null;
let authMode = "signin";

function pad(n) { return String(n).padStart(2, "0"); }

function tick() {
  const now = new Date();
  $("clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  const ms = next - now;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  $("remain").textContent = `${m}m ${pad(s)}s`;
}
setInterval(tick, 250);
tick();

async function loadFeature() {
  const { data } = await sb.from("pulse_hours").select("*").order("created_at", { ascending: false }).limit(1);
  const feat = data?.[0];
  if (!feat) return;
  $("featTitle").textContent = feat.title;
  $("featBody").textContent = feat.body;
}

function cardHTML(n, name) {
  const when = new Date(n.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `<article class="card">
    <h4>${escapeHtml(n.title || "Untitled")}</h4>
    <p>${escapeHtml(n.body)}</p>
    <div class="meta">${escapeHtml(name || "someone")} · ${when}${n.is_public ? " · public" : " · private"}</div>
  </article>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadWall() {
  const { data: notes } = await sb.from("pulse_notes").select("*").eq("is_public", true).order("created_at", { ascending: false }).limit(40);
  const ids = [...new Set((notes || []).map((n) => n.user_id))];
  let names = {};
  if (ids.length) {
    const { data: profiles } = await sb.from("pulse_profiles").select("id, display_name").in("id", ids);
    (profiles || []).forEach((p) => { names[p.id] = p.display_name; });
  }
  $("wall").innerHTML = (notes || []).map((n) => cardHTML(n, names[n.user_id])).join("") || "<p class='hint'>The wall is empty. Be the first to pin something public.</p>";
}

async function loadMine() {
  if (!session) {
    $("mine").innerHTML = "";
    return;
  }
  const { data } = await sb.from("pulse_notes").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false });
  $("mine").innerHTML = (data || []).map((n) => cardHTML(n, "you")).join("");
}

function setAuthUI() {
  if (session) {
    $("authBtn").textContent = "Sign out";
    $("noteForm").hidden = false;
    $("composerHint").textContent = "Write it down. Public notes hang on the wall for everyone.";
  } else {
    $("authBtn").textContent = "Sign in";
    $("noteForm").hidden = true;
    $("composerHint").textContent = "Sign in to leave a note. Mark it public and it hangs on the wall.";
  }
}

$("authBtn").onclick = async () => {
  if (session) {
    await sb.auth.signOut();
    session = null;
    setAuthUI();
    loadMine();
    return;
  }
  $("authModal").hidden = false;
};

$("closeAuth").onclick = () => { $("authModal").hidden = true; };

$("toggleAuth").onclick = () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  $("authTitle").textContent = authMode === "signin" ? "Sign in" : "Create account";
  $("toggleAuth").textContent = authMode === "signin" ? "Need an account?" : "Have an account?";
};

$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get("email");
  const password = fd.get("password");
  const name = fd.get("name") || email.split("@")[0];
  $("authErr").textContent = "";
  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: name } } });
      if (error) throw error;
      if (data.user) {
        await sb.from("pulse_profiles").upsert({ id: data.user.id, display_name: name });
      }
      $("authErr").textContent = data.session ? "" : "Check your email if confirmation is on, then sign in.";
      if (!data.session) return;
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    $("authModal").hidden = true;
  } catch (err) {
    $("authErr").textContent = err.message;
  }
};

$("noteForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!session) return;
  const fd = new FormData(e.target);
  const title = String(fd.get("title") || "").trim();
  const body = String(fd.get("body") || "").trim();
  const is_public = fd.get("is_public") === "on";
  if (!body) return;
  const { error } = await sb.from("pulse_notes").insert({
    user_id: session.user.id,
    title,
    body,
    is_public,
  });
  if (error) {
    alert(error.message);
    return;
  }
  e.target.reset();
  await Promise.all([loadWall(), loadMine()]);
};

sb.auth.onAuthStateChange(async (_e, s) => {
  session = s;
  if (s?.user) {
    const name = s.user.user_metadata?.display_name || s.user.email.split("@")[0];
    await sb.from("pulse_profiles").upsert({ id: s.user.id, display_name: name });
  }
  setAuthUI();
  loadMine();
});

sb.channel("pulse")
  .on("postgres_changes", { event: "*", schema: "public", table: "pulse_notes" }, () => { loadWall(); loadMine(); })
  .on("postgres_changes", { event: "*", schema: "public", table: "pulse_hours" }, loadFeature)
  .subscribe();

loadFeature();
loadWall();
setAuthUI();
