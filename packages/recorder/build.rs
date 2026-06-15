use std::{
    env, fs,
    io::ErrorKind,
    path::PathBuf,
};

const DISCORD_DETECTABLE_GENERATED: &str = "src/detections/discordDetectable.generated.json";
const DISCORD_DETECTABLE_FALLBACK: &str = r#"{
  "version": 1,
  "source": "discord-detectable-applications-v9",
  "generatedAt": null,
  "games": [],
  "executables": {}
}
"#;

#[cfg(windows)]
fn main() {
    stage_discord_detectable();

    winresource::WindowsResource::new()
        .set_icon("assets/icon.ico")
        .set("FileDescription", "Alloy Recorder")
        .set("ProductName", "Alloy")
        .compile()
        .expect("failed to compile Windows resources");
}

#[cfg(not(windows))]
fn main() {
    stage_discord_detectable();
}

fn stage_discord_detectable() {
    let manifest_dir = manifest_dir();
    let source = manifest_dir.join(DISCORD_DETECTABLE_GENERATED);
    let destination = out_dir().join("discordDetectable.generated.json");

    println!("cargo:rerun-if-changed={}", source.display());

    match fs::copy(&source, &destination) {
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {
            fs::write(&destination, DISCORD_DETECTABLE_FALLBACK)
                .expect("failed to write fallback Discord detections");
        }
        Err(error) => {
            panic!(
                "failed to stage Discord detections from {} to {}: {error}",
                source.display(),
                destination.display(),
            );
        }
    }
}

fn manifest_dir() -> PathBuf {
    env_path("CARGO_MANIFEST_DIR")
}

fn out_dir() -> PathBuf {
    env_path("OUT_DIR")
}

fn env_path(name: &str) -> PathBuf {
    env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("{name} is not set"))
}
