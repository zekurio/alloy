//! Audio devices, applications and level meters from PipeWire's node graph.
//!
//! Device ids are node names, which obs-pipewire-audio-capture's device
//! sources reconnect to: a sink for an output, a source for an input.
//! Applications are playback streams, identified for its application capture
//! by binary or, for Wine and shared Electron, by application name.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    thread,
    time::{Duration, Instant},
};

use super::{
    desktop_entries::desktop_application,
    games::unwrapped_executable,
    pipewire::{Client, Graph, Meter, Node, NodeClass},
};
use crate::agent::{
    events::emit_event,
    game_matching::{user_facing_process_name, ProcessDisplayName},
    platform::audio_application_id_from_parts,
};
use crate::protocol::SIDE_CAR_NAME;
use crate::types::{
    RecordingAudioApplicationSelection, RecordingAudioDevice, RecordingAudioDeviceKind,
    RecordingAudioLevel, RecordingAudioLevelTarget, RecordingEvent,
};

const AUDIO_LEVEL_SUBSCRIPTION_TTL: Duration = Duration::from_secs(10);
const AUDIO_LEVEL_POLL_INTERVAL: Duration = Duration::from_millis(100);
const AUDIO_LEVEL_REFRESH_INTERVAL: Duration = Duration::from_secs(2);
/// How long one snapshot of the graph answers lookups. A configure asks for
/// the devices, each default, and the applications in turn; one connection
/// serves them all, and a stalled server costs one timeout, not one per
/// lookup.
const GRAPH_REUSE: Duration = Duration::from_secs(1);

type GraphResult = Result<Arc<Graph>, String>;

static LAST_GRAPH: Mutex<Option<(Instant, GraphResult)>> = Mutex::new(None);

/// The graph from a recent lookup, or a fresh one. The lock is held while
/// connecting, so concurrent lookups wait for that snapshot.
fn graph() -> GraphResult {
    let mut last = LAST_GRAPH.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((_, graph)) = last.as_ref().filter(|(at, _)| at.elapsed() < GRAPH_REUSE) {
        return graph.clone();
    }
    let graph = Client::connect().map(|client| Arc::new(client.graph()));
    *last = Some((Instant::now(), graph.clone()));
    graph
}

fn devices(graph: &Graph) -> Vec<RecordingAudioDevice> {
    graph
        .nodes
        .iter()
        .filter_map(|node| {
            let kind = match node.class {
                NodeClass::Sink => RecordingAudioDeviceKind::Output,
                NodeClass::Source => RecordingAudioDeviceKind::Input,
                NodeClass::Playback => return None,
            };
            Some(RecordingAudioDevice {
                id: node.name.clone(),
                label: node.description.clone(),
                kind,
            })
        })
        .collect()
}

/// Playback streams from other processes. The agent's own notification
/// sounds are left out.
fn playback_streams(graph: &Graph) -> impl Iterator<Item = &Node> {
    graph.nodes.iter().filter(|node| {
        node.class == NodeClass::Playback && node.process_id != Some(std::process::id())
    })
}

/// How a playback stream is identified. PipeWire's application capture
/// matches its target against the stream's binary or application name.
/// Streams from a runtime that hosts many programs report the runtime as
/// their binary but name the program, so they are matched by name: Wine's
/// loader for Windows programs, and `electron` for apps that run on a shared
/// Electron, as Nix packages them.
struct StreamApplication {
    id: String,
    target: String,
    executable: String,
    name: Option<String>,
    process_id: Option<u32>,
}

fn stream_application(node: &Node) -> Option<StreamApplication> {
    let by_name = node.binary.as_deref().is_none_or(|binary| {
        binary.starts_with("wine") || unwrapped_executable(binary.to_string()) == "electron"
    });
    let (target, executable) = if by_name {
        let name = node.application_name.clone()?;
        (name.clone(), name)
    } else {
        let binary = node.binary.clone()?;
        (binary.clone(), unwrapped_executable(binary))
    };
    Some(StreamApplication {
        id: audio_application_id_from_parts(Some(&executable), None, node.process_id.unwrap_or(0)),
        target,
        executable,
        name: node.application_name.clone(),
        process_id: node.process_id,
    })
}

