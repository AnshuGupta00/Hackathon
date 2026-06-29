import { useState, useEffect, useRef } from "react";
import VoiceAssistant from "./assets/VoiceAssistant";

const COLORS = {
  bg: "#170f0f",
  surface: "#1A1D27",
  surfaceHover: "#1F2235",
  border: "#2A2D3E",
  accent: "#6C63FF",
  accentDim: "#6C63FF22",
  accentHover: "#7B73FF",
  amber: "#F59E0B",
  amberDim: "#F59E0B22",
  red: "#EF4444",
  redDim: "#EF444420",
  green: "#22C55E",
  greenDim: "#22C55E20",
  textPrimary: "#F0F2F8",
  textSecondary: "#8B8FA8",
  textMuted: "#4A4D62",
};

const HABIT_PALETTE = [COLORS.accent, COLORS.amber, COLORS.green, "#EC4899", "#06d414"];

// ---- persistence (localStorage — this is a real browser app, not a sandboxed
// artifact, so this is the correct/normal place for this data to live) ----
const STORAGE_PREFIX = "deadlinezero:";

function loadStored(key, fallback) {
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }
}

function getTimeLeft(deadline) {
  const diff = new Date(deadline) - new Date();
  if (diff < 0) return { label: "Overdue", urgent: true, color: COLORS.red };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h < 6) return { label: h + "h " + m + "m left", urgent: true, color: COLORS.red };
  if (h < 24) return { label: h + "h left", urgent: false, color: COLORS.amber };
  const d = Math.ceil(diff / 86400000);
  return { label: d + "d left", urgent: false, color: COLORS.textSecondary };
}

