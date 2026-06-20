/// Picks the OBS encoder for the selected codec, falling back to HEVC then
/// H.264 when this OBS instance has no encoder for it. Encoder registration
/// can transiently fail (AMD's AMF helper probe under GPU load), and recording
/// in a fallback codec beats losing the session.
fn choose_video_encoder(
    settings: &RecordingSettings,
    available: &[ObsEncoderDescriptor],
    selected_gpu_label: Option<&str>,
) -> Option<(String, RecordingCodec)> {
    let mut codecs = vec![settings.codec.clone()];
    for fallback in [RecordingCodec::Hevc, RecordingCodec::H264] {
        if !codecs.contains(&fallback) {
            codecs.push(fallback);
        }
    }
    codecs.into_iter().find_map(|codec| {
        video_encoder_candidates(&settings.encoder, &codec, available, selected_gpu_label)
            .into_iter()
            .next()
            .map(|candidate| (candidate.id.clone(), codec))
    })
}

fn available_video_codecs(
    obs: &LibObs,
    settings: &RecordingSettings,
    available: &[ObsEncoderDescriptor],
    selected_gpu_label: Option<&str>,
) -> Vec<RecordingCodec> {
    [
        RecordingCodec::H264,
        RecordingCodec::Hevc,
        RecordingCodec::Av1,
    ]
    .into_iter()
    .filter(|codec| {
        codec_allowed_for_gpu_label(codec, selected_gpu_label)
            && can_create_video_codec(obs, settings, available, codec, selected_gpu_label)
    })
    .collect()
}

fn can_create_video_codec(
    obs: &LibObs,
    settings: &RecordingSettings,
    available: &[ObsEncoderDescriptor],
    codec: &RecordingCodec,
    selected_gpu_label: Option<&str>,
) -> bool {
    let candidates = video_encoder_candidates(
        &settings.encoder,
        codec,
        available,
        selected_gpu_label,
    );
    if candidates.is_empty() {
        return false;
    }

    unsafe {
        for candidate in candidates {
            let probe_settings = RecordingSettings {
                codec: codec.clone(),
                ..settings.clone()
            };
            let data = obs.create_data();
            let result = (|| {
                let quality = effective_quality(&probe_settings);
                configure_video_encoder(obs, data, &probe_settings, &quality)?;
                create_video_encoder(obs, &candidate.id, data)
            })();
            obs.release_data(data);

            if let Ok(encoder) = result {
                (obs.obs_encoder_release)(encoder);
                return true;
            }
        }
    }

    false
}

fn video_encoder_candidates<'a>(
    encoder: &RecordingEncoder,
    codec: &RecordingCodec,
    available: &'a [ObsEncoderDescriptor],
    selected_gpu_label: Option<&str>,
) -> Vec<&'a ObsEncoderDescriptor> {
    let mut candidates: Vec<_> = available
        .iter()
        .enumerate()
        .filter(|(_, candidate)| {
            video_encoder_matches(candidate, encoder, codec, selected_gpu_label)
        })
        .collect();
    candidates.sort_by_key(|(index, candidate)| (video_encoder_priority(candidate), *index));
    candidates
        .into_iter()
        .map(|(_, candidate)| candidate)
        .collect()
}

fn video_encoder_matches(
    encoder: &ObsEncoderDescriptor,
    target: &RecordingEncoder,
    codec: &RecordingCodec,
    selected_gpu_label: Option<&str>,
) -> bool {
    if encoder.kind != ObsEncoderKind::Video || encoder.is_internal_or_deprecated() {
        return false;
    }

    if !codec_allowed_for_gpu_label(codec, selected_gpu_label) {
        return false;
    }

    let Some(encoder_codec) = recording_codec_from_obs(&encoder.codec) else {
        return false;
    };
    if &encoder_codec != codec {
        return false;
    }

    match target {
        RecordingEncoder::Software => is_software_h264_encoder(encoder),
        RecordingEncoder::Hardware => !is_software_video_encoder(encoder),
    }
}

fn codec_allowed_for_gpu_label(codec: &RecordingCodec, selected_gpu_label: Option<&str>) -> bool {
    if codec != &RecordingCodec::Av1 {
        return true;
    }

    selected_gpu_label.is_none_or(|label| !amd_gpu_label_lacks_av1_encode(label))
}

