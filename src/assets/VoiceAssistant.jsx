import { useState, useEffect, useRef, useCallback } from "react";
import "./VoiceAssistant.css";

// ── Build system prompt with live task list ────────────────────────────────
function buildSystemPrompt(tasks) {
  const taskList = tasks.length
    ? tasks
        .map(
          (t, i) =>
            `  ${i + 1}. [${t.id}] "${t.title}" — due: ${t.dueDate || "no date"}, priority: ${t.priority || "medium"}, completed: ${t.completed ? "yes" : "no"}`
        )
        .join("\n")
    : "  (no tasks yet)";

  return `You are the AI voice assistant for DeadlineZero, a productivity app. You help users manage tasks via natural conversation.

CURRENT TASKS:
${taskList}

YOUR JOB:
- Understand the user's intent (add task, remove task, list tasks, mark complete, prioritize, etc.)
- Respond naturally and conversationally in 1-2 sentences max.
- Always end your response with a JSON action block (even if no action needed).

ACTION BLOCK FORMAT (always include, at the very end):
<action>
{
  "type": "ADD_TASK" | "REMOVE_TASK" | "COMPLETE_TASK" | "LIST_TASKS" | "PRIORITIZE" | "NONE",
  "task": {
    "title": "...",
    "dueDate": "YYYY-MM-DD or null",
    "priority": "high|medium|low",
    "category": "work|personal|health|other"
  },
  "taskId": "...",
  "taskTitle": "...",
  "message": "short confirmation"
}
</action>

RULES:
- For removing tasks, match by title if the user says a name (not ID). Pick the best match.
- For dates: "tomorrow" = tomorrow's date, "next Monday" = calculate relative dates. Today is ${new Date().toLocaleDateString("en-CA")}.
- If the intent is unclear, ask a single clarifying question and use type "NONE".
- Keep your spoken response warm, brief, and encouraging.
- Never repeat the JSON in your spoken text.`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function parseAction(text) {
  const match = text.match(/<action>([\s\S]*?)<\/action>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function stripAction(text) {
  return text.replace(/<action>[\s\S]*?<\/action>/g, "").trim();
}

function genId() {
  return "task_" + Math.random().toString(36).slice(2, 9);
}

const HINTS = [
  "Add a task for tomorrow",
  "Remove the last task",
  "What tasks do I have?",
  "Mark task as done",
  "Add high priority meeting",
];

// ══════════════════════════════════════════════════════════════════════════
// VoiceAssistant component
// ══════════════════════════════════════════════════════════════════════════
export default function VoiceAssistant({ tasks = [], onTasksChange }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi! I'm your AI assistant. Talk or type to manage your tasks — I can add, remove, prioritize, or list them for you.",
    },
  ]);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [status, setStatus] = useState("idle"); // idle | listening | thinking | speaking
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef(null);
  const feedRef = useRef(null);
  const inputRef = useRef(null);
  const taskListRef = useRef(tasks);

  // Keep ref in sync so async callbacks always see the latest tasks
  useEffect(() => {
    taskListRef.current = tasks;
  }, [tasks]);

  // Auto-scroll feed to latest message
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  // ── Speech Recognition setup ──────────────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }

    const recog = new SR();
    recog.continuous = false;
    recog.interimResults = true;
    recog.lang = "en-US";

    recog.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setLiveTranscript(final || interim);
      if (final) handleUserMessage(final.trim());
    };

    recog.onerror = (e) => {
      if (e.error !== "aborted") {
        addMessage("system", `Microphone error: ${e.error}. Try typing instead.`);
      }
      setListening(false);
      setStatus("idle");
      setLiveTranscript("");
    };

    recog.onend = () => {
      setListening(false);
      setStatus((prev) => (prev === "listening" ? "idle" : prev));
      setLiveTranscript("");
    };

    recognitionRef.current = recog;
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────
  const addMessage = useCallback((role, text, extra = {}) => {
    setMessages((prev) => [...prev, { role, text, ...extra }]);
  }, []);

  const speak = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05;
    utt.pitch = 1;
    utt.onend = () => setStatus("idle");
    setStatus("speaking");
    window.speechSynthesis.speak(utt);
  }, []);

  // ── Apply Claude's structured action to task list ─────────────────────
  const applyAction = useCallback(
    (action, spokenText) => {
      const currentTasks = taskListRef.current;
      let updatedTasks = [...currentTasks];
      let actionPill = null;

      switch (action.type) {
        case "ADD_TASK": {
          const newTask = {
            id: genId(),
            title: action.task?.title || "New Task",
            dueDate: action.task?.dueDate || null,
            priority: action.task?.priority || "medium",
            category: action.task?.category || "other",
            completed: false,
            createdAt: new Date().toISOString(),
          };
          updatedTasks = [...currentTasks, newTask];
          actionPill = { type: "add", label: `✓ Added: ${newTask.title}` };
          break;
        }
        case "REMOVE_TASK": {
          const target = action.taskId
            ? currentTasks.find((t) => t.id === action.taskId)
            : currentTasks.find((t) =>
                t.title?.toLowerCase().includes((action.taskTitle || "").toLowerCase())
              );
          if (target) {
            updatedTasks = currentTasks.filter((t) => t.id !== target.id);
            actionPill = { type: "remove", label: `✕ Removed: ${target.title}` };
          }
          break;
        }
        case "COMPLETE_TASK": {
          const target = action.taskId
            ? currentTasks.find((t) => t.id === action.taskId)
            : currentTasks.find((t) =>
                t.title?.toLowerCase().includes((action.taskTitle || "").toLowerCase())
              );
          if (target) {
            updatedTasks = currentTasks.map((t) =>
              t.id === target.id ? { ...t, completed: true } : t
            );
            actionPill = { type: "add", label: `✓ Completed: ${target.title}` };
          }
          break;
        }
        case "LIST_TASKS":
          actionPill = { type: "list", label: `${currentTasks.length} tasks listed` };
          break;
        default:
          break;
      }

      onTasksChange?.(updatedTasks);
      taskListRef.current = updatedTasks;
      addMessage("assistant", spokenText, { actionPill });
      speak(spokenText);
    },
    [addMessage, speak, onTasksChange]
  );

  // ── Call Claude API ───────────────────────────────────────────────────
  const callClaude = useCallback(
    async (userText) => {
      setThinking(true);
      setStatus("thinking");

      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            system: buildSystemPrompt(taskListRef.current),
            messages: [{ role: "user", content: userText }],
          }),
        });

        const data = await response.json();
        const fullText = data.content?.map((b) => b.text || "").join("") || "";
        const action = parseAction(fullText);
        const spokenText = stripAction(fullText);

        if (action) applyAction(action, spokenText);
        else {
          addMessage("assistant", spokenText);
          speak(spokenText);
        }
      } catch {
        const msg = "Sorry, I couldn't connect right now. Please try again.";
        addMessage("assistant", msg);
        speak(msg);
      } finally {
        setThinking(false);
      }
    },
    [addMessage, speak, applyAction]
  );

  // ── Handle user message (from voice or text) ──────────────────────────
  const handleUserMessage = useCallback(
    (text) => {
      if (!text.trim()) return;
      setLiveTranscript("");
      addMessage("user", text);
      callClaude(text);
    },
    [addMessage, callClaude]
  );

  // ── Toggle voice listening ────────────────────────────────────────────
  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
      setStatus("idle");
    } else {
      window.speechSynthesis?.cancel();
      setListening(true);
      setStatus("listening");
      setLiveTranscript("");
      try {
        recognitionRef.current.start();
      } catch {}
    }
  }, [listening]);

  // ── Text input submit ─────────────────────────────────────────────────
  const handleTextSubmit = () => {
    if (!textInput.trim() || thinking) return;
    handleUserMessage(textInput.trim());
    setTextInput("");
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="va-root">
      {/* Panel */}
      {open && (
        <div className="va-panel">
          {/* Header */}
          <div className="va-panel-header">
            <div className="va-panel-title">
              <div className={`va-status-dot ${status}`} />
              AI Assistant
            </div>
            <button
              className="va-close-btn"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              ×
            </button>
          </div>

          {/* Hint chips — shown until first real interaction */}
          {messages.length <= 1 && (
            <div className="va-hints">
              {HINTS.map((h) => (
                <button key={h} className="va-hint" onClick={() => handleUserMessage(h)}>
                  {h}
                </button>
              ))}
            </div>
          )}

          {/* Message feed */}
          <div className="va-feed" ref={feedRef}>
            {!supported && (
              <div className="va-unsupported">
                <strong>Voice not supported in this browser</strong>
                Use the text input below, or try Chrome / Edge for voice.
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`va-bubble ${m.role}`}>
                {m.text}
                {m.actionPill && (
                  <div>
                    <span className={`va-action-pill ${m.actionPill.type}`}>
                      {m.actionPill.label}
                    </span>
                  </div>
                )}
              </div>
            ))}

            {thinking && (
              <div className="va-typing">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          {/* Live transcript bar */}
          <div className={`va-transcript-bar ${liveTranscript ? "active" : ""}`}>
            {liveTranscript || (listening ? "Listening…" : "Speak or type a command")}
          </div>

          {/* Footer: mic + text input + send */}
          <div className="va-footer">
            {supported && (
              <button
                className={`va-mic-btn ${listening ? "listening" : ""}`}
                onClick={toggleListening}
                aria-label={listening ? "Stop listening" : "Start voice input"}
                title={listening ? "Stop" : "Speak"}
              >
                {listening ? (
                  /* Stop square */
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  /* Mini sound bars */
                  <div className="va-mic-bars idle" aria-hidden="true">
                    <span /><span /><span /><span /><span />
                  </div>
                )}
              </button>
            )}

            <input
              ref={inputRef}
              className="va-text-input"
              placeholder="Type a command…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
              disabled={thinking}
              aria-label="Type command"
            />

            <button
              className="va-send-btn"
              onClick={handleTextSubmit}
              disabled={!textInput.trim() || thinking}
              aria-label="Send"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        className="va-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open AI Assistant"
      >
        {open ? (
          /* X to close */
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          /* Animated sound bars */
          <div className={`va-bars ${listening ? "active" : "idle"}`} aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
        )}
      </button>
    </div>
  );
}