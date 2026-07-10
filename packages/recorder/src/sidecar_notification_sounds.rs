fn play_notification_sound(params: PlayNotificationSoundParams) -> Result<(), String> {
    let path = PathBuf::from(params.path);
    let volume = params.volume.clamp(0.0, 1.0);
    thread::Builder::new()
        .name("alloy-notification-sound".to_string())
        .spawn(move || {
            if let Err(error) = play_notification_sound_blocking(path, volume) {
                eprintln!("[{SIDE_CAR_NAME}] failed to play notification sound: {error}");
            }
        })
        .map(|_| ())
        .map_err(|error| format!("Failed to start notification sound thread: {error}"))
}

fn play_notification_sound_blocking(
    path: PathBuf,
    volume: f32,
) -> Result<(), String> {
    let file = fs::File::open(&path).map_err(|error| {
        format!(
            "Failed to open notification sound {}: {error}",
            path.display()
        )
    })?;
    let mut handle = rodio::DeviceSinkBuilder::open_default_sink()
        .map_err(|error| format!("Failed to open default audio output: {error}"))?;
    handle.log_on_drop(false);

    let player = rodio::Player::connect_new(handle.mixer());
    player.set_volume(volume);

    let source = rodio::Decoder::try_from(file).map_err(|error| {
        format!(
            "Failed to decode notification sound {}: {error}",
            path.display()
        )
    })?;
    player.append(source);
    player.sleep_until_end();
    Ok(())
}
