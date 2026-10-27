//! Game identification shared by every platform: the user's allowed and
//! denied games, the Discord detectable-games catalog, the built-in non-game
//! list, and the names shown for detected processes.

use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

use serde::Deserialize;

#[cfg(windows)]
use crate::agent::platform::application_display_name;
use crate::{
    protocol::SIDE_CAR_NAME,
    types::{
        RecordingAllowedGame, RecordingGameGuessMatchKind, RecordingGameGuessSource,
        RecordingSettings, VideoDimensions,
    },
};

const PLAYS_NON_GAME_DETECTIONS_JSON: &str = include_str!("../detections/nonGameDetections.json");

const MANUAL_ALLOW_SCORE: i32 = 120;
const DISCORD_DETECTIONS_PATH_ENV: &str = "ALLOY_DISCORD_DETECTIONS_PATH";
const DISCORD_DETECTION_CACHE_CHECK_INTERVAL: Duration = Duration::from_secs(5);

const GAME_CLASS_ALLOW_TERMS: &[&str] = &[
    "steam_app_",
    "unitywndclass",
    "unrealwindow",
    "riotwindowclass",
];
const GAME_CLASS_DENY_TERMS: &[&str] = &[
    "plasmashell",
    "splashscreen",
    "splashwindow",
    "launcher",
    "cheat",
    "console",
    "amddvroverlaywindowclass",
    "splashclass",
];

#[derive(Clone, Debug)]
pub(in crate::agent) struct CandidateGameMatch {
    pub(in crate::agent) id: Option<String>,
    pub(in crate::agent) source: RecordingGameGuessSource,
    pub(in crate::agent) source_id: Option<String>,
    pub(in crate::agent) name: String,
    pub(in crate::agent) aliases: Vec<String>,
    pub(in crate::agent) icon_url: Option<String>,
    preserve_name: bool,
    pub(in crate::agent) detection_score: i32,
    pub(in crate::agent) confidence: u8,
    pub(in crate::agent) match_kind: RecordingGameGuessMatchKind,
}

#[derive(Clone, Copy)]
pub(in crate::agent) struct ProcessDisplayName<'a> {
    /// Windows reads the product name from the executable's version info.
    #[cfg_attr(not(windows), expect(dead_code))]
    pub(in crate::agent) path: Option<&'a str>,
    pub(in crate::agent) preferred: Option<&'a str>,
    pub(in crate::agent) title: Option<&'a str>,
    pub(in crate::agent) executable: Option<&'a str>,
    pub(in crate::agent) fallback: Option<&'a str>,
    pub(in crate::agent) preserve_preferred: bool,
}

#[derive(Default)]
struct RuntimeDiscordDetectionState {
    path: Option<PathBuf>,
    modified: Option<SystemTime>,
    last_checked: Option<Instant>,
    catalog: DiscordDetectionCatalog,
}

