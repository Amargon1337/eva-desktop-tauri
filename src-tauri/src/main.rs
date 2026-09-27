// Eva Desktop — thin binary entry. All logic lives in the lib crate so Tauri's
// mobile/desktop entry points share one code path.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eva_desktop_lib::run()
}