fn selected_gpu_label<'a>(
    settings: &'a RecordingSettings,
    available_gpus: &'a [String],
) -> Option<&'a str> {
    if settings.gpu == "auto" {
        return available_gpus
            .first()
            .and_then(|gpu| gpu_setting_label(gpu));
    }

    gpu_setting_label(&settings.gpu).or_else(|| {
        let adapter = usize::try_from(gpu_adapter(settings)).ok()?;
        available_gpus
            .get(adapter)
            .and_then(|gpu| gpu_setting_label(gpu))
    })
}

fn gpu_setting_label(value: &str) -> Option<&str> {
    let mut parts = value.splitn(3, ':');
    (parts.next() == Some("adapter")).then_some(())?;
    parts.next()?;
    parts.next().map(str::trim).filter(|label| !label.is_empty())
}

fn amd_gpu_label_lacks_av1_encode(label: &str) -> bool {
    let normalized = label.to_ascii_lowercase();
    if !normalized.contains("amd") && !normalized.contains("radeon") {
        return false;
    }

    amd_radeon_rx_model(&normalized).is_some_and(|model| model < 7000)
        || amd_radeon_pro_w_model(&normalized).is_some_and(|model| model < 7000)
}

fn amd_radeon_rx_model(label: &str) -> Option<u32> {
    parse_model_after_token(label, "rx")
}

fn amd_radeon_pro_w_model(label: &str) -> Option<u32> {
    parse_model_after_token(label, "w")
}

fn parse_model_after_token(label: &str, token: &str) -> Option<u32> {
    let normalized = normalize_gpu_label_tokens(label);
    let mut previous = "";
    for part in normalized.split_whitespace() {
        if previous == token {
            if let Some(model) = leading_u32(part) {
                return Some(model);
            }
        }

        if let Some(rest) = part.strip_prefix(token) {
            if let Some(model) = leading_u32(rest) {
                return Some(model);
            }
        }

        previous = part;
    }
    None
}

fn normalize_gpu_label_tokens(label: &str) -> String {
    label
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
        .collect()
}

fn leading_u32(value: &str) -> Option<u32> {
    let digits: String = value
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    (!digits.is_empty())
        .then(|| digits.parse::<u32>().ok())
        .flatten()
}

fn video_encoder_priority(encoder: &ObsEncoderDescriptor) -> u8 {
    if encoder.has_cap(OBS_ENCODER_CAP_PASS_TEXTURE) {
        0
    } else {
        1
    }
}

fn has_software_h264_encoder(available: &[ObsEncoderDescriptor]) -> bool {
    available.iter().any(is_software_h264_encoder)
}

fn is_software_h264_encoder(encoder: &ObsEncoderDescriptor) -> bool {
    is_software_video_encoder(encoder)
        && !encoder.is_internal_or_deprecated()
        && recording_codec_from_obs(&encoder.codec) == Some(RecordingCodec::H264)
}

fn is_software_video_encoder(encoder: &ObsEncoderDescriptor) -> bool {
    encoder.id == "obs_x264"
        || encoder
            .display_name
            .as_deref()
            .is_some_and(|name| name.to_ascii_lowercase().contains("x264"))
}

fn recording_codec_from_obs(codec: &str) -> Option<RecordingCodec> {
    let normalized = codec.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "h264" | "avc" => Some(RecordingCodec::H264),
        "h265" | "hevc" => Some(RecordingCodec::Hevc),
        "av1" => Some(RecordingCodec::Av1),
        _ => None,
    }
}

fn is_aac_codec(codec: &str) -> bool {
    codec.trim().eq_ignore_ascii_case("aac")
}

fn unavailable_video_encoder_message(settings: &RecordingSettings) -> String {
    format!(
        "{} is not available for the selected {} encoder. Choose a supported codec or switch encoders.",
        codec_label(&settings.codec),
        encoder_label(&settings.encoder),
    )
}

fn codec_label(codec: &RecordingCodec) -> &'static str {
    match codec {
        RecordingCodec::H264 => "H.264",
        RecordingCodec::Hevc => "HEVC",
        RecordingCodec::Av1 => "AV1",
    }
}

