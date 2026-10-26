#[cfg(any(windows, target_os = "linux"))]
fn main() {
    alloy_recorder::run();
}

#[cfg(not(any(windows, target_os = "linux")))]
fn main() {
    eprintln!("alloy-agent runs only on Windows and Linux.");
    std::process::exit(1);
}