#[derive(Default)]
struct DiscordDetectionCatalog {
    games_by_id: HashMap<String, DiscordDetectionGame>,
    rules_by_executable: HashMap<String, Vec<DiscordExecutableRule>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordDetectionBundle {
    games: Vec<DiscordDetectionGame>,
    executables: HashMap<String, Vec<DiscordExecutableRule>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordDetectionGame {
    id: String,
    name: String,
    #[serde(default)]
    aliases: Vec<String>,
    icon_hash: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordExecutableRule {
    game_id: String,
    #[serde(default)]
    is_launcher: bool,
    score: i32,
}

#[derive(Deserialize)]
struct PlaysNonGameEntry {
    #[serde(default)]
    detections: Vec<PlaysNonGameRule>,
}

#[derive(Deserialize)]
struct PlaysNonGameRule {
    detect_exe: Option<String>,
}

static NON_GAME_EXECUTABLES: OnceLock<HashSet<String>> = OnceLock::new();
static DISCORD_DETECTION_STATE: OnceLock<Mutex<RuntimeDiscordDetectionState>> = OnceLock::new();

pub(in crate::agent) fn candidate_game_detection_match(
    path: Option<&str>,
    executable: Option<&str>,
    title: Option<&str>,
    class_name: Option<&str>,
    capture_dimensions: Option<VideoDimensions>,
    settings: &RecordingSettings,
) -> Option<CandidateGameMatch> {
    if manual_game_denied(settings, path, executable, class_name) {
        return None;
    }

    if let Some((game, match_score)) =
        manual_allowed_game_match(settings, path, executable, class_name)
    {
        return Some(CandidateGameMatch {
            id: Some(game.id.clone()),
            source: RecordingGameGuessSource::Manual,
            source_id: Some(game.id.clone()),
            name: manual_game_name(game, path, title, executable),
            aliases: Vec::new(),
            icon_url: game.icon_url.clone(),
            preserve_name: true,
            detection_score: MANUAL_ALLOW_SCORE + match_score,
            confidence: 100,
            match_kind: RecordingGameGuessMatchKind::Manual,
        });
    }

    if is_builtin_non_game(executable) || has_blocked_identity(title, executable, class_name) {
        return None;
    }

    discord_game_match(executable)
        .filter(|_| known_game_window_is_plausible(capture_dimensions, class_name))
}

fn manual_game_name(
    game: &RecordingAllowedGame,
    path: Option<&str>,
    title: Option<&str>,
    executable: Option<&str>,
) -> String {
    Some(game.name.as_str())
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            user_facing_process_name(ProcessDisplayName {
                path,
                preferred: title,
                title,
                executable,
                fallback: Some("Game"),
                preserve_preferred: false,
            })
        })
        .unwrap_or_else(|| "Game".to_string())
}

fn discord_game_match(executable: Option<&str>) -> Option<CandidateGameMatch> {
    let executable_key = executable.map(|value| value.to_ascii_lowercase())?;
    let mut state = discord_detection_state()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.refresh_if_needed();
    let rule = state
        .catalog
        .rules_by_executable
        .get(&executable_key)?
        .iter()
        .max_by_key(|rule| rule.score)?;
    let game = state.catalog.games_by_id.get(&rule.game_id)?;

    Some(CandidateGameMatch {
        id: Some(game.id.clone()),
        source: RecordingGameGuessSource::DiscordDetectable,
        source_id: Some(game.id.clone()),
        name: game.name.clone(),
        aliases: game.aliases.clone(),
        icon_url: discord_icon_url(game),
        preserve_name: true,
        detection_score: rule.score,
        confidence: if rule.is_launcher { 82 } else { 96 },
        match_kind: RecordingGameGuessMatchKind::Executable,
    })
}

fn discord_icon_url(game: &DiscordDetectionGame) -> Option<String> {
    let hash = game.icon_hash.as_deref()?.trim();
    (!hash.is_empty()).then(|| {
        format!(
            "https://cdn.discordapp.com/app-icons/{}/{}.png",
            game.id, hash
        )
    })
}

fn is_builtin_non_game(executable: Option<&str>) -> bool {
    executable
        .is_some_and(|executable| non_game_executables().contains(&executable.to_ascii_lowercase()))
}

fn known_game_window_is_plausible(
    capture_dimensions: Option<VideoDimensions>,
    class_name: Option<&str>,
) -> bool {
    let Some(dimensions) = capture_dimensions else {
        return true;
    };
    dimensions.width > 69
        && dimensions.height > 69
        && (has_valid_game_dimensions(dimensions) || class_is_game_like(class_name))
}

fn has_valid_game_dimensions(dimensions: VideoDimensions) -> bool {
    if dimensions.width <= 69 || dimensions.height <= 69 {
        return false;
    }
    let divisor = gcd(dimensions.width, dimensions.height);
    let ratio = (dimensions.width / divisor, dimensions.height / divisor);
    matches!(
        ratio,
        (64, 27) | (43, 18) | (21, 9) | (16, 10) | (16, 9) | (4, 3) | (32, 9)
    )
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

fn class_is_game_like(class_name: Option<&str>) -> bool {
    class_name.is_some_and(|class_name| contains_any_folded(class_name, GAME_CLASS_ALLOW_TERMS))
}

fn has_blocked_identity(
    title: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> bool {
    [title, executable, class_name]
        .into_iter()
        .flatten()
        .any(|value| contains_any_folded(value, GAME_CLASS_DENY_TERMS))
}

fn contains_any_folded(value: &str, terms: &[&str]) -> bool {
    let lower = value.to_ascii_lowercase();
    let compact = lower.replace(' ', "");
    terms
        .iter()
        .any(|term| lower.contains(term) || compact.contains(term))
}

pub(in crate::agent) fn readable_detected_game_name(
    candidate: &CandidateGameMatch,
    path: Option<&str>,
    title: Option<&str>,
    executable: Option<&str>,
) -> String {
    // Authoritative detector names identify the game. Executable metadata
    // identifies the capture target and may contain implementation labels such
    // as "League of Legends (TM) Client" instead of the catalogue name.
    user_facing_process_name(ProcessDisplayName {
        path,
        preferred: Some(&candidate.name),
        title,
        executable,
        fallback: Some(&candidate.name),
        preserve_preferred: candidate.preserve_name,
    })
    .unwrap_or_else(|| candidate.name.clone())
}

pub(in crate::agent) fn user_facing_process_name(input: ProcessDisplayName<'_>) -> Option<String> {
    if input.preserve_preferred {
        return input.preferred.and_then(clean_user_facing_process_name);
    }

    #[cfg(windows)]
    if let Some(name) = input.path.and_then(application_display_name) {
        return Some(name);
    }

    if let Some(preferred) = input.preferred.and_then(clean_user_facing_process_name) {
        if !compact_process_name_needs_spacing(&preferred) {
            return Some(preferred);
        }
    }

    input
        .preferred
        .and_then(humanize_compact_process_name)
        .or_else(|| input.title.and_then(humanize_compact_process_name))
        .or_else(|| input.executable.and_then(humanize_compact_process_name))
        .or_else(|| input.fallback.and_then(humanize_compact_process_name))
}

pub(in crate::agent) fn clean_user_facing_process_name(value: &str) -> Option<String> {
    let name = value.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn compact_process_name_needs_spacing(value: &str) -> bool {
    clean_user_facing_process_name(value)
        .as_deref()
        .is_some_and(compact_process_name_token_needs_spacing)
}

fn compact_process_name_token_needs_spacing(value: &str) -> bool {
    let mut previous = None;
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if matches!(ch, '.' | '_' | '\\' | '/') {
            return true;
        }

        if let Some(previous) = previous {
            if compact_name_boundary(previous, ch, chars.peek().copied()) {
                return true;
            }
        }
        previous = Some(ch);
    }

    false
}

fn humanize_compact_process_name(value: &str) -> Option<String> {
    let stem = value
        .strip_suffix(".exe")
        .or_else(|| value.strip_suffix(".EXE"))
        .unwrap_or(value)
        .trim();
    if stem.is_empty() {
        return None;
    }

    let compact = stem.replace(['\\', '/', '_', '.'], " ");
    let name = compact
        .split_whitespace()
        .map(humanize_compact_word)
        .collect::<Vec<_>>()
        .join(" ");
    clean_user_facing_process_name(&name)
}

fn humanize_compact_word(value: &str) -> String {
    let mut result = String::new();
    let mut previous = None;
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(previous) = previous {
            if compact_name_boundary(previous, ch, chars.peek().copied()) {
                result.push(' ');
            }
        }
        result.push(ch);
        previous = Some(ch);
    }

    result
}

fn compact_name_boundary(previous: char, current: char, next: Option<char>) -> bool {
    if current.is_ascii_digit() && previous.is_ascii_alphabetic() {
        return true;
    }
    if current.is_ascii_alphabetic() && previous.is_ascii_digit() {
        return true;
    }
    if current.is_ascii_uppercase() && previous.is_ascii_lowercase() {
        return true;
    }
    current.is_ascii_uppercase()
        && previous.is_ascii_uppercase()
        && next.is_some_and(|next| next.is_ascii_lowercase())
}

fn non_game_executables() -> &'static HashSet<String> {
    NON_GAME_EXECUTABLES.get_or_init(load_non_game_executables)
}

fn discord_detection_state() -> &'static Mutex<RuntimeDiscordDetectionState> {
    DISCORD_DETECTION_STATE.get_or_init(|| Mutex::new(RuntimeDiscordDetectionState::default()))
}

