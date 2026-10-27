//! Checks a downloaded update installer against the minisign signature that
//! the release publishes for it. The public key and each signature are base64
//! of the minisign files; `alloy-update-signer` writes the signatures.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};

const INVALID: &str = "The update signature is invalid.";

fn decode_text(value: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|_| INVALID.to_owned())?;
    String::from_utf8(bytes).map_err(|_| INVALID.to_owned())
}

/// Verifies `path` against `signature` with `public_key` while the file
/// streams through. Only prehashed signatures, which `alloy-update-signer`
/// writes, are accepted.
pub fn verify_file(public_key: &str, signature: &str, path: &Path) -> Result<(), String> {
    let public_key = PublicKey::decode(&decode_text(public_key)?).map_err(|error| {
        log::warn!("The update public key is invalid: {error}");
        "The update public key is invalid.".to_owned()
    })?;
    let signature = Signature::decode(&decode_text(signature)?).map_err(|_| INVALID.to_owned())?;
    let read_error = |error: std::io::Error| {
        log::warn!("Could not read the update {}: {error}", path.display());
        "Could not read the downloaded update.".to_owned()
    };
    let mut file = File::open(path).map_err(read_error)?;
    let mut verifier = public_key
        .verify_stream(&signature)
        .map_err(|_| INVALID.to_owned())?;
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
        INVALID.to_owned()
    })
}
