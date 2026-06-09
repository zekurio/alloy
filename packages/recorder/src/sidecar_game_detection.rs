const PLAYS_GAME_DETECTIONS_JSON: &str =
    include_str!("detections/gameDetections.json");
const PLAYS_NON_GAME_DETECTIONS_JSON: &str =
    include_str!("detections/nonGameDetections.json");

const MANUAL_ALLOW_SCORE: i32 = 120;
const CURATED_GAME_SCORE: i32 = 90;
const STORE_PATH_SCORE: i32 = 75;
const HEURISTIC_GAME_SCORE: i32 = 50;

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
struct CandidateGameMatch {
    id: Option<String>,
    name: String,
    preserve_name: bool,
    force_display_capture: bool,
    detection_score: i32,
}

#[derive(Clone, Copy)]
struct ProcessDisplayName<'a> {
    path: Option<&'a str>,
    preferred: Option<&'a str>,
    title: Option<&'a str>,
    executable: Option<&'a str>,
    fallback: Option<&'a str>,
    preserve_preferred: bool,
}

#[derive(Default)]
struct AutoDetectionCatalog {
    game_rules_by_executable: HashMap<String, Vec<GameDetectionRule>>,
    fallback_game_rules: Vec<GameDetectionRule>,
    non_game_executables: HashSet<String>,
}

#[derive(Clone)]
struct GameDetectionRule {
    id: String,
    title: String,
    pattern: String,
    force_display_capture: bool,
}

#[derive(Deserialize)]
struct PlaysGameEntry {
    title: Option<String>,
    #[serde(default)]
    game_detection: Vec<PlaysGameRule>,
}

