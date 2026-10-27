//! Applications' names and icons from freedesktop desktop entries and icon
//! themes, which the settings show for audio applications and processes, as
//! Windows shows an executable's product name and icon. A process is matched
//! to its desktop entry by executable or application name, or else through
//! the systemd unit its launcher started it in.

use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use super::games::unwrapped_executable;

/// Icon sizes in the order they are looked for: twice the settings' 16 px
/// first, then larger ones, which scale down cleanly.
const ICON_SIZES: &[&str] = &[
    "32", "48", "64", "scalable", "24", "128", "256", "512", "22", "16",
];
/// Every icon crosses to the settings on each list refresh.
const MAX_ICON_BYTES: u64 = 64 * 1024;
/// Desktop entries and themes are read again after this, so apps installed
/// while Alloy runs get their icons.
const INDEX_TTL: Duration = Duration::from_secs(60);
const CACHE_LIMIT: usize = 512;
const MAX_DESKTOP_ENTRY_BYTES: u64 = 64 * 1024;
const MAX_PROCESS_DEPTH: usize = 64;
/// Interpreters and launchers, in any version. An entry whose `Exec` starts
/// one runs some other program, so processes running it aren't its app.
const LAUNCHERS: &[&str] = &[
    "bash",
    "dash",
    "electron",
    "flatpak",
    "gtk-launch",
    "java",
    "mono",
    "node",
    "perl",
    "python",
    "ruby",
    "sh",
    "wine",
    "xdg-open",
    "zsh",
];

static INDEX: Mutex<Option<Index>> = Mutex::new(None);

/// What the desktop entry of the app a process belongs to says about it.
#[derive(Clone)]
pub(super) struct DesktopApplication {
    pub(super) name: Option<String>,
    /// A data URL.
    pub(super) icon_url: Option<String>,
}

/// The app a process belongs to. `names` are the process's executable and
/// application names; the process's systemd unit is tried when they match no
/// desktop entry.
pub(super) fn desktop_application(
    process_id: Option<u32>,
    names: &[&str],
) -> Option<DesktopApplication> {
    let unit_id = process_id.and_then(unit_application_id);
    let key = format!("{}\n{}", unit_id.as_deref().unwrap_or(""), names.join("\n")).to_lowercase();
    let mut index = INDEX.lock().unwrap_or_else(PoisonError::into_inner);
    if index
        .as_ref()
        .is_none_or(|index| index.built.elapsed() > INDEX_TTL)
    {
        *index = Some(Index::build());
    }
    let index = index.as_mut()?;
    if let Some(application) = index.applications.get(&key) {
        return application.clone();
    }
    let application = index
        .entry_for(unit_id.as_deref(), names)
        .map(|entry| DesktopApplication {
            name: entry.name.clone(),
            icon_url: entry
                .icon
                .as_deref()
                .and_then(|icon| index.icon_data_url(icon)),
        });
    if index.applications.len() >= CACHE_LIMIT {
        index.applications.clear();
    }
    index.applications.insert(key, application.clone());
    application
}

/// The desktop entry id of the systemd unit a launcher started the process's
/// program in. Everything that program starts shares its unit, so the unit
/// names the process's app only when the process and each of its ancestors in
/// the unit run under one name. A game Steam started, or a program run from a
/// terminal, is not its unit's app.
fn unit_application_id(process_id: u32) -> Option<String> {
    let id = unit_id(process_id)?;
    let name = process_name(process_id)?;
    let mut pid = process_id;
    for _ in 0..MAX_PROCESS_DEPTH {
        let parent = parent_process_id(pid)?;
        if parent <= 1 || unit_id(parent).as_deref() != Some(id.as_str()) {
            return Some(id);
        }
        if process_name(parent)? != name {
            return None;
        }
        pid = parent;
    }
    None
}

fn process_name(process_id: u32) -> Option<String> {
    fs::read_to_string(format!("/proc/{process_id}/comm"))
        .ok()
        .map(|name| name.trim_end_matches('\n').to_string())
}

