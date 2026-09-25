use std::process::Command;

use crate::types::{
    RecordingAllowedGame, RecordingDisplay, RecordingGame, RecordingGameGuess,
    RecordingGameProcess, RecordingSettings, VideoDimensions,
};

mod audio_levels;
pub(in crate::agent) mod com;
mod game_matching;
pub(in crate::agent) mod hotkeys;
mod windows;
mod windows_audio;

pub(in crate::agent) use windows::audio_applications;

#[derive(Clone, Debug)]
pub(in crate::agent) struct DetectedGame {
    pub(in crate::agent) game: RecordingGame,
    pub(in crate::agent) obs_window: Option<String>,
    pub(in crate::agent) window_key: String,
    pub(in crate::agent) window_handle: isize,
    pub(in crate::agent) fullscreen: bool,
    pub(in crate::agent) capture_dimensions: Option<VideoDimensions>,
    pub(in crate::agent) hdr_enabled: bool,
    pub(in crate::agent) detection_score: i32,
}

#[derive(Clone, Debug)]
pub(in crate::agent) struct GameDetection {
    pub(in crate::agent) game: DetectedGame,
    pub(in crate::agent) focused: bool,
}

pub(in crate::agent) fn detect_game_activity(
    active_game: Option<&DetectedGame>,
    settings: &RecordingSettings,
) -> Option<GameDetection> {
    windows::detect_game_activity(active_game, settings)
}

pub(in crate::agent) fn is_detected_game_alive(game: &DetectedGame) -> bool {
    windows::detected_game_alive(game)
}

pub(in crate::agent) fn refresh_capture_metadata(game: &mut DetectedGame) {
    windows_audio::refresh_capture_metadata(game);
}

pub(in crate::agent) fn application_icon_url(path: &str) -> Option<String> {
    windows_audio::application_icon_data_url(path)
}

pub(in crate::agent) fn application_display_name(path: &str) -> Option<String> {
    windows_audio::application_display_name(path)
}

pub(in crate::agent) fn subscribe_audio_level_events() {
    audio_levels::subscribe_audio_levels();
}

pub(in crate::agent) fn stop_audio_level_events() {
    audio_levels::stop_audio_levels();
}

pub(in crate::agent) fn list_game_processes() -> Vec<RecordingGameProcess> {
    windows::game_processes()
}

pub(in crate::agent) fn list_displays() -> Vec<RecordingDisplay> {
    windows::displays()
}

pub(in crate::agent) fn selected_display(settings: &RecordingSettings) -> Option<RecordingDisplay> {
    let displays = list_displays();
    if !settings.selected_display_id.trim().is_empty() {
        if let Some(display) = displays
            .iter()
            .find(|display| display.id == settings.selected_display_id)
            .cloned()
        {
            return Some(display);
        }
    }
    displays
        .iter()
        .find(|display| display.primary)
        .cloned()
        .or_else(|| displays.into_iter().next())
}

pub(in crate::agent) fn selected_display_dimensions(
    settings: &RecordingSettings,
) -> Option<VideoDimensions> {
    selected_display(settings).map(|display| VideoDimensions {
        width: display.width,
        height: display.height,
    })
}

pub(in crate::agent) fn primary_display_id() -> Option<String> {
    windows::primary_display_id()
}

pub(in crate::agent) fn detected_game_allowed(
    detected: &DetectedGame,
    settings: &RecordingSettings,
) -> bool {
    game_matching::detected_game_still_allowed(detected, settings)
}

pub(in crate::agent) fn path_file_name(path: &str) -> Option<String> {
    path.rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
}

pub(in crate::agent) fn paths_equal(left: &str, right: &str) -> bool {
    normalized_path(left)
        .trim_end_matches('/')
        .eq_ignore_ascii_case(normalized_path(right).trim_end_matches('/'))
}

pub(in crate::agent) fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let mut process = Command::new(command);
    process.args(args);
    use std::os::windows::process::CommandExt;
    process.creation_flags(0x0800_0000);
    let output = process.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

pub(in crate::agent) fn obs_window_selector(
    title: &str,
    class_name: &str,
    executable: &str,
) -> String {
    format!(
        "{}:{}:{}",
        obs_window_selector_component(title),
        obs_window_selector_component(class_name),
        obs_window_selector_component(executable)
    )
}

fn obs_window_selector_component(value: &str) -> String {
    value.replace('#', "#22").replace(':', "#3A")
}

fn normalized_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub(in crate::agent) fn valid_capture_dimensions(dimensions: VideoDimensions) -> bool {
    const MIN_VALID_CAPTURE_DIMENSION_SUM: u32 = 1120;
    dimensions.width.saturating_add(dimensions.height) >= MIN_VALID_CAPTURE_DIMENSION_SUM
}

pub(in crate::agent) fn audio_application_id_from_parts(
    executable: Option<&str>,
    class_name: Option<&str>,
    process_id: u32,
) -> String {
    if let Some(executable) = executable {
        return format!("exe:{}", executable.to_ascii_lowercase());
    }
    if let Some(class_name) = class_name {
        return format!("class:{}", class_name.to_ascii_lowercase());
    }
    format!("process:{process_id}")
}

