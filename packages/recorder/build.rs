fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    winresource::WindowsResource::new()
        .set_icon("assets/icon.ico")
        .set("FileDescription", "Alloy Recorder")
        .set("ProductName", "Alloy")
        .compile()
        .expect("failed to compile Windows resources");
}