pub(in crate::agent) fn audio_devices() -> Result<Vec<RecordingAudioDevice>, String> {
    let graph = graph()?;
    Ok(devices(&graph))
}

pub(in crate::agent) fn default_audio_device_id(kind: &RecordingAudioDeviceKind) -> Option<String> {
    let graph = graph().ok()?;
    match kind {
        RecordingAudioDeviceKind::Output => graph.default_sink.clone(),
        RecordingAudioDeviceKind::Input => graph.default_source.clone(),
    }
}

pub(in crate::agent) fn audio_applications() -> Vec<RecordingAudioApplicationSelection> {
    let graph = match graph() {
        Ok(graph) => graph,
        Err(error) => {
            eprintln!("[{SIDE_CAR_NAME}] could not list audio applications: {error}");
            return Vec::new();
        }
    };
    let mut applications: Vec<RecordingAudioApplicationSelection> = Vec::new();
    for application in playback_streams(&graph).filter_map(stream_application) {
        if applications.iter().any(|known| known.id == application.id) {
            continue;
        }
        let desktop = desktop_application(
            application.process_id,
            &[
                application.executable.as_str(),
                application.name.as_deref().unwrap_or_default(),
            ],
        );
        let name = desktop
            .as_ref()
            .and_then(|desktop| desktop.name.clone())
            .or_else(|| {
                user_facing_process_name(ProcessDisplayName {
                    path: None,
                    preferred: application.name.as_deref(),
                    title: None,
                    executable: Some(&application.executable),
                    fallback: Some(&application.executable),
                    preserve_preferred: false,
                })
            })
            .unwrap_or_else(|| application.executable.clone());
        applications.push(RecordingAudioApplicationSelection {
            id: application.id,
            name,
            window: application.target,
            executable: Some(application.executable),
            icon_url: desktop.and_then(|desktop| desktop.icon_url),
            process_id: application.process_id,
            enabled: false,
            volume: 100,
        });
    }
    applications
}

struct AudioLevelMonitor {
    deadline: Option<Instant>,
    running: bool,
}

static AUDIO_LEVEL_MONITOR: Mutex<AudioLevelMonitor> = Mutex::new(AudioLevelMonitor {
    deadline: None,
    running: false,
});

/// Keeps live `audio-levels` events flowing for the next few seconds.
/// Callers re-send this as a heartbeat while a meter UI is visible, so a
/// crashed window or sidecar respawn never leaves the meter thread orphaned.
pub(in crate::agent) fn subscribe_audio_level_events() {
    let mut monitor = lock_audio_level_monitor();
    monitor.deadline = Some(Instant::now() + AUDIO_LEVEL_SUBSCRIPTION_TTL);
    if !monitor.running {
        monitor.running = true;
        thread::spawn(run_audio_level_monitor);
    }
}

pub(in crate::agent) fn stop_audio_level_events() {
    lock_audio_level_monitor().deadline = None;
}

fn lock_audio_level_monitor() -> MutexGuard<'static, AudioLevelMonitor> {
    match AUDIO_LEVEL_MONITOR.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// True while the subscription deadline is in the future. Once expired the
/// monitor is marked stopped under the same lock, so a concurrent subscribe
/// either extends the deadline in time or spawns a fresh thread.
fn audio_level_subscription_active() -> bool {
    let mut monitor = lock_audio_level_monitor();
    let active = monitor
        .deadline
        .is_some_and(|deadline| Instant::now() < deadline);
    if !active {
        monitor.deadline = None;
        monitor.running = false;
    }
    active
}

#[derive(Clone, PartialEq, Eq, Hash)]
enum MeterTarget {
    /// A device by node name.
    Device(String),
    /// A playback stream by node serial.
    Stream(u32),
}

enum MeterLevel {
    Device {
        kind: RecordingAudioDeviceKind,
        ids: Vec<String>,
    },
    Application(String),
}

struct LevelMeter {
    meter: Meter,
    level: MeterLevel,
}