#[allow(clippy::too_many_arguments)]
fn detected_game_from_parts(
    process_id: u32,
    path: Option<String>,
    title: Option<String>,
    class_name: Option<String>,
    window_key: String,
    window_handle: isize,
    fullscreen: bool,
    obs_window: Option<String>,
    capture_dimensions: Option<VideoDimensions>,
    hdr_enabled: bool,
    settings: &RecordingSettings,
) -> Option<DetectedGame> {
    let executable = path.as_deref().and_then(path_file_name);
    let match_ = game_matching::candidate_game_detection_match(
        path.as_deref(),
        executable.as_deref(),
        title.as_deref(),
        class_name.as_deref(),
        capture_dimensions,
        settings,
    )?;
    let name = game_matching::readable_detected_game_name(
        &match_,
        path.as_deref(),
        title.as_deref(),
        executable.as_deref(),
    );
    let icon_url = match_
        .icon_url
        .clone()
        .or_else(|| path.as_deref().and_then(application_icon_url));
    let guess = RecordingGameGuess {
        source: match_.source,
        source_id: match_.source_id,
        name: match_.name,
        aliases: match_.aliases,
        executable: executable.clone(),
        path: path.clone(),
        window_title: title.clone(),
        window_class: class_name.clone(),
        icon_url: icon_url.clone(),
        confidence: match_.confidence,
        match_kind: match_.match_kind,
    };

    Some(DetectedGame {
        game: RecordingGame {
            id: match_.id,
            name,
            process_id,
            executable,
            icon_url,
            path,
            window_title: title,
            window_class: class_name,
            started_at: Some(crate::agent::time::now_iso()),
            guess: Some(guess),
        },
        obs_window,
        window_key,
        window_handle,
        fullscreen,
        capture_dimensions,
        hdr_enabled,
        detection_score: match_.detection_score,
    })
}

fn best_allowed_game_match<'a>(
    allowed_games: &'a [RecordingAllowedGame],
    path: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> Option<(&'a RecordingAllowedGame, i32)> {
    allowed_games
        .iter()
        .filter_map(|game| {
            let score = allowed_game_match_score(game, path, executable, class_name);
            (score > 0).then_some((game, score))
        })
        .max_by_key(|(_, score)| *score)
}

fn manual_allowed_game_match<'a>(
    settings: &'a RecordingSettings,
    path: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> Option<(&'a RecordingAllowedGame, i32)> {
    let allowed = best_allowed_game_match(&settings.allowed_games, path, executable, class_name)?;
    let denied = best_allowed_game_match(&settings.denied_games, path, executable, class_name);
    denied
        .is_none_or(|(_, denied_score)| denied_score < allowed.1)
        .then_some(allowed)
}

fn manual_game_denied(
    settings: &RecordingSettings,
    path: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> bool {
    let Some((_, denied_score)) =
        best_allowed_game_match(&settings.denied_games, path, executable, class_name)
    else {
        return false;
    };
    best_allowed_game_match(&settings.allowed_games, path, executable, class_name)
        .is_none_or(|(_, allowed_score)| denied_score >= allowed_score)
}

fn allowed_game_match_score(
    game: &RecordingAllowedGame,
    path: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> i32 {
    if let Some(allowed_path) = game.path.as_deref() {
        return i32::from(path.is_some_and(|path| paths_equal(allowed_path, path))) * 100;
    }
    if game.executable.as_deref().is_some_and(|allowed| {
        executable.is_some_and(|candidate| allowed.eq_ignore_ascii_case(candidate))
    }) {
        return 80;
    }
    if game.window_class.as_deref().is_some_and(|allowed| {
        class_name.is_some_and(|candidate| allowed.eq_ignore_ascii_case(candidate))
    }) {
        return 60;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::audio_application_id_from_parts;
    use super::{allowed_game_match_score, obs_window_selector, path_file_name, paths_equal};
    use crate::types::RecordingAllowedGame;

    #[test]
    fn audio_application_ids_preserve_selector_prefixes() {
        assert_eq!(
            audio_application_id_from_parts(Some("Game.EXE"), Some("Window"), 42),
            "exe:game.exe"
        );
        assert_eq!(
            audio_application_id_from_parts(None, Some("Window"), 42),
            "class:window"
        );
        assert_eq!(
            audio_application_id_from_parts(None, None, 42),
            "process:42"
        );
    }

    fn allowed_game(
        executable: Option<&str>,
        path: Option<&str>,
        window_class: Option<&str>,
    ) -> RecordingAllowedGame {
        RecordingAllowedGame {
            id: "test".to_string(),
            name: "Test".to_string(),
            executable: executable.map(str::to_string),
            path: path.map(str::to_string),
            window_class: window_class.map(str::to_string),
            icon_url: None,
        }
    }

    #[test]
    fn manual_game_matching_prefers_path_then_executable_then_class() {
        assert_eq!(
            allowed_game_match_score(
                &allowed_game(None, Some(r"C:\Games\Test.exe"), None),
                Some("c:/games/test.exe/"),
                Some("other.exe"),
                None,
            ),
            100
        );
        assert_eq!(
            allowed_game_match_score(
                &allowed_game(Some("Test.exe"), None, Some("GameWindow")),
                None,
                Some("test.EXE"),
                Some("OtherWindow"),
            ),
            80
        );
        assert_eq!(
            allowed_game_match_score(
                &allowed_game(None, None, Some("GameWindow")),
                None,
                None,
                Some("gamewindow"),
            ),
            60
        );
    }

    #[test]
    fn path_and_obs_selectors_keep_windows_identity_stable() {
        assert!(paths_equal(r"C:\Games\Test.exe", "c:/games/test.exe/"));
        assert_eq!(
            path_file_name(r"C:\Games\Test.exe").as_deref(),
            Some("Test.exe")
        );
        assert_eq!(
            obs_window_selector("Game: One", "Class#1", "game.exe"),
            "Game#3A One:Class#221:game.exe"
        );
    }
}