fn parent_process_id(process_id: u32) -> Option<u32> {
    let stat = fs::read_to_string(format!("/proc/{process_id}/stat")).ok()?;
    // Field 4. The command name before it is parenthesized and may contain
    // spaces, so count from the closing parenthesis, which ends field 2.
    stat.rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

/// The desktop entry id in the name of a process's systemd unit:
/// `app[-<launcher>]-<id>[@<random>].service` or
/// `app[-<launcher>]-<id>-<random>.scope`, with the id's dashes escaped.
fn unit_id(process_id: u32) -> Option<String> {
    let cgroup = fs::read_to_string(format!("/proc/{process_id}/cgroup")).ok()?;
    let unit = cgroup
        .lines()
        .find_map(|line| line.strip_prefix("0::"))?
        .rsplit('/')
        .next()?;
    let name = unit.strip_prefix("app-")?;
    let name = match name.strip_suffix(".service") {
        Some(service) => service.split('@').next()?,
        None => name.strip_suffix(".scope")?.rsplit_once('-')?.0,
    };
    let id = name.rsplit('-').next()?.replace("\\x2d", "-");
    (!id.is_empty()).then_some(id)
}

struct DesktopEntry {
    /// The file's path below `applications/`, `/` as `-`, without `.desktop`.
    id: String,
    name: Option<String>,
    program: Option<String>,
    wm_class: Option<String>,
    icon: Option<String>,
    /// Kept out of menus, as a URL handler's entry is.
    no_display: bool,
}

struct Index {
    built: Instant,
    data_dirs: Vec<PathBuf>,
    entries: Vec<DesktopEntry>,
    themes: Vec<String>,
    applications: HashMap<String, Option<DesktopApplication>>,
}

impl Index {
    fn build() -> Self {
        let data_dirs = data_dirs();
        let entries = desktop_entries(&data_dirs);
        let themes = icon_themes(&icon_bases(&data_dirs));
        Self {
            built: Instant::now(),
            data_dirs,
            entries,
            themes,
            applications: HashMap::new(),
        }
    }

    /// The first entry whose id, window class, program or name equals one of
    /// `names`, in the order those name an app surely, else the unit's entry.
    /// Names come first because a program can run in a unit named after the
    /// one it was forked from, as Chromium's forks do.
    fn entry_for(&self, unit_id: Option<&str>, names: &[&str]) -> Option<&DesktopEntry> {
        let matches = |field: Option<&str>| {
            field.is_some_and(|field| {
                names
                    .iter()
                    .any(|name| !name.is_empty() && field.eq_ignore_ascii_case(name))
            })
        };
        let fields: [fn(&DesktopEntry) -> Option<&str>; 4] = [
            |entry| Some(&entry.id),
            |entry| entry.wm_class.as_deref(),
            |entry| entry.program.as_deref(),
            |entry| entry.name.as_deref(),
        ];
        fields
            .iter()
            .find_map(|field| self.entries.iter().find(|entry| matches(field(entry))))
            .or_else(|| {
                let id = unit_id?;
                self.entries
                    .iter()
                    .find(|entry| entry.id.eq_ignore_ascii_case(id))
            })
    }

    fn icon_data_url(&self, icon: &str) -> Option<String> {
        let path = Path::new(icon);
        if path.is_absolute() {
            return usable_icon(path).and_then(|path| data_url(&path));
        }
        // An icon name with a path or an extension is not a theme name, but
        // some entries add the extension anyway.
        let name = icon
            .strip_suffix(".png")
            .or_else(|| icon.strip_suffix(".svg"))
            .unwrap_or(icon);
        if name.is_empty() || name.contains('/') {
            return None;
        }
        let bases = icon_bases(&self.data_dirs);
        let themed = self.themes.iter().find_map(|theme| {
            bases.iter().find_map(|base| {
                let theme = base.join(theme);
                if !theme.is_dir() {
                    return None;
                }
                ICON_SIZES.iter().find_map(|size| {
                    // hicolor and Papirus use `48x48/apps`, Breeze `apps/48`.
                    let sized = if *size == "scalable" {
                        size.to_string()
                    } else {
                        format!("{size}x{size}")
                    };
                    [
                        theme.join(sized).join("apps"),
                        theme.join("apps").join(size),
                    ]
                    .iter()
                    .find_map(|directory| icon_in(directory, name))
                })
            })
        });
        themed
            .or_else(|| {
                self.data_dirs
                    .iter()
                    .find_map(|directory| icon_in(&directory.join("pixmaps"), name))
            })
            .and_then(|path| data_url(&path))
    }
}

fn icon_in(directory: &Path, name: &str) -> Option<PathBuf> {
    ["svg", "png"]
        .iter()
        .find_map(|extension| usable_icon(&directory.join(format!("{name}.{extension}"))))
}

/// A PNG or SVG small enough to send, which an image element can show.
fn usable_icon(path: &Path) -> Option<PathBuf> {
    let extension = path.extension()?.to_str()?;
    let small = fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() <= MAX_ICON_BYTES);
    (matches!(extension, "png" | "svg") && small).then(|| path.to_path_buf())
}

