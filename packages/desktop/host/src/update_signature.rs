//! Checks a downloaded update installer against the minisign signature that
//! the release publishes for it. Public keys and signatures are base64 of the
//! minisign files; `alloy-update-signer` writes the signatures, with a trusted
//! comment that names the installer file and the release version.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use semver::Version;

/// Why a downloaded update was not accepted.
#[derive(Debug, thiserror::Error)]
pub enum UpdateSignatureError {
    /// The file could not be read; the same download may still be valid.
    #[error("Could not read the downloaded update.")]
    Unreadable,
    /// No trusted key signed this file for this release.
    #[error("The update signature is invalid.")]
    Invalid,
}

/// The release the shell expects the downloaded installer to be.
pub struct ExpectedUpdate<'a> {
    /// The version the release feed offers.
    pub version: &'a str,
    /// The running app's version; the update must be newer.
    pub current_version: &'a str,
}

fn decode_text(value: &str) -> Option<String> {
    let bytes = STANDARD.decode(value.trim()).ok()?;
    String::from_utf8(bytes).ok()
}

/// The trusted keys: base64 public key files separated by whitespace or
/// commas, as `ALLOY_UPDATER_PUBLIC_KEY` lists them. A list with a key that
/// does not decode is rejected whole, as the signer rejects it.
fn public_keys(list: &str) -> Option<Vec<PublicKey>> {
    let keys = list
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|key| !key.is_empty())
        .map(|key| PublicKey::decode(&decode_text(key)?).ok())
        .collect::<Option<Vec<_>>>()?;
    (!keys.is_empty()).then_some(keys)
}

/// The `file` and `version` fields of the signer's trusted comment,
/// `timestamp:<seconds>\tfile:<name>\tversion:<version>`. Each must appear
/// exactly once.
fn signed_release(comment: &str) -> Option<(&str, &str)> {
    let (mut file, mut version) = (None, None);
    for field in comment.split('\t') {
        let (name, value) = field.split_once(':')?;
        let slot = match name {
            "file" => &mut file,
            "version" => &mut version,
            _ => continue,
        };
        if slot.replace(value).is_some() {
            return None;
        }
    }
    Some((file?, version?))
}

/// Verifies the installer at `path` against `signature` while the file
/// streams through. The trusted key whose ID the signature names checks it,
/// and the signed trusted comment must name the file's own name and
/// `expected.version`, which must be newer than `expected.current_version`.
/// Only prehashed signatures, which `alloy-update-signer` writes, are
/// accepted.
pub fn verify_file(
    public_key_list: &str,
    signature: &str,
    path: &Path,
    expected: &ExpectedUpdate,
) -> Result<(), UpdateSignatureError> {
    use UpdateSignatureError::{Invalid, Unreadable};

    let Some(keys) = public_keys(public_key_list) else {
        log::warn!("The update public keys are invalid.");
        return Err(Invalid);
    };
    let signature = decode_text(signature)
        .and_then(|text| Signature::decode(&text).ok())
        .ok_or(Invalid)?;
    // `verify_stream` refuses a key whose ID differs from the signature's.
    let Some(mut verifier) = keys
        .iter()
        .find_map(|key| key.verify_stream(&signature).ok())
    else {
        log::warn!("The update is not signed by a trusted key.");
        return Err(Invalid);
    };
    check_release(signature.trusted_comment(), path, expected)?;

    let read_error = |error: std::io::Error| {
        log::warn!("Could not read the update {}: {error}", path.display());
        Unreadable
    };
    let mut file = File::open(path).map_err(read_error)?;
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(read_error)?;
        if read == 0 {
            break;
        }
        verifier.update(&buffer[..read]);
    }
    verifier.finalize().map_err(|error| {
        log::warn!("The update {} failed verification: {error}", path.display());
        Invalid
    })
}

/// Checks what the trusted comment claims. It is only authentic once the
/// global signature verifies, which `verify_file` checks last.
fn check_release(
    comment: &str,
    path: &Path,
    expected: &ExpectedUpdate,
) -> Result<(), UpdateSignatureError> {
    let Some((file, version)) = signed_release(comment) else {
        log::warn!("The update signature does not name a release: {comment:?}");
        return Err(UpdateSignatureError::Invalid);
    };
    let file_name = path.file_name().and_then(|name| name.to_str());
    if file_name != Some(file) {
        log::warn!("The update signature is for {file:?}, not {file_name:?}.");
        return Err(UpdateSignatureError::Invalid);
    }
    if version != expected.version {
        log::warn!(
            "The update signature is for version {version:?}, not {:?}.",
            expected.version
        );
        return Err(UpdateSignatureError::Invalid);
    }
    let newer = match (
        Version::parse(version),
        Version::parse(expected.current_version),
    ) {
        (Ok(signed), Ok(current)) => signed > current,
        _ => false,
    };
    if !newer {
        log::warn!(
            "The signed update version {version:?} is not newer than {:?}.",
            expected.current_version
        );
        return Err(UpdateSignatureError::Invalid);
    }
    Ok(())
}
