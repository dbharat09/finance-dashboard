import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc,
  deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------- Plan defaults (Bharat's plan, Nov 2026) ----------
const DEFAULT_CATEGORIES = [
  { id: "rent",        name: "Housing / Rent",        budget: 2426, carryOver: false, color: "#6366f1" },
  { id: "groceries",   name: "Groceries",             budget: 775,  carryOver: true,  color: "#22c55e" },
  { id: "utilities",   name: "Utilities & Internet",  budget: 225,  carryOver: true,  color: "#f59e0b" },
  { id: "dining",      name: "Dining Out",            budget: 200,  carryOver: true,  color: "#ef4444" },
  { id: "shopping",    name: "Shopping",              budget: 250,  carryOver: true,  color: "#ec4899" },
  { id: "health",      name: "Health & Medical",      budget: 100,  carryOver: true,  color: "#14b8a6" },
  { id: "subs",        name: "Subscriptions",         budget: 75,   carryOver: true,  color: "#8b5cf6" },
  { id: "personal",    name: "Personal Care",         budget: 75,   carryOver: true,  color: "#f97316" },
  { id: "entertainment", name: "Entertainment",       budget: 100,  carryOver: true,  color: "#06b6d4" },
  { id: "travel",      name: "Travel",                budget: 150,  carryOver: true,  color: "#3b82f6" },
  { id: "buffer",      name: "Buffer / Miscellaneous", budget: 124, carryOver: true,  color: "#64748b" },
];
const DEFAULT_PLAN = { income: 6000, savingsTarget: 1500, categories: DEFAULT_CATEGORIES };

// ---------- State ----------
let app, auth, db, user = null, householdId = null;
let plan = structuredClone(DEFAULT_PLAN);
let expenses = [];           // all expenses for the household
let editingId = null;        // expense id currently loaded in the form, if any
let viewMonth = monthKey(new Date());
let pieChart = null;
let unsubscribers = [];

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}
function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}
function show(view) {
  ["loading", "auth-view", "household-view", "dash-view"].forEach((v) => $(v).classList.add("hidden"));
  $(view).classList.remove("hidden");
}

// ---------- Boot ----------
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  $("loading").textContent = "Firebase is not configured yet. Fill in firebase-config.js (see README).";
  throw e;
}

onAuthStateChanged(auth, async (u) => {
  user = u;
  unsubscribers.forEach((f) => f()); unsubscribers = [];
  if (!u) { show("auth-view"); return; }
  const uref = doc(db, "users", u.uid);
  const usnap = await getDoc(uref);
  if (usnap.exists() && usnap.data().householdId) {
    householdId = usnap.data().householdId;
    subscribeHousehold();
    show("dash-view");
  } else {
    show("household-view");
  }
});

// ---------- Auth ----------
$("btn-signin").onclick = async () => {
  $("auth-error").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("auth-email").value.trim(), $("auth-password").value); }
  catch (e) { $("auth-error").textContent = e.message; }
};
$("btn-signup").onclick = async () => {
  $("auth-error").textContent = "";
  try { await createUserWithEmailAndPassword(auth, $("auth-email").value.trim(), $("auth-password").value); }
  catch (e) { $("auth-error").textContent = e.message; }
};
const doSignOut = () => signOut(auth);
$("btn-signout").onclick = doSignOut;
$("btn-signout-2").onclick = doSignOut;

// ---------- Household ----------
function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
$("btn-create-household").onclick = async () => {
  $("household-error").textContent = "";
  try {
    const code = makeCode();
    const href = await addDoc(collection(db, "households"), {
      name: "Our household", inviteCode: code, members: [user.uid], createdAt: serverTimestamp(),
    });
    householdId = href.id;
    await setDoc(doc(db, "invites", code), { householdId });
    const newPlan = structuredClone(DEFAULT_PLAN);
    newPlan.startMonth = monthKey(new Date());
    await setDoc(doc(db, "households", householdId, "meta", "plan"), newPlan);
    await setDoc(doc(db, "users", user.uid), { householdId });
    subscribeHousehold();
    show("dash-view");
  } catch (e) { $("household-error").textContent = e.message; }
};
$("btn-join-household").onclick = async () => {
  $("household-error").textContent = "";
  const code = $("join-code").value.trim().toUpperCase();
  if (!code) return;
  try {
    const isnap = await getDoc(doc(db, "invites", code));
    if (!isnap.exists()) { $("household-error").textContent = "That invite code was not found."; return; }
    const hid = isnap.data().householdId;
    // Joining = creating her own member document with the invite code as
    // proof. (Appending to the household's members array from outside does
    // not work: Firestore rules cannot verify arrayUnion transforms, and
    // non-members may not read the household doc to rebuild the array.)
    const mref = doc(db, "households", hid, "members", user.uid);
    try {
      await setDoc(mref, { code, joinedAt: serverTimestamp() });
    } catch (e) {
      // Re-joining: the create is denied because the doc already exists,
      // but then reading it back succeeds because she is a member.
      const msnap = await getDoc(mref).catch(() => null);
      if (!msnap || !msnap.exists()) {
        $("household-error").textContent = "Could not join that household. Check the code and try again.";
        return;
      }
    }
    householdId = hid;
    await setDoc(doc(db, "users", user.uid), { householdId });
    subscribeHousehold();
    show("dash-view");
  } catch (e) { $("household-error").textContent = e.message; }
};