fn data_url(path: &Path) -> Option<String> {
    let mime = match path.extension()?.to_str()? {
        "png" => "image/png",
        "svg" => "image/svg+xml",
        _ => return None,
    };
    let bytes = fs::read(path).ok()?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// `XDG_DATA_HOME`, then `XDG_DATA_DIRS`, each once.
fn data_dirs() -> Vec<PathBuf> {
    let data_home = env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home().map(|home| home.join(".local/share")));
    let data_dirs = env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
    let mut seen = HashSet::new();
    data_home
        .into_iter()
        .chain(
            data_dirs
                .split(':')
                .filter(|dir| !dir.is_empty())
                .map(PathBuf::from),
        )
        .filter(|dir| seen.insert(dir.to_string_lossy().trim_end_matches('/').to_string()))
        .collect()
}

fn home() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Where icon themes live: `~/.icons`, then each data directory's `icons`.
fn icon_bases(data_dirs: &[PathBuf]) -> Vec<PathBuf> {
    home()
        .map(|home| home.join(".icons"))
        .into_iter()
        .chain(data_dirs.iter().map(|dir| dir.join("icons")))
        .collect()
}

/// Every application's desktop entry, those shown in menus first, as a
/// helper's entry often starts the same program. An id found in an earlier
/// data directory hides the same id in later ones. A program that several
/// menu entries start, as a browser starts its web apps or Steam its games,
/// names none of them.
fn desktop_entries(data_dirs: &[PathBuf]) -> Vec<DesktopEntry> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for dir in data_dirs {
        let mut files = Vec::new();
        collect_desktop_files(&dir.join("applications"), "", 0, &mut files);
        for (id, path) in files {
            if !seen.insert(id.clone()) {
                continue;
            }
            if let Some(entry) = desktop_entry(id, &path) {
                entries.push(entry);
            }
        }
    }
    entries.sort_by_key(|entry| entry.no_display);
    let mut menu_programs = HashMap::<String, usize>::new();
    for entry in entries.iter().filter(|entry| !entry.no_display) {
        if let Some(program) = &entry.program {
            *menu_programs
                .entry(program.to_ascii_lowercase())
                .or_default() += 1;
        }
    }
    for entry in &mut entries {
        let shared = entry.program.as_ref().is_some_and(|program| {
            menu_programs
                .get(&program.to_ascii_lowercase())
                .is_some_and(|&count| count > 1)
        });
        if shared {
            entry.program = None;
        }
    }
    entries
}

fn collect_desktop_files(
    directory: &Path,
    prefix: &str,
    depth: usize,
    files: &mut Vec<(String, PathBuf)>,
) {
    let Ok(children) = fs::read_dir(directory) else {
        return;
    };
    for child in children.flatten() {
        let path = child.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if path.is_dir() {
            if depth < 3 {
                collect_desktop_files(&path, &format!("{prefix}{name}-"), depth + 1, files);
            }
        } else if let Some(stem) = name.strip_suffix(".desktop") {
            files.push((format!("{prefix}{stem}"), path));
        }
    }
}

