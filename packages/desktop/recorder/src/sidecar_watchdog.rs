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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_a_stall_after_progress_stops_without_renewing_on_reads() {
        let start = Instant::now();
        let progress = RecorderProgress::new(start, Duration::from_secs(90));
        // Healthy recorder work can run for much longer than one deadline.
        for seconds in [60, 120, 180] {
            let now = start + Duration::from_secs(seconds);
            assert!(!progress.stalled(now));
            progress.completed(now);
        }
        // The I/O thread can still answer requests while recorder work blocks.
        assert!(!progress.stalled(start + Duration::from_secs(269)));
        assert!(progress.stalled(start + Duration::from_secs(270)));
        assert!(progress.stalled(start + Duration::from_secs(300)));
    }
}