impl RuntimeDiscordDetectionState {
    fn refresh_if_needed(&mut self) {
        let now = Instant::now();
        if self
            .last_checked
            .is_some_and(|last| now.duration_since(last) < DISCORD_DETECTION_CACHE_CHECK_INTERVAL)
        {
            return;
        }
        self.last_checked = Some(now);

        let Some(path) = env::var_os(DISCORD_DETECTIONS_PATH_ENV).map(PathBuf::from) else {
            return;
        };

        if self.path.as_ref() != Some(&path) {
            self.path = Some(path.clone());
            self.modified = None;
        }

        let Ok(metadata) = fs::metadata(&path) else {
            return;
        };
        let modified = metadata.modified().ok();
        if self.modified.is_some() && self.modified == modified {
            return;
        }

        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!(
                    "[{SIDE_CAR_NAME}] failed to read Discord detection catalog {}: {error}",
                    path.display()
                );
                return;
            }
        };
        let catalog = match parse_discord_detection_catalog(&contents) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!(
                    "[{SIDE_CAR_NAME}] failed to parse Discord detection catalog {}: {error}",
                    path.display()
                );
                return;
            }
        };

        self.catalog = catalog;
        self.modified = modified;
    }
}

fn parse_discord_detection_catalog(
    contents: &str,
) -> Result<DiscordDetectionCatalog, serde_json::Error> {
    let bundle = serde_json::from_str::<DiscordDetectionBundle>(contents)?;
    let games_by_id = bundle
        .games
        .into_iter()
        .map(|game| (game.id.clone(), game))
        .collect::<HashMap<_, _>>();
    let mut rules_by_executable = HashMap::new();

    for (executable, rules) in bundle.executables {
        let key = executable.trim().to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }
        let rules = rules
            .into_iter()
            .filter(|rule| games_by_id.contains_key(&rule.game_id))
            .collect::<Vec<_>>();
        if !rules.is_empty() {
            rules_by_executable.insert(key, rules);
        }
    }

    Ok(DiscordDetectionCatalog {
        games_by_id,
        rules_by_executable,
    })
}

