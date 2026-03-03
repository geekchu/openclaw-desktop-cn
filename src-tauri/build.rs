fn main() {
    // 告诉 Cargo：当 frontend/ 目录变化时重新运行 build script
    // 否则增量编译会跳过前端资源嵌入，导致 "No resource with given URL found"
    println!("cargo:rerun-if-changed=frontend");
    tauri_build::build()
}
