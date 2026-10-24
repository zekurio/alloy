//! gpu-screen-recorder: discovery, the replay process and screenshots.
//!
//! Monitor capture goes through KMS, which needs no portal dialog. Its helper,
//! `gsr-kms-server`, needs `cap_sys_admin`; without it gpu-screen-recorder
//! asks for a password through polkit each time it starts.
//!
//! Every process starts with a parent-death signal: an orphaned recorder would
//! keep capturing the screen after the agent is gone.

use std::{
    ffi::OsString,
    fs,
    io::{self, BufRead, BufReader, Write},
    os::unix::{net::UnixStream, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    protocol::SIDE_CAR_NAME,
    types::{
        RecordingAudioDevice, RecordingAudioDeviceKind, RecordingAudioDeviceSelection,
        RecordingBufferStorage, RecordingCodec, RecordingDisplay, VideoDimensions,
    },
};

/// Overrides the `gpu-screen-recorder` found on `PATH`.
const GSR_PATH_ENV: &str = "ALLOY_GSR_PATH";
/// Generous, since a missing KMS capability turns startup into a password
/// prompt.
const START_TIMEOUT: Duration = Duration::from_secs(60);
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
/// Writing a long replay held on disk can take a while.
const SAVE_TIMEOUT: Duration = Duration::from_secs(60);
const SCREENSHOT_TIMEOUT: Duration = Duration::from_secs(15);
const AUDIO_BITRATE_KBPS: u32 = 160;
/// Matches the keyframe interval of Windows recordings, which the host's
/// stream-copy exports rely on.
const KEYFRAME_INTERVAL_SECONDS: u32 = 2;

fn command() -> Command {
    let program =
        std::env::var_os(GSR_PATH_ENV).unwrap_or_else(|| OsString::from("gpu-screen-recorder"));
    let mut command = Command::new(program);
    command.stdin(Stdio::null());
    // SAFETY: prctl is async-signal-safe and only changes the child.
    unsafe {
        command.pre_exec(|| {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGINT) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command
}

fn start_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        "gpu-screen-recorder is not installed.".to_string()
    } else {
        format!("Could not start gpu-screen-recorder: {error}")
    }
}

fn query(args: &[&str]) -> Result<String, String> {
    let output = command()
        .args(args)
        .stderr(Stdio::null())
        .output()
        .map_err(start_error)?;
    if !output.status.success() {
        return Err(format!(
            "gpu-screen-recorder {} failed ({}).",
            args.join(" "),
            output.status
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[derive(Clone, Debug, Default)]
pub(super) struct GsrInfo {
    pub(super) vendor: String,
    codecs: Vec<String>,
}

impl GsrInfo {
    pub(super) fn hardware_codecs(&self) -> Vec<RecordingCodec> {
        [
            ("h264", RecordingCodec::H264),
            ("hevc", RecordingCodec::Hevc),
            ("av1", RecordingCodec::Av1),
        ]
        .into_iter()
        .filter(|(name, _)| self.codecs.iter().any(|codec| codec == name))
        .map(|(_, codec)| codec)
        .collect()
    }

    pub(super) fn software_h264(&self) -> bool {
        self.codecs.iter().any(|codec| codec == "h264_software")
    }
}

/// `--info` prints `section=<name>` headers followed by one entry per line.
pub(super) fn info() -> Result<GsrInfo, String> {
    let output = query(&["--info"])?;
    let mut info = GsrInfo::default();
    let mut section = "";
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(name) = line.strip_prefix("section=") {
            section = name;
            continue;
        }
        match section {
            "gpu_info" => {
                if let Some(vendor) = line.strip_prefix("vendor|") {
                    info.vendor = vendor.to_string();
                }
            }
            "video_codecs" => info.codecs.push(line.to_string()),
            _ => {}
        }
    }
    Ok(info)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Monitor {
    pub(super) name: String,
    pub(super) width: u32,
    pub(super) height: u32,
}

impl Monitor {
    pub(super) fn dimensions(&self) -> VideoDimensions {
        VideoDimensions {
            width: self.width,
            height: self.height,
        }
    }

    pub(super) fn display(&self, primary: bool) -> RecordingDisplay {
        RecordingDisplay {
            id: self.name.clone(),
            name: self.name.clone(),
            width: self.width,
            height: self.height,
            primary,
            thumbnail_data_url: None,
        }
    }
}

/// Monitors by connector name (`DP-1|2560x1440`). gpu-screen-recorder's
/// `screen` is the first one, so that one counts as primary.
pub(super) fn monitors() -> Vec<Monitor> {
    let Ok(output) = query(&["--list-monitors"]) else {
        return Vec::new();
    };
    output
        .lines()
        .filter_map(|line| {
            let (name, size) = line.trim().split_once('|')?;
            let (width, height) = size.split_once('x')?;
            Some(Monitor {
                name: name.to_string(),
                width: width.parse().ok()?,
                height: height.parse().ok()?,
            })
        })
        .collect()
}

pub(in crate::agent) fn list_displays() -> Vec<RecordingDisplay> {
    monitors()
        .iter()
        .enumerate()
        .map(|(index, monitor)| monitor.display(index == 0))
        .collect()
}

/// PipeWire sources (`name|description`). An output is recorded through its
/// monitor source. The defaults follow the system's current device and use
/// the shared `default` id.
pub(super) fn audio_devices() -> Vec<RecordingAudioDevice> {
    let Ok(output) = query(&["--list-audio-devices"]) else {
        return Vec::new();
    };
    output
        .lines()
        .filter_map(|line| {
            let (id, label) = line.trim().split_once('|')?;
            Some(match id {
                "default_output" => RecordingAudioDevice {
                    id: "default".to_string(),
                    label: "Default output".to_string(),
                    kind: RecordingAudioDeviceKind::Output,
                },
                "default_input" => RecordingAudioDevice {
                    id: "default".to_string(),
                    label: "Default microphone".to_string(),
                    kind: RecordingAudioDeviceKind::Input,
                },
                _ if id.ends_with(".monitor") => RecordingAudioDevice {
                    id: id.to_string(),
                    label: label
                        .strip_prefix("Monitor of ")
                        .unwrap_or(label)
                        .to_string(),
                    kind: RecordingAudioDeviceKind::Output,
                },
                _ => RecordingAudioDevice {
                    id: id.to_string(),
                    label: label.to_string(),
                    kind: RecordingAudioDeviceKind::Input,
                },
            })
        })
        .collect()
}

pub(super) fn audio_device_source(device: &RecordingAudioDeviceSelection) -> String {
    match (device.id.as_str(), &device.kind) {
        ("default", RecordingAudioDeviceKind::Output) => "default_output".to_string(),
        ("default", RecordingAudioDeviceKind::Input) => "default_input".to_string(),
        (id, _) => format!("device:{id}"),
    }
}

/// Applications playing audio, by their PipeWire application name.
pub(super) fn audio_applications() -> Vec<String> {
    let Ok(output) = query(&["--list-application-audio"]) else {
        return Vec::new();
    };
    output
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

/// Everything that requires a new replay process when it changes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ReplayConfig {
    pub(super) monitor: String,
    pub(super) fps: u32,
    pub(super) replay_seconds: u32,
    pub(super) storage: RecordingBufferStorage,
    pub(super) codec: RecordingCodec,
    pub(super) cpu: bool,
    pub(super) bitrate_kbps: u32,
    /// The scaled size, or `None` to record the monitor's own size.
    pub(super) output: Option<VideoDimensions>,
    /// `|`-joined sources mixed into one track, or `None` for no audio.
    pub(super) audio: Option<String>,
}

impl ReplayConfig {
    fn args(&self, directory: &Path, socket: &Path) -> Vec<OsString> {
        let codec = match self.codec {
            RecordingCodec::H264 => "h264",
            RecordingCodec::Hevc => "hevc",
            RecordingCodec::Av1 => "av1",
        };
        let storage = match self.storage {
            RecordingBufferStorage::Memory => "ram",
            RecordingBufferStorage::Disk => "disk",
        };
        let mut args: Vec<OsString> = [
            "-w",
            &self.monitor,
            "-c",
            "mp4",
            "-f",
            &self.fps.to_string(),
            "-fm",
            "cfr",
            "-k",
            codec,
            "-encoder",
            if self.cpu { "cpu" } else { "gpu" },
            "-bm",
            "cbr",
            "-q",
            &self.bitrate_kbps.to_string(),
            "-keyint",
            &KEYFRAME_INTERVAL_SECONDS.to_string(),
            "-r",
            &self.replay_seconds.to_string(),
            "-replay-storage",
            storage,
            "-cursor",
            "yes",
            "-v",
            "no",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        if let Some(output) = self.output {
            args.push("-s".into());
            args.push(format!("{}x{}", output.width, output.height).into());
        }
        if let Some(audio) = &self.audio {
            args.extend(
                [
                    "-a",
                    audio,
                    "-ac",
                    "aac",
                    "-ab",
                    &AUDIO_BITRATE_KBPS.to_string(),
                ]
                .map(OsString::from),
            );
        }
        args.extend(["-ipc".into(), socket.into(), "-o".into(), directory.into()]);
        args
    }
}

#[derive(Deserialize)]
struct IpcReply {
    result: String,
    #[serde(default)]
    data: Value,
}

/// A running replay buffer, controlled through gpu-screen-recorder's IPC
/// socket.
pub(super) struct ReplayProcess {
    child: Child,
    socket: PathBuf,
    next_request: u64,
    last_log_line: Arc<Mutex<String>>,
}

impl ReplayProcess {
    /// Returns once the IPC socket accepts requests.
    pub(super) fn start(
        config: &ReplayConfig,
        directory: &Path,
        socket: &Path,
    ) -> Result<Self, String> {
        let _ = fs::remove_file(socket);
        let mut child = command()
            .args(config.args(directory, socket))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(start_error)?;
        let last_log_line = forward_log(child.stderr.take());
        let mut process = Self {
            child,
            socket: socket.to_path_buf(),
            next_request: 1,
            last_log_line,
        };
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            if let Some(error) = process.exited() {
                return Err(error);
            }
            if UnixStream::connect(socket).is_ok() {
                return Ok(process);
            }
            if Instant::now() >= deadline {
                return Err("gpu-screen-recorder did not start in time.".to_string());
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    /// Describes why the process ended, or `None` while it runs.
    pub(super) fn exited(&mut self) -> Option<String> {
        let status = match self.child.try_wait() {
            Ok(Some(status)) => status.to_string(),
            Ok(None) => return None,
            Err(error) => error.to_string(),
        };
        let line = self
            .last_log_line
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        Some(if line.is_empty() {
            format!("gpu-screen-recorder stopped ({status}).")
        } else {
            format!("gpu-screen-recorder stopped ({status}): {line}")
        })
    }

    /// Saves the last `seconds` of the buffer and returns the file, which
    /// gpu-screen-recorder writes into the session's directory.
    pub(super) fn save(&mut self, seconds: u32) -> Result<PathBuf, String> {
        let data = self.request("save-replay", json!({ "seconds": seconds }), SAVE_TIMEOUT)?;
        data.as_str()
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "gpu-screen-recorder saved the replay without a path.".to_string())
    }

    fn request(&mut self, name: &str, data: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_request;
        self.next_request += 1;
        let ipc_error =
            |error: io::Error| format!("gpu-screen-recorder IPC {name} failed: {error}");
        let mut stream = UnixStream::connect(&self.socket).map_err(ipc_error)?;
        stream.set_read_timeout(Some(timeout)).map_err(ipc_error)?;
        stream
            .set_write_timeout(Some(STOP_TIMEOUT))
            .map_err(ipc_error)?;
        writeln!(
            stream,
            "{}",
            json!({ "id": id, "name": name, "data": data })
        )
        .map_err(ipc_error)?;
        let mut line = String::new();
        BufReader::new(stream)
            .read_line(&mut line)
            .map_err(ipc_error)?;
        let reply: IpcReply = serde_json::from_str(&line).map_err(|error| {
            format!("gpu-screen-recorder IPC {name} reply was invalid: {error}")
        })?;
        if reply.result == "ok" {
            Ok(reply.data)
        } else {
            Err(reply
                .data
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| format!("gpu-screen-recorder could not {name}.")))
        }
    }

    /// Ends the buffer without saving it.
    pub(super) fn stop(&mut self) {
        if self.exited().is_none() {
            // In replay mode, `stop` discards the buffer.
            let _ = self.request("stop", Value::Null, STOP_TIMEOUT);
            if !wait_for_exit(&mut self.child, STOP_TIMEOUT) {
                let _ = self.child.kill();
                let _ = self.child.wait();
            }
        }
        let _ = fs::remove_file(&self.socket);
    }
}

impl Drop for ReplayProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Forwards gpu-screen-recorder's log to the agent's stderr, which the host
/// writes to its log file, and keeps the last line for error messages.
fn forward_log(stderr: Option<ChildStderr>) -> Arc<Mutex<String>> {
    let last_line = Arc::new(Mutex::new(String::new()));
    let Some(stderr) = stderr else {
        return last_line;
    };
    let shared = Arc::clone(&last_line);
    let _ = thread::Builder::new()
        .name("alloy-gsr-log".to_string())
        .spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                eprintln!("[{SIDE_CAR_NAME}] gpu-screen-recorder: {line}");
                *shared
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = line.to_string();
            }
        });
    last_line
}

fn wait_for_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !matches!(child.try_wait(), Ok(None)) {
            return true;
        }
        thread::sleep(Duration::from_millis(25));
    }
    false
}

/// Writes a PNG of `monitor` to `path`, which must end in `.png`.
pub(super) fn screenshot(monitor: &str, path: &Path) -> Result<(), String> {
    let mut child = command()
        .args(["-w", monitor, "-cursor", "yes", "-o"])
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(start_error)?;
    let last_log_line = forward_log(child.stderr.take());
    if !wait_for_exit(&mut child, SCREENSHOT_TIMEOUT) {
        let _ = child.kill();
        let _ = child.wait();
        return Err("gpu-screen-recorder did not take the screenshot in time.".to_string());
    }
    match child.wait() {
        Ok(status) if status.success() && path.is_file() => Ok(()),
        Ok(status) => {
            let line = last_log_line
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            Err(format!("Could not take the screenshot ({status}): {line}"))
        }
        Err(error) => Err(format!("Could not take the screenshot: {error}")),
    }
}