fn run_audio_level_monitor() {
    let client = match Client::connect() {
        Ok(client) => client,
        Err(error) => {
            eprintln!("[{SIDE_CAR_NAME}] audio levels unavailable: {error}");
            let mut monitor = lock_audio_level_monitor();
            monitor.deadline = None;
            monitor.running = false;
            return;
        }
    };

    let mut meters: HashMap<MeterTarget, LevelMeter> = HashMap::new();
    let mut refreshed_at: Option<Instant> = None;
    while audio_level_subscription_active() {
        // The client follows devices and streams as they come and go;
        // reconcile the meters on a slow cadence and only read the peaks in
        // between.
        if refreshed_at.is_none_or(|at| at.elapsed() >= AUDIO_LEVEL_REFRESH_INTERVAL) {
            reconcile_meters(&client, &mut meters, &client.graph());
            refreshed_at = Some(Instant::now());
        }
        emit_event(RecordingEvent::AudioLevels {
            levels: poll_levels(&meters),
        });
        thread::sleep(AUDIO_LEVEL_POLL_INTERVAL);
    }

    // The loop only ends once `audio_level_subscription_active` marked the
    // monitor stopped, under the lock a new subscription takes; resetting it
    // here could stop the monitor that subscription started.
    for (_, meter) in meters.drain() {
        client.remove_meter(meter.meter);
    }
}

fn reconcile_meters(client: &Client, meters: &mut HashMap<MeterTarget, LevelMeter>, graph: &Graph) {
    // Target, whether it reads a sink's playback, and what its level reports.
    let mut wanted: HashMap<MeterTarget, (String, bool, MeterLevel)> = HashMap::new();
    for device in devices(graph) {
        let (default, capture_sink) = match device.kind {
            RecordingAudioDeviceKind::Output => (graph.default_sink.as_deref(), true),
            RecordingAudioDeviceKind::Input => (graph.default_source.as_deref(), false),
        };
        let mut ids = vec![device.id.clone()];
        if default == Some(device.id.as_str()) {
            ids.push("default".to_string());
        }
        wanted.insert(
            MeterTarget::Device(device.id.clone()),
            (
                device.id,
                capture_sink,
                MeterLevel::Device {
                    kind: device.kind,
                    ids,
                },
            ),
        );
    }
    for node in playback_streams(graph) {
        let (Some(application), Some(serial)) = (stream_application(node), node.serial) else {
            continue;
        };
        wanted.insert(
            MeterTarget::Stream(serial),
            (
                serial.to_string(),
                false,
                MeterLevel::Application(application.id),
            ),
        );
    }

    let gone: Vec<_> = meters
        .keys()
        .filter(|target| !wanted.contains_key(target))
        .cloned()
        .collect();
    for target in gone {
        if let Some(meter) = meters.remove(&target) {
            client.remove_meter(meter.meter);
        }
    }
    for (target, (object, capture_sink, level)) in wanted {
        if let Some(meter) = meters.get_mut(&target) {
            meter.level = level;
            continue;
        }
        match client.meter(&object, capture_sink) {
            Ok(meter) => {
                meters.insert(target, LevelMeter { meter, level });
            }
            Err(error) => eprintln!("[{SIDE_CAR_NAME}] audio level meter skipped: {error}"),
        }
    }
}

fn poll_levels(meters: &HashMap<MeterTarget, LevelMeter>) -> Vec<RecordingAudioLevel> {
    let mut levels = Vec::new();
    // An application can play several streams; report the loudest one.
    let mut application_peaks: HashMap<&str, f32> = HashMap::new();
    for meter in meters.values() {
        let peak = meter.meter.take_peak();
        match &meter.level {
            MeterLevel::Device { kind, ids } => {
                for id in ids {
                    levels.push(RecordingAudioLevel {
                        target: RecordingAudioLevelTarget::Device,
                        kind: Some(kind.clone()),
                        id: id.clone(),
                        peak,
                    });
                }
            }
            MeterLevel::Application(id) => {
                let entry = application_peaks.entry(id.as_str()).or_insert(0.0);
                *entry = entry.max(peak);
            }
        }
    }
    for (id, peak) in application_peaks {
        levels.push(RecordingAudioLevel {
            target: RecordingAudioLevelTarget::Application,
            kind: None,
            id: id.to_string(),
            peak,
        });
    }
    levels
}
