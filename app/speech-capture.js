const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported",
]);

const RESTART_DELAY_MS = 250;
const MAX_RESTART_DELAY_MS = 2_000;
const RAPID_END_MS = 1_000;

function joinText(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * A bounded Web Speech listening session. Each browser recognition instance may
 * end after a short silence; the session survives those ends until its time
 * budget expires or the user explicitly stops it.
 */
export class SpeechCapture {
  constructor({
    Recognition,
    now = Date.now,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = (id) => globalThis.clearTimeout(id),
    durationMs = 90_000,
    cooldownMs = 600,
    onText = () => {},
    onState = () => {},
  } = {}) {
    this.Recognition = Recognition;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.durationMs = durationMs;
    this.cooldownMs = cooldownMs;
    this.onText = onText;
    this.onState = onState;

    this._active = false;
    this._paused = false;
    this._recognition = null;
    this._generation = 0;
    this._language = "en-US";
    this._remainingMs = durationMs;
    this._deadline = 0;
    this._deadlineTimer = null;
    this._restartTimer = null;
    this._resumeTimer = null;
    this._initialText = "";
    this._committedFinal = "";
    this._sessionFinal = "";
    this._interim = "";
    this._rapidEndCount = 0;
  }

  get active() {
    return this._active;
  }

  get paused() {
    return this._paused;
  }

  get remainingMs() {
    return this._active && !this._paused
      ? Math.max(0, this._deadline - this.now())
      : this._remainingMs;
  }

  start({ language = "en-US", initialText = "" } = {}) {
    if (this._active) this.stop("replaced");
    if (!this.Recognition) {
      this.onState({
        state: "error",
        remainingMs: 0,
        reason: "unsupported",
      });
      return false;
    }
    this._active = true;
    this._paused = false;
    this._language = language;
    this._remainingMs = Math.max(0, this.durationMs);
    this._initialText = String(initialText || "").trim();
    this._committedFinal = "";
    this._sessionFinal = "";
    this._interim = "";
    this._rapidEndCount = 0;
    this._generation++;
    this._beginBudget();
    this._startRecognition();
    return this._active;
  }

  stop(reason = "stopped") {
    if (!this._active) return;
    this._remainingMs = this.remainingMs;
    this._active = false;
    this._paused = false;
    this._clearTimers();
    this._commitCurrentFinal();
    this._interim = "";
    this._generation++;
    const previous = this._recognition;
    this._recognition = null;
    if (previous) {
      try {
        previous.abort();
      } catch {
        // Engines may already have ended. A stale onend must not rearm us.
      }
    }
    this._emitText();
    const state =
      reason === "time-limit"
        ? "complete"
        : FATAL_ERRORS.has(reason) || reason === "start-failed"
          ? "error"
          : "stopped";
    this.onState({ state, remainingMs: this._remainingMs, reason });
  }

  pauseForOutput() {
    if (!this._active) return;
    if (this._paused) {
      // Asha can speak again before the prior cooldown fires. Cancel that
      // pending resume so her second utterance never reaches the microphone.
      if (this._resumeTimer !== null) {
        this.clearTimer(this._resumeTimer);
        this._resumeTimer = null;
      }
      return;
    }
    this._remainingMs = this.remainingMs;
    this._paused = true;
    this._clearTimers();
    this._commitCurrentFinal();
    this._interim = "";
    this._generation++;
    const previous = this._recognition;
    this._recognition = null;
    if (previous) {
      try {
        previous.abort();
      } catch {
        // Recognition may have ended just before output started.
      }
    }
    this._emitText();
    this.onState({
      state: "paused",
      remainingMs: this._remainingMs,
      reason: "output",
    });
  }

  resumeAfterOutput() {
    if (!this._active || !this._paused) return;
    if (this._resumeTimer !== null) this.clearTimer(this._resumeTimer);
    this._resumeTimer = this.setTimer(
      () => {
        this._resumeTimer = null;
        if (!this._active || !this._paused) return;
        this._paused = false;
        this._beginBudget();
        this._startRecognition();
      },
      Math.max(0, this.cooldownMs),
    );
  }

  _clearTimers() {
    for (const key of ["_deadlineTimer", "_restartTimer", "_resumeTimer"]) {
      if (this[key] !== null) this.clearTimer(this[key]);
      this[key] = null;
    }
  }

  _beginBudget() {
    if (this._remainingMs <= 0) {
      this.stop("time-limit");
      return;
    }
    this._deadline = this.now() + this._remainingMs;
    this._deadlineTimer = this.setTimer(() => {
      this._deadlineTimer = null;
      this.stop("time-limit");
    }, this._remainingMs);
    this.onState({
      state: "listening",
      remainingMs: this._remainingMs,
      reason: "ready",
    });
  }

  _startRecognition() {
    if (!this._active || this._paused || this.remainingMs <= 0) {
      if (this._active && !this._paused) this.stop("time-limit");
      return;
    }
    let recognition;
    try {
      recognition = new this.Recognition();
      recognition.lang = this._language;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
    } catch {
      this.stop("start-failed");
      return;
    }
    this._recognition = recognition;
    this._sessionFinal = "";
    this._interim = "";
    const startedAt = this.now();
    const generation = ++this._generation;
    const current = () =>
      this._active &&
      !this._paused &&
      generation === this._generation &&
      recognition === this._recognition;

    recognition.onresult = (event) => {
      if (!current()) return;
      const finalParts = [];
      const interimParts = [];
      // Web Speech sends a cumulative results collection. Rebuild it instead
      // of appending every result event, which duplicates earlier final words.
      for (const result of Array.from(event.results || [])) {
        const transcript = result?.[0]?.transcript;
        if (!transcript) continue;
        (result.isFinal ? finalParts : interimParts).push(transcript);
      }
      this._sessionFinal = joinText(...finalParts);
      this._interim = joinText(...interimParts);
      this._emitText();
    };
    recognition.onerror = (event) => {
      if (!current()) return;
      const error = String(event?.error || "unknown");
      if (FATAL_ERRORS.has(error)) {
        this.stop(error);
      } else {
        this.onState({
          state: "listening",
          remainingMs: this.remainingMs,
          reason: error,
        });
      }
    };
    recognition.onend = () => {
      if (!current()) return;
      const endedRapidly = this.now() - startedAt < RAPID_END_MS;
      const restartDelay = endedRapidly
        ? Math.min(
            MAX_RESTART_DELAY_MS,
            RESTART_DELAY_MS * 2 ** this._rapidEndCount++,
          )
        : RESTART_DELAY_MS;
      if (!endedRapidly) this._rapidEndCount = 0;
      this._commitCurrentFinal();
      this._interim = "";
      this._recognition = null;
      this._generation++;
      this._emitText();
      if (this.remainingMs <= 0) {
        this.stop("time-limit");
        return;
      }
      this.onState({
        state: "listening",
        remainingMs: this.remainingMs,
        reason: "restarting",
      });
      this._restartTimer = this.setTimer(
        () => {
          this._restartTimer = null;
          this._startRecognition();
        },
        Math.min(restartDelay, this.remainingMs),
      );
    };
    try {
      recognition.start();
    } catch {
      if (current()) this.stop("start-failed");
    }
  }

  _commitCurrentFinal() {
    this._committedFinal = joinText(this._committedFinal, this._sessionFinal);
    this._sessionFinal = "";
  }

  _emitText() {
    const finalText = joinText(
      this._initialText,
      this._committedFinal,
      this._sessionFinal,
    );
    const interimText = this._interim;
    this.onText(joinText(finalText, interimText), { finalText, interimText });
  }
}