#[derive(Deserialize)]
struct PlaysGameRule {
    gameexe: Option<String>,
    #[serde(default)]
    force_display_capture: bool,
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

static AUTO_DETECTION_CATALOG: OnceLock<AutoDetectionCatalog> = OnceLock::new();
static GAME_REGEX_CACHE: OnceLock<Mutex<HashMap<String, Option<Regex>>>> = OnceLock::new();

fn candidate_game_detection_match(
    path: Option<&str>,
    executable: Option<&str>,
    title: Option<&str>,
    class_name: Option<&str>,
    capture_dimensions: Option<VideoDimensions>,
    settings: &RecordingSettings,
) -> Option<CandidateGameMatch> {
    if match_allowed_game(&settings.denied_games, path, executable, class_name).is_some() {
        return None;
    }

    if let Some(game) = match_allowed_game(&settings.allowed_games, path, executable, class_name) {
        return Some(CandidateGameMatch {
            id: Some(game.id.clone()),
            name: manual_game_name(game, path, title, executable),
            preserve_name: true,
            force_display_capture: false,
            detection_score: MANUAL_ALLOW_SCORE
                + allowed_game_match_score(game, path, executable, class_name),
        });
    }

    if is_builtin_non_game(executable) || has_blocked_identity(title, executable, class_name) {
        return None;
    }

    if let Some(match_) = curated_game_match(path, executable) {
        if known_game_window_is_plausible(capture_dimensions, class_name) {
            return Some(match_);
        }
        return None;
    }

    if let Some(name) = steam_game_name(path) {
        if known_game_window_is_plausible(capture_dimensions, class_name) {
            return Some(CandidateGameMatch {
                id: Some(format!("steam-path:{}", detection_slug(&name))),
                name,
                preserve_name: false,
                force_display_capture: false,
                detection_score: STORE_PATH_SCORE,
            });
        }
    }

    if let Some(name) = windows_store_game_name(path) {
        if known_game_window_is_plausible(capture_dimensions, class_name) {
            return Some(CandidateGameMatch {
                id: Some(format!("windows-store:{}", detection_slug(&name))),
                name,
                preserve_name: false,
                force_display_capture: false,
                detection_score: STORE_PATH_SCORE,
            });
        }
    }

    heuristic_game_match(title, executable, class_name, capture_dimensions)
}

fn detected_game_still_allowed(
    detected: &DetectedGame,
    settings: &RecordingSettings,
) -> bool {
    match_allowed_game(
        &settings.denied_games,
        detected.game.path.as_deref(),
        detected.game.executable.as_deref(),
        detected.game.window_class.as_deref(),
    )
    .is_none()
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

fn curated_game_match(path: Option<&str>, executable: Option<&str>) -> Option<CandidateGameMatch> {
    let executable_key = executable.map(|value| value.to_ascii_lowercase())?;
    let catalog = auto_detection_catalog();
    let path = path.map(normalized_path);
    let candidate = path.as_deref().or(executable)?;

    if let Some(rules) = catalog.game_rules_by_executable.get(&executable_key) {
        for rule in rules {
            if game_rule_matches(rule, candidate) {
                return Some(candidate_match_from_rule(rule));
            }
        }
    }

    for rule in &catalog.fallback_game_rules {
        if game_rule_matches(rule, candidate) {
            return Some(candidate_match_from_rule(rule));
        }
    }

    None
}

fn candidate_match_from_rule(rule: &GameDetectionRule) -> CandidateGameMatch {
    CandidateGameMatch {
        id: Some(rule.id.clone()),
        name: rule.title.clone(),
        preserve_name: false,
        force_display_capture: rule.force_display_capture,
        detection_score: CURATED_GAME_SCORE,
    }
}

fn is_builtin_non_game(executable: Option<&str>) -> bool {
    executable.is_some_and(|executable| {
        auto_detection_catalog()
            .non_game_executables
            .contains(&executable.to_ascii_lowercase())
    })
}

fn heuristic_game_match(
    title: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
    capture_dimensions: Option<VideoDimensions>,
) -> Option<CandidateGameMatch> {
    let dimensions = capture_dimensions?;
    if !class_is_game_like(class_name) || !has_valid_game_dimensions(dimensions) {
        return None;
    }

    let name = user_facing_process_name(ProcessDisplayName {
        path: None,
        preferred: title,
        title,
        executable,
        fallback: Some("Detected Game"),
        preserve_preferred: false,
    })
    .unwrap_or_else(|| "Detected Game".to_string());

    Some(CandidateGameMatch {
        id: Some(format!("heuristic:{}", detection_slug(&name))),
        name,
        preserve_name: false,
        force_display_capture: false,
        detection_score: HEURISTIC_GAME_SCORE,
    })
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

fn steam_game_name(path: Option<&str>) -> Option<String> {
    let path = normalized_path(path?);
    let (_, rest) = split_once_case_insensitive(&path, "/steamapps/common/")?;
    rest.split('/')
        .next()
        .map(clean_detection_name)
        .filter(|name| !name.is_empty())
}

fn windows_store_game_name(path: Option<&str>) -> Option<String> {
    let path = normalized_path(path?);
    let (_, rest) = split_once_case_insensitive(&path, "/windowsapps/")?;
    let package = rest.split('/').next()?;
    let name = package.split('_').next().unwrap_or(package);
    Some(clean_detection_name(name)).filter(|name| !name.is_empty())
}

fn split_once_case_insensitive<'a>(value: &'a str, needle: &str) -> Option<(&'a str, &'a str)> {
    let index = value.to_ascii_lowercase().find(&needle.to_ascii_lowercase())?;
    Some(value.split_at(index + needle.len()))
}

fn clean_detection_name(value: &str) -> String {
    value
        .replace(['\\', '/', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn readable_detected_game_name(
    candidate: &CandidateGameMatch,
    path: Option<&str>,
    title: Option<&str>,
    executable: Option<&str>,
) -> String {
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

fn user_facing_process_name(input: ProcessDisplayName<'_>) -> Option<String> {
    if input.preserve_preferred {
        return input.preferred.and_then(clean_user_facing_process_name);
    }

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

fn clean_user_facing_process_name(value: &str) -> Option<String> {
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

fn game_rule_matches(rule: &GameDetectionRule, candidate_path: &str) -> bool {
    let mut cache = GAME_REGEX_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .expect("game detection regex cache should not be poisoned");

    if !cache.contains_key(&rule.pattern) {
        let regex = RegexBuilder::new(&rule.pattern)
            .case_insensitive(true)
            .build()
            .ok();
        cache.insert(rule.pattern.clone(), regex);
    }

    cache
        .get(&rule.pattern)
        .and_then(Option::as_ref)
        .is_some_and(|regex| regex.is_match(candidate_path))
}

fn auto_detection_catalog() -> &'static AutoDetectionCatalog {
    AUTO_DETECTION_CATALOG.get_or_init(load_auto_detection_catalog)
}

fn load_auto_detection_catalog() -> AutoDetectionCatalog {
    let mut catalog = AutoDetectionCatalog::default();
    load_game_detection_rules(&mut catalog);
    load_non_game_detection_rules(&mut catalog);
    catalog
}

fn load_game_detection_rules(catalog: &mut AutoDetectionCatalog) {
    let Ok(entries) = serde_json::from_str::<Vec<PlaysGameEntry>>(PLAYS_GAME_DETECTIONS_JSON)
    else {
        return;
    };

    for entry in entries {
        let Some(title) = entry
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_string)
        else {
            continue;
        };

        for detection in entry.game_detection {
            let Some(patterns) = detection.gameexe else {
                continue;
            };
            for pattern in patterns.split('|').map(str::trim).filter(|p| !p.is_empty()) {
                let rule = GameDetectionRule {
                    id: format!("plays:{}", detection_slug(&title)),
                    title: title.clone(),
                    pattern: pattern.to_string(),
                    force_display_capture: detection.force_display_capture,
                };

                if let Some(executable) = executable_hint_from_pattern(pattern) {
                    catalog
                        .game_rules_by_executable
                        .entry(executable)
                        .or_default()
                        .push(rule);
                } else {
                    catalog.fallback_game_rules.push(rule);
                }
            }
        }
    }
}

fn load_non_game_detection_rules(catalog: &mut AutoDetectionCatalog) {
    let Ok(entries) =
        serde_json::from_str::<Vec<PlaysNonGameEntry>>(PLAYS_NON_GAME_DETECTIONS_JSON)
    else {
        return;
    };

    for entry in entries {
        for detection in entry.detections {
            let Some(patterns) = detection.detect_exe else {
                continue;
            };
            for pattern in patterns.split('|').map(str::trim).filter(|p| !p.is_empty()) {
                if let Some(executable) = path_file_name(pattern) {
                    catalog
                        .non_game_executables
                        .insert(executable.to_ascii_lowercase());
                }
            }
        }
    }
}

fn executable_hint_from_pattern(pattern: &str) -> Option<String> {
    let tail = pattern
        .trim_end_matches('$')
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|tail| !tail.is_empty())?;
    let mut output = String::new();
    let mut chars = tail.chars();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(escaped) = chars.next() {
                output.push(escaped);
            }
            continue;
        }

        if matches!(ch, '.' | '^' | '$' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|')
        {
            return None;
        }

        output.push(ch);
    }

    output
        .to_ascii_lowercase()
        .ends_with(".exe")
        .then(|| output.to_ascii_lowercase())
}

fn detection_slug(value: &str) -> String {
    let slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let slug = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "game".to_string()
    } else {
        slug
    }
}