fn load_non_game_executables() -> HashSet<String> {
    let entries =
        match serde_json::from_str::<Vec<PlaysNonGameEntry>>(PLAYS_NON_GAME_DETECTIONS_JSON) {
            Ok(entries) => entries,
            Err(error) => {
                eprintln!(
                    "[{SIDE_CAR_NAME}] failed to parse embedded non-game detections: {error}"
                );
                return HashSet::new();
            }
        };

    let mut catalog = HashSet::new();
    for entry in entries {
        for detection in entry.detections {
            let Some(patterns) = detection.detect_exe else {
                continue;
            };
            for pattern in patterns.split('|').map(str::trim).filter(|p| !p.is_empty()) {
                if let Some(executable) = path_file_name(pattern) {
                    catalog.insert(executable.to_ascii_lowercase());
                }
            }
        }
    }
    catalog
}

pub(in crate::agent) fn path_file_name(path: &str) -> Option<String> {
    path.rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
}

/// Windows paths, including the ones Wine runs Proton games from, ignore
/// case; native Linux paths don't.
pub(in crate::agent) fn paths_equal(left: &str, right: &str) -> bool {
    let (left, right) = (normalized_path(left), normalized_path(right));
    let (left, right) = (left.trim_end_matches('/'), right.trim_end_matches('/'));
    if cfg!(windows) || windows_path(left) || windows_path(right) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

/// A normalized path with a drive letter, such as `C:/Games/game.exe`.
fn windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub(in crate::agent) fn normalized_path(path: &str) -> String {
    path.replace('\\', "/")
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
