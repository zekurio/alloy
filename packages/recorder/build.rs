#[cfg(windows)]
fn main() {
    winresource::WindowsResource::new()
        .set_icon("assets/icon.ico")
        .set("FileDescription", "Alloy Recorder")
        .set("ProductName", "Alloy")
        .compile()
        .expect("failed to compile Windows resources");
}

#[cfg(not(windows))]
fn main() {}
