# DeadlineZero

An AI-powered productivity app that goes beyond passive reminders — it prioritizes your tasks, tracks habits, and lets you manage everything by voice. Built for the **Vibe2Ship Hackathon** (Problem Statement: *The Last-Minute Life Saver*).

> "Don't just remind me — help me actually get it done."

---

## Features

- **Personalized onboarding** — enter your name once; the app starts blank for you, not pre-filled with someone else's sample data
- **AI-prioritized tasks** — each task carries an urgency score and a one-line reason, surfaced front and center on the dashboard
- **Voice assistant** — a floating mic you can talk *or* type to: "add a task to submit my report tomorrow at 6pm" lands directly in your task list, fully reasoned about by Gemini (priority, urgency score, and why)
- **Habit tracking** — streaks, a 28-day heatmap, add as many as you want
- **Calendar view** — current month, real dates, tasks plotted on their actual deadline
- **Browser notifications with sound** — get pinged (with a little chime) when a deadline is approaching or passed, on your own schedule
- **Fully responsive** — slide-out sidebar and stacked layout under 768px, usable on a phone
- **Persists across reloads** — your data lives in `localStorage`, so closing the tab doesn't lose anything; a "Clear all data" option is in Settings if you want a fresh start

## Tech stack

| Piece | Choice | Why |
|---|---|---|
| Frontend | React (Vite) | Fast dev loop, no framework overhead needed for a single-page app |
| Voice & AI backend | Node.js + Express | Tiny dedicated server — keeps the Gemini API key off the client |
| AI model | Google Gemini (`gemini-1.5-flash`) via Google AI Studio | Hackathon-mandated AI provider; called server-side only |
| Voice input/output | Web Speech API (`SpeechRecognition` / `SpeechSynthesis`) | Native browser APIs, no extra dependency |
| Notifications | Web Notification API + Web Audio API | Native desktop notifications; the chime is synthesized on the fly, no audio file needed |
| Persistence | `localStorage` | No database needed for a single-user, single-device hackathon build |
| Styling | Inline styles + a single injected stylesheet | Keeps the whole UI in one file, no build-step CSS tooling |

## Project structure

```
deadlinezero/
├── App.jsx                      # Main app: dashboard, tasks, habits, calendar, settings
├── assets/
│   ├── VoiceAssistant.jsx       # Floating mic/chat widget — talks to voice-backend
│   └── VoiceAssistant.css       # Styles for the assistant panel
└── voice-backend/               # Separate Express server (runs on its own port)
    ├── server.js                # POST /api/voice-command — calls Gemini server-side
    ├── package.json
    └── .env.example
```

The voice backend is intentionally **separate** from the main app. A Vite dev server has no backend of its own, and an AI provider's API can't be called safely or successfully straight from the browser — there's nowhere to keep the key, and the request would get blocked by CORS anyway. This small server is the fix: it holds the key, builds the prompt, and is the only thing that talks to Gemini.

## Setup

### 1. Frontend
```bash
npm install
npm run dev          # http://localhost:5173
```

### 2. Voice backend (separate terminal, runs alongside the frontend)
```bash
cd voice-backend
cp .env.example .env
```
Edit `.env`:
```
GEMINI_API_KEY=your-key-from-aistudio.google.com
PORT=5050
FRONTEND_URL=http://localhost:5173
```
Get a key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey), then:
```bash
npm install
npm run dev           # http://localhost:5050
```

**Both servers need to be running at the same time** — the frontend for the app itself, the backend for the voice assistant to work. If you don't need voice features for a given session, the rest of the app (tasks, habits, calendar, notifications) works fine with only the frontend running.

### Environment variables

| Variable | Where | Required | Default |
|---|---|---|---|
| `GEMINI_API_KEY` | `voice-backend/.env` | Yes | — |
| `PORT` | `voice-backend/.env` | No | `5050` |
| `FRONTEND_URL` | `voice-backend/.env` | No | `http://localhost:5173` |
| `VITE_VOICE_BACKEND_URL` | frontend `.env` | No | `http://localhost:5050` |

## How the voice assistant works

1. You speak or type a command into the floating assistant.
2. The frontend sends your message *and* your current task list to `voice-backend`.
3. The backend builds a prompt (live task list included) and calls Gemini, asking for a short spoken reply plus a structured action block (`ADD_TASK`, `REMOVE_TASK`, `COMPLETE_TASK`, `LIST_TASKS`, or `NONE`).
4. The frontend parses that action, applies it to the real task list (same shape as manually-added tasks — deadline, priority, status, AI score, AI reason), and speaks the reply back to you.

Gemini computes the urgency score and reasoning itself, factoring in both the stated priority and how soon the deadline is — voice-added tasks get prioritized exactly like manually-added ones.

## Known limitations

- **The AI Planner chat tab** (in the sidebar) currently returns canned, randomized replies — it is *not* wired to a real model yet. This is separate from the floating voice assistant, which *is* real and Gemini-backed.
- **Voice input** requires a Chromium-based browser (Chrome, Edge). Other browsers fall back to text input automatically.
- **Notification sound** requires at least one prior click anywhere on the page — a browser security rule, not a bug. By the time notification permission is granted, this is already satisfied.
- **Data is per-browser, per-device.** `localStorage` doesn't sync across devices and is wiped if the user clears site data.
- **`localhost:5050` won't exist once deployed.** Shipping this for real means hosting `voice-backend` somewhere with a Node runtime (Render, Railway, Fly.io) — static hosts like Vercel/Netlify only serve the frontend.

## Possible next steps

- Wire the AI Planner tab to the same Gemini backend the voice assistant already uses
- Add a proactive check that surfaces a "recovery plan" *before* the user has to ask, for tasks at serious risk of being missed
- Swap `localStorage` for a real account + database if multi-device sync becomes a goal beyond the hackathon
