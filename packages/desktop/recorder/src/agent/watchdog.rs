use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

/// Only completed recorder work renews this deadline. Cached status reads and
/// hotkey events must not keep a blocked OBS call alive.
pub(super) struct RecorderProgress {
    last_completed_at: Mutex<Instant>,
    timeout: Duration,
}

impl RecorderProgress {
    pub(super) fn new(now: Instant, timeout: Duration) -> Self {
        Self {
            last_completed_at: Mutex::new(now),
            timeout,
        }
    }

    pub(super) fn completed(&self, now: Instant) {
        *self
            .last_completed_at
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = now;
    }

    pub(super) fn stalled(&self, now: Instant) -> bool {
        let completed_at = *self
            .last_completed_at
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        now.saturating_duration_since(completed_at) >= self.timeout
    }
}
