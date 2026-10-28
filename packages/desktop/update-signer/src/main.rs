//! Signs a desktop installer with the update key and writes
//! `<installer>.sig`, base64 of a minisign signature file, which the app
//! checks before it installs an update.
//!
//! Usage: `alloy-update-signer <installer> <version>`. The key comes from
//! `ALLOY_UPDATE_SIGNING_KEY` (base64 of a password-protected minisign secret
//! key file) and its password from `ALLOY_UPDATE_SIGNING_KEY_PASSWORD`. The
//! signature must verify against one of the keys in
//! `ALLOY_UPDATER_PUBLIC_KEY`, the base64 public key files, separated by
//! whitespace or commas, that the release compiles into the app.

use std::env;
use std::fs::{self, File};
use std::io::BufReader;
use std::path::Path;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign::{PublicKey, PublicKeyBox, SecretKey, SecretKeyBox};

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

/// The listed public key of `secret_key`'s pair. Every listed key must
/// decode, as the app rejects a list with one that does not.
fn trusted_public_key(secret_key: &SecretKey) -> Result<PublicKey, String> {
    let list = required_env("ALLOY_UPDATER_PUBLIC_KEY")?;
    let own = PublicKey::from_secret_key(secret_key)
        .map_err(|error| format!("The update signing key is invalid: {error}"))?
        .to_bytes();
    let mut matching = None;
    for (index, key) in list
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|key| !key.is_empty())
        .enumerate()
    {
        let name = format!("Key {} in ALLOY_UPDATER_PUBLIC_KEY", index + 1);
        let key = PublicKeyBox::from_string(&decode_text(&name, key)?)
            .and_then(PublicKeyBox::into_public_key)
            .map_err(|error| format!("{name} is invalid: {error}"))?;
        if key.to_bytes() == own {
            matching = Some(key);
        }
    }
    matching.ok_or_else(|| {
        "The update signing key matches none of the keys in ALLOY_UPDATER_PUBLIC_KEY.".to_owned()
    })
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
    let public_key = trusted_public_key(&secret_key)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("The system clock is before 1970: {error}"))?
        .as_secs();
    let trusted_comment = format!("timestamp:{timestamp}\tfile:{file_name}\tversion:{version}");
    let data = File::open(installer)
        .map(BufReader::new)
        .map_err(|error| format!("Could not open {}: {error}", installer.display()))?;
    // Passing the listed public key makes `sign` check the key pair against
    // it, so a signing key the app does not trust fails here instead of
    // after the release.
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