function subscribeHousehold() {
  const hRef = doc(db, "households", householdId);
  unsubscribers.push(onSnapshot(hRef, (s) => {
    if (s.exists()) $("invite-chip").textContent = "Invite code: " + s.data().inviteCode;
  }));
  unsubscribers.push(onSnapshot(doc(db, "households", householdId, "meta", "plan"), (s) => {
    if (s.exists()) {
      plan = s.data();
      const anchor = planAnchor();
      if (viewMonth < anchor) viewMonth = anchor;
      render();
    }
  }));
  const q = query(collection(db, "households", householdId, "expenses"), orderBy("date", "desc"));
  unsubscribers.push(onSnapshot(q, (s) => {
    expenses = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }));
}

// ---------- Budget math (with carry-over chains) ----------
function spentIn(catId, key) {
  return expenses.filter((e) => e.categoryId === catId && e.date.startsWith(key))
    .reduce((a, e) => a + Number(e.amount), 0);
}
// Carry-over only counts from the month tracking started (the plan's
// startMonth, stamped when the household is created). Months before that
// must not mint phantom budget out of empty history.
function planAnchor() {
  if (plan.startMonth) return plan.startMonth;
  const cur = monthKey(new Date());
  if (!expenses.length) return cur;
  const earliest = expenses.reduce((a, e) => (e.date.slice(0, 7) < a ? e.date.slice(0, 7) : a), "9999-99");
  return earliest < cur ? earliest : cur;
}
// Effective budget for a category in a month: base budget plus rolled-over
// leftovers from previous months (only when carryOver is on). Overspending
// never carries.
function effectiveBudget(cat, key) {
  if (!cat.carryOver) return { effective: cat.budget, carriedIn: 0 };
  const anchor = planAnchor();
  if (key <= anchor) return { effective: cat.budget, carriedIn: 0 };
  let eff = cat.budget, carriedIn = 0, m = anchor;
  while (m < key) {
    const leftover = Math.max(0, eff - spentIn(cat.id, m));
    carriedIn = leftover;
    eff = cat.budget + leftover;
    m = shiftMonth(m, 1);
  }
  return { effective: eff, carriedIn };
}

