//! Checks a downloaded update installer against the minisign signature that
//! the release publishes for it. The key pair is the one the Tauri updater
//! trusted: the public key and each signature are base64 of the minisign
//! files, the format `tauri signer` writes.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{Error as MinisignError, PublicKey, Signature};

const INVALID: &str = "The update signature is invalid.";

fn decode_text(value: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|_| INVALID.to_owned())?;
    String::from_utf8(bytes).map_err(|_| INVALID.to_owned())
}

/// Verifies `path` against `signature` with `public_key`. Prehashed
/// signatures are checked while the file streams through; legacy ones, which
/// sign the raw bytes, read the file whole.
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
    let verified = match public_key.verify_stream(&signature) {
        Ok(mut verifier) => {
            let mut buffer = vec![0_u8; 1024 * 1024];
            loop {
                let read = file.read(&mut buffer).map_err(read_error)?;
                if read == 0 {
                    break;
                }
                verifier.update(&buffer[..read]);
            }
            verifier.finalize()
        }
        Err(MinisignError::UnsupportedLegacyMode) => {
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).map_err(read_error)?;
            public_key.verify(&bytes, &signature, true)
        }
        Err(error) => Err(error),
    };
    verified.map_err(|error| {
        log::warn!("The update {} failed verification: {error}", path.display());
        INVALID.to_owned()
    })
}
