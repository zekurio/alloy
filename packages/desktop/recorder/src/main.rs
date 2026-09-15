#[cfg(windows)]
fn main() {
    alloy_recorder::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("alloy-agent is currently Windows-only.");
    std::process::exit(1);
}