// ---------- Rendering ----------
function render() {
  if (!householdId) return;
  $("month-title").textContent = monthLabel(viewMonth);
  const spentTotal = expenses.filter((e) => e.date.startsWith(viewMonth))
    .reduce((a, e) => a + Number(e.amount), 0);
  let effTotal = 0;
  const perCat = plan.categories.map((cat) => {
    const { effective, carriedIn } = effectiveBudget(cat, viewMonth);
    effTotal += effective;
    const spent = spentIn(cat.id, viewMonth);
    // Closeness to the limit: share of the effective budget already used.
    // A category with spending but no budget counts as fully blown.
    const ratio = effective > 0 ? spent / effective : (spent > 0 ? Infinity : 0);
    return { cat, effective, carriedIn, spent, remaining: effective - spent, ratio };
  });
  // Display order only (plan order is untouched): the categories closest
  // to blowing their budget float to the top so they are seen first.
  perCat.sort((a, b) => (b.ratio - a.ratio) || (b.spent - a.spent));

  $("plan-line").textContent =
    `Income ${money(plan.income)} − savings target ${money(plan.savingsTarget)} = ${money(plan.income - plan.savingsTarget)} spending plan` +
    (effTotal !== plan.income - plan.savingsTarget ? ` · effective budget this month ${money(effTotal)} with carry-overs` : "");
  $("sum-income").textContent = money(plan.income);
  $("sum-spent").textContent = money(spentTotal);
  $("sum-left").textContent = money(effTotal - spentTotal);
  const projected = plan.income - spentTotal;
  $("sum-savings").textContent = money(projected);
  const pct = Math.max(0, Math.min(100, (projected / plan.savingsTarget) * 100));
  const bar = $("savings-bar");
  bar.style.width = pct + "%";
  bar.classList.toggle("over", projected < plan.savingsTarget);
  $("savings-note").textContent = projected >= plan.savingsTarget
    ? `On track — target ${money(plan.savingsTarget)}`
    : `Below the ${money(plan.savingsTarget)} target`;

  // Category cards
  $("category-cards").innerHTML = perCat.map(({ cat, effective, carriedIn, spent, remaining, ratio }) => {
    const p = effective > 0 ? Math.min(100, (spent / effective) * 100) : 0;
    const tag = spent > effective
      ? `<span class="tag over-tag">Over budget</span>`
      : ratio >= 0.85 ? `<span class="tag warn-tag">Near limit</span>` : "";
    const pctText = effective > 0 ? `${Math.round(ratio * 100)}% used` : (spent > 0 ? "no budget set" : "0% used");
    const meta = spent > effective
      ? `${money(spent - effective)} over the ${money(effective)} budget · ${pctText}`
      : `${money(remaining)} left of ${money(effective)} budget · ${pctText}`;
    return `<div class="card cat-card">
      <div class="top"><span class="dot" style="background:${cat.color}"></span>
      <span class="name">${cat.name}</span>${tag}<span class="spent">${money(spent)}</span></div>
      ${carriedIn > 0 ? `<div class="carried">+${money(carriedIn)} carried from last month</div>` : ""}
      <div class="bar"><div class="fill ${spent > effective ? "over" : ""}" style="width:${p}%;background:${spent > effective ? "" : cat.color}"></div></div>
      <div class="meta">${meta}</div>
    </div>`;
  }).join("");

  // Pie chart + legend
  const withSpend = perCat.filter((c) => c.spent > 0);
  $("pie-empty").classList.toggle("hidden", withSpend.length > 0);
  $("pie-legend").innerHTML = withSpend.map(({ cat, spent }) =>
    `<li><span class="dot" style="background:${cat.color}"></span>${cat.name}
     <span class="amt">${money(spent)} · ${((spent / spentTotal) * 100).toFixed(0)}%</span></li>`).join("");
  const ctx = $("pie");
  if (window.Chart) {
    const data = {
      labels: withSpend.map((c) => c.cat.name),
      datasets: [{ data: withSpend.map((c) => c.spent), backgroundColor: withSpend.map((c) => c.cat.color) }],
    };
    if (pieChart) { pieChart.data = data; pieChart.update(); }
    else pieChart = new Chart(ctx, { type: "doughnut", data, options: { plugins: { legend: { display: false } } } });
  }

  // Expense form categories + list
  const sel = $("exp-category");
  const prev = sel.value;
  sel.innerHTML = plan.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  if (prev) sel.value = prev;
  if (!$("exp-date").value) $("exp-date").value = new Date().toISOString().slice(0, 10);
  const list = expenses.filter((e) => e.date.startsWith(viewMonth));
  $("expense-list").innerHTML = list.length ? list.map((e) => {
    const cat = plan.categories.find((c) => c.id === e.categoryId);
    return `<li><span class="dot" style="background:${cat ? cat.color : "#999"}"></span>
      <span>${e.date.slice(5)} · ${cat ? cat.name : "?"}${e.note ? " — " + e.note : ""}</span>
      <span class="amt">${money(e.amount)}</span>
      <button data-edit="${e.id}" title="Edit">✎</button>
      <button data-del="${e.id}" title="Delete">✕</button></li>`;
  }).join("") : `<li class="muted">Nothing logged yet this month.</li>`;
  document.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => deleteDoc(doc(db, "households", householdId, "expenses", b.dataset.del));
  });
  document.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => startEditExpense(b.dataset.edit);
  });

  // Plan editor
  $("plan-income").value = plan.income;
  $("plan-savings").value = plan.savingsTarget;
  $("plan-start").value = planAnchor();
  $("plan-categories").innerHTML = plan.categories.map((c, i) =>
    `<div class="plan-row"><span class="dot" style="background:${c.color}"></span>
     <input type="text" value="${c.name}" data-name="${i}" aria-label="Category name" />
     <input type="number" min="0" step="1" value="${c.budget}" data-budget="${i}" />
     <label class="switch"><input type="checkbox" data-carry="${i}" ${c.carryOver ? "checked" : ""} /> carry over</label>
     <button type="button" data-delcat="${i}" title="Delete category">✕</button>
   </div>`).join("");
  document.querySelectorAll("[data-delcat]").forEach((b) => {
    b.onclick = () => deleteCategory(Number(b.dataset.delcat));
  });
}

