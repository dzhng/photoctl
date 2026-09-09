use napi_derive::napi;
use ort::logging::{LogLevel, LoggerFunction};
use std::sync::{Arc, Mutex, OnceLock};

const MAX_DIAGNOSTICS: usize = 64;
const MAX_FIELD_BYTES: usize = 4096;

#[napi(object)]
#[derive(Clone)]
pub struct RuntimeDiagnostic {
    pub scope: String,
    pub severity: String,
    pub code_location: String,
    pub message: String,
    pub truncated: bool,
}

#[napi(object)]
#[derive(Default)]
pub struct RuntimeDiagnostics {
    pub diagnostics: Vec<RuntimeDiagnostic>,
    pub dropped_diagnostics: u32,
}

pub struct Recorder {
    scope: &'static str,
    pending: Mutex<RuntimeDiagnostics>,
}

impl Recorder {
    pub fn new(scope: &'static str) -> Arc<Self> {
        Arc::new(Self {
            scope,
            pending: Mutex::new(RuntimeDiagnostics::default()),
        })
    }

    pub fn logger(self: &Arc<Self>) -> LoggerFunction {
        let recorder = Arc::clone(self);
        // ort rc13 decodes category from the wrong pointer; code location is reliable.
        Arc::new(move |level, _category, _id, location, message| {
            recorder.record(level, location, message);
        })
    }

    fn record(&self, level: LogLevel, location: &str, message: &str) {
        if level < LogLevel::Warning {
            return;
        }
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if pending.diagnostics.len() == MAX_DIAGNOSTICS {
            pending.dropped_diagnostics = pending.dropped_diagnostics.saturating_add(1);
            return;
        }
        let mut truncated = false;
        let mut bounded = |value: &str| {
            let mut end = value.len().min(MAX_FIELD_BYTES);
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            truncated |= end != value.len();
            value[..end].to_owned()
        };
        let code_location = bounded(location);
        let message = bounded(message);
        pending.diagnostics.push(RuntimeDiagnostic {
            scope: self.scope.into(),
            severity: match level {
                LogLevel::Warning => "warning",
                LogLevel::Error => "error",
                _ => "fatal",
            }
            .into(),
            code_location,
            message,
            truncated,
        });
    }

    pub fn take(&self) -> RuntimeDiagnostics {
        std::mem::take(
            &mut *self
                .pending
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        )
    }
}

pub fn runtime_recorder() -> &'static Arc<Recorder> {
    static RECORDER: OnceLock<Arc<Recorder>> = OnceLock::new();
    RECORDER.get_or_init(|| {
        let recorder = Recorder::new("runtime");
        // Commit the callback before any session can create ORT's environment.
        ort::init()
            .with_name("photoctl")
            .with_logger(recorder.logger())
            .commit();
        recorder
    })
}

pub fn take_diagnostics(session: &Recorder) -> RuntimeDiagnostics {
    let mut batch = runtime_recorder().take();
    let session = session.take();
    batch.diagnostics.extend(session.diagnostics);
    batch.dropped_diagnostics = batch
        .dropped_diagnostics
        .saturating_add(session.dropped_diagnostics);
    batch
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_fields_keep_valid_utf8_and_report_truncation() {
        let recorder = Recorder::new("runtime");
        recorder.record(LogLevel::Error, "location", &"€".repeat(2000));
        let batch = recorder.take();
        assert_eq!(batch.diagnostics[0].message, "€".repeat(1365));
        assert!(batch.diagnostics[0].truncated);
        assert_eq!(batch.diagnostics[0].severity, "error");
        assert_eq!(batch.diagnostics[0].scope, "runtime");
        assert_eq!(batch.dropped_diagnostics, 0);
    }

    #[test]
    fn retained_diagnostics_are_bounded_and_overflow_is_observable_once() {
        let recorder = Recorder::new("session");
        for index in 0..66 {
            recorder.record(LogLevel::Warning, "fixture", &format!("warning-{index}"));
        }
        let batch = recorder.take();
        assert_eq!(
            batch
                .diagnostics
                .iter()
                .map(|entry| entry.message.clone())
                .collect::<Vec<_>>(),
            (0..64)
                .map(|index| format!("warning-{index}"))
                .collect::<Vec<_>>()
        );
        assert_eq!(batch.dropped_diagnostics, 2);
        let empty = recorder.take();
        assert!(empty.diagnostics.is_empty());
        assert_eq!(empty.dropped_diagnostics, 0);
    }
}