fn desktop_entry(id: String, path: &Path) -> Option<DesktopEntry> {
    if fs::metadata(path).ok()?.len() > MAX_DESKTOP_ENTRY_BYTES {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let value = |key| ini_value(&text, "Desktop Entry", key);
    if value("Hidden").as_deref() == Some("true")
        || value("Type").is_some_and(|kind| kind != "Application")
    {
        return None;
    }
    Some(DesktopEntry {
        id,
        name: value("Name"),
        program: value("Exec").and_then(|exec| exec_program(&exec)),
        wm_class: value("StartupWMClass"),
        icon: value("Icon"),
        no_display: value("NoDisplay").as_deref() == Some("true"),
    })
}

/// The program an `Exec` line starts, by file name, past `env` and its
/// assignments. None for an interpreter or launcher.
fn exec_program(exec: &str) -> Option<String> {
    let mut words = exec.split_whitespace().map(|word| word.trim_matches('"'));
    let mut program = words.next()?;
    if Path::new(program).file_name()? == "env" {
        program = words.find(|word| !word.contains('=') && !word.starts_with('-'))?;
    }
    let name = unwrapped_executable(Path::new(program).file_name()?.to_str()?.to_string());
    let unversioned = name.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.');
    (!LAUNCHERS.contains(&unversioned)).then_some(name)
}

/// The icon theme the desktop uses, then the themes it inherits from, depth
/// first, and `hicolor`, which every lookup ends in.
fn icon_themes(bases: &[PathBuf]) -> Vec<String> {
    fn visit(theme: String, bases: &[PathBuf], themes: &mut Vec<String>) {
        if theme == "hicolor" || themes.contains(&theme) {
            return;
        }
        let inherits = bases
            .iter()
            .find_map(|base| fs::read_to_string(base.join(&theme).join("index.theme")).ok())
            .and_then(|index| ini_value(&index, "Icon Theme", "Inherits"))
            .unwrap_or_default();
        themes.push(theme);
        for parent in inherits
            .split(',')
            .map(str::trim)
            .filter(|parent| !parent.is_empty())
        {
            visit(parent.to_string(), bases, themes);
        }
    }

    let mut themes = Vec::new();
    if let Some(theme) = configured_icon_theme() {
        visit(theme, bases, &mut themes);
    }
    themes.push("hicolor".to_string());
    themes
}

/// KDE's icon theme, else GTK's. Plasma without a choice uses Breeze.
fn configured_icon_theme() -> Option<String> {
    let config = env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home().map(|home| home.join(".config")))?;
    let read = |file: &str, group: &str, key: &str| {
        fs::read_to_string(config.join(file))
            .ok()
            .and_then(|text| ini_value(&text, group, key))
    };
    read("kdeglobals", "Icons", "Theme")
        .or_else(|| read("gtk-4.0/settings.ini", "Settings", "gtk-icon-theme-name"))
        .or_else(|| read("gtk-3.0/settings.ini", "Settings", "gtk-icon-theme-name"))
        .or_else(|| {
            env::var("XDG_CURRENT_DESKTOP")
                .is_ok_and(|desktop| desktop.split(':').any(|name| name == "KDE"))
                .then(|| "breeze".to_string())
        })
}

/// The first unlocalized `key` in `[group]` of an INI-style file.
fn ini_value(text: &str, group: &str, key: &str) -> Option<String> {
    let mut in_group = false;
    for line in text.lines().map(str::trim) {
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            in_group = name == group;
        } else if in_group {
            if let Some((name, value)) = line.split_once('=') {
                if name.trim() == key {
                    let value = value.trim();
                    return (!value.is_empty()).then(|| value.to_string());
                }
            }
        }
    }
    None
}
