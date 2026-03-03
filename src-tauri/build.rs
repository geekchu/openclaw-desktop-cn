fn main() {
    // 告诉 Cargo：当 UI 构建产物变化时重新运行 build script
    // 否则增量编译会跳过前端资源嵌入，导致 "No resource with given URL found"
    println!("cargo:rerun-if-changed=../dist/control-ui");
    tauri_build::build()
}
