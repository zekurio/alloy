//! The update check against signatures made the way `alloy-update-signer`
//! makes them, with freshly generated keys.

use std::fs;
use std::path::PathBuf;

use alloy_desktop::update_signature::{ExpectedUpdate, UpdateSignatureError, verify_file};
use base64::{Engine, engine::general_purpose::STANDARD};
use minisign::KeyPair;
use tempfile::TempDir;

const INSTALLER: &str = "Alloy-Desktop-0.2.0-win-x64-setup.exe";
const CONTENTS: &[u8] = b"an installer";
const UPDATE: ExpectedUpdate<'static> = ExpectedUpdate {
    version: "0.2.0",
    current_version: "0.1.0",
};

struct Key {
    pair: KeyPair,
    /// Base64 of the public key file, as `ALLOY_UPDATER_PUBLIC_KEY` holds it.
    public: String,
}

fn key() -> Key {
    let pair = KeyPair::generate_unencrypted_keypair().unwrap();
    let public = STANDARD.encode(pair.pk.to_box().unwrap().into_string());
    Key { pair, public }
}

/// Signs `contents` with the signer's trusted comment.
fn sign(key: &Key, contents: &[u8], file: &str, version: &str) -> String {
    let comment = format!("timestamp:1700000000\tfile:{file}\tversion:{version}");
    let signature = minisign::sign(
        Some(&key.pair.pk),
        &key.pair.sk,
        contents,
        Some(&comment),
        Some("signature from the Alloy update key"),
    )
    .unwrap();
    STANDARD.encode(signature.to_string())
}

/// Writes `contents` as `name` in a new folder, which lives as long as the
/// returned guard.
fn installer(name: &str, contents: &[u8]) -> (TempDir, PathBuf) {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join(name);
    fs::write(&path, contents).unwrap();
    (folder, path)
}

fn assert_invalid(result: Result<(), UpdateSignatureError>) {
    assert!(
        matches!(result, Err(UpdateSignatureError::Invalid)),
        "expected an invalid signature, got {result:?}"
    );
}

#[test]
fn accepts_a_signature_for_this_release() {
    let key = key();
    let signature = sign(&key, CONTENTS, INSTALLER, "0.2.0");
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    verify_file(&key.public, &signature, &path, &UPDATE).unwrap();
}

#[test]
fn trusts_every_listed_key() {
    let (old, spare) = (key(), key());
    let list = format!("{}, \n{}\n", old.public, spare.public);
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    for signer in [&old, &spare] {
        let signature = sign(signer, CONTENTS, INSTALLER, "0.2.0");
        verify_file(&list, &signature, &path, &UPDATE).unwrap();
    }
}

#[test]
fn rejects_an_untrusted_key() {
    let (trusted, other) = (key(), key());
    let signature = sign(&other, CONTENTS, INSTALLER, "0.2.0");
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    assert_invalid(verify_file(&trusted.public, &signature, &path, &UPDATE));
}

#[test]
fn rejects_a_list_with_an_invalid_key() {
    let key = key();
    let signature = sign(&key, CONTENTS, INSTALLER, "0.2.0");
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    for list in ["", " , ", &format!("{},bm90IGEga2V5", key.public)] {
        assert_invalid(verify_file(list, &signature, &path, &UPDATE));
    }
}

#[test]
fn rejects_a_tampered_file() {
    let key = key();
    let signature = sign(&key, CONTENTS, INSTALLER, "0.2.0");
    let (_folder, path) = installer(INSTALLER, b"another installer");
    assert_invalid(verify_file(&key.public, &signature, &path, &UPDATE));
}

#[test]
fn rejects_another_file_name() {
    let key = key();
    let signature = sign(
        &key,
        CONTENTS,
        "Alloy-Desktop-0.2.0-win-arm64-setup.exe",
        "0.2.0",
    );
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    assert_invalid(verify_file(&key.public, &signature, &path, &UPDATE));
}

#[test]
fn rejects_another_version() {
    let key = key();
    let signature = sign(&key, CONTENTS, INSTALLER, "0.1.5");
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    assert_invalid(verify_file(&key.public, &signature, &path, &UPDATE));
}

#[test]
fn rejects_a_version_that_is_not_newer() {
    let key = key();
    let signature = sign(&key, CONTENTS, INSTALLER, "0.2.0");
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    for current_version in ["0.2.0", "0.10.0", "not a version"] {
        let update = ExpectedUpdate {
            current_version,
            ..UPDATE
        };
        assert_invalid(verify_file(&key.public, &signature, &path, &update));
    }
}

#[test]
fn rejects_a_signature_that_names_no_release() {
    let key = key();
    let signature = minisign::sign(Some(&key.pair.pk), &key.pair.sk, CONTENTS, None, None)
        .unwrap()
        .to_string();
    let (_folder, path) = installer(INSTALLER, CONTENTS);
    assert_invalid(verify_file(
        &key.public,
        &STANDARD.encode(signature),
        &path,
        &UPDATE,
    ));
}

#[test]
fn reports_a_missing_file_as_unreadable() {
    let key = key();
    let signature = sign(&key, CONTENTS, INSTALLER, "0.2.0");
    let folder = tempfile::tempdir().unwrap();
    let result = verify_file(
        &key.public,
        &signature,
        &folder.path().join(INSTALLER),
        &UPDATE,
    );
    assert!(
        matches!(result, Err(UpdateSignatureError::Unreadable)),
        "expected an unreadable file, got {result:?}"
    );
}
