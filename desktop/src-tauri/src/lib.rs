// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}