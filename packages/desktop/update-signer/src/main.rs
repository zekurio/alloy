//! Signs a desktop installer with the update key and writes
//! `<installer>.sig`, base64 of a minisign signature file, which the app
//! checks before it installs an update.
//!
//! Usage: `alloy-update-signer <installer> <version>`. The key comes from
//! `ALLOY_UPDATE_SIGNING_KEY` (base64 of a password-protected minisign secret
//! key file) and its password from `ALLOY_UPDATE_SIGNING_KEY_PASSWORD`. The
//! signature must verify against `ALLOY_UPDATER_PUBLIC_KEY`, the key the
//! release compiles into the app.

use std::env;
use std::fs::{self, File};
use std::io::BufReader;
use std::path::Path;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign::{PublicKeyBox, SecretKey, SecretKeyBox};

fn decode_text(name: &str, value: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|error| format!("{name} is not base64: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("{name} is not text: {error}"))
}

fn required_env(name: &str) -> Result<String, String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Set {name}."))
}

fn secret_key() -> Result<SecretKey, String> {
    let key = decode_text(
        "ALLOY_UPDATE_SIGNING_KEY",
        &required_env("ALLOY_UPDATE_SIGNING_KEY")?,
    )?;
    let key = SecretKeyBox::from_string(&key)
        .map_err(|error| format!("ALLOY_UPDATE_SIGNING_KEY is invalid: {error}"))?;
    let password = required_env("ALLOY_UPDATE_SIGNING_KEY_PASSWORD")?;
    key.into_secret_key(Some(password))
        .map_err(|error| format!("Could not open the update signing key: {error}"))
}

fn sign(installer: &Path, version: &str) -> Result<(), String> {
    let file_name = installer
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} is not a file path.", installer.display()))?;
    // The trusted comment is one line of tab-separated fields.
    if file_name.contains(['\t', '\r', '\n']) || version.contains(['\t', '\r', '\n']) {
        return Err("The file name and version must not contain tabs or newlines.".into());
    }

    let secret_key = secret_key()?;
    let public_key = decode_text(
        "ALLOY_UPDATER_PUBLIC_KEY",
        &required_env("ALLOY_UPDATER_PUBLIC_KEY")?,
    )?;
    let public_key = PublicKeyBox::from_string(&public_key)
        .and_then(PublicKeyBox::into_public_key)
        .map_err(|error| format!("ALLOY_UPDATER_PUBLIC_KEY is invalid: {error}"))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("The system clock is before 1970: {error}"))?
        .as_secs();
    let trusted_comment = format!("timestamp:{timestamp}\tfile:{file_name}\tversion:{version}");
    let data = File::open(installer)
        .map(BufReader::new)
        .map_err(|error| format!("Could not open {}: {error}", installer.display()))?;
    // Passing the public key makes `sign` check the key pair, so a signing
    // key the app does not trust fails here instead of after the release.
    let signature = minisign::sign(
        Some(&public_key),
        &secret_key,
        data,
        Some(&trusted_comment),
        Some("signature from the Alloy update key"),
    )
    .map_err(|error| format!("Could not sign {}: {error}", installer.display()))?;

    let mut signature_path = installer.as_os_str().to_owned();
    signature_path.push(".sig");
    fs::write(&signature_path, STANDARD.encode(signature.to_string()))
        .map_err(|error| format!("Could not write the signature: {error}"))?;
    println!("Signed {file_name}.");
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let [installer, version] = args.as_slice() else {
        eprintln!("Usage: alloy-update-signer <installer> <version>");
        return ExitCode::FAILURE;
    };
    match sign(Path::new(installer), version) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