function getPriorityColor(p) {
  if (p === "URGENT") return COLORS.red;
  if (p === "HIGH") return COLORS.amber;
  if (p === "MEDIUM") return COLORS.accent;
  return COLORS.textMuted;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function UrgencyRing({ active }) {
  return active ? (
    <span style={{
      position: "absolute", inset: -4, borderRadius: "50%",
      border: `2px solid ${COLORS.red}`,
      animation: "pulse-ring 2s ease-in-out infinite",
      pointerEvents: "none",
    }} />
  ) : null;
}

export default function App() {
  // ---- identity / onboarding ----
  const [userName, setUserName] = useState(() => loadStored("userName", ""));
  const [onboardingName, setOnboardingName] = useState("");

  // ---- core data (loaded from localStorage if present, empty for a brand-new user) ----
  const [tasks, setTasks] = useState(() => loadStored("tasks", []));
  const [habits, setHabits] = useState(() => loadStored("habits", []));
  const [aiMessages, setAiMessages] = useState(() => loadStored("aiMessages", []));

  const [activeNav, setActiveNav] = useState("dashboard");
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const chatEndRef = useRef(null);
  const [newTask, setNewTask] = useState({ title: "", deadline: "", estimatedMins: 30, priority: "MEDIUM", tags: "" });
  const [tick, setTick] = useState(0);

  // ---- habits add form ----
  const [showHabitForm, setShowHabitForm] = useState(false);
  const [newHabitName, setNewHabitName] = useState("");

  // ---- settings ----
  const [notifyMinutesBefore, setNotifyMinutesBefore] = useState(() => loadStored("notifyMinutesBefore", 30));
  const [savedMsg, setSavedMsg] = useState(false);

  // ---- notifications ----
  const [notifPermission, setNotifPermission] = useState(
    typeof window !== "undefined" && typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const notifiedRef = useRef(new Set());

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Persist to localStorage whenever the underlying data changes, so a
  // refresh (or closing the tab) doesn't lose anything.
  useEffect(() => { saveStored("userName", userName); }, [userName]);
  useEffect(() => { saveStored("tasks", tasks); }, [tasks]);
  useEffect(() => { saveStored("habits", habits); }, [habits]);
  useEffect(() => { saveStored("aiMessages", aiMessages); }, [aiMessages]);
  useEffect(() => { saveStored("notifyMinutesBefore", notifyMinutesBefore); }, [notifyMinutesBefore]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  // Check every minute (and whenever tasks/threshold change) for deadlines
  // crossing the notify-before window, or tasks going overdue.
  useEffect(() => {
    tasks.forEach(task => {
      if (task.status === "done") return;
      const minutesLeft = (new Date(task.deadline) - new Date()) / 60000;
      const dueKey = `${task.id}-due`;
      const overdueKey = `${task.id}-overdue`;

      if (minutesLeft <= notifyMinutesBefore && minutesLeft > 0 && !notifiedRef.current.has(dueKey)) {
        sendBrowserNotification(
          "Deadline approaching",
          `"${task.title}" is due in ${Math.round(minutesLeft)} minute${Math.round(minutesLeft) === 1 ? "" : "s"}.`,
          dueKey
        );
        notifiedRef.current.add(dueKey);
      }
      if (minutesLeft <= 0 && !notifiedRef.current.has(overdueKey)) {
        sendBrowserNotification("Task overdue", `"${task.title}" is now overdue.`, overdueKey);
        notifiedRef.current.add(overdueKey);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, tasks, notifyMinutesBefore]);

  function sendBrowserNotification(title, body, tag) {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, tag });
    } catch (e) {
      console.warn("Notification failed:", e);
    }
  }

  function requestNotifPermission() {
    if (typeof Notification === "undefined") {
      setNotifPermission("unsupported");
      return;
    }
    Notification.requestPermission().then(p => setNotifPermission(p));
  }

  function submitOnboarding() {
    const name = onboardingName.trim();
    if (!name) return;
    setUserName(name);
    setTasks([]);
    setHabits([]);
    setAiMessages([{
      role: "assistant",
      content: `Hey ${name}! I'm your AI planner. Add your first task with a deadline and I'll tell you what to prioritize and when.`,
    }]);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      requestNotifPermission();
    }
  }

  function clearAllData() {
    if (!window.confirm("This will erase all your tasks, habits, and settings on this device. Continue?")) return;
    ["userName", "tasks", "habits", "aiMessages", "notifyMinutesBefore"].forEach(k => {
      try { localStorage.removeItem(STORAGE_PREFIX + k); } catch {}
    });
    setUserName("");
    setOnboardingName("");
    setTasks([]);
    setHabits([]);
    setAiMessages([]);
    setNotifyMinutesBefore(30);
  }

  const activeTasks = tasks.filter(t => t.status !== "done");
  const doneTasks = tasks.filter(t => t.status === "done");
  const urgentTask = activeTasks.sort((a, b) => b.aiScore - a.aiScore)[0];
  const overdueCount = tasks.filter(t => t.status !== "done" && new Date(t.deadline) < new Date()).length;

  const filteredTasks = tasks.filter(t => {
    if (filterStatus === "todo") return t.status === "todo";
    if (filterStatus === "in-progress") return t.status === "in-progress";
    if (filterStatus === "done") return t.status === "done";
    return true;
  });

  function sendAIMessage() {
    if (!aiInput.trim()) return;
    const userMsg = { role: "user", content: aiInput };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput("");
    setAiLoading(true);
    setTimeout(() => {
      const replies = [
        "Based on your current tasks, I'd tackle the one with the tightest deadline first, then work outward from there.",
        `You have ${activeTasks.length} active task${activeTasks.length === 1 ? "" : "s"} right now. Want me to suggest an order to tackle them in?`,
        "Tell me more about what you're working on and I can help you break it into a schedule.",
        "I'd block focused time for your most urgent task first, then take a short break before the next one.",
      ];
      const reply = { role: "assistant", content: replies[Math.floor(Math.random() * replies.length)] };
      setAiMessages(prev => [...prev, reply]);
      setAiLoading(false);
    }, 1200);
  }

  function toggleHabit(id) {
    setHabits(prev => prev.map(h => h.id === id ? { ...h, todayDone: !h.todayDone, streak: !h.todayDone ? h.streak + 1 : Math.max(0, h.streak - 1) } : h));
  }

  function addHabit() {
    const name = newHabitName.trim();
    if (!name) return;
    const h = {
      id: Date.now(),
      name,
      streak: 0,
      target: 7,
      todayDone: false,
      color: HABIT_PALETTE[habits.length % HABIT_PALETTE.length],
    };
    setHabits(prev => [...prev, h]);
    setNewHabitName("");
    setShowHabitForm(false);
  }

  function updateTaskStatus(id, status) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status, aiScore: status === "done" ? 0 : t.aiScore } : t));
    setSelectedTask(null);
  }

  function addTask() {
    if (!newTask.title || !newTask.deadline) return;
    const t = {
      id: Date.now(), title: newTask.title, deadline: newTask.deadline,
      estimatedMins: Number(newTask.estimatedMins), priority: newTask.priority,
      status: "todo", tags: newTask.tags.split(",").map(s => s.trim()).filter(Boolean),
      aiScore: newTask.priority === "URGENT" ? 90 : newTask.priority === "HIGH" ? 70 : 40,
      aiReason: "Newly added. AI will analyze soon.",
    };
    setTasks(prev => [...prev, t]);
    setNewTask({ title: "", deadline: "", estimatedMins: 30, priority: "MEDIUM", tags: "" });
    setShowTaskForm(false);
  }

  function buildCalendarCells() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - firstWeekday + 1;
      const date = new Date(year, month, dayNum);
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
      const isToday = inMonth && date.toDateString() === today.toDateString();
      const tasksOnDay = inMonth
        ? tasks.filter(t => {
            const td = new Date(t.deadline);
            return td.getFullYear() === year && td.getMonth() === month && td.getDate() === dayNum;
          })
        : [];
      cells.push({ key: i, dayNum, inMonth, isToday, tasksOnDay });
    }
    return cells;
  }

  const navItems = [
    { id: "dashboard", icon: "⊞", label: "Dashboard" },
    { id: "tasks", icon: "✓", label: "Tasks" },
    { id: "calendar", icon: "▦", label: "Calendar" },
    { id: "habits", icon: "◎", label: "Habits" },
    { id: "ai-planner", icon: "✦", label: "AI Planner" },
    { id: "settings", icon: "⚙", label: "Settings" },
  ];

  const showLabels = mobileSidebarOpen || !sidebarCollapsed;

  return (
    <div style={{ display: "flex", height: "100vh", background: COLORS.bg, color: COLORS.textPrimary, fontFamily: "'Inter', sans-serif", fontSize: 14, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes pulse-ring { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${COLORS.border};border-radius:4px}
        .nav-item:hover{background:${COLORS.surfaceHover}!important}
        .task-card:hover{background:${COLORS.surfaceHover}!important;border-color:${COLORS.accent}44!important}
        .btn-primary{background:${COLORS.accent};color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:background .15s}
        .btn-primary:hover{background:${COLORS.accentHover}}
        .btn-primary:disabled{opacity:.5;cursor:not-allowed}
        .btn-ghost{background:transparent;color:${COLORS.textSecondary};border:1px solid ${COLORS.border};padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;transition:all .15s}
        .btn-ghost:hover{border-color:${COLORS.accent};color:${COLORS.accent}}
        .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;background:${COLORS.accentDim};color:${COLORS.accent};margin:0 3px 3px 0}
        .status-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500}
        .chat-bubble{animation:fadeIn .2s ease}
        .filter-btn{padding:5px 12px;border-radius:6px;font-size:12px;border:1px solid ${COLORS.border};background:transparent;color:${COLORS.textSecondary};cursor:pointer;transition:all .15s}
        .filter-btn.active,.filter-btn:hover{background:${COLORS.accent};color:#fff;border-color:${COLORS.accent}}
        input,select,textarea{background:${COLORS.surface};border:1px solid ${COLORS.border};color:${COLORS.textPrimary};border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit;outline:none;transition:border .15s;min-width:0}
        input:focus,select:focus,textarea:focus{border-color:${COLORS.accent}}
        input::placeholder,textarea::placeholder{color:${COLORS.textMuted}}
        .habit-check:hover{transform:scale(1.05)}

        /* ---------- responsive ---------- */
        .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
        @media (max-width:900px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
        @media (max-width:480px){.stats-grid{grid-template-columns:1fr}}

        .dashboard-grid{display:grid;grid-template-columns:1fr 320px;gap:16px}
        @media (max-width:1024px){.dashboard-grid{grid-template-columns:1fr}}

        @media (max-width:640px){
          .topbar{flex-wrap:wrap;row-gap:8px}
          .page-content{padding:14px!important}
        }

        @media (max-width:480px){
          .modal-card{width:92vw!important;padding:16px!important}
          .calendar-grid .cal-cell{min-height:48px!important;padding:3px!important}
          .calendar-grid .cal-cell > div:first-child{font-size:10px!important}
        }

        .hamburger-btn{display:none}
        .sidebar-backdrop{position:fixed;inset:0;background:#00000066;z-index:250;display:none}
        @media (max-width:768px){
          .hamburger-btn{display:flex!important}
          .collapse-toggle{display:none!important}
          .sidebar-fixed{
            position:fixed!important;top:0;left:0;bottom:0;
            width:240px!important;
            transform:translateX(-100%);
            transition:transform .25s ease;
            z-index:300;
          }
          .sidebar-fixed.open{transform:translateX(0)}
          .sidebar-backdrop.show{display:block}
        }
      `}</style>

      {/* Onboarding gate */}
      {!userName && (
        <div style={{ position: "fixed", inset: 0, background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }}>
          <div className="modal-card" style={{ background: COLORS.surface, borderRadius: 16, padding: 28, width: 380, border: `1px solid ${COLORS.border}`, textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "#fff", margin: "0 auto 16px" }}>D</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Welcome to DeadlineZero</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 18 }}>What should we call you?</div>
            <input
              value={onboardingName}
              onChange={e => setOnboardingName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitOnboarding()}
              placeholder="Your name"
              style={{ width: "100%", textAlign: "center", marginBottom: 14 }}
              autoFocus
            />
            <button className="btn-primary" style={{ width: "100%" }} onClick={submitOnboarding} disabled={!onboardingName.trim()}>
              Get started
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`sidebar-fixed${mobileSidebarOpen ? " open" : ""}`} style={{
        width: sidebarCollapsed ? 60 : 220, flexShrink: 0,
        background: COLORS.surface, borderRight: `1px solid ${COLORS.border}`,
        display: "flex", flexDirection: "column", transition: "width .2s", overflow: "hidden",
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>D</div>
          {showLabels && <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: -0.3 }}>DeadlineZero</span>}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(item => (
            <button key={item.id} className="nav-item" onClick={() => { setActiveNav(item.id); setMobileSidebarOpen(false); }} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
              borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left",
              background: activeNav === item.id ? COLORS.accentDim : "transparent",
              color: activeNav === item.id ? COLORS.accent : COLORS.textSecondary,
              fontWeight: activeNav === item.id ? 600 : 400, fontSize: 13,
              transition: "all .15s", whiteSpace: "nowrap", overflow: "hidden",
            }}>
              <span style={{ fontSize: 16, flexShrink: 0, width: 20, textAlign: "center" }}>{item.icon}</span>
              {showLabels && item.label}
            </button>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: "12px 12px 16px", borderTop: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg, ${COLORS.accent}, #a78bfa)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {userName ? userName.charAt(0).toUpperCase() : "?"}
          </div>
          {showLabels && (
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{userName}</div>
            </div>
          )}
        </div>

        {/* Collapse toggle (desktop only) */}
        <button className="collapse-toggle" onClick={() => setSidebarCollapsed(x => !x)} style={{
          position: "absolute", left: sidebarCollapsed ? 46 : 206, top: 22,
          width: 20, height: 20, borderRadius: "50%", background: COLORS.border,
          border: "none", cursor: "pointer", color: COLORS.textSecondary, fontSize: 10,
          display: "flex", alignItems: "center", justifyContent: "center", transition: "left .2s", zIndex: 10,
        }}>{sidebarCollapsed ? "›" : "‹"}</button>
      </div>

      {mobileSidebarOpen && (
        <div className="sidebar-backdrop show" onClick={() => setMobileSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

        {/* Topbar */}
        <div className="topbar" style={{ padding: "14px 24px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 12, background: COLORS.bg, flexShrink: 0 }}>
          <button className="hamburger-btn" onClick={() => setMobileSidebarOpen(true)} style={{
            width: 34, height: 34, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface,
            color: COLORS.textPrimary, cursor: "pointer", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
          }}>☰</button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis" }}>
              {activeNav === "dashboard" && `${getGreeting()}, ${userName}`}
              {activeNav === "tasks" && "Tasks"}
              {activeNav === "calendar" && "Calendar"}
              {activeNav === "habits" && "Habits"}
              {activeNav === "ai-planner" && "AI Planner"}
              {activeNav === "settings" && "Settings"}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
              {overdueCount > 0 && <span style={{ color: COLORS.red, marginLeft: 8 }}>· {overdueCount} overdue</span>}
            </div>
          </div>
          {overdueCount > 0 && (
            <div style={{ background: COLORS.redDim, border: `1px solid ${COLORS.red}44`, borderRadius: 8, padding: "6px 12px", fontSize: 12, color: COLORS.red, fontWeight: 500, whiteSpace: "nowrap" }}>
              ⚠ {overdueCount} task{overdueCount > 1 ? "s" : ""} past due
            </div>
          )}
          <button className="btn-primary" onClick={() => setShowTaskForm(true)} style={{ whiteSpace: "nowrap" }}>+ Add task</button>
        </div>

        {/* Page content */}
        <div className="page-content" style={{ flex: 1, overflow: "auto", padding: 24 }}>

          {/* DASHBOARD */}
          {activeNav === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Stats row */}
              <div className="stats-grid">
                {[
                  { label: "Tasks due today", value: tasks.filter(t => { const d = new Date(t.deadline); const today = new Date(); return d.toDateString() === today.toDateString() && t.status !== "done"; }).length, color: COLORS.amber, icon: "⏰" },
                  { label: "In progress", value: tasks.filter(t => t.status === "in-progress").length, color: COLORS.accent, icon: "◉" },
                  { label: "Completed", value: doneTasks.length, color: COLORS.green, icon: "✓" },
                  { label: "Habit streak", value: habits.length ? Math.max(...habits.map(h => h.streak)) + "d" : "—", color: COLORS.accent, icon: "🔥" },
                ].map((s, i) => (
                  <div key={i} style={{ background: COLORS.surface, borderRadius: 12, padding: "16px 18px", border: `1px solid ${COLORS.border}` }}>
                    <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 6 }}>{s.icon} {s.label}</div>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 28, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="dashboard-grid">
                {/* Task list */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 10, letterSpacing: .5 }}>ACTIVE TASKS · AI PRIORITIZED</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activeTasks.length === 0 && (
                      <div style={{ textAlign: "center", padding: "32px 0", color: COLORS.textMuted }}>
                        <p style={{ fontSize: 13 }}>No active tasks. Add one to get started.</p>
                      </div>
                    )}
                    {[...activeTasks].sort((a, b) => b.aiScore - a.aiScore).map(task => {
                      const tl = getTimeLeft(task.deadline);
                      const isTop = task.id === urgentTask?.id;
                      return (
                        <div key={task.id} className="task-card" onClick={() => setSelectedTask(task)} style={{
                          background: COLORS.surface, borderRadius: 12, padding: "14px 16px",
                          border: `1px solid ${isTop ? COLORS.red + "66" : COLORS.border}`,
                          cursor: "pointer", transition: "all .15s", position: "relative",
                        }}>
                          {isTop && <div style={{ position: "absolute", top: 12, right: 12 }}>
                            <div style={{ position: "relative", width: 10, height: 10 }}>
                              <div style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS.red }} />
                              <UrgencyRing active={true} />
                            </div>
                          </div>}
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ width: 3, borderRadius: 2, alignSelf: "stretch", background: getPriorityColor(task.priority), flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{task.title}</span>
                                <span className="status-badge" style={{ background: task.status === "in-progress" ? COLORS.accentDim : COLORS.surface, color: task.status === "in-progress" ? COLORS.accent : COLORS.textMuted, border: `1px solid ${task.status === "in-progress" ? COLORS.accent + "44" : COLORS.border}` }}>
                                  {task.status === "in-progress" ? "In progress" : "To do"}
                                </span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: COLORS.textSecondary, flexWrap: "wrap" }}>
                                <span style={{ color: tl.color, fontWeight: 500 }}>{tl.label}</span>
                                <span>~{task.estimatedMins}m</span>
                                {task.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                              </div>
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: task.aiScore > 80 ? COLORS.red : task.aiScore > 60 ? COLORS.amber : COLORS.textMuted, flexShrink: 0 }}>
                              AI {task.aiScore}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right panel: AI + Habits */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                  {/* AI quick insight */}
                  <div style={{ background: COLORS.surface, borderRadius: 12, padding: 16, border: `1px solid ${COLORS.accent}33` }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.accent, marginBottom: 8, letterSpacing: .5 }}>✦ AI INSIGHT</div>
                    <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6 }}>
                      {urgentTask ? urgentTask.aiReason : `No urgent deadlines right now, ${userName}. Add a task and I'll help you prioritize it.`}
                    </div>
                    <button className="btn-ghost" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setActiveNav("ai-planner")}>Open AI Planner →</button>
                  </div>

                  {/* Habits mini */}
                  <div style={{ background: COLORS.surface, borderRadius: 12, padding: 16, border: `1px solid ${COLORS.border}` }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 10, letterSpacing: .5 }}>TODAY'S HABITS</div>
                    {habits.length === 0 ? (
                      <div style={{ fontSize: 12, color: COLORS.textMuted }}>
                        No habits yet. <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => setActiveNav("habits")}>Add one</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {habits.map(h => (
                          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button className="habit-check" onClick={() => toggleHabit(h.id)} style={{
                              width: 20, height: 20, borderRadius: 6, border: `2px solid ${h.todayDone ? h.color : COLORS.border}`,
                              background: h.todayDone ? h.color : "transparent", flexShrink: 0,
                              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                              transition: "all .15s", fontSize: 10, color: "#fff",
                            }}>{h.todayDone ? "✓" : ""}</button>
                            <span style={{ flex: 1, fontSize: 12, color: h.todayDone ? COLORS.textPrimary : COLORS.textSecondary, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                            <span style={{ fontSize: 11, color: h.color, fontWeight: 600, flexShrink: 0 }}>🔥{h.streak}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* TASKS PAGE */}
          {activeNav === "tasks" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {["all", "todo", "in-progress", "done"].map(f => (
                  <button key={f} className={`filter-btn ${filterStatus === f ? "active" : ""}`} onClick={() => setFilterStatus(f)}>
                    {f === "all" ? "All" : f === "in-progress" ? "In progress" : f.charAt(0).toUpperCase() + f.slice(1)}
                    <span style={{ marginLeft: 4, opacity: .7 }}>
                      {tasks.filter(t => f === "all" || t.status === f).length}
                    </span>
                  </button>
                ))}
              </div>

              {filteredTasks.length === 0 && (
                <div style={{ textAlign: "center", padding: "48px 0", color: COLORS.textMuted }}>
                  <p style={{ fontSize: 13 }}>No tasks here yet.</p>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...filteredTasks].sort((a, b) => b.aiScore - a.aiScore).map(task => {
                  const tl = getTimeLeft(task.deadline);
                  return (
                    <div key={task.id} className="task-card" onClick={() => setSelectedTask(task)} style={{
                      background: COLORS.surface, borderRadius: 12, padding: "14px 18px",
                      border: `1px solid ${COLORS.border}`, cursor: "pointer",
                      opacity: task.status === "done" ? .6 : 1, transition: "all .15s",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 3, height: 40, borderRadius: 2, background: getPriorityColor(task.priority), flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4, textDecoration: task.status === "done" ? "line-through" : "none" }}>{task.title}</div>
                          <div style={{ display: "flex", gap: 10, fontSize: 12, color: COLORS.textSecondary, flexWrap: "wrap" }}>
                            <span style={{ color: tl.color }}>{tl.label}</span>
                            <span>~{task.estimatedMins}m</span>
                            <span style={{ color: getPriorityColor(task.priority) }}>{task.priority}</span>
                            {task.tags.map(t => <span key={t} className="tag">{t}</span>)}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: task.aiScore > 80 ? COLORS.red : task.aiScore > 60 ? COLORS.amber : COLORS.textMuted, flexShrink: 0 }}>
                          {task.status === "done" ? "✓ Done" : `AI ${task.aiScore}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* HABITS PAGE */}
          {activeNav === "habits" && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, letterSpacing: .5 }}>YOUR HABITS</div>
                <button className="btn-ghost" onClick={() => setShowHabitForm(true)}>+ Add habit</button>
              </div>

              {showHabitForm && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <input
                    value={newHabitName}
                    onChange={e => setNewHabitName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addHabit()}
                    placeholder="e.g. Read 20 minutes"
                    style={{ flex: 1, minWidth: 160 }}
                    autoFocus
                  />
                  <button className="btn-primary" onClick={addHabit}>Add</button>
                  <button className="btn-ghost" onClick={() => { setShowHabitForm(false); setNewHabitName(""); }}>Cancel</button>
                </div>
              )}

              {habits.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: COLORS.textMuted }}>
                  <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, marginBottom: 6, color: COLORS.textSecondary }}>No habits yet.</p>
                  <p style={{ fontSize: 12 }}>Add one above to start tracking a streak.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {habits.map(h => (
                    <div key={h.id} style={{ background: COLORS.surface, borderRadius: 12, padding: 18, border: `1px solid ${COLORS.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: h.color }} />
                        <span style={{ fontWeight: 600, flex: 1, minWidth: 100 }}>{h.name}</span>
                        <span style={{ fontSize: 11, color: h.color, fontWeight: 700 }}>🔥 {h.streak} day streak</span>
                        <button className="habit-check" onClick={() => toggleHabit(h.id)} style={{
                          width: 28, height: 28, borderRadius: 8, border: `2px solid ${h.todayDone ? h.color : COLORS.border}`,
                          background: h.todayDone ? h.color : "transparent", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 14, color: "#fff", transition: "all .15s",
                        }}>{h.todayDone ? "✓" : ""}</button>
                      </div>
                      {/* Mini heatmap */}
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                        {Array.from({ length: 28 }).map((_, i) => {
                          const filled = i >= 28 - h.streak;
                          return <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: filled ? h.color : COLORS.border, opacity: filled ? 0.4 + (i / 28) * 0.6 : 0.3 }} />;
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>Last 28 days</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI PLANNER */}
          {activeNav === "ai-planner" && (
            <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", height: "calc(100vh - 140px)" }}>
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>
                AI knows your {activeTasks.length} active tasks and deadlines. Ask anything.
              </div>
              <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12 }}>
                {aiMessages.map((msg, i) => (
                  <div key={i} className="chat-bubble" style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "80%", padding: "12px 16px", borderRadius: 12,
                    background: msg.role === "user" ? COLORS.accent : COLORS.surface,
                    border: msg.role === "user" ? "none" : `1px solid ${COLORS.border}`,
                    color: msg.role === "user" ? "#fff" : COLORS.textPrimary,
                    fontSize: 13, lineHeight: 1.6,
                  }}>
                    {msg.role === "assistant" && <div style={{ fontSize: 10, color: COLORS.accent, fontWeight: 600, marginBottom: 4 }}>✦ AI PLANNER</div>}
                    {msg.content}
                  </div>
                ))}
                {aiLoading && (
                  <div style={{ alignSelf: "flex-start", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "12px 16px" }}>
                    <div style={{ width: 16, height: 16, border: `2px solid ${COLORS.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendAIMessage()} placeholder="Ask AI to plan your day, prioritize tasks…" style={{ flex: 1 }} />
                <button className="btn-primary" onClick={sendAIMessage} disabled={!aiInput.trim()}>Send</button>
              </div>
            </div>
          )}

          {/* CALENDAR */}
          {activeNav === "calendar" && (
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
                {new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
              </div>
              <div className="calendar-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 16 }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                  <div key={d} style={{ textAlign: "center", fontSize: 11, color: COLORS.textMuted, padding: "6px 0", fontWeight: 600 }}>{d}</div>
                ))}
                {buildCalendarCells().map(cell => (
                  <div key={cell.key} className="cal-cell" style={{
                    minHeight: 72, background: COLORS.surface, borderRadius: 8, padding: 6,
                    border: `1px solid ${cell.isToday ? COLORS.accent + "66" : COLORS.border}`,
                    opacity: cell.inMonth ? 1 : .3,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: cell.isToday ? 700 : 400, color: cell.isToday ? COLORS.accent : COLORS.textSecondary, marginBottom: 4 }}>
                      {cell.inMonth ? cell.dayNum : ""}
                    </div>
                    {cell.tasksOnDay.slice(0, 2).map(t => (
                      <div key={t.id} style={{ fontSize: 10, background: getPriorityColor(t.priority) + "22", color: getPriorityColor(t.priority), padding: "1px 4px", borderRadius: 3, marginBottom: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{t.title}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SETTINGS */}
          {activeNav === "settings" && (
            <div style={{ maxWidth: 480 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Display name</label>
                <input type="text" value={userName} onChange={e => setUserName(e.target.value)} style={{ width: "100%" }} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Notify me before deadline</label>
                <select value={notifyMinutesBefore} onChange={e => setNotifyMinutesBefore(Number(e.target.value))} style={{ width: "100%" }}>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Timezone</label>
                <select style={{ width: "100%" }} defaultValue="Asia/Kolkata">
                  <option>Asia/Kolkata</option>
                  <option>UTC</option>
                  <option>America/New_York</option>
                </select>
              </div>

              <div style={{ marginBottom: 20, padding: 14, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
                <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>Browser notifications</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: notifPermission === "granted" ? COLORS.green : notifPermission === "denied" ? COLORS.red : COLORS.amber,
                  }}>
                    {notifPermission === "granted" ? "Enabled"
                      : notifPermission === "denied" ? "Blocked by browser"
                      : notifPermission === "unsupported" ? "Not supported here"
                      : "Not enabled"}
                  </span>
                  {notifPermission !== "granted" && notifPermission !== "unsupported" && notifPermission !== "denied" && (
                    <button className="btn-ghost" onClick={requestNotifPermission}>Enable</button>
                  )}
                </div>
                {notifPermission === "denied" && (
                  <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
                    Notifications were blocked. Re-enable them from your browser's site settings.
                  </div>
                )}
              </div>

              <button className="btn-primary" onClick={() => { setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000); }}>
                Save settings
              </button>
              {savedMsg && <span style={{ marginLeft: 10, fontSize: 12, color: COLORS.green }}>✓ Saved</span>}

              <div style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 8 }}>
                  Your tasks, habits, and name are saved on this device automatically.
                </div>
                <button
                  className="btn-ghost"
                  style={{ color: COLORS.red, borderColor: COLORS.red + "44" }}
                  onClick={clearAllData}
                >
                  Clear all data
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Task detail modal */}
      {selectedTask && (
        <div onClick={() => setSelectedTask(null)} style={{
          position: "fixed", inset: 0, background: "#00000088",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
        }}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{
            background: COLORS.surface, borderRadius: 16, padding: 24, width: 440,
            border: `1px solid ${COLORS.border}`, animation: "fadeIn .2s ease",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, flex: 1, paddingRight: 12 }}>{selectedTask.title}</div>
              <button onClick={() => setSelectedTask(null)} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <span className="status-badge" style={{ background: getPriorityColor(selectedTask.priority) + "22", color: getPriorityColor(selectedTask.priority) }}>{selectedTask.priority}</span>
              {selectedTask.tags.map(t => <span key={t} className="tag">{t}</span>)}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                <span style={{ color: COLORS.textSecondary }}>Deadline</span>
                <span style={{ color: getTimeLeft(selectedTask.deadline).color, fontWeight: 500 }}>
                  {new Date(selectedTask.deadline).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {getTimeLeft(selectedTask.deadline).label}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: COLORS.textSecondary }}>Estimated time</span>
                <span>~{selectedTask.estimatedMins} minutes</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: COLORS.textSecondary }}>AI priority score</span>
                <span style={{ color: selectedTask.aiScore > 80 ? COLORS.red : selectedTask.aiScore > 60 ? COLORS.amber : COLORS.textMuted, fontWeight: 700 }}>{selectedTask.aiScore}/100</span>
              </div>
            </div>

            <div style={{ background: COLORS.accentDim, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.6 }}>
              <span style={{ color: COLORS.accent, fontWeight: 600 }}>✦ AI says: </span>{selectedTask.aiReason}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selectedTask.status !== "done" && (
                <button className="btn-primary" style={{ flex: 1 }} onClick={() => updateTaskStatus(selectedTask.id, "done")}>Mark as done</button>
              )}
              {selectedTask.status === "todo" && (
                <button className="btn-ghost" onClick={() => { updateTaskStatus(selectedTask.id, "in-progress"); setSelectedTask(null); }}>Start task</button>
              )}
              {selectedTask.status === "done" && (
                <button className="btn-ghost" onClick={() => updateTaskStatus(selectedTask.id, "todo")}>Reopen</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add task modal */}
      {showTaskForm && (
        <div onClick={() => setShowTaskForm(false)} style={{
          position: "fixed", inset: 0, background: "#00000088",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
        }}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{
            background: COLORS.surface, borderRadius: 16, padding: 24, width: 420,
            border: `1px solid ${COLORS.border}`, animation: "fadeIn .2s ease",
          }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 18 }}>Add new task</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 5 }}>Task title</label>
                <input value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Submit project report" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 5 }}>Deadline</label>
                <input type="datetime-local" value={newTask.deadline} onChange={e => setNewTask(p => ({ ...p, deadline: e.target.value }))} style={{ width: "100%", colorScheme: "dark" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 5 }}>Priority</label>
                  <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))} style={{ width: "100%" }}>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 5 }}>Est. minutes</label>
                  <input type="number" value={newTask.estimatedMins} onChange={e => setNewTask(p => ({ ...p, estimatedMins: e.target.value }))} min="5" step="5" style={{ width: "100%" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 5 }}>Tags (comma separated)</label>
                <input value={newTask.tags} onChange={e => setNewTask(p => ({ ...p, tags: e.target.value }))} placeholder="college, project, career" style={{ width: "100%" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={addTask}>Add task</button>
              <button className="btn-ghost" onClick={() => setShowTaskForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* AI voice assistant — floating button + panel, talks to the same task list */}
      <VoiceAssistant tasks={tasks} onTasksChange={setTasks} />
    </div>
  );
}