fn encoder_label(encoder: &RecordingEncoder) -> &'static str {
    match encoder {
        RecordingEncoder::Hardware => "GPU",
        RecordingEncoder::Software => "CPU",
    }
}

fn choose_audio_encoder(available: &[ObsEncoderDescriptor]) -> Option<String> {
    available
        .iter()
        .find(|encoder| {
            encoder.kind == ObsEncoderKind::Audio
                && !encoder.is_internal_or_deprecated()
                && is_aac_codec(&encoder.codec)
        })
        .map(|encoder| encoder.id.clone())
}

#[cfg(test)]
mod obs_encoder_policy_tests {
    use super::*;

    fn encoder(id: &str, kind: ObsEncoderKind, codec: &str, caps: u32) -> ObsEncoderDescriptor {
        ObsEncoderDescriptor {
            id: id.to_string(),
            kind,
            codec: codec.to_string(),
            caps,
            display_name: None,
        }
    }

    #[test]
    fn hardware_candidates_should_prefer_texture_capable_encoders() {
        let encoders = vec![
            encoder("obs_x264", ObsEncoderKind::Video, "h264", 0),
            encoder("plain_hardware", ObsEncoderKind::Video, "h264", 0),
            encoder(
                "texture_hardware",
                ObsEncoderKind::Video,
                "h264",
                OBS_ENCODER_CAP_PASS_TEXTURE,
            ),
        ];

        let candidates = video_encoder_candidates(
            &RecordingEncoder::Hardware,
            &RecordingCodec::H264,
            &encoders,
            None,
        );

        assert_eq!(
            candidates.first().map(|encoder| encoder.id.as_str()),
            Some("texture_hardware"),
        );
    }

    #[test]
    fn software_candidates_should_only_include_x264_h264() {
        let encoders = vec![
            encoder("obs_x264", ObsEncoderKind::Video, "h264", 0),
            encoder("software_hevc", ObsEncoderKind::Video, "hevc", 0),
            encoder("hardware_h264", ObsEncoderKind::Video, "h264", 0),
        ];

        let candidates = video_encoder_candidates(
            &RecordingEncoder::Software,
            &RecordingCodec::H264,
            &encoders,
            None,
        );

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "obs_x264");
    }

    #[test]
    fn deprecated_encoders_should_not_be_candidates() {
        let encoders = vec![
            encoder(
                "deprecated_h264",
                ObsEncoderKind::Video,
                "h264",
                OBS_ENCODER_CAP_DEPRECATED,
            ),
            encoder("current_h264", ObsEncoderKind::Video, "h264", 0),
        ];

        let candidates = video_encoder_candidates(
            &RecordingEncoder::Hardware,
            &RecordingCodec::H264,
            &encoders,
            None,
        );

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "current_h264");
    }

    #[test]
    fn amd_rx_6000_should_not_be_an_av1_candidate() {
        let encoders = vec![encoder(
            "av1_texture_amf",
            ObsEncoderKind::Video,
            "av1",
            OBS_ENCODER_CAP_PASS_TEXTURE,
        )];

        let candidates = video_encoder_candidates(
            &RecordingEncoder::Hardware,
            &RecordingCodec::Av1,
            &encoders,
            Some("AMD Radeon RX 6800"),
        );

        assert!(candidates.is_empty());
    }

    #[test]
    fn amd_rx_7000_should_remain_an_av1_candidate() {
        let encoders = vec![encoder(
            "av1_texture_amf",
            ObsEncoderKind::Video,
            "av1",
            OBS_ENCODER_CAP_PASS_TEXTURE,
        )];

        let candidates = video_encoder_candidates(
            &RecordingEncoder::Hardware,
            &RecordingCodec::Av1,
            &encoders,
            Some("AMD Radeon RX 7900 XTX"),
        );

        assert_eq!(
            candidates.first().map(|encoder| encoder.id.as_str()),
            Some("av1_texture_amf"),
        );
    }

    #[test]
    fn selected_gpu_label_should_use_first_adapter_for_auto() {
        let settings = RecordingSettings::default();
        let gpus = vec!["adapter:0:AMD Radeon RX 6800".to_string()];

        assert_eq!(
            selected_gpu_label(&settings, &gpus),
            Some("AMD Radeon RX 6800"),
        );
    }
}