// ---------- Events ----------
$("month-prev").onclick = () => { viewMonth = shiftMonth(viewMonth, -1); render(); };
$("month-next").onclick = () => { viewMonth = shiftMonth(viewMonth, 1); render(); };
$("month-today").onclick = () => { viewMonth = monthKey(new Date()); render(); };

// ---------- Expense editing ----------
function startEditExpense(id) {
  const e = expenses.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $("exp-date").value = e.date;
  $("exp-amount").value = e.amount;
  $("exp-category").value = e.categoryId;
  $("exp-note").value = e.note || "";
  $("exp-submit").textContent = "Save changes";
  $("exp-cancel").classList.remove("hidden");
  $("expense-form").scrollIntoView({ behavior: "smooth", block: "center" });
  $("exp-amount").focus();
}
function resetExpenseForm() {
  editingId = null;
  $("exp-submit").textContent = "Add expense";
  $("exp-cancel").classList.add("hidden");
  $("exp-amount").value = ""; $("exp-note").value = "";
}
$("exp-cancel").onclick = resetExpenseForm;

$("expense-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const data = {
    date: $("exp-date").value,
    amount: Number($("exp-amount").value),
    categoryId: $("exp-category").value,
    note: $("exp-note").value.trim(),
  };
  if (editingId) {
    await updateDoc(doc(db, "households", householdId, "expenses", editingId), data);
  } else {
    await addDoc(collection(db, "households", householdId, "expenses"), {
      ...data, createdBy: user.uid, createdAt: serverTimestamp(),
    });
  }
  resetExpenseForm();
};

$("plan-toggle").onclick = () => {
  const card = $("plan-card");
  const open = card.classList.toggle("open");
  $("plan-body").classList.toggle("hidden", !open);
  $("plan-toggle").setAttribute("aria-expanded", String(open));
};

$("expenses-toggle").onclick = () => {
  const card = $("expenses-card");
  const open = card.classList.toggle("open");
  $("expenses-body").classList.toggle("hidden", !open);
  $("expenses-toggle").setAttribute("aria-expanded", String(open));
};

// ---------- Plan editor: save / add category / edit / delete ----------
function readPlanEditor() {
  return {
    income: Number($("plan-income").value || 0),
    savingsTarget: Number($("plan-savings").value || 0),
    startMonth: $("plan-start").value || plan.startMonth || monthKey(new Date()),
    categories: plan.categories.map((c, i) => ({
      ...c,
      name: (document.querySelector(`[data-name="${i}"]`).value || c.name).trim() || c.name,
      budget: Number(document.querySelector(`[data-budget="${i}"]`).value || 0),
      carryOver: document.querySelector(`[data-carry="${i}"]`).checked,
    })),
  };
}
function savePlanDoc(state) {
  return setDoc(doc(db, "households", householdId, "meta", "plan"), state);
}

$("btn-save-plan").onclick = async () => { await savePlanDoc(readPlanEditor()); };

const CAT_COLORS = ["#eab308", "#f43f5e", "#0ea5e9", "#a855f7", "#84cc16", "#fb923c", "#2dd4bf", "#e879f9"];
$("btn-add-cat").onclick = async () => {
  $("cat-error").textContent = "";
  const name = $("new-cat-name").value.trim();
  const budget = Number($("new-cat-budget").value || 0);
  if (!name) { $("cat-error").textContent = "Give the category a name first."; return; }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug || plan.categories.some((c) => c.id === slug)) {
    $("cat-error").textContent = "A category with that name already exists.";
    return;
  }
  const state = readPlanEditor();
  state.categories.push({
    id: slug, name, budget, carryOver: false,
    color: CAT_COLORS[state.categories.length % CAT_COLORS.length],
  });
  await savePlanDoc(state);
  $("new-cat-name").value = ""; $("new-cat-budget").value = "";
};

async function deleteCategory(idx) {
  const cat = plan.categories[idx];
  if (!cat) return;
  $("cat-error").textContent = "";
  if (expenses.some((e) => e.categoryId === cat.id)) {
    $("cat-error").textContent =
      `"${cat.name}" has expenses logged under it, so it can't be deleted. Delete or reassign those expenses first — or just rename it.`;
    return;
  }
  const state = readPlanEditor();
  state.categories.splice(idx, 1);
  await savePlanDoc(state);
}
