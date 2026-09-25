use std::io::{self, Write};

use crate::types::{EventEnvelope, RecordingEvent};

pub(super) fn emit_event(event: RecordingEvent) {
    let envelope = EventEnvelope { event };
    if let Ok(line) = serde_json::to_string(&envelope) {
        let _ = writeln!(io::stdout().lock(), "{line}");
        let _ = io::stdout().flush();
    }
}
