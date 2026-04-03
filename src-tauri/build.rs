fn main() {
    // 告诉 Cargo：当 Tauri 实际打包使用的 UI 资源变化时重新运行 build script。
    // 兼容保留旧 dist 路径监听，避免 prepare-gateway-bundle 复制前后的任一侧变化
    // 被增量构建错误复用旧资源。
    println!("cargo:rerun-if-changed=../dist/control-ui");
    println!("cargo:rerun-if-changed=./gateway-bundle/dist/control-ui");
    tauri_build::build()
}
