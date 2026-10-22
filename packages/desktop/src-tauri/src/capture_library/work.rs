//! The one place the capture library runs ffmpeg and ffprobe.
//!
//! Library jobs (probing, finalizing recordings, exports, posters) are plain
//! async functions; every tool process they start goes through [`MediaWork`],
//! which
//! - bounds concurrency per [`Lane`], so a long encode never holds up the
//!   quick probes and frame grabs that thumbnails depend on,
//! - cancels all tools when the library shuts down and lets shutdown wait
//!   until every child process is gone, and
//! - collapses concurrent requests for the same job into one run through
//!   [`MediaWork::exclusive`].

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::{Notify, OwnedMutexGuard, Semaphore};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use crate::capture_library::error::{LibraryError, Result};

/// Windows process creation flag that suppresses a console window for the child.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_TOOL_OUTPUT: usize = 2 * 1024 * 1024;
/// Encodes and stream copies over whole recordings.
const HEAVY_SLOTS: usize = 2;
/// Probes and single-frame grabs.
const LIGHT_SLOTS: usize = 2;

/// How expensive a tool run is. Each lane has its own process limit.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Lane {
    /// Reads or writes a whole recording: finalizing, exporting.
    Heavy,
    /// Reads a few frames or the container header: probes, posters.
    Light,
}

pub(crate) struct ToolOutput {
    pub stdout: Vec<u8>,
}

pub(crate) struct MediaWork {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    heavy: Semaphore,
    light: Semaphore,
    cancel: CancellationToken,
    active: AtomicUsize,
    idle: Notify,
    jobs: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl MediaWork {
    pub(crate) fn new(ffmpeg: PathBuf, ffprobe: PathBuf) -> Self {
        Self {
            ffmpeg,
            ffprobe,
            heavy: Semaphore::new(HEAVY_SLOTS),
            light: Semaphore::new(LIGHT_SLOTS),
            cancel: CancellationToken::new(),
            active: AtomicUsize::new(0),
            idle: Notify::new(),
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn ffmpeg(
        &self,
        lane: Lane,
        args: &[&str],
        limit: Duration,
    ) -> Result<ToolOutput> {
        self.run(&self.ffmpeg, lane, args, limit).await
    }

    pub(crate) async fn ffprobe(&self, args: &[&str], limit: Duration) -> Result<ToolOutput> {
        self.run(&self.ffprobe, Lane::Light, args, limit).await
    }

    /// Waits until no other caller holds `key`. Jobs whose output is a file
    /// take this before checking for that output, so a second request for a
    /// job in flight waits for it and then finds its result instead of
    /// starting the same tools again.
    pub(crate) async fn exclusive(&self, key: String) -> JobSlot {
        let lock = {
            let mut jobs = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
            Arc::clone(jobs.entry(key.clone()).or_default())
        };
        JobSlot {
            jobs: Arc::clone(&self.jobs),
            key,
            guard: Some(lock.lock_owned().await),
        }
    }

    /// Cancels every running and future tool. The work is not reusable after
    /// this; the shell opens a new library when it needs one.
    pub(crate) fn cancel(&self) {
        self.cancel.cancel();
    }

    /// Cancels tools and waits until every child process has been released.
    pub(crate) async fn shutdown(&self) {
        self.cancel();
        loop {
            if self.active.load(Ordering::Acquire) == 0 {
                return;
            }
            let notified = self.idle.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.active.load(Ordering::Acquire) == 0 {
                return;
            }
            notified.await;
        }
    }

    async fn run(
        &self,
        tool: &Path,
        lane: Lane,
        args: &[&str],
        limit: Duration,
    ) -> Result<ToolOutput> {
        // Count waiting runs too: shutdown must not return while one of them
        // could still win a permit and start a process.
        let _activity = Activity::begin(self);
        let slots = match lane {
            Lane::Heavy => &self.heavy,
            Lane::Light => &self.light,
        };
        let _permit = tokio::select! {
            biased;
            _ = self.cancel.cancelled() => return Err(LibraryError::MediaCancelled),
            permit = slots.acquire() => permit.map_err(|_| LibraryError::MediaCancelled)?,
        };
        tokio::select! {
            biased;
            _ = self.cancel.cancelled() => Err(LibraryError::MediaCancelled),
            result = run_tool(tool, args, limit) => result,
        }
    }
}

/// Holds a job key from [`MediaWork::exclusive`] until dropped.
pub(crate) struct JobSlot {
    jobs: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    key: String,
    guard: Option<OwnedMutexGuard<()>>,
}

impl Drop for JobSlot {
    fn drop(&mut self) {
        let Some(guard) = self.guard.take() else {
            return;
        };
        let lock = Arc::clone(OwnedMutexGuard::mutex(&guard));
        drop(guard);
        let mut jobs = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
        // Only the map and `lock` remain once nobody waits for the key, so the
        // entry can go; a waiter holds its own reference and keeps it.
        if Arc::strong_count(&lock) == 2
            && jobs
                .get(&self.key)
                .is_some_and(|current| Arc::ptr_eq(current, &lock))
        {
            jobs.remove(&self.key);
        }
    }
}

struct Activity<'a> {
    work: &'a MediaWork,
}

impl<'a> Activity<'a> {
    fn begin(work: &'a MediaWork) -> Self {
        work.active.fetch_add(1, Ordering::AcqRel);
        Self { work }
    }
}

impl Drop for Activity<'_> {
    fn drop(&mut self) {
        if self.work.active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.work.idle.notify_waiters();
        }
    }
}

async fn run_tool(path: &Path, args: &[&str], limit: Duration) -> Result<ToolOutput> {
    let mut command = Command::new(path);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Media tools are console programs; without this flag a GUI-subsystem
    // parent such as the packaged desktop app gets a console window flashed
    // on screen for every ffmpeg/ffprobe run.
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| {
        LibraryError::MediaTool(format!("could not start {}: {error}", path.display()))
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| LibraryError::MediaTool("media tool stdout was not captured".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| LibraryError::MediaTool("media tool stderr was not captured".into()))?;
    let stdout_task = tokio::spawn(read_limited(stdout));
    let stderr_task = tokio::spawn(read_limited(stderr));
    let result = timeout(limit, async {
        let (status, stdout, stderr) = tokio::try_join!(
            child.wait(),
            async {
                stdout_task
                    .await
                    .map_err(|error| io::Error::other(error.to_string()))?
            },
            async {
                stderr_task
                    .await
                    .map_err(|error| io::Error::other(error.to_string()))?
            },
        )?;
        Ok::<_, io::Error>((status, stdout, stderr))
    })
    .await;
    let (status, stdout, stderr) = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            let _ = child.kill().await;
            return Err(
                if error.kind() == io::ErrorKind::Other
                    && error.to_string().contains("output limit")
                {
                    LibraryError::MediaTool("tool output is too large".into())
                } else {
                    LibraryError::MediaTool(error.to_string())
                },
            );
        }
        Err(_) => {
            let _ = child.kill().await;
            return Err(LibraryError::MediaToolTimeout);
        }
    };
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(LibraryError::MediaTool(if detail.is_empty() {
            format!("{} exited with {status}", path.display())
        } else {
            detail.chars().take(1_000).collect()
        }));
    }
    Ok(ToolOutput { stdout })
}

async fn read_limited<R>(mut reader: R) -> io::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut chunk = [0_u8; 16 * 1024];
    loop {
        let count = reader.read(&mut chunk).await?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > MAX_TOOL_OUTPUT {
            return Err(io::Error::other("tool output limit exceeded"));
        }
        output.extend_from_slice(&chunk[..count]);
    }
}